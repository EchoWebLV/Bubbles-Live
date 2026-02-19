// Server-side game state management
// Physics + targeting run on the server
// Combat resolution (damage, kills, XP) runs on MagicBlock Ephemeral Rollup

const { MagicBlockService } = require('./magicblock');
const { loadAllPhotos, savePhoto, deletePhoto } = require('./playerStore');

const BATTLE_CONFIG = {
  maxHealth: 100,       // base — overridden by onchain PlayerState
  bulletDamage: 0.1,    // base damage per bullet
  fireRate: 200,        // ms between shots
  bulletSpeed: 8,
  ghostDuration: 60000, // 60 seconds (visual only; ER has its own respawn timer)
  curveStrength: { min: 25, max: 60 },
};

const PHYSICS_CONFIG = {
  minSpeed: 0.4,
  maxSpeed: 3.0,
  velocityDecay: 0.997,
  collisionPadding: 5,
  wallBounce: 0.75,
  repulsionRange: 15,
  repulsionStrength: 0.04,
  nudgeInterval: 3000,
  nudgeStrength: 0.35,
};

// Progression formulas (mirror onchain but used for local preview)
// On-chain uses u16: BASE_ATTACK=10, +5/level, BASE_HEALTH=100, +10/level
// Local uses floats: scale damage by /100
const PROGRESSION = {
  xpPerKill: 25,
  xpPerDeath: 5,
  levelScale: 50,
  healthPerLevel: 10,
  damagePerLevel: 0.05, // on-chain +5 per level → local +0.05
  baseHealth: 100,
  baseDamage: 0.1,      // on-chain 10 → local 0.1
};

function calcLevel(xp) {
  return 1 + Math.floor(Math.sqrt(xp / PROGRESSION.levelScale));
}
function calcMaxHealth(healthLevel) {
  return PROGRESSION.baseHealth + (healthLevel - 1) * PROGRESSION.healthPerLevel;
}
function calcAttackPower(attackLevel) {
  return PROGRESSION.baseDamage + (attackLevel - 1) * PROGRESSION.damagePerLevel;
}


class GameState {
  constructor() {
    this.holders = [];
    this.battleBubbles = new Map();
    this.bullets = [];
    this.damageNumbers = [];
    this.killFeed = [];
    this.eventLog = [];
    this.topKillers = [];
    this.dimensions = { width: 3840, height: 2160 };
    this.lastUpdateTime = Date.now();
    this.bulletIdCounter = 0;
    this.isRunning = false;
    this.tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS || '';
    this.token = {
      address: this.tokenAddress,
      symbol: 'Loading...',
      name: 'Loading...',
      decimals: 9,
      totalSupply: 0,
      logoUri: '',
    };
    this.priceData = null;
    this.pendingRefresh = false;
    this.lastRefreshTime = 0;
    this.minRefreshInterval = 5000;
    this.lastPriceUpdate = 0;
    this.newHolders = new Set();
    this.popEffects = [];
    this.missingHolderCounts = new Map();
    this.playerPhotos = new Map(); // wallet -> base64 data URL (max 50KB)
    this.playerCache = new Map();  // In-memory cache: wallet -> stats from ER
    this.magicBlock = new MagicBlockService();
    this.magicBlockReady = false;

    // Damage aggregation buffer: "attacker|victim" → { attacker, victim, damage, isLocalKill }
    // Instead of sending one tx per bullet, we accumulate damage and flush every N seconds.
    this.damageBuffer = new Map();
    this.lastDamageFlush = Date.now();
    this.damageFlushInterval = 3000; // flush every 3 seconds
    this.isFlushingDamage = false;
    this.maxConcurrentFlush = 3; // max txs sent per flush cycle

    // Player registration queue
    this.registerQueue = [];
    this.isProcessingRegistration = false;

    // ER state sync timer
    this.erSyncInterval = null;
  }

  // Fast price-only update (doesn't fetch full metadata)
  async updatePrice() {
    try {
      const isPumpToken = this.tokenAddress.toLowerCase().endsWith('pump');
      
      const [dexResult, jupResult] = await Promise.allSettled([
        fetch(`https://api.dexscreener.com/latest/dex/tokens/${this.tokenAddress}`)
          .then(r => r.json())
          .catch(() => null),
        fetch(`https://api.jup.ag/price/v2?ids=${this.tokenAddress}`)
          .then(r => r.json())
          .catch(() => null),
      ]);

      let price = 0;
      let priceChange1h = this.priceData?.priceChange1h || 0;
      let priceChange24h = this.priceData?.priceChange24h || 0;

      if (jupResult.status === 'fulfilled' && jupResult.value?.data?.[this.tokenAddress]) {
        price = parseFloat(jupResult.value.data[this.tokenAddress].price) || 0;
      }

      if (dexResult.status === 'fulfilled' && dexResult.value?.pairs?.[0]) {
        const pair = dexResult.value.pairs[0];
        if (!price) {
          price = parseFloat(pair.priceUsd) || 0;
        }
        priceChange1h = pair.priceChange?.h1 || 0;
        priceChange24h = pair.priceChange?.h24 || 0;
        
        if (!this.token.logoUri && pair.info?.imageUrl) {
          this.token.logoUri = pair.info.imageUrl;
        }
      }

      if (price > 0) {
        const totalSupply = isPumpToken ? 1_000_000_000 : (this.token.totalSupply || 1_000_000_000);
        const marketCap = price * totalSupply;

        this.priceData = {
          ...this.priceData,
          price: price,
          priceChange1h: priceChange1h,
          priceChange24h: priceChange24h,
          marketCap: marketCap,
        };
        
        this.lastPriceUpdate = Date.now();
      }
    } catch (error) {
      console.error('Price update error:', error.message);
    }
  }

