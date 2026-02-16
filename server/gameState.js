// Server-side game state management
// Physics + targeting run on the server
// Combat resolution (damage, kills, XP) runs on MagicBlock Ephemeral Rollup

const { MagicBlockService } = require('./magicblock');

const BATTLE_CONFIG = {
  maxHealth: 100,       // base — overridden by onchain PlayerState
  bulletDamage: 0.1,    // base damage per bullet
  fireRate: 200,        // ms between shots
  bulletSpeed: 8,
  ghostDuration: 60000, // 60 seconds (visual only; ER has its own respawn timer)
  curveStrength: { min: 25, max: 60 },
};

const PHYSICS_CONFIG = {
  minSpeed: 0.3,
  maxSpeed: 2.5,
  velocityDecay: 0.998,
  collisionPadding: 5,
  wallBounce: 0.7,
};

// Progression formulas (mirror onchain but used for local preview)
const PROGRESSION = {
  xpPerKill: 25,
  xpPerDeath: 5,
  levelScale: 50,
  healthPerLevel: 10,
  damagePerLevel: 0.01, // +0.01 bullet damage per level
  baseHealth: 100,
  baseDamage: 0.1,      // base attack per bullet
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
    this.playerCache = new Map();  // In-memory cache: wallet -> stats from ER
    this.magicBlock = new MagicBlockService();
    this.magicBlockReady = false;

    // Pending attack queue (for when ER is processing)
    this.attackQueue = [];
    this.isProcessingAttacks = false;

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
        const maxHealth = cached ? cached.maxHealth : BATTLE_CONFIG.maxHealth;

        this.battleBubbles.set(holder.address, {
          address: holder.address,
          health: maxHealth,
          maxHealth: maxHealth,
          attackPower: cached ? cached.attackPower : BATTLE_CONFIG.bulletDamage,
          isGhost: false,
          ghostUntil: null,
          lastShotTime: 0,
          kills: cached ? cached.kills : 0,
          deaths: cached ? cached.deaths : 0,
          xp: cached ? cached.xp : 0,
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

    // Bubble collisions
    for (let i = 0; i < this.holders.length; i++) {
      for (let j = i + 1; j < this.holders.length; j++) {
        const a = this.holders[i];
        const b = this.holders[j];
        if (a.x === undefined || b.x === undefined) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.radius + b.radius + PHYSICS_CONFIG.collisionPadding;

        if (dist < minDist && dist > 0) {
          const overlap = minDist - dist;
          const nx = dx / dist;
          const ny = dy / dist;
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
        }
      }
    }

    // Check ghost respawns (local visual timer + ER respawn)
    this.battleBubbles.forEach((bubble, address) => {
      if (bubble.isGhost && bubble.ghostUntil && now >= bubble.ghostUntil) {
        bubble.isGhost = false;
        bubble.ghostUntil = null;
        bubble.health = bubble.maxHealth;
        bubble.isAlive = true;
        this.addEventLog(`${address.slice(0, 6)}... respawned!`);

        // Also respawn on ER
        if (this.magicBlockReady) {
          this.magicBlock.respawnPlayer(address).catch(() => {});
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

        const damage = battleBubble.attackPower || BATTLE_CONFIG.bulletDamage;

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

      // Check for hits
      this.holders.forEach(target => {
        if (target.x === undefined || target.address === bullet.shooterAddress) return;

        const targetBattle = this.battleBubbles.get(target.address);
        if (!targetBattle || targetBattle.isGhost) return;

        const hitDx = bullet.x - target.x;
        const hitDy = bullet.y - target.y;
        const hitDist = Math.sqrt(hitDx * hitDx + hitDy * hitDy);

        if (hitDist < target.radius + 3) {
          bulletsToRemove.add(bullet.id);

          // Local damage preview (immediate visual feedback)
          targetBattle.health -= bullet.damage;

          this.damageNumbers.push({
            id: `dmg-${now}-${Math.random()}`,
            x: target.x + (Math.random() - 0.5) * 20,
            y: target.y - 10,
            damage: bullet.damage,
            createdAt: now,
            alpha: 1,
          });

          // Check for local death (preview — ER confirms with tx proof)
          const isLocalKill = targetBattle.health <= 0;

          // Send attack to ER; flag lethal hits so ER can verify and log with tx hash
          if (this.magicBlockReady) {
            this._queueAttack(bullet.shooterAddress, target.address, bullet.damage, isLocalKill);
          }

          if (isLocalKill) {
            targetBattle.health = 0;
            targetBattle.isGhost = true;
            targetBattle.isAlive = false;
            targetBattle.ghostUntil = now + BATTLE_CONFIG.ghostDuration;
            targetBattle.deaths++;

            const shooter = this.battleBubbles.get(bullet.shooterAddress);
            if (shooter) {
              shooter.kills++;
            }

            this.killFeed.unshift({
              killer: bullet.shooterAddress,
              victim: target.address,
              time: now,
            });
            this.killFeed = this.killFeed.slice(0, 5);
            this.addEventLog(`${target.address.slice(0, 6)}... killed by ${bullet.shooterAddress.slice(0, 6)}...`);

            // Kill/death events are logged by magicBlock.processAttack()
            // with the actual ER tx hash as on-chain proof.

            this.updateTopKillers();
          }
        }
      });
    });

    this.bullets = this.bullets.filter(b => !bulletsToRemove.has(b.id));

    this.damageNumbers = this.damageNumbers
      .map(dn => ({ ...dn, y: dn.y - 0.5, alpha: dn.alpha - 0.02 }))
      .filter(dn => dn.alpha > 0);

    // Process attack queue (send to ER)
    this._processAttackQueue();
  }

  // ─── ER Attack Queue ─────────────────────────────────────────────

  _queueAttack(attackerAddress, victimAddress, damage, isLocalKill = false) {
    this.attackQueue.push({ attacker: attackerAddress, victim: victimAddress, damage, isLocalKill });
  }

  async _processAttackQueue() {
    if (this.isProcessingAttacks || this.attackQueue.length === 0) return;
    this.isProcessingAttacks = true;

    // Process up to 5 attacks per tick
    const batch = this.attackQueue.splice(0, 5);
    for (const attack of batch) {
      this.magicBlock.processAttack(attack.attacker, attack.victim, attack.damage, attack.isLocalKill).catch(() => {});
    }

    this.isProcessingAttacks = false;
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
      await new Promise(r => setTimeout(r, 2000));
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
          bubble.attackPower = state.attackPower;

          // Sync health from ER (ER is authoritative)
          if (!bubble.isGhost) {
            bubble.maxHealth = state.maxHealth;
            bubble.health = state.health;
            bubble.isAlive = state.isAlive;

            if (!state.isAlive && !bubble.isGhost) {
              bubble.isGhost = true;
              bubble.ghostUntil = Date.now() + BATTLE_CONFIG.ghostDuration;
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
      .slice(0, 5)
      .map(b => ({ address: b.address, kills: b.kills }));
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

  // ─── Client State ────────────────────────────────────────────────

  getState() {
    const now = Date.now();
    return {
      holders: this.holders.map(h => ({
        address: h.address,
        balance: h.balance,
        percentage: h.percentage,
        color: h.color,
        radius: h.radius,
        x: h.x,
        y: h.y,
        isNew: this.newHolders.has(h.address),
        spawnTime: h.spawnTime,
      })),
      popEffects: this.popEffects.map(p => ({
        ...p,
        progress: Math.min(1, (now - p.time) / 1000),
      })),
      battleBubbles: Array.from(this.battleBubbles.entries()).map(([addr, b]) => ({
        address: addr,
        health: b.health,
        maxHealth: b.maxHealth,
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
        x: b.x,
        y: b.y,
        startX: b.startX,
        startY: b.startY,
        targetX: b.targetX,
        targetY: b.targetY,
        progress: b.progress,
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
      timestamp: Date.now(),
      magicBlock: this.magicBlock.getStatus(),
    };
  }

  // ─── Lifecycle ───────────────────────────────────────────────────

  async start() {
    if (this.isRunning) return;
    
    console.log('Starting game state...');
    this.isRunning = true;

    // Initialize MagicBlock Ephemeral Rollup integration
    console.log('Initializing MagicBlock Ephemeral Rollup...');
    this.magicBlockReady = await this.magicBlock.initialize();
    if (this.magicBlockReady) {
      console.log('MagicBlock ER integration active!');
      console.log('   Arena:', this.magicBlock.arenaPda.toBase58());
      console.log('   Delegated:', this.magicBlock.arenaDelegated);

      // Commit ER state to base layer every 30 seconds
      this.magicBlock.startCommitTimer(30000);

      // Sync ER state back to in-memory cache every 10 seconds
      this.erSyncInterval = setInterval(() => this.syncFromER(), 10000);
    } else {
      console.warn('MagicBlock ER not available — game runs locally only');
    }

    await this.fetchTokenMetadata();

    this.holders = await this.fetchHolders();
    this.initializePositions();
    
    console.log(`Loaded ${this.holders.length} holders`);

    for (const holder of this.holders) {
      this.ensurePlayerCached(holder.address);
    }

    this.gameLoop = setInterval(() => {
      this.tick();
    }, 1000 / 60);

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