  async fetchTokenMetadata() {
    try {
      if (!this.tokenAddress) {
        console.log('No token address provided, skipping metadata fetch');
        return;
      }

      const isPumpToken = this.tokenAddress.toLowerCase().endsWith('pump');
      
      const dexResponse = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${this.tokenAddress}`);
      const dexData = await dexResponse.json();
      
      if (dexData.pairs && dexData.pairs.length > 0) {
        const pair = dexData.pairs[0];
        const tokenInfo = pair.baseToken.address.toLowerCase() === this.tokenAddress.toLowerCase() 
          ? pair.baseToken 
          : pair.quoteToken;
        
        this.token = {
          address: this.tokenAddress,
          symbol: tokenInfo.symbol || 'UNKNOWN',
          name: tokenInfo.name || 'Unknown Token',
          decimals: isPumpToken ? 6 : 9,
          totalSupply: isPumpToken ? 1_000_000_000 : 0,
          logoUri: pair.info?.imageUrl || '',
        };
        
        let marketCap = parseFloat(pair.fdv) || parseFloat(pair.marketCap) || 0;
        const price = parseFloat(pair.priceUsd) || 0;
        
        if (isPumpToken && price > 0) {
          const calculatedMcap = price * 1_000_000_000;
          if (Math.abs(calculatedMcap - marketCap) > marketCap * 0.1) {
            console.log(`Market cap mismatch - DexScreener: $${marketCap.toFixed(2)}, Calculated: $${calculatedMcap.toFixed(2)}`);
          }
          marketCap = calculatedMcap;
        }
        
        this.priceData = {
          price: price,
          priceChange1h: pair.priceChange?.h1 || 0,
          priceChange24h: pair.priceChange?.h24 || 0,
          volume24h: parseFloat(pair.volume?.h24) || 0,
          liquidity: parseFloat(pair.liquidity?.usd) || 0,
          marketCap: marketCap,
        };
        
        console.log('Token:', this.token.symbol, '-', this.token.name);
        console.log('Price: $' + price.toExponential(4), '| Market Cap: $' + marketCap.toFixed(2));
        return;
      }

      const apiKey = process.env.HELIUS_API_KEY;
      if (apiKey) {
        const heliusResponse = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 'metadata',
            method: 'getAsset',
            params: { id: this.tokenAddress },
          }),
        });
        
        const heliusData = await heliusResponse.json();
        
        if (heliusData.result) {
          const asset = heliusData.result;
          this.token = {
            address: this.tokenAddress,
            symbol: asset.content?.metadata?.symbol || 'UNKNOWN',
            name: asset.content?.metadata?.name || 'Unknown Token',
            decimals: 9,
            totalSupply: 0,
            logoUri: asset.content?.links?.image || asset.content?.files?.[0]?.uri || '',
          };
          return;
        }
      }

      console.log('Could not fetch token metadata');
    } catch (error) {
      console.error('Error fetching token metadata:', error.message);
    }
  }

  async fetchHolders() {
    try {
      const apiKey = process.env.HELIUS_API_KEY;
      console.log('Fetching holders... API Key:', apiKey ? 'present' : 'MISSING', 'Token:', this.tokenAddress);
      
      if (!apiKey || !this.tokenAddress) {
        console.error('ERROR: Missing HELIUS_API_KEY or TOKEN_ADDRESS');
        return [];
      }

      const response = await fetch(`https://mainnet.helius-rpc.com/?api-key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 'holders',
          method: 'getTokenAccounts',
          params: {
            mint: this.tokenAddress,
            limit: 1000,
          },
        }),
      });

      const data = await response.json();
      console.log('Helius response - total accounts:', data.result?.total || 0);
      
      if (data.error || !data.result?.token_accounts) {
        console.error('Helius API error:', data.error || 'No token_accounts in response');
        return [];
      }

      const accounts = data.result.token_accounts;
      const totalSupply = accounts.reduce((sum, acc) => sum + acc.amount, 0);

      const maxHolders = parseInt(process.env.MAX_HOLDERS_DISPLAY) || 500;
      const minPercentage = parseFloat(process.env.MIN_HOLDER_PERCENTAGE) || 0.01;
      
      const holders = accounts
        .sort((a, b) => b.amount - a.amount)
        .map((account) => {
          const percentage = totalSupply > 0 ? (account.amount / totalSupply) * 100 : 0;
          return {
            address: account.owner,
            balance: account.amount,
            percentage,
            color: this.getHolderColor(percentage, account.owner),
            radius: this.calculateRadius(percentage),
            x: undefined,
            y: undefined,
            vx: (Math.random() - 0.5) * 2,
            vy: (Math.random() - 0.5) * 2,
          };
        })
        .filter(h => h.percentage > minPercentage)
        .slice(0, maxHolders);

      return holders;
    } catch (error) {
      console.error('Error fetching holders:', error);
      return [];
    }
  }

  getHolderColor(percentage, address) {
    let hash = 0;
    for (let i = 0; i < address.length; i++) {
      const char = address.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    
    const hue = Math.abs(hash % 360);
    const saturation = 65 + Math.abs((hash >> 8) % 25);
    let lightness = 50;
    
    if (percentage >= 5) {
      lightness = 55 + Math.abs((hash >> 16) % 10);
    } else if (percentage >= 1) {
      lightness = 50 + Math.abs((hash >> 16) % 10);
    } else {
      lightness = 45 + Math.abs((hash >> 16) % 15);
    }
    
    return this.hslToHex(hue, saturation, lightness);
  }

  hslToHex(h, s, l) {
    s /= 100;
    l /= 100;
    const a = s * Math.min(l, 1 - l);
    const f = n => {
      const k = (n + h / 30) % 12;
      const color = l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
      return Math.round(255 * color).toString(16).padStart(2, '0');
    };
    return `#${f(0)}${f(8)}${f(4)}`;
  }

  calculateRadius(percentage) {
    const minRadius = 8;
    const maxRadius = 45;
    const logMin = Math.log(0.001);
    const logMax = Math.log(100);
    const logPct = Math.log(Math.max(0.001, percentage));
    const normalized = (logPct - logMin) / (logMax - logMin);
    return minRadius + normalized * (maxRadius - minRadius);
  }

  initializePositions() {
    const { width, height } = this.dimensions;
    const margin = 150;

    this.holders.forEach((holder) => {
      if (holder.x === undefined || holder.y === undefined) {
        holder.x = margin + Math.random() * (width - margin * 2);
        holder.y = margin + Math.random() * (height - margin * 2);
        holder.vx = (Math.random() - 0.5) * 2;
        holder.vy = (Math.random() - 0.5) * 2;
      }

      if (!this.battleBubbles.has(holder.address)) {
        const cached = this.playerCache.get(holder.address);
        const cachedXp = cached ? (cached.xp || 0) : 0;
        const lvl = Math.min(calcLevel(cachedXp), 20);
        const cappedMaxHealth = cached ? Math.min(cached.maxHealth, calcMaxHealth(lvl)) : BATTLE_CONFIG.maxHealth;
        const cappedAttack = cached ? Math.min(cached.attackPower, calcAttackPower(lvl)) : BATTLE_CONFIG.bulletDamage;

        this.battleBubbles.set(holder.address, {
          address: holder.address,
          health: cappedMaxHealth,
          maxHealth: cappedMaxHealth,
          attackPower: cappedAttack,
          isGhost: false,
          ghostUntil: null,
          lastShotTime: 0,
          kills: cached ? cached.kills : 0,
          deaths: cached ? cached.deaths : 0,
          xp: cachedXp,
          healthLevel: cached ? cached.healthLevel : 1,
          attackLevel: cached ? cached.attackLevel : 1,
          isAlive: true,
        });
      }
    });
  }

  // ─── Main Game Loop ──────────────────────────────────────────────

  tick() {
    const now = Date.now();
    const deltaTime = Math.min((now - this.lastUpdateTime) / 16, 3);
    this.lastUpdateTime = now;

    if (this.holders.length === 0) return;

    const { width, height } = this.dimensions;

    // Update physics
    this.holders.forEach(holder => {
      if (holder.x === undefined || holder.y === undefined) return;

      holder.x += (holder.vx || 0) * deltaTime;
      holder.y += (holder.vy || 0) * deltaTime;
      holder.vx = (holder.vx || 0) * PHYSICS_CONFIG.velocityDecay;
      holder.vy = (holder.vy || 0) * PHYSICS_CONFIG.velocityDecay;

      const margin = holder.radius + 10;
      if (holder.x < margin) { holder.x = margin; holder.vx = Math.abs(holder.vx) * PHYSICS_CONFIG.wallBounce; }
      if (holder.x > width - margin) { holder.x = width - margin; holder.vx = -Math.abs(holder.vx) * PHYSICS_CONFIG.wallBounce; }
      if (holder.y < margin) { holder.y = margin; holder.vy = Math.abs(holder.vy) * PHYSICS_CONFIG.wallBounce; }
      if (holder.y > height - margin) { holder.y = height - margin; holder.vy = -Math.abs(holder.vy) * PHYSICS_CONFIG.wallBounce; }

      const speed = Math.sqrt((holder.vx || 0) ** 2 + (holder.vy || 0) ** 2);
      if (speed < PHYSICS_CONFIG.minSpeed && speed > 0) {
        const scale = PHYSICS_CONFIG.minSpeed / speed;
        holder.vx *= scale;
        holder.vy *= scale;
      } else if (speed === 0) {
        const angle = Math.random() * Math.PI * 2;
        holder.vx = Math.cos(angle) * PHYSICS_CONFIG.minSpeed;
        holder.vy = Math.sin(angle) * PHYSICS_CONFIG.minSpeed;
      }
      if (speed > PHYSICS_CONFIG.maxSpeed) {
        const scale = PHYSICS_CONFIG.maxSpeed / speed;
        holder.vx *= scale;
        holder.vy *= scale;
      }
    });

    // Bubble collisions + soft repulsion
    for (let i = 0; i < this.holders.length; i++) {
      for (let j = i + 1; j < this.holders.length; j++) {
        const a = this.holders[i];
        const b = this.holders[j];
        if (a.x === undefined || b.x === undefined) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist === 0) continue;

        const nx = dx / dist;
        const ny = dy / dist;
        const minDist = a.radius + b.radius + PHYSICS_CONFIG.collisionPadding;

        if (dist < minDist) {
          const overlap = minDist - dist;
          const separation = overlap / 2 + 1;
          a.x -= nx * separation;
          a.y -= ny * separation;
          b.x += nx * separation;
          b.y += ny * separation;

          const relVelX = (b.vx || 0) - (a.vx || 0);
          const relVelY = (b.vy || 0) - (a.vy || 0);
          const relVelDotNormal = relVelX * nx + relVelY * ny;

          if (relVelDotNormal < 0) {
            const massA = a.radius * a.radius;
            const massB = b.radius * b.radius;
            const totalMass = massA + massB;
            const impulse = (2 * relVelDotNormal) / totalMass;
            a.vx += impulse * massB * nx * 0.8;
            a.vy += impulse * massB * ny * 0.8;
            b.vx -= impulse * massA * nx * 0.8;
            b.vy -= impulse * massA * ny * 0.8;
          }
        } else if (dist < minDist + PHYSICS_CONFIG.repulsionRange) {
          const gap = dist - minDist;
          const t = 1 - gap / PHYSICS_CONFIG.repulsionRange;
          const force = t * t * PHYSICS_CONFIG.repulsionStrength;
          a.vx -= nx * force;
          a.vy -= ny * force;
          b.vx += nx * force;
          b.vy += ny * force;
        }
      }
    }

    // Random nudge to break up static clusters
    this.holders.forEach(holder => {
      if (holder.x === undefined) return;
      if (!holder._lastNudge) holder._lastNudge = now - Math.random() * PHYSICS_CONFIG.nudgeInterval;
      if (now - holder._lastNudge > PHYSICS_CONFIG.nudgeInterval) {
        holder._lastNudge = now;
        const angle = Math.random() * Math.PI * 2;
        holder.vx += Math.cos(angle) * PHYSICS_CONFIG.nudgeStrength;
        holder.vy += Math.sin(angle) * PHYSICS_CONFIG.nudgeStrength;
      }
    });

    // Check ghost respawns (local visual timer + ER respawn)
    this.battleBubbles.forEach((bubble, address) => {
      if (bubble.isGhost && bubble.ghostUntil && now >= bubble.ghostUntil) {
        bubble.isGhost = false;
        bubble.ghostUntil = null;
        bubble.health = bubble.maxHealth;
        bubble.isAlive = true;
        bubble.respawnedAt = now;
        this.addEventLog(`${address.slice(0, 6)}... respawned!`);

        // Clear any stale queued damage targeting this bubble
        for (const [key, entry] of this.damageBuffer) {
          if (entry.victim === address) {
            this.damageBuffer.delete(key);
          }
        }

        // Also respawn on ER (the ER logs the event with a tx on success)
        if (this.magicBlockReady) {
          this.magicBlock.deathLogged.delete(address);
          this.magicBlock.respawnPlayer(address).catch(() => {
            // ER respawn failed — still log locally so it shows in on-chain records
            this.magicBlock._logEvent('respawn', `Player ${address.slice(0, 6)}... respawned`, null, { wallet: address });
          });
        }
      }
    });

    // Shooting logic
    this.holders.forEach(holder => {
      if (holder.x === undefined) return;
      
      const battleBubble = this.battleBubbles.get(holder.address);
      if (!battleBubble || battleBubble.isGhost) return;
      if (now - battleBubble.lastShotTime < BATTLE_CONFIG.fireRate) return;

      let closest = null;
      let closestDist = Infinity;

      this.holders.forEach(target => {
        if (target.address === holder.address || target.x === undefined) return;
        const targetBattle = this.battleBubbles.get(target.address);
        if (targetBattle?.isGhost) return;

        const dx = target.x - holder.x;
        const dy = target.y - holder.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist) {
          closestDist = dist;
          closest = target;
        }
      });

      if (closest) {
        const dx = closest.x - holder.x;
        const dy = closest.y - holder.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const curveDir = Math.random() > 0.5 ? 1 : -1;

        let damage = battleBubble.attackPower || BATTLE_CONFIG.bulletDamage;
        if (!isFinite(damage) || damage > 5) {
          console.warn(`DAMAGE ANOMALY: ${holder.address.slice(0,6)} attackPower=${battleBubble.attackPower} attackLevel=${battleBubble.attackLevel} — clamping to base`);
          damage = BATTLE_CONFIG.bulletDamage;
          battleBubble.attackPower = BATTLE_CONFIG.bulletDamage;
        }

        this.bullets.push({
          id: `b-${this.bulletIdCounter++}`,
          shooterAddress: holder.address,
          targetAddress: closest.address,
          shooterColor: holder.color,
          x: holder.x,
          y: holder.y,
          startX: holder.x,
          startY: holder.y,
          targetX: closest.x,
          targetY: closest.y,
          progress: 0,
          curveDirection: curveDir,
          curveStrength: BATTLE_CONFIG.curveStrength.min + 
            Math.random() * (BATTLE_CONFIG.curveStrength.max - BATTLE_CONFIG.curveStrength.min),
          vx: (dx / dist) * BATTLE_CONFIG.bulletSpeed,
          vy: (dy / dist) * BATTLE_CONFIG.bulletSpeed,
          damage: damage,
          createdAt: now,
        });

        battleBubble.lastShotTime = now;
      }
    });

    // Update bullets
    const bulletsToRemove = new Set();

    this.bullets.forEach(bullet => {
      if (bulletsToRemove.has(bullet.id)) return;

      // Remove bullets from dead/ghost shooters
      const shooterBattle = this.battleBubbles.get(bullet.shooterAddress);
      if (shooterBattle && (shooterBattle.isGhost || !shooterBattle.isAlive)) {
        bulletsToRemove.add(bullet.id);
        return;
      }

      const totalDist = Math.sqrt(
        Math.pow(bullet.targetX - bullet.startX, 2) +
        Math.pow(bullet.targetY - bullet.startY, 2)
      );
      const progressSpeed = BATTLE_CONFIG.bulletSpeed / totalDist;
      bullet.progress += progressSpeed;

      const t = bullet.progress;
      const dx = bullet.targetX - bullet.startX;
      const dy = bullet.targetY - bullet.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const perpX = -dy / dist;
      const perpY = dx / dist;
      const midX = (bullet.startX + bullet.targetX) / 2;
      const midY = (bullet.startY + bullet.targetY) / 2;
      const controlX = midX + perpX * bullet.curveStrength * bullet.curveDirection;
      const controlY = midY + perpY * bullet.curveStrength * bullet.curveDirection;

      const oneMinusT = 1 - t;
      bullet.x = oneMinusT * oneMinusT * bullet.startX +
                 2 * oneMinusT * t * controlX +
                 t * t * bullet.targetX;
      bullet.y = oneMinusT * oneMinusT * bullet.startY +
                 2 * oneMinusT * t * controlY +
                 t * t * bullet.targetY;

      if (bullet.progress >= 1.1 ||
          bullet.x < -50 || bullet.x > width + 50 ||
          bullet.y < -50 || bullet.y > height + 50) {
        bulletsToRemove.add(bullet.id);
        return;
      }

      // Check for hits — only the intended target
      const target = this.holders.find(h => h.address === bullet.targetAddress);
      if (!target || target.x === undefined) return;

      const targetBattle = this.battleBubbles.get(target.address);
      if (!targetBattle || targetBattle.isGhost) return;

      const hitDx = bullet.x - target.x;
      const hitDy = bullet.y - target.y;
      const hitDist = Math.sqrt(hitDx * hitDx + hitDy * hitDy);

      if (hitDist < target.radius + 3) {
        bulletsToRemove.add(bullet.id);

        const actualDmg = Math.min(bullet.damage, 5);
        targetBattle.health -= actualDmg;

        this.damageNumbers.push({
          id: `dmg-${now}-${Math.random()}`,
          x: target.x + (Math.random() - 0.5) * 20,
          y: target.y - 10,
          damage: actualDmg,
            createdAt: now,
            alpha: 1,
          });

        if (this.magicBlockReady) {
          this._queueAttack(bullet.shooterAddress, target.address, actualDmg);
        }

        if (targetBattle.health <= 0) {
          targetBattle.health = 0;
          targetBattle.isGhost = true;
          targetBattle.isAlive = false;
          targetBattle.ghostUntil = now + BATTLE_CONFIG.ghostDuration;

          this.killFeed.unshift({
            killer: bullet.shooterAddress,
            victim: target.address,
            time: now,
          });
          this.killFeed = this.killFeed.slice(0, 5);
          this.addEventLog(`${target.address.slice(0, 6)}... killed by ${bullet.shooterAddress.slice(0, 6)}...`);

          // Log kill/death to on-chain records immediately (no tx yet).
          // The ER will later detect the death and patch in the tx signature.
          if (this.magicBlockReady && this.magicBlock) {
            this.magicBlock._logEvent('kill', `${bullet.shooterAddress.slice(0, 6)}... killed ${target.address.slice(0, 6)}...`, null, {
              killer: bullet.shooterAddress,
              victim: target.address,
            });
            this.magicBlock._logEvent('death', `${target.address.slice(0, 6)}... was eliminated`, null, {
              victim: target.address,
              killer: bullet.shooterAddress,
            });
          }

          this.updateTopKillers();
        }
      }
    });

    this.bullets = this.bullets.filter(b => !bulletsToRemove.has(b.id));

    this.damageNumbers = this.damageNumbers
      .map(dn => ({ ...dn, y: dn.y - 0.5, alpha: dn.alpha - 0.02 }))
      .filter(dn => dn.alpha > 0);

    // Process attack queue (send to ER)
    this._processAttackQueue();
  }

  // ─── ER Damage Aggregation ───────────────────────────────────────
  // Instead of sending one processAttack tx per bullet (hundreds/sec),
  // we accumulate damage per attacker→victim pair and flush every few
  // seconds.  This keeps ER tx count manageable (~1-5 txs per flush).

  _queueAttack(attackerAddress, victimAddress, damage) {
    // Don't queue damage against bubbles that are dead or just respawned
    const victimBubble = this.battleBubbles.get(victimAddress);
    if (victimBubble && (victimBubble.isGhost || !victimBubble.isAlive)) return;

    const key = `${attackerAddress}|${victimAddress}`;
    const existing = this.damageBuffer.get(key);
    if (existing) {
      existing.damage += damage;
    } else {
      this.damageBuffer.set(key, {
        attacker: attackerAddress,
        victim: victimAddress,
        damage,
      });
    }
  }

  async _processAttackQueue() {
    const now = Date.now();
    if (this.isFlushingDamage) return;
    if (now - this.lastDamageFlush < this.damageFlushInterval) return;
    if (this.damageBuffer.size === 0) return;

    this.isFlushingDamage = true;
    this.lastDamageFlush = now;

    // Take the current buffer and clear it so new damage accumulates fresh
    const batch = Array.from(this.damageBuffer.values());
    this.damageBuffer.clear();

    // Send up to maxConcurrentFlush txs in parallel, then the rest sequentially
    // to avoid overwhelming the ER
    const toSend = batch.slice(0, this.maxConcurrentFlush);
    const overflow = batch.slice(this.maxConcurrentFlush);

    // Send first batch in parallel
    await Promise.allSettled(
      toSend.map(attack =>
        this.magicBlock.processAttack(
          attack.attacker, attack.victim, attack.damage
        ).catch(() => {})
      )
    );

    // Send overflow sequentially with a small gap
    for (const attack of overflow) {
      await this.magicBlock.processAttack(
        attack.attacker, attack.victim, attack.damage
      ).catch(() => {});
    }

    this.isFlushingDamage = false;
  }

  // ─── Player Registration Queue ───────────────────────────────────

  _queueRegistration(walletAddress) {
    if (!this.registerQueue.includes(walletAddress)) {
      this.registerQueue.push(walletAddress);
    }
    this._processRegistrationQueue();
  }

  async _processRegistrationQueue() {
    if (this.isProcessingRegistration || this.registerQueue.length === 0) return;
    this.isProcessingRegistration = true;

    while (this.registerQueue.length > 0) {
      const wallet = this.registerQueue.shift();
      try {
        await this.magicBlock.registerPlayer(wallet);
      } catch (err) {
        console.error(`Registration failed for ${wallet.slice(0, 6)}:`, err.message);
      }
      await new Promise(r => setTimeout(r, 500));
    }

    this.isProcessingRegistration = false;
  }

  // ─── ER State Sync ───────────────────────────────────────────────

  async syncFromER() {
    if (!this.magicBlockReady) return;

    try {
      const erStates = await this.magicBlock.getAllPlayerStates();
      let synced = 0;

      for (const [walletAddress, state] of erStates) {
        // Update player cache
        this.playerCache.set(walletAddress, state);

        // Update battle bubble from ER state
        const bubble = this.battleBubbles.get(walletAddress);
        if (bubble) {
          bubble.kills = state.kills;
          bubble.deaths = state.deaths;
          bubble.xp = state.xp;
          bubble.healthLevel = state.healthLevel;
          bubble.attackLevel = state.attackLevel;

          const currentXp = state.xp || 0;
          const expectedLevel = calcLevel(currentXp);
          const maxAllowedAttack = calcAttackPower(Math.min(expectedLevel, 20));
          const syncedAttack = state.attackPower;
          if (isFinite(syncedAttack) && syncedAttack > 0) {
            bubble.attackPower = Math.min(syncedAttack, maxAllowedAttack);
          } else {
            bubble.attackPower = BATTLE_CONFIG.bulletDamage;
          }

          const expectedLevelForHealth = calcLevel(currentXp);
          const maxAllowedHealth = calcMaxHealth(Math.min(expectedLevelForHealth, 20));
          bubble.maxHealth = Math.min(state.maxHealth, maxAllowedHealth);

          // Don't let ER sync override a bubble that just respawned locally
          // (the ER might still have stale dead state for ~5s after respawn)
          const recentlyRespawned = bubble.respawnedAt && (Date.now() - bubble.respawnedAt < 10000);

          if (!bubble.isGhost && !recentlyRespawned) {
            // Only sync health if the ER shows full health (respawn) — 
            // never pull health DOWN from ER because batched damage in the ER
            // would cause "phantom damage" (health drops without visible bullets).
            // Local bullet hits are the visual authority for health reduction.
            if (state.health >= state.maxHealth && bubble.health < bubble.maxHealth) {
              bubble.health = bubble.maxHealth;
            }
            // Do NOT sync isAlive=false from ER — local bullet kills handle that.
            // Only sync isAlive=true (e.g. ER respawn)
            if (state.isAlive && !bubble.isAlive) {
              bubble.isAlive = true;
            }
          }
        }

        synced++;
      }

      if (synced > 0) {
        this.updateTopKillers();
      }
    } catch (err) {
      console.error('ER sync error:', err.message);
    }
  }

  // ─── Season Reset ──────────────────────────────────────────────

  async seasonReset() {
    if (!this.magicBlockReady) {
      return { success: false, error: 'MagicBlock ER not ready' };
    }

    console.log('SEASON RESET: resetting all players on-chain...');
    const result = await this.magicBlock.resetAllPlayers();

    for (const [address, bubble] of this.battleBubbles) {
      bubble.kills = 0;
      bubble.deaths = 0;
      bubble.xp = 0;
      bubble.healthLevel = 1;
      bubble.attackLevel = 1;
      bubble.health = BATTLE_CONFIG.maxHealth;
      bubble.maxHealth = BATTLE_CONFIG.maxHealth;
      bubble.attackPower = BATTLE_CONFIG.bulletDamage;
      bubble.isAlive = true;
      bubble.isGhost = false;
      bubble.ghostUntil = null;
    }

    this.playerCache.clear();
    this.killFeed = [];
    this.topKillers = [];
    this.damageBuffer.clear();
    this.addEventLog('New season started — all stats reset!');

    console.log('SEASON RESET: complete', result);
    return { success: true, ...result };
  }

  // ─── Event & Player Management ───────────────────────────────────

  addEventLog(message) {
    this.eventLog.unshift(message);
    this.eventLog = this.eventLog.slice(0, 10);
  }

  ensurePlayerCached(walletAddress) {
    if (!this.playerCache.has(walletAddress)) {
      this.playerCache.set(walletAddress, {
        walletAddress,
        health: BATTLE_CONFIG.maxHealth,
        maxHealth: BATTLE_CONFIG.maxHealth,
        attackPower: BATTLE_CONFIG.bulletDamage,
        xp: 0,
        kills: 0,
        deaths: 0,
        healthLevel: 1,
        attackLevel: 1,
        isAlive: true,
      });

      // Queue for ER registration
      if (this.magicBlockReady) {
        this._queueRegistration(walletAddress);
      }
    }
    return this.playerCache.get(walletAddress);
  }

  updateTopKillers() {
    this.topKillers = Array.from(this.battleBubbles.values())
      .filter(b => b.kills > 0)
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 20)
      .map(b => ({ address: b.address, kills: b.kills, level: calcLevel(b.xp) }));
  }

  async handleTransaction(event) {
    const now = Date.now();
    
    if (event.type === 'buy') {
      this.addEventLog(`BUY tx: ${event.signature?.slice(0, 8) || 'unknown'}...`);
    } else if (event.type === 'sell') {
      this.addEventLog(`SELL tx: ${event.signature?.slice(0, 8) || 'unknown'}...`);
    } else {
      this.addEventLog(`TX: ${event.signature?.slice(0, 8) || 'unknown'}...`);
    }

    this.updatePrice();

    if (now - this.lastRefreshTime < this.minRefreshInterval) {
      if (!this.pendingRefresh) {
        this.pendingRefresh = true;
        const delay = this.minRefreshInterval - (now - this.lastRefreshTime);
        setTimeout(() => this.refreshHoldersNow(), delay);
      }
      return;
    }

    await this.refreshHoldersNow();
  }

  async refreshHoldersNow() {
    this.pendingRefresh = false;
    this.lastRefreshTime = Date.now();
    const now = Date.now();
    
    const oldHolders = new Map(this.holders.map(h => [h.address, h]));
    const newHolders = await this.fetchHolders();
    
    const newAddresses = new Set(newHolders.map(h => h.address));
    const oldAddresses = new Set(this.holders.map(h => h.address));
    
    this.newHolders = new Set([...this.newHolders].filter(addr => {
      const holder = newHolders.find(h => h.address === addr);
      return holder && holder.spawnTime && (now - holder.spawnTime) < 3000;
    }));
    
    this.popEffects = this.popEffects.filter(p => (now - p.time) < 1000);
    
    for (const [address, holder] of oldHolders) {
      if (!newAddresses.has(address) && holder.x !== undefined) {
        const missingCount = (this.missingHolderCounts.get(address) || 0) + 1;
        this.missingHolderCounts.set(address, missingCount);
        
        if (missingCount >= 3) {
          this.addEventLog(`${address.slice(0, 6)}... sold everything!`);
          this.popEffects.push({
            id: `pop-${now}-${address}`,
            x: holder.x,
            y: holder.y,
            radius: holder.radius,
            color: holder.color,
            time: now,
          });
          this.battleBubbles.delete(address);
          this.missingHolderCounts.delete(address);
        }
      }
    }
    
    for (const holder of newHolders) {
      if (this.missingHolderCounts.has(holder.address)) {
        this.missingHolderCounts.delete(holder.address);
      }
    }
    
    for (const holder of newHolders) {
      if (!oldAddresses.has(holder.address)) {
        this.newHolders.add(holder.address);
        holder.spawnTime = now;
        this.addEventLog(`${holder.address.slice(0, 6)}... joined! (${holder.percentage.toFixed(2)}%)`);
      }
    }
    
    for (const newHolder of newHolders) {
      const oldHolder = oldHolders.get(newHolder.address);
      if (oldHolder) {
        newHolder.x = oldHolder.x;
        newHolder.y = oldHolder.y;
        newHolder.vx = oldHolder.vx;
        newHolder.vy = oldHolder.vy;
        newHolder.spawnTime = oldHolder.spawnTime;
        
        const pctChange = newHolder.percentage - oldHolder.percentage;
        if (Math.abs(pctChange) > 0.1) {
          if (pctChange > 0) {
            this.addEventLog(`${newHolder.address.slice(0, 6)}... +${pctChange.toFixed(2)}%`);
          } else {
            this.addEventLog(`${newHolder.address.slice(0, 6)}... ${pctChange.toFixed(2)}%`);
          }
        }
      }
    }
    
    this.holders = newHolders;
    this.initializePositions();
    console.log(`Live refresh: ${this.holders.length} holders`);
  }

  // ─── Player Photos ──────────────────────────────────────────────

  setPlayerPhoto(walletAddress, dataUrl) {
    if (!walletAddress || typeof dataUrl !== 'string') return false;
    if (dataUrl.length > 1400000) return false; // ~1MB base64 limit
    if (!dataUrl.startsWith('data:image/')) return false;
    this.playerPhotos.set(walletAddress, dataUrl);
    savePhoto(walletAddress, dataUrl)
      .then(() => console.log(`Photo persisted to DB for ${walletAddress.slice(0, 8)}...`))
      .catch(err => console.error('Failed to persist photo to DB:', err.message));
    return true;
  }

  removePlayerPhoto(walletAddress) {
    this.playerPhotos.delete(walletAddress);
    deletePhoto(walletAddress).catch(err =>
      console.warn('Failed to delete photo from DB:', err.message)
    );
  }

  getPlayerPhotos() {
    const photos = {};
    for (const [addr, data] of this.playerPhotos) {
      photos[addr] = data;
    }
    return photos;
  }

  // ─── Client State ────────────────────────────────────────────────

  getState() {
    const now = Date.now();
    const mbStatus = this.magicBlock.getStatus();
    return {
      holders: this.holders.map(h => ({
        address: h.address,
        balance: h.balance,
        percentage: h.percentage,
        color: h.color,
        radius: h.radius,
        x: Math.round(h.x),
        y: Math.round(h.y),
        isNew: this.newHolders.has(h.address),
        spawnTime: h.spawnTime,
        hasPhoto: this.playerPhotos.has(h.address),
      })),
      popEffects: this.popEffects.map(p => ({
        ...p,
        progress: Math.min(1, (now - p.time) / 1000),
      })),
      battleBubbles: Array.from(this.battleBubbles.entries()).map(([addr, b]) => ({
        address: addr,
        health: Math.round(b.health),
        maxHealth: Math.round(b.maxHealth),
        isGhost: b.isGhost,
        ghostUntil: b.ghostUntil,
        kills: b.kills,
        deaths: b.deaths,
        level: calcLevel(b.xp || 0),
        xp: b.xp || 0,
        healthLevel: b.healthLevel || 1,
        attackLevel: b.attackLevel || 1,
        attackPower: b.attackPower || BATTLE_CONFIG.bulletDamage,
        isAlive: b.isAlive !== false,
      })),
      bullets: this.bullets.map(b => ({
        id: b.id,
        shooterAddress: b.shooterAddress,
        shooterColor: b.shooterColor,
        x: Math.round(b.x),
        y: Math.round(b.y),
        startX: Math.round(b.startX),
        startY: Math.round(b.startY),
        targetX: Math.round(b.targetX),
        targetY: Math.round(b.targetY),
        progress: Math.round(b.progress * 1000) / 1000,
        curveDirection: b.curveDirection,
        curveStrength: b.curveStrength,
      })),
      damageNumbers: this.damageNumbers,
      killFeed: this.killFeed,
      eventLog: this.eventLog,
      topKillers: this.topKillers,
      token: this.token,
      priceData: this.priceData,
      dimensions: this.dimensions,
      timestamp: now,
      magicBlock: {
        ready: mbStatus.ready,
        arenaPda: mbStatus.arenaPda,
        arenaDelegated: mbStatus.arenaDelegated,
        playersRegistered: mbStatus.playersRegistered,
        playersDelegated: mbStatus.playersDelegated,
        stats: mbStatus.stats,
        rpc: mbStatus.rpc,
        programId: mbStatus.programId,
        erValidator: mbStatus.erValidator,
        eventLog: mbStatus.eventLog.slice(0, 10),
      },
    };
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  async start() {
    if (this.isRunning) return;
    
    console.log('Starting game state...');
    this.isRunning = true;

    // Fetch holders + metadata first so the game can start immediately
    await this.fetchTokenMetadata();

    this.holders = await this.fetchHolders();
    this.initializePositions();
    
    console.log(`Loaded ${this.holders.length} holders`);

    try {
      const dbPhotos = await loadAllPhotos();
      if (dbPhotos.size > 0) {
        for (const [addr, data] of dbPhotos) {
          this.playerPhotos.set(addr, data);
        }
        console.log(`Loaded ${dbPhotos.size} player photos from DB`);
      }
    } catch (err) {
      console.warn('Failed to load photos from DB:', err.message);
    }

    for (const holder of this.holders) {
      this.ensurePlayerCached(holder.address);
    }

    this.gameLoop = setInterval(() => {
      this.tick();
    }, 1000 / 30);

    this.holderRefresh = setInterval(async () => {
      const newHolders = await this.fetchHolders();
      newHolders.forEach(newHolder => {
        const existing = this.holders.find(h => h.address === newHolder.address);
        if (existing) {
          newHolder.x = existing.x;
          newHolder.y = existing.y;
          newHolder.vx = existing.vx;
          newHolder.vy = existing.vy;
        }
      });
      this.holders = newHolders;
      this.initializePositions();

      for (const holder of newHolders) {
        this.ensurePlayerCached(holder.address);
      }

      console.log(`Refreshed holders: ${this.holders.length}`);
    }, 120000);

    this.priceRefresh = setInterval(async () => {
      await this.updatePrice();
    }, 5000);

    this.metadataRefresh = setInterval(async () => {
      await this.fetchTokenMetadata();
    }, 60000);

    // Initialize MagicBlock in the background — don't block the game
    this._initMagicBlock();
  }

  async _initMagicBlock() {
    console.log('Initializing MagicBlock Ephemeral Rollup (background)...');
    try {
      this.magicBlockReady = await this.magicBlock.initialize();
      if (this.magicBlockReady) {
        console.log('MagicBlock ER integration active!');
        console.log('   Arena:', this.magicBlock.arenaPda.toBase58());
        console.log('   Delegated:', this.magicBlock.arenaDelegated);

        this.magicBlock.startCommitTimer(30000);
        this.erSyncInterval = setInterval(() => this.syncFromER(), 10000);

        // Register any holders that loaded before MagicBlock was ready
        for (const holder of this.holders) {
          this.ensurePlayerCached(holder.address);
        }
      } else {
        console.warn('MagicBlock ER not available — game runs locally only');
      }
    } catch (err) {
      console.error('MagicBlock init failed (non-blocking):', err.message);
    }
  }

  async stop() {
    this.isRunning = false;
    if (this.gameLoop) clearInterval(this.gameLoop);
    if (this.holderRefresh) clearInterval(this.holderRefresh);
    if (this.priceRefresh) clearInterval(this.priceRefresh);
    if (this.metadataRefresh) clearInterval(this.metadataRefresh);
    if (this.erSyncInterval) clearInterval(this.erSyncInterval);

    if (this.magicBlockReady) {
      this.magicBlock.stopCommitTimer();
      // Final commit before shutdown
      await this.magicBlock.commitState();
    }
  }
}

module.exports = { GameState, BATTLE_CONFIG, PHYSICS_CONFIG };
