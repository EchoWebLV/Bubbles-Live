// Server-side game state management
// Physics + targeting run on the server
// Combat resolution (damage, kills, XP) runs on MagicBlock Ephemeral Rollup

const { MagicBlockService } = require('./magicblock');
const { loadAllPhotos, savePhoto, deletePhoto } = require('./playerStore');
const {
  MAX_LEVEL, LEVEL_SCALE, MAX_RANK,
  ALL_TALENTS, TREE_ORDER, AUTO_ALLOCATE_ORDER,
  CAPSTONE_TALENTS, MAX_CAPSTONES,
  TALENT_NAME_TO_CHAIN_ID, CHAIN_ID_TO_TALENT_NAME,
  getTalentValue, canAllocate, createEmptyTalents, totalPointsSpent,
} = require('./talentConfig');

const BATTLE_CONFIG = {
  maxHealth: 100,       // base — overridden by onchain PlayerState
  bulletDamage: 0.1,    // base damage per bullet
  fireRate: 200,        // ms between shots
  bulletSpeed: 10,
  ghostBaseMs: 20000,   // 20s at level 1, +1s per level
  ghostPerLevelMs: 1000,
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

const PROGRESSION = {
  xpPerKillBase: 10,
  xpPerKillPerLevel: 3,
  xpPerDeath: 5,
  levelScale: LEVEL_SCALE,
  healthPerLevel: 10,
  damagePerLevel: 0.05,
  baseHealth: 100,
  baseDamage: 0.1,
};

const TESTING_OVERRIDE_LEVEL = 0; // Set to a number to force all players to that level
function calcLevel(xp) {
  if (TESTING_OVERRIDE_LEVEL) return TESTING_OVERRIDE_LEVEL;
  // Each level from 51-100 costs 1% more per level (cumulative)
  // so level 100 requires ~49% more XP per level than level 51
  let totalXp = 0;
  for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
    const baseCost = (2 * lvl - 1) * PROGRESSION.levelScale;
    const penalty = lvl > 50 ? 1 + (lvl - 50) * 0.01 : 1;
    totalXp += baseCost * penalty;
    if (xp < totalXp) return lvl;
  }
  return MAX_LEVEL;
}
function calcMaxHealth(healthLevel) {
  return PROGRESSION.baseHealth + (healthLevel - 1) * PROGRESSION.healthPerLevel;
}
function calcAttackPower(attackLevel) {
  return PROGRESSION.baseDamage + (attackLevel - 1) * PROGRESSION.damagePerLevel;
}
const TALENT_POINT_LEVELS = Array.from({ length: 50 }, (_, i) => 1 + i * 2);

function calcTalentPoints(level) {
  return TALENT_POINT_LEVELS.filter(l => level >= l).length;
}

// Auto-allocate talent points for idle players (respects prerequisites).
function autoAllocateTalents(bubble) {
  const available = calcTalentPoints(calcLevel(bubble.xp)) - totalPointsSpent(bubble.talents);
  if (available <= 0) return [];
  const allocated = [];
  for (let i = 0; i < available; i++) {
    const candidates = AUTO_ALLOCATE_ORDER.filter(id =>
      canAllocate(id, bubble.talents) &&
      bubble.talents[id] < ALL_TALENTS[id].maxRank
    );
    if (candidates.length === 0) break;
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    bubble.talents[pick]++;
    allocated.push(pick);
  }
  return allocated;
}


class GameState {
  constructor() {
    this.holders = [];
    this.battleBubbles = new Map();
    this.bullets = [];
    this.damageNumbers = [];
    this.vfx = [];
    this.killFeed = [];
    this.eventLog = [];
    this.topKillers = [];
    this.dimensions = { width: 4224, height: 2376 };
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

    // Guest players (max 10, removed on disconnect)
    this.guestAddresses = new Set();

    // Player registration queue
    this.registerQueue = [];
    this.isProcessingRegistration = false;

    // Talent chain sync queue: [{ wallet, chainId }]
    this.talentSyncQueue = [];
    this.isProcessingTalentSync = false;

    // ER state sync
    this.erSyncInterval = null;
    this._isSyncingER = false;
    this._lastTalentCatchUp = 0;
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

  getMedianXp() {
    const xpValues = Array.from(this.battleBubbles.values())
      .map(b => b.xp || 0)
      .filter(xp => xp > 0)
      .sort((a, b) => a - b);

    if (xpValues.length === 0) return 0;

    const mid = Math.floor(xpValues.length / 2);
    if (xpValues.length % 2 === 0) {
      return Math.floor((xpValues[mid - 1] + xpValues[mid]) / 2);
    }
    return xpValues[mid];
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
        const cachedXp = cached ? (cached.xp || 0) : this.getMedianXp();
        const lvl = calcLevel(cachedXp);
        const cappedMaxHealth = cached ? Math.min(cached.maxHealth, calcMaxHealth(lvl)) : calcMaxHealth(lvl);
        const cappedAttack = cached ? Math.min(cached.attackPower, calcAttackPower(lvl)) : calcAttackPower(lvl);

        // Restore talents from ER cache
        const cachedTalents = (cached && cached.talents && totalPointsSpent(cached.talents) > 0)
          ? { ...cached.talents }
          : createEmptyTalents();
        const cachedManualBuild = cached ? (cached.manualBuild || false) : false;

        const bubble = {
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
          healthLevel: cached ? cached.healthLevel : lvl,
          attackLevel: cached ? cached.attackLevel : lvl,
          isAlive: true,
          talents: cachedTalents,
          manualBuild: cachedManualBuild,
          lastHitTarget: null,
          focusFireStacks: 0,
          shotCounter: 0,
          talentResets: 0,
          // Brawler state
          _lastDash: 0,
          _lastDashHit: 0,
          _lastContactDmg: 0,
          // Blood Thirst state
          killRushUntil: 0,
          // Nova state
          _lastNova: 0,
        };
        if (!bubble.manualBuild) {
          const newTalents = autoAllocateTalents(bubble);
          this._queueTalentSync(holder.address, newTalents);
        }
        this.battleBubbles.set(holder.address, bubble);
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
      // Kill Rush talent: temporary speed boost after kills
      const effectiveMax = PHYSICS_CONFIG.maxSpeed;
      if (speed > effectiveMax) {
        const scale = effectiveMax / speed;
        holder.vx *= scale;
        holder.vy *= scale;
      }
    });

    // Body Slam: check contacts BEFORE physics pushes them apart
    this._processBrawlerCollisions(now, deltaTime);

    // Orbit: orbiting orbs deal damage to nearby enemies
    this._processOrbitDamage(now);

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
        } else {
          if (dist < minDist + PHYSICS_CONFIG.repulsionRange) {
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

      const bb = this.battleBubbles.get(holder.address);
      if (bb && !bb.isGhost) {
        // Dash talent: periodic burst of speed in current direction
        const dashRank = bb.talents?.dash || 0;
        if (dashRank > 0) {
          const cooldown = ALL_TALENTS.dash.cooldownMs[dashRank - 1];
          if (!bb._lastDash) bb._lastDash = now - Math.random() * cooldown;
          if (now - bb._lastDash >= cooldown) {
            bb._lastDash = now;
            bb._dashActive = now;
            const speed = Math.sqrt((holder.vx || 0) ** 2 + (holder.vy || 0) ** 2);
            if (speed > 0.01) {
              const nx = holder.vx / speed;
              const ny = holder.vy / speed;
              holder.vx = nx * ALL_TALENTS.dash.dashStrength;
              holder.vy = ny * ALL_TALENTS.dash.dashStrength;
            } else {
              const angle = Math.random() * Math.PI * 2;
              holder.vx = Math.cos(angle) * ALL_TALENTS.dash.dashStrength;
              holder.vy = Math.sin(angle) * ALL_TALENTS.dash.dashStrength;
            }

            
          }
        }
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

    // Regeneration talent: heal alive non-ghost bubbles each tick
    const regenTickRate = deltaTime / 30;
    this.battleBubbles.forEach((bubble) => {
      if (bubble.isGhost || !bubble.isAlive) return;
      const regenRank = bubble.talents?.regeneration || 0;
      if (regenRank <= 0) return;
      const regenPerSec = getTalentValue('regeneration', regenRank);
      const healCeiling = bubble.maxHealth * ALL_TALENTS.regeneration.healCeiling;
      if (bubble.health < healCeiling) {
        bubble.health = Math.min(bubble.health + regenPerSec * regenTickRate, healCeiling);
      }
    });

    // Berserker regen: heal per second when below 50% HP
    this.battleBubbles.forEach((bubble) => {
      if (bubble.isGhost || !bubble.isAlive) return;
      const bRank = bubble.talents?.berserker || 0;
      if (bRank <= 0) return;
      if (bubble.health >= bubble.maxHealth * ALL_TALENTS.berserker.hpThreshold) return;
      const hps = ALL_TALENTS.berserker.regenPerSec[bRank - 1];
      const healCeiling = bubble.maxHealth * 0.50;
      bubble.health = Math.min(bubble.health + hps * regenTickRate, healCeiling);
    });

    // Nova talent: emit projectiles periodically
    this._processNova(now);

    // Shooting logic
    this.holders.forEach(holder => {
      if (holder.x === undefined) return;
      
      const battleBubble = this.battleBubbles.get(holder.address);
      if (!battleBubble || battleBubble.isGhost) return;

      // Kill Rush talent: temporary fire rate boost after kills
      const rapidFireVal = getTalentValue('rapidFire', battleBubble.talents?.rapidFire || 0);
      const killRushActive = battleBubble.killRushUntil && now < battleBubble.killRushUntil;
      const killRushVal = killRushActive ? getTalentValue('killRush', battleBubble.talents?.killRush || 0) : 0;
      const berserkRank = battleBubble.talents?.berserker || 0;
      const berserkActive = berserkRank > 0 && battleBubble.health < battleBubble.maxHealth * ALL_TALENTS.berserker.hpThreshold;
      const berserkAtkSpeed = berserkActive ? ALL_TALENTS.berserker.atkSpeedBonus[berserkRank - 1] : 0;
      let effectiveFireRate = BATTLE_CONFIG.fireRate * (1 - rapidFireVal) * (1 - killRushVal) * (1 - berserkAtkSpeed);
      effectiveFireRate = Math.max(effectiveFireRate, ALL_TALENTS.rapidFire.minCooldownMs || 80);
      if (now - battleBubble.lastShotTime < effectiveFireRate) return;

      // Find closest target
      let closest = null;
      let closestDist = Infinity;
      let secondClosest = null;
      let secondClosestDist = Infinity;
      this.holders.forEach(target => {
        if (target.address === holder.address || target.x === undefined) return;
        const targetBattle = this.battleBubbles.get(target.address);
        if (targetBattle?.isGhost) return;

        const dx = target.x - holder.x;
        const dy = target.y - holder.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist < closestDist) {
          secondClosest = closest;
          secondClosestDist = closestDist;
          closestDist = dist;
          closest = target;
        } else if (dist < secondClosestDist) {
          secondClosestDist = dist;
          secondClosest = target;
        }
      });

      if (closest) {
        const dx = closest.x - holder.x;
        const dy = closest.y - holder.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const curveDir = Math.random() > 0.5 ? 1 : -1;

        let damage = battleBubble.attackPower || BATTLE_CONFIG.bulletDamage;
        if (!isFinite(damage) || damage > 5) {
          damage = BATTLE_CONFIG.bulletDamage;
          battleBubble.attackPower = BATTLE_CONFIG.bulletDamage;
        }

        // Heavy Hitter talent: flat damage boost
        const heavyHitterVal = getTalentValue('heavyHitter', battleBubble.talents.heavyHitter || 0);
        if (heavyHitterVal > 0) damage *= (1 + heavyHitterVal);

        // Berserker talent: bonus damage below 50% HP
        if (berserkActive) {
          damage *= (1 + ALL_TALENTS.berserker.dmgBonus[berserkRank - 1]);
        }

        // Vitality Strike talent: bonus damage from max HP
        const vitalityVal = getTalentValue('vitalityStrike', battleBubble.talents?.vitalityStrike || 0);
        if (vitalityVal > 0) damage += battleBubble.maxHealth * vitalityVal;

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

        battleBubble.shotCounter = (battleBubble.shotCounter || 0) + 1;

        // Multi Shot talent: chance to fire a second bullet at same target
        const multiShotChance = getTalentValue('multiShot', battleBubble.talents.multiShot || 0);
        if (multiShotChance > 0 && Math.random() < multiShotChance) {
          const spreadAngle = (Math.random() - 0.5) * 0.3;
          const cos = Math.cos(spreadAngle), sin = Math.sin(spreadAngle);
          const svx = (dx / dist) * BATTLE_CONFIG.bulletSpeed;
          const svy = (dy / dist) * BATTLE_CONFIG.bulletSpeed;
          this.bullets.push({
            id: `b-${this.bulletIdCounter++}`,
            shooterAddress: holder.address,
            targetAddress: closest.address,
            shooterColor: holder.color,
            x: holder.x, y: holder.y,
            startX: holder.x, startY: holder.y,
            targetX: closest.x + spreadAngle * 30, targetY: closest.y + spreadAngle * 30,
            progress: 0,
            curveDirection: -curveDir,
            curveStrength: BATTLE_CONFIG.curveStrength.min,
            vx: cos * svx - sin * svy,
            vy: sin * svx + cos * svy,
            damage: damage * ALL_TALENTS.multiShot.secondBulletDamage,
            createdAt: now,
            isMultiShot: true,
          });
        }

        // Homing Cannon: every Nth shot becomes a homing bullet with 400% dmg
        const homingRank = battleBubble.talents.dualCannon || 0;
        if (homingRank > 0) {
          const freq = ALL_TALENTS.dualCannon.fireFrequency[homingRank - 1];
          if (battleBubble.shotCounter % freq === 0) {
            const lastIdx = this.bullets.length - 1;
            if (lastIdx >= 0 && this.bullets[lastIdx].shooterAddress === holder.address) {
              this.bullets[lastIdx].isHoming = true;
              this.bullets[lastIdx].damage = damage * ALL_TALENTS.dualCannon.homingDamageMultiplier;
            }
          }
        }

        battleBubble.lastShotTime = now;
      }
    });

    // Update bullets
    const bulletsToRemove = new Set();

    this.bullets.forEach(bullet => {
      if (bulletsToRemove.has(bullet.id)) return;

      // Remove bullets from dead/ghost shooters
      const shooterBubble = this.battleBubbles.get(bullet.shooterAddress);
      if (shooterBubble && (shooterBubble.isGhost || !shooterBubble.isAlive)) {
        bulletsToRemove.add(bullet.id);
        return;
      }

      // Nova bullets: straight-line movement, hit detection uses normal pipeline below
      if (bullet.isNova) {
        bullet.x += bullet.vx * deltaTime;
        bullet.y += bullet.vy * deltaTime;
        const travelDx = bullet.x - bullet.startX;
        const travelDy = bullet.y - bullet.startY;
        const traveled = Math.sqrt(travelDx * travelDx + travelDy * travelDy);
        bullet.progress = traveled / (bullet.novaMaxDist || 350);

        if (traveled >= (bullet.novaMaxDist || 350) ||
            bullet.x < -50 || bullet.x > width + 50 ||
            bullet.y < -50 || bullet.y > height + 50) {
          if (bullet.x > -10 && bullet.x < width + 10 && bullet.y > -10 && bullet.y < height + 10) {
            this.vfx.push({ type: 'bulletPop', x: bullet.x, y: bullet.y, color: bullet.shooterColor || '#ffff00', createdAt: now, small: true });
          }
          bulletsToRemove.add(bullet.id);
          return;
        }

        // Find closest enemy in hit range and assign as target for normal pipeline
        let novaHit = null;
        let novaHitDist = Infinity;
        for (const h of this.holders) {
          if (h.address === bullet.shooterAddress || h.x === undefined) continue;
          const hb = this.battleBubbles.get(h.address);
          if (!hb || hb.isGhost) continue;
          const hdx = bullet.x - h.x;
          const hdy = bullet.y - h.y;
          const hDist = Math.sqrt(hdx * hdx + hdy * hdy);
          if (hDist < h.radius + 3 && hDist < novaHitDist) {
            novaHit = h;
            novaHitDist = hDist;
          }
        }
        if (!novaHit) return;
        bullet.targetAddress = novaHit.address;
        // Fall through to normal hit detection below
      }


      // Homing Cannon: home toward lowest HP enemy within 1000px
      if (bullet.isHoming) {
        let bestTarget = null;
        let bestHp = Infinity;
        for (const h of this.holders) {
          if (h.address === bullet.shooterAddress || h.x === undefined) continue;
          const hb = this.battleBubbles.get(h.address);
          if (!hb || hb.isGhost) continue;
          const hdx = h.x - bullet.x;
          const hdy = h.y - bullet.y;
          const hDist = Math.sqrt(hdx * hdx + hdy * hdy);
          if (hDist <= 1000 && hb.health < bestHp) {
            bestHp = hb.health;
            bestTarget = h;
          }
        }
        if (bestTarget) {
          bullet.targetAddress = bestTarget.address;
          const tdx = bestTarget.x - bullet.x;
          const tdy = bestTarget.y - bullet.y;
          const tDist = Math.sqrt(tdx * tdx + tdy * tdy);
          if (tDist > 0) {
            bullet.vx = (tdx / tDist) * BATTLE_CONFIG.bulletSpeed;
            bullet.vy = (tdy / tDist) * BATTLE_CONFIG.bulletSpeed;
            bullet.targetX = bestTarget.x;
            bullet.targetY = bestTarget.y;
          }
        }
      }

      // Blood Bolt: homing — lock onto target, only re-target if dead/ghost
      if (bullet.isBloodBolt) {
        let homingTarget = null;
        const currentTarget = this.holders.find(h => h.address === bullet.targetAddress);
        const currentTargetBattle = currentTarget ? this.battleBubbles.get(currentTarget.address) : null;
        const currentAlive = currentTarget && currentTarget.x !== undefined && currentTargetBattle && !currentTargetBattle.isGhost;

        if (currentAlive) {
          homingTarget = currentTarget;
        } else {
          let nearestDist = Infinity;
          for (const h of this.holders) {
            if (h.address === bullet.shooterAddress || h.x === undefined) continue;
            const hb = this.battleBubbles.get(h.address);
            if (!hb || hb.isGhost) continue;
            const hdx = h.x - bullet.x;
            const hdy = h.y - bullet.y;
            const hDist = Math.sqrt(hdx * hdx + hdy * hdy);
            if (hDist < nearestDist) {
              homingTarget = h;
              nearestDist = hDist;
            }
          }
        }

        if (homingTarget) {
          const tdx = homingTarget.x - bullet.x;
          const tdy = homingTarget.y - bullet.y;
          const tDist = Math.sqrt(tdx * tdx + tdy * tdy);
          if (tDist > 0) {
            const desiredVx = (tdx / tDist) * BATTLE_CONFIG.bulletSpeed;
            const desiredVy = (tdy / tDist) * BATTLE_CONFIG.bulletSpeed;
            const strength = ALL_TALENTS.bloodBolt.homingStrength;
            bullet.vx += (desiredVx - bullet.vx) * strength;
            bullet.vy += (desiredVy - bullet.vy) * strength;
            const spd = Math.sqrt(bullet.vx * bullet.vx + bullet.vy * bullet.vy);
            if (spd > 0) {
              bullet.vx = (bullet.vx / spd) * BATTLE_CONFIG.bulletSpeed;
              bullet.vy = (bullet.vy / spd) * BATTLE_CONFIG.bulletSpeed;
            }
          }
          bullet.targetAddress = homingTarget.address;
          bullet.targetX = homingTarget.x;
          bullet.targetY = homingTarget.y;
        }
      }

      // Retarget if original target is dead — smoothly reroute the curve
      if (!bullet.isHoming && !bullet.isBloodBolt && !bullet.isNova) {
        const curTarget = this.holders.find(h => h.address === bullet.targetAddress);
        const curBattle = curTarget ? this.battleBubbles.get(curTarget.address) : null;
        const targetAlive = curTarget && curTarget.x !== undefined && curBattle && !curBattle.isGhost && curBattle.isAlive !== false;

        if (!targetAlive) {
          let nearest = null;
          let nearestDist = 600;
          for (const h of this.holders) {
            if (h.address === bullet.shooterAddress || h.x === undefined) continue;
            const hb = this.battleBubbles.get(h.address);
            if (!hb || hb.isGhost || hb.isAlive === false) continue;
            const hdx = h.x - bullet.x;
            const hdy = h.y - bullet.y;
            const hd = Math.sqrt(hdx * hdx + hdy * hdy);
            if (hd < nearestDist) { nearestDist = hd; nearest = h; }
          }
          if (nearest) {
            bullet.startX = bullet.x;
            bullet.startY = bullet.y;
            bullet.targetX = nearest.x;
            bullet.targetY = nearest.y;
            bullet.targetAddress = nearest.address;
            bullet.progress = 0;
            bullet.curveStrength *= 0.5;
          }
        }
      }

      const totalDist = Math.sqrt(
        Math.pow(bullet.targetX - bullet.startX, 2) +
        Math.pow(bullet.targetY - bullet.startY, 2)
      );
      const progressSpeed = BATTLE_CONFIG.bulletSpeed / totalDist;
      bullet.progress += progressSpeed;

      const t = Math.min(bullet.progress, 1);
      const dx = bullet.targetX - bullet.startX;
      const dy = bullet.targetY - bullet.startY;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const perpX = -dy / dist;
      const perpY = dx / dist;
      const midX = (bullet.startX + bullet.targetX) / 2;
      const midY = (bullet.startY + bullet.targetY) / 2;
      const controlX = midX + perpX * bullet.curveStrength * bullet.curveDirection;
      const controlY = midY + perpY * bullet.curveStrength * bullet.curveDirection;

      const oneMinusT = 1 - t;
      const curveX = oneMinusT * oneMinusT * bullet.startX +
                 2 * oneMinusT * t * controlX +
                 t * t * bullet.targetX;
      const curveY = oneMinusT * oneMinusT * bullet.startY +
                 2 * oneMinusT * t * controlY +
                 t * t * bullet.targetY;

      if (bullet.progress <= 1) {
        bullet.x = curveX;
        bullet.y = curveY;
      } else {
        // Overshoot: continue straight past the target for 100px
        const overshoot = (bullet.progress - 1) * dist;
        bullet.x = bullet.targetX + (dx / dist) * overshoot;
        bullet.y = bullet.targetY + (dy / dist) * overshoot;
      }

      const maxProgress = 1 + (100 / dist);
      if (bullet.progress >= maxProgress ||
          bullet.x < -50 || bullet.x > width + 50 ||
          bullet.y < -50 || bullet.y > height + 50) {
        if (bullet.x > -10 && bullet.x < width + 10 && bullet.y > -10 && bullet.y < height + 10) {
          this.vfx.push({ type: 'bulletPop', x: bullet.x, y: bullet.y, color: bullet.shooterColor || '#ffff00', createdAt: now, small: true });
        }
        bulletsToRemove.add(bullet.id);
        return;
      }

      // Check for hits — any enemy the bullet collides with
      let target = null;
      let targetBattle = null;
      for (let hi = 0; hi < this.holders.length; hi++) {
        const h = this.holders[hi];
        if (h.address === bullet.shooterAddress || h.x === undefined) continue;
        const hb = this.battleBubbles.get(h.address);
        if (!hb || hb.isGhost) continue;
        const hitDx = bullet.x - h.x;
        const hitDy = bullet.y - h.y;
        const hitDist = Math.sqrt(hitDx * hitDx + hitDy * hitDy);
        if (hitDist < h.radius + 3) {
          target = h;
          targetBattle = hb;
          break;
        }
      }

      if (target && targetBattle) {
        bulletsToRemove.add(bullet.id);

        let actualDmg = Math.min(bullet.damage, 5);
        const shooterBattle = this.battleBubbles.get(bullet.shooterAddress);

        // Critical Strike talent
        if (shooterBattle) {
          const critRank = shooterBattle.talents?.criticalStrike || 0;
          const critChance = getTalentValue('criticalStrike', critRank);
          if (critChance > 0 && Math.random() < critChance) {
            const critMult = Array.isArray(ALL_TALENTS.criticalStrike.critMultiplier)
              ? ALL_TALENTS.criticalStrike.critMultiplier[critRank - 1]
              : ALL_TALENTS.criticalStrike.critMultiplier;
            actualDmg *= critMult;
          }
        }

        // Execute talent: bonus vs targets ≤50% HP
        if (shooterBattle) {
          const executeVal = getTalentValue('execute', shooterBattle.talents?.execute || 0);
          if (executeVal > 0 && targetBattle.health / targetBattle.maxHealth <= ALL_TALENTS.execute.hpThreshold) {
            actualDmg *= (1 + executeVal);
          }
        }

        // Focus Fire talent (massDamage T3): stacking damage on same target
        if (shooterBattle) {
          const focusRank = shooterBattle.talents?.focusFire || 0;
          if (focusRank > 0) {
            if (shooterBattle.lastHitTarget === target.address) {
              shooterBattle.focusFireStacks = Math.min(
                (shooterBattle.focusFireStacks || 0) + 1,
                ALL_TALENTS.focusFire.maxStacks
              );
            } else {
              shooterBattle.lastHitTarget = target.address;
              shooterBattle.focusFireStacks = 1;
            }
            const stackBonus = getTalentValue('focusFire', focusRank) * shooterBattle.focusFireStacks;
            actualDmg *= (1 + stackBonus);
            if (shooterBattle.focusFireStacks >= ALL_TALENTS.focusFire.maxStacks) {
              shooterBattle.focusFireStacks = 0;
            }
          }
        }

        // Armor talent: reduce incoming damage
        const armorVal = getTalentValue('armor', targetBattle.talents?.armor || 0);
        const dmgBeforeArmor = actualDmg;
        if (armorVal > 0) {
          actualDmg *= (1 - armorVal);
        }

        // Iron Skin talent: boost max health
        const ironSkinVal = getTalentValue('ironSkin', targetBattle.talents?.ironSkin || 0);
        if (ironSkinVal > 0) {
          const boostedMax = calcMaxHealth(targetBattle.healthLevel) * (1 + ironSkinVal);
          if (targetBattle.maxHealth < boostedMax) {
            targetBattle.maxHealth = Math.round(boostedMax);
          }
        }


        targetBattle.health -= actualDmg;

        // Counter Attack talent: chance to fire straight bullet back at attacker
        if (!bullet.isCounterAttack) {
          const counterChance = getTalentValue('counterAttack', targetBattle.talents?.counterAttack || 0);
          if (counterChance > 0 && Math.random() < counterChance) {
            const shooter = this.holders.find(h => h.address === bullet.shooterAddress);
            if (shooter && shooter.x !== undefined) {
              const cdx = shooter.x - target.x;
              const cdy = shooter.y - target.y;
              const cdist = Math.sqrt(cdx * cdx + cdy * cdy);
              this.bullets.push({
                id: `b-${this.bulletIdCounter++}`,
                shooterAddress: target.address,
                targetAddress: bullet.shooterAddress,
                shooterColor: target.color || '#fff',
                x: target.x, y: target.y,
                startX: target.x, startY: target.y,
                targetX: shooter.x, targetY: shooter.y,
                progress: 0,
                curveDirection: 0,
                curveStrength: 0,
                vx: cdist > 0 ? (cdx / cdist) * BATTLE_CONFIG.bulletSpeed : 0,
                vy: cdist > 0 ? (cdy / cdist) * BATTLE_CONFIG.bulletSpeed : 0,
                damage: (targetBattle.attackPower || BATTLE_CONFIG.bulletDamage),
                createdAt: now,
                isCounterAttack: true,
              });
            }
          }
        }

        // Lifesteal talent: heal shooter
        if (shooterBattle && !shooterBattle.isGhost) {
          const lifestealVal = getTalentValue('lifesteal', shooterBattle.talents?.lifesteal || 0);
          if (lifestealVal > 0) {
            const healAmount = actualDmg * lifestealVal;
            const healCeiling = shooterBattle.maxHealth * ALL_TALENTS.lifesteal.healCeiling;
            shooterBattle.health = Math.min(shooterBattle.health + healAmount, healCeiling);
          }
        }

        // Chain Lightning: % chance on hit to arc lightning from caster to nearby enemies
        if (shooterBattle) {
          const clRank = shooterBattle.talents?.chainLightning || 0;
          if (clRank > 0) {
            const procChance = Array.isArray(ALL_TALENTS.chainLightning.procChance) ? ALL_TALENTS.chainLightning.procChance[clRank - 1] : ALL_TALENTS.chainLightning.procChance;
            if (Math.random() < procChance) {
              const arcCount = ALL_TALENTS.chainLightning.arcTargets[clRank - 1];
              const baseDmgMult = ALL_TALENTS.chainLightning.arcDamage;
              const decay = ALL_TALENTS.chainLightning.arcDecay;
              const arcRange = ALL_TALENTS.chainLightning.arcRange;
              const shooter = this.holders.find(h => h.address === bullet.shooterAddress);
              if (shooter && shooter.x !== undefined) {
                const nearbyTargets = [];
                this.holders.forEach(h => {
                  if (h.address === bullet.shooterAddress || h.x === undefined) return;
                  const hb = this.battleBubbles.get(h.address);
                  if (!hb || hb.isGhost) return;
                  const fdx = h.x - shooter.x;
                  const fdy = h.y - shooter.y;
                  const fd = Math.sqrt(fdx * fdx + fdy * fdy);
                  if (fd < arcRange) nearbyTargets.push({ holder: h, battle: hb, dist: fd });
                });
                nearbyTargets.sort((a, b) => a.dist - b.dist);
                let prevX = shooter.x, prevY = shooter.y;
                let currentMult = baseDmgMult;
                for (let ai = 0; ai < Math.min(arcCount, nearbyTargets.length); ai++) {
                  const arcTarget = nearbyTargets[ai];
                  const arcDmg = Math.min(bullet.damage * currentMult, 5);
                  arcTarget.battle.health -= arcDmg;
                  if (this.magicBlockReady) this._queueAttack(bullet.shooterAddress, arcTarget.holder.address, arcDmg);
                  this.damageNumbers.push({
                    id: `dmg-${now}-${Math.random()}`,
                    x: arcTarget.holder.x + (Math.random() - 0.5) * 10,
                    y: arcTarget.holder.y - 10,
                    damage: arcDmg, createdAt: now, alpha: 1,
                    color: '#00ccff', fontSize: 14,
                  });
                  this.vfx.push({
                    type: 'lightning',
                    x: prevX, y: prevY,
                    targetX: arcTarget.holder.x, targetY: arcTarget.holder.y,
                    color: shooter.color || '#00ccff', createdAt: now,
                  });
                  prevX = arcTarget.holder.x;
                  prevY = arcTarget.holder.y;
                  currentMult *= decay;
                }
              }
            }
          }
        }

        // Reaper's Arc: every Nth hit, instant 180° sweep around the shooter
        if (shooterBattle) {
          const arcRank = shooterBattle.talents?.reaperArc || 0;
          if (arcRank > 0) {
            shooterBattle._reaperHits = (shooterBattle._reaperHits || 0) + 1;
            const interval = ALL_TALENTS.reaperArc.hitInterval[arcRank - 1];
            if (shooterBattle._reaperHits >= interval) {
              shooterBattle._reaperHits = 0;
              const shooter = this.holders.find(h => h.address === bullet.shooterAddress);
              if (shooter && shooter.x !== undefined) {
                const sweepRange = ALL_TALENTS.reaperArc.sweepRange;
                const halfAngle = ALL_TALENTS.reaperArc.sweepAngle / 2;
                const sweepDmgPct = ALL_TALENTS.reaperArc.sweepDamagePct[arcRank - 1];
                const facingAngle = Math.atan2(target.y - shooter.y, target.x - shooter.x);

                // HP cost scales with rank
                const hpCost = shooterBattle.maxHealth * ALL_TALENTS.reaperArc.hpCost[arcRank - 1];
                shooterBattle.health = Math.max(1, shooterBattle.health - hpCost);

                this.holders.forEach(h => {
                  if (h.address === shooter.address || h.x === undefined) return;
                  const hb = this.battleBubbles.get(h.address);
                  if (!hb || hb.isGhost) return;

                  const edx = h.x - shooter.x;
                  const edy = h.y - shooter.y;
                  const eDist = Math.sqrt(edx * edx + edy * edy);
                  if (eDist > sweepRange + h.radius) return;

                  let angleToEnemy = Math.atan2(edy, edx) - facingAngle;
                  while (angleToEnemy > Math.PI) angleToEnemy -= 2 * Math.PI;
                  while (angleToEnemy < -Math.PI) angleToEnemy += 2 * Math.PI;
                  if (Math.abs(angleToEnemy) > halfAngle) return;

                  const arcDmg = shooterBattle.maxHealth * sweepDmgPct;
                  hb.health -= arcDmg;

                  this.damageNumbers.push({
                    id: `dmg-${now}-${Math.random()}`, x: h.x, y: h.y - 20,
                    damage: arcDmg, createdAt: now, alpha: 1,
                    color: '#ff1111', fontSize: 26, type: 'reaperArc',
                  });

                  if (this.magicBlockReady) this._queueAttack(shooter.address, h.address, arcDmg);

                  if (hb.health <= 0) {
                    hb.health = 0;
                    hb.isGhost = true;
                    hb.isAlive = false;
                  }
                });

                this.vfx.push({
                  type: 'reaperArc',
                  x: shooter.x, y: shooter.y,
                  angle: facingAngle,
                  range: sweepRange,
                  createdAt: now,
                  color: shooter.color || '#ff2233',
                });
              }
            }
          }
        }

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

        // Ricochet talent: chance to bounce to a second target (base damage only)
        if (shooterBattle && !bullet.isRicochet) {
          const ricochetChance = getTalentValue('ricochet', shooterBattle.talents?.ricochet || 0);
          if (ricochetChance > 0 && Math.random() < ricochetChance) {
            let bounceTarget = null;
            let bounceDist = Infinity;
            this.holders.forEach(h => {
              if (h.address === target.address || h.address === bullet.shooterAddress || h.x === undefined) return;
              const hBattle = this.battleBubbles.get(h.address);
              if (hBattle?.isGhost) return;
              const bdx = h.x - target.x;
              const bdy = h.y - target.y;
              const bd = Math.sqrt(bdx * bdx + bdy * bdy);
              if (bd < bounceDist) {
                bounceDist = bd;
                bounceTarget = h;
              }
            });
            if (bounceTarget) {
              const baseDmg = (shooterBattle.attackPower || BATTLE_CONFIG.bulletDamage) * ALL_TALENTS.ricochet.bounceDamage;
              this.bullets.push({
                id: `b-${this.bulletIdCounter++}`,
                shooterAddress: bullet.shooterAddress,
                targetAddress: bounceTarget.address,
                shooterColor: bullet.shooterColor,
                x: target.x, y: target.y,
                startX: target.x, startY: target.y,
                targetX: bounceTarget.x, targetY: bounceTarget.y,
                progress: 0,
                curveDirection: Math.random() > 0.5 ? 1 : -1,
                curveStrength: BATTLE_CONFIG.curveStrength.min,
                vx: 0, vy: 0,
                damage: baseDmg,
                createdAt: now,
                isRicochet: true,
              });
            }
          }
        }

        if (targetBattle.health <= 0) {
          targetBattle.health = 0;
          targetBattle.isGhost = true;
          targetBattle.isAlive = false;

          // Ghost duration scales with level: 20s base + 1s per level
          const victimLevel = calcLevel(targetBattle.xp || 0);
          const baseGhostMs = BATTLE_CONFIG.ghostBaseMs + (victimLevel - 1) * BATTLE_CONFIG.ghostPerLevelMs;
          targetBattle.ghostUntil = now + baseGhostMs;

          if (shooterBattle) {
            shooterBattle.kills++;
            let killXp = PROGRESSION.xpPerKillBase + (victimLevel - 1) * PROGRESSION.xpPerKillPerLevel;
            if (victimLevel >= 50) killXp *= 2;

            // Experience talent: bonus XP %
            const expVal = getTalentValue('experience', shooterBattle.talents?.experience || 0);
            if (expVal > 0) killXp = Math.round(killXp * (1 + expVal));

            shooterBattle.xp += killXp;
            const newLevel = calcLevel(shooterBattle.xp);
            shooterBattle.healthLevel = newLevel;
            shooterBattle.attackLevel = newLevel;
            shooterBattle.maxHealth = calcMaxHealth(newLevel);
            shooterBattle.attackPower = calcAttackPower(newLevel);
            shooterBattle.health = Math.min(shooterBattle.health, shooterBattle.maxHealth);
            if (!shooterBattle.manualBuild) {
              const newTalents = autoAllocateTalents(shooterBattle);
              this._queueTalentSync(bullet.shooterAddress, newTalents);
            }

            // Kill Rush talent: temporary speed + fire rate boost
            const killRushRank = shooterBattle.talents?.killRush || 0;
            if (killRushRank > 0) {
              shooterBattle.killRushUntil = now + ALL_TALENTS.killRush.durationMs;
            }

            // Berserker: passive talent, no on-kill effect needed
          }
          targetBattle.deaths++;
          const deathXp = PROGRESSION.xpPerDeath;
          targetBattle.xp += deathXp;
          if (!targetBattle.manualBuild) {
            const newTalents = autoAllocateTalents(targetBattle);
            this._queueTalentSync(target.address, newTalents);
          }

          this.killFeed.unshift({
            killer: bullet.shooterAddress,
            victim: target.address,
            time: now,
          });
          this.killFeed = this.killFeed.slice(0, 20);
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

    this.vfx = this.vfx.filter(v => now - v.createdAt < 1500);

    // Process attack queue (send to ER)
    this._processAttackQueue();
  }

  // ─── Brawler: Body Slam + Pinball + Shockwave ──────────────────────
  _processBrawlerCollisions(now, deltaTime) {
    for (let i = 0; i < this.holders.length; i++) {
      const a = this.holders[i];
      const bbA = this.battleBubbles.get(a.address);
      if (!bbA || bbA.isGhost || a.x === undefined) continue;

      for (let j = i + 1; j < this.holders.length; j++) {
        const b = this.holders[j];
        const bbB = this.battleBubbles.get(b.address);
        if (!bbB || bbB.isGhost || b.x === undefined) continue;

        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = a.radius + b.radius + 15;
        if (dist >= minDist) continue;

        const pairs = [[bbA, bbB, a, b], [bbB, bbA, b, a]];
        for (const [attacker, victim, aH, vH] of pairs) {
          const bodyRank = attacker.talents?.bodySlam || 0;
          if (bodyRank <= 0) continue;

          if (attacker._lastBodySlam && now - attacker._lastBodySlam < 1500) continue;

          attacker._lastBodySlam = now;
          const pct = getTalentValue('bodySlam', bodyRank);
          const dmg = attacker.maxHealth * pct;
          victim.health -= dmg;
          this.damageNumbers.push({
            id: `dmg-${now}-${Math.random()}`, x: vH.x, y: vH.y - 20,
            damage: dmg, createdAt: now, alpha: 1,
            color: '#ff8800', fontSize: 26, type: 'bodySlam',
          });
          if (this.magicBlockReady) this._queueAttack(aH.address, vH.address, dmg);

          // Shockwave: AoE on body hit (no CD during pinball)
          const swRank = attacker.talents?.shockwave || 0;
          if (swRank > 0) {
            const swPct = getTalentValue('shockwave', swRank);
            const swRadius = ALL_TALENTS.shockwave.radius[swRank - 1];
            const swDmg = attacker.maxHealth * swPct;
            this.vfx.push({ type: 'shockwave', x: vH.x, y: vH.y, radius: swRadius, color: aH.color || '#ff8800', createdAt: now });
            this.holders.forEach(h => {
              if (h.address === aH.address || h.x === undefined) return;
              const hb = this.battleBubbles.get(h.address);
              if (!hb || hb.isGhost) return;
              const sdx = h.x - vH.x;
              const sdy = h.y - vH.y;
              const sd = Math.sqrt(sdx * sdx + sdy * sdy);
              if (sd < swRadius) {
                const falloff = 1 - (sd / swRadius);
                const d = swDmg * falloff;
                hb.health -= d;
                if (this.magicBlockReady) this._queueAttack(aH.address, h.address, d);
              }
            });
          }

          // Pinball: bounce off victim like a bumper (reflect away)
          const pinballRank = attacker.talents?.relentless || 0;
          if (pinballRank > 0) {
            const bounceRange = ALL_TALENTS.relentless.bounceRange[pinballRank - 1];
            // Direction from victim back to attacker (away from impact)
            const awayX = aH.x - vH.x;
            const awayY = aH.y - vH.y;
            const awayDist = Math.sqrt(awayX * awayX + awayY * awayY) || 1;
            const nx = awayX / awayDist;
            const ny = awayY / awayDist;

            // Pick a random side to bounce (perpendicular left or right)
            const side = Math.random() < 0.5 ? 1 : -1;
            const perpX = -ny * side;
            const perpY = nx * side;

            // 45° between away and perpendicular for a natural ricochet
            const bx = (nx + perpX) * 0.707;
            const by = (ny + perpY) * 0.707;

            const strength = ALL_TALENTS.dash.dashStrength * 0.5;
            aH.vx = bx * strength;
            aH.vy = by * strength;
          }
        }
      }
    }
  }

  // ─── Orbit: orbiting orbs deal contact damage ──────────────────────
  _processOrbitDamage(now) {
    const cfg = ALL_TALENTS.orbit;
    this.battleBubbles.forEach((bubble, address) => {
      if (bubble.isGhost) return;
      const rank = bubble.talents?.orbit || 0;
      if (rank <= 0) return;

      const owner = this.holders.find(h => h.address === address);
      if (!owner || owner.x === undefined) return;

      const dmgPct = cfg.perRank[rank - 1];
      const orbitR = owner.radius + cfg.orbRadius;
      const hitR = cfg.orbSize + 4;

      if (!bubble._orbitHitTimers) bubble._orbitHitTimers = {};

      for (let i = 0; i < cfg.orbCount; i++) {
        const angle = (now / 1000) * cfg.orbRotationSpeed + (i * 2 * Math.PI / cfg.orbCount);
        const ox = owner.x + Math.cos(angle) * orbitR;
        const oy = owner.y + Math.sin(angle) * orbitR;

        this.holders.forEach(target => {
          if (target.address === address || target.x === undefined) return;
          const tb = this.battleBubbles.get(target.address);
          if (!tb || tb.isGhost) return;

          const dx = target.x - ox;
          const dy = target.y - oy;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > target.radius + hitR) return;

          const key = `${address}_${target.address}`;
          if (bubble._orbitHitTimers[key] && now - bubble._orbitHitTimers[key] < cfg.orbHitCooldown) return;
          bubble._orbitHitTimers[key] = now;

          const dmg = bubble.maxHealth * dmgPct;
          tb.health -= dmg;
          this.damageNumbers.push({
            id: `dmg-${now}-${Math.random()}`, x: target.x, y: target.y - 15,
            damage: dmg, createdAt: now, alpha: 1,
            color: '#88ffcc', fontSize: 14, type: 'orbit',
          });
          if (this.magicBlockReady) this._queueAttack(address, target.address, dmg);
        });
      }
    });
  }

  // ─── Nova: periodic burst of straight-line bullets in all directions ───
  _processNova(now) {
    this.battleBubbles.forEach((bubble, address) => {
      if (bubble.isGhost) return;
      const novaRank = bubble.talents?.nova || 0;
      if (novaRank <= 0) return;
      const interval = ALL_TALENTS.nova.intervalMs;
      if (!bubble._lastNova) bubble._lastNova = now - Math.random() * interval;
      if (now - bubble._lastNova < interval) return;
      bubble._lastNova = now;

      const holder = this.holders.find(h => h.address === address);
      if (!holder || holder.x === undefined) return;

      const count = ALL_TALENTS.nova.projectiles[novaRank - 1];
      const baseDmg = (bubble.attackPower || BATTLE_CONFIG.bulletDamage) * ALL_TALENTS.nova.novaDamageMultiplier;
      const novaSpeed = ALL_TALENTS.nova.novaSpeed;
      const range = ALL_TALENTS.nova.novaRange;

      if (!bubble._novaRotation) bubble._novaRotation = 0;
      bubble._novaRotation += ALL_TALENTS.nova.spiralSpread;

      for (let i = 0; i < count; i++) {
        const angle = (Math.PI * 2 / count) * i + bubble._novaRotation;
        const endX = holder.x + Math.cos(angle) * range;
        const endY = holder.y + Math.sin(angle) * range;

        this.bullets.push({
          id: `b-${this.bulletIdCounter++}`,
          shooterAddress: address,
          targetAddress: address,
          shooterColor: holder.color,
          x: holder.x, y: holder.y,
          startX: holder.x, startY: holder.y,
          targetX: endX, targetY: endY,
          progress: 0,
          curveDirection: 0,
          curveStrength: 0,
          vx: Math.cos(angle) * novaSpeed,
          vy: Math.sin(angle) * novaSpeed,
          damage: baseDmg,
          createdAt: now,
          isNova: true,
          novaMaxDist: range,
        });
      }
    });
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

  // ─── Talent Chain Sync Queue ─────────────────────────────────────

  _queueTalentSync(walletAddress, talentNames) {
    if (!talentNames || talentNames.length === 0) return;
    for (const name of talentNames) {
      const chainId = TALENT_NAME_TO_CHAIN_ID[name];
      if (chainId !== undefined) {
        this.talentSyncQueue.push({ wallet: walletAddress, chainId });
      }
    }
    this._processTalentSyncQueue();
  }

  async _processTalentSyncQueue() {
    if (this.isProcessingTalentSync || this.talentSyncQueue.length === 0) return;
    if (!this.magicBlockReady) return;
    this.isProcessingTalentSync = true;

    while (this.talentSyncQueue.length > 0) {
      const { wallet, chainId } = this.talentSyncQueue.shift();
      try {
        await this.magicBlock.allocateTalentOnChain(wallet, chainId);
      } catch (err) {
        // Non-critical — local state is the authority, chain is best-effort
      }
      await new Promise(r => setTimeout(r, 200));
    }

    this.isProcessingTalentSync = false;
  }

  // ─── ER State Sync ───────────────────────────────────────────────

  async syncFromER() {
    if (!this.magicBlock.ready || this._isSyncingER) return;
    this._isSyncingER = true;

    try {
      const erStates = await this.magicBlock.getAllPlayerStates();
      let synced = 0;

      for (const [walletAddress, state] of erStates) {
        const bubble = this.battleBubbles.get(walletAddress);
        if (bubble) {
          bubble.kills = Math.max(bubble.kills, state.kills);
          bubble.deaths = Math.max(bubble.deaths, state.deaths);
          bubble.xp = Math.max(bubble.xp, state.xp);

          const effectiveLevel = calcLevel(bubble.xp);
          bubble.healthLevel = Math.max(bubble.healthLevel, state.healthLevel, effectiveLevel);
          bubble.attackLevel = Math.max(bubble.attackLevel, state.attackLevel, effectiveLevel);
          bubble.attackPower = calcAttackPower(bubble.attackLevel);

          // Derive maxHealth from local level + Iron Skin talent (local authority).
          const baseMax = calcMaxHealth(bubble.healthLevel);
          const ironSkinVal = getTalentValue('ironSkin', bubble.talents?.ironSkin || 0);
          bubble.maxHealth = ironSkinVal > 0 ? Math.round(baseMax * (1 + ironSkinVal)) : baseMax;

          // Only trust ER health/alive data when the ER state is clearly
          // current (has at least as much XP and kills as local). After an ER
          // reset the stale accounts show full HP / 0 kills which would snap
          // every idle player back to full health every sync cycle.
          const erIsAhead = state.xp >= bubble.xp && state.kills >= bubble.kills;
          const recentlyRespawned = bubble.respawnedAt && (Date.now() - bubble.respawnedAt < 10000);
          if (erIsAhead && !bubble.isGhost && !recentlyRespawned) {
            if (state.health >= state.maxHealth && bubble.health < bubble.maxHealth) {
              bubble.health = bubble.maxHealth;
            }
            if (state.isAlive && !bubble.isAlive) {
              bubble.isAlive = true;
            }
          }

          // Talents: only adopt chain state if chain is strictly AHEAD in total
          // points AND the local player hasn't manually allocated (manualBuild).
          // The strict > prevents the chain from overwriting a local build that
          // has the same point total but a different talent distribution.
          if (state.talents && !bubble.manualBuild) {
            const chainPts = totalPointsSpent(state.talents);
            const localPts = totalPointsSpent(bubble.talents);
            if (chainPts > localPts) {
              bubble.talents = { ...state.talents };
              bubble.manualBuild = state.manualBuild || false;
            }
          }

          // Write the merged bubble state back into playerCache so that any
          // future bubble recreation (holder refresh) uses the best-known data
          // instead of potentially stale raw chain values.
          this.playerCache.set(walletAddress, {
            walletAddress,
            health: bubble.health,
            maxHealth: bubble.maxHealth,
            attackPower: bubble.attackPower,
            xp: bubble.xp,
            kills: bubble.kills,
            deaths: bubble.deaths,
            healthLevel: bubble.healthLevel,
            attackLevel: bubble.attackLevel,
            isAlive: bubble.isAlive,
            talents: { ...bubble.talents },
            manualBuild: bubble.manualBuild,
          });
        } else {
          // No bubble yet — seed cache from chain for future bubble creation
          this.playerCache.set(walletAddress, state);
        }

        synced++;
      }

      if (synced > 0) this.updateTopKillers();

      // Push local talent state to chain for wallets where chain is behind
      await this._catchUpChainTalents(erStates);
    } catch (err) {
      console.error('ER sync error:', err.message);
    } finally {
      this._isSyncingER = false;
    }
  }

  // Reconcile local talent state → chain. Runs after every ER sync to ensure
  // that fire-and-forget talent ops that failed silently eventually get pushed.
  // Throttled to run at most every 30s to avoid spamming the ER.
  async _catchUpChainTalents(erStates) {
    const now = Date.now();
    if (now - this._lastTalentCatchUp < 30000) return;
    if (!this.magicBlockReady || this.isProcessingTalentSync) return;
    this._lastTalentCatchUp = now;

    const pendingWallets = new Set(this.talentSyncQueue.map(item => item.wallet));

    for (const [walletAddress, bubble] of this.battleBubbles) {
      if (pendingWallets.has(walletAddress)) continue;

      const chainState = erStates.get(walletAddress);
      if (!chainState?.talents) continue;

      let needsSync = false;
      for (const talentName of Object.keys(ALL_TALENTS)) {
        if ((bubble.talents[talentName] || 0) !== (chainState.talents[talentName] || 0)) {
          needsSync = true;
          break;
        }
      }
      if (!needsSync) continue;

      const chainPts = totalPointsSpent(chainState.talents);
      const localPts = totalPointsSpent(bubble.talents);

      // If chain has talents that don't match local, reset chain first
      if (chainPts > 0) {
        const ok = await this.magicBlock.resetTalentsOnChain(walletAddress);
        if (!ok) continue; // will retry next cycle
        await new Promise(r => setTimeout(r, 200));
      }

      // Now push all local talent ranks from scratch
      if (localPts > 0) {
        let failed = false;
        for (const [talentName, chainId] of Object.entries(TALENT_NAME_TO_CHAIN_ID)) {
          const localRank = bubble.talents[talentName] || 0;
          for (let i = 0; i < localRank; i++) {
            const ok = await this.magicBlock.allocateTalentOnChain(walletAddress, chainId);
            if (!ok) { failed = true; break; }
            await new Promise(r => setTimeout(r, 150));
          }
          if (failed) break;
        }
      }
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
      bubble.talents = createEmptyTalents();
      bubble.manualBuild = false;
      bubble.lastHitTarget = null;
      bubble.focusFireStacks = 0;
      bubble.shotCounter = 0;
      bubble.killRushUntil = 0;
      bubble._lastDash = 0;
      bubble._dashActive = 0;
      bubble._lastDashHit = 0;
      bubble._lastContactDmg = 0;
      bubble._lastNova = 0;
    }

    this.playerCache.clear();
    this.killFeed = [];
    this.topKillers = [];
    this.damageBuffer.clear();
    this.addEventLog('New season started — all stats reset!');

    console.log('SEASON RESET: complete', result);
    return { success: true, ...result };
  }

  // ─── One-time catch-up: boost all players below median ──────────

  catchUpLowLevelPlayers() {
    const medianXp = this.getMedianXp();
    if (medianXp <= 0) return 0;

    let boosted = 0;
    for (const [address, bubble] of this.battleBubbles) {
      if ((bubble.xp || 0) >= medianXp) continue;

      const oldLevel = calcLevel(bubble.xp || 0);
      bubble.xp = medianXp;
      const lvl = calcLevel(medianXp);
      bubble.healthLevel = lvl;
      bubble.attackLevel = lvl;
      bubble.maxHealth = calcMaxHealth(lvl);
      bubble.attackPower = calcAttackPower(lvl);
      bubble.health = Math.min(bubble.health, bubble.maxHealth);

      if (!bubble.manualBuild) {
        const newTalents = autoAllocateTalents(bubble);
        this._queueTalentSync(address, newTalents);
      }

      boosted++;
      console.log(`Catch-up: ${address.slice(0, 6)}... boosted from level ${oldLevel} to ${lvl}`);
    }

    if (boosted > 0) {
      this.updateTopKillers();
      this.addEventLog(`${boosted} player(s) boosted to median level ${calcLevel(medianXp)}`);
      console.log(`Catch-up complete: ${boosted} players boosted to median level ${calcLevel(medianXp)} (${medianXp} XP)`);
    }
    return boosted;
  }

  // ─── Event & Player Management ───────────────────────────────────

  addEventLog(message) {
    this.eventLog.unshift(message);
    this.eventLog = this.eventLog.slice(0, 10);
  }

  ensurePlayerCached(walletAddress) {
    if (!this.playerCache.has(walletAddress)) {
      const medianXp = this.getMedianXp();
      const medianLevel = calcLevel(medianXp);
      this.playerCache.set(walletAddress, {
        walletAddress,
        health: calcMaxHealth(medianLevel),
        maxHealth: calcMaxHealth(medianLevel),
        attackPower: calcAttackPower(medianLevel),
        xp: medianXp,
        kills: 0,
        deaths: 0,
        healthLevel: medianLevel,
        attackLevel: medianLevel,
        isAlive: true,
        talents: createEmptyTalents(),
        manualBuild: false,
      });

      if (medianLevel > 1) {
        console.log(`New player ${walletAddress.slice(0, 6)}... starts at median level ${medianLevel} (${medianXp} XP)`);
      }

      // Queue for ER registration
      if (this.magicBlockReady) {
        this._queueRegistration(walletAddress);
      }
    }
    return this.playerCache.get(walletAddress);
  }

  allocateTalent(walletAddress, talentId) {
    const bubble = this.battleBubbles.get(walletAddress);
    if (!bubble) return { success: false, error: 'Not in game' };
    const talent = ALL_TALENTS[talentId];
    if (!talent) return { success: false, error: 'Unknown talent' };
    if (!canAllocate(talentId, bubble.talents)) {
      if (CAPSTONE_TALENTS.includes(talentId) && (bubble.talents[talentId] || 0) === 0) {
        const chosen = CAPSTONE_TALENTS.filter(id => (bubble.talents[id] || 0) > 0).length;
        if (chosen >= MAX_CAPSTONES) {
          return { success: false, error: `Max ${MAX_CAPSTONES} ultimates allowed` };
        }
      }
      return { success: false, error: talent.requires ? 'Prerequisite not met' : 'Already maxed' };
    }
    const level = calcLevel(bubble.xp);
    const available = calcTalentPoints(level) - totalPointsSpent(bubble.talents);
    if (available <= 0) return { success: false, error: 'No talent points available' };

    bubble.talents[talentId] = (bubble.talents[talentId] || 0) + 1;
    bubble.manualBuild = true;

    // Recalc Iron Skin immediately so HP reflects the new talent
    const ironSkinVal = getTalentValue('ironSkin', bubble.talents.ironSkin || 0);
    if (ironSkinVal > 0) {
      const boostedMax = Math.round(calcMaxHealth(bubble.healthLevel) * (1 + ironSkinVal));
      bubble.maxHealth = boostedMax;
      bubble.health = Math.min(bubble.health, bubble.maxHealth);
    }

    // Push to chain via queue (catch-up mechanism retries persistent failures)
    this._queueTalentSync(walletAddress, [talentId]);

    return {
      success: true,
      talents: { ...bubble.talents },
      talentPoints: calcTalentPoints(level) - totalPointsSpent(bubble.talents),
    };
  }

  resetTalents(walletAddress) {
    const bubble = this.battleBubbles.get(walletAddress);
    if (!bubble) return { success: false, error: 'Not in game' };
    bubble.talents = createEmptyTalents();
    bubble.manualBuild = true;
    // Recalc stats back to base
    const level = calcLevel(bubble.xp);
    bubble.maxHealth = calcMaxHealth(bubble.healthLevel);
    bubble.health = Math.min(bubble.health, bubble.maxHealth);

    // Push to chain (fire-and-forget)
    if (this.magicBlockReady) {
      this.magicBlock.resetTalentsOnChain(walletAddress).catch(() => {});
    }

    return {
      success: true,
      talents: { ...bubble.talents },
      talentPoints: calcTalentPoints(level),
    
    };
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
      if (address.startsWith('guest_')) continue;
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
    
    // Preserve guest holders across refresh
    const guestHolders = this.holders.filter(h => h.address.startsWith('guest_'));
    this.holders = [...newHolders, ...guestHolders];
    this.initializePositions();
    console.log(`Live refresh: ${this.holders.length} holders (${guestHolders.length} guests)`);
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

  // ─── Guest Players ──────────────────────────────────────────────

  addGuest(address) {
    if (this.guestAddresses.size >= 10) return { success: false, error: 'Guest slots full' };
    if (this.guestAddresses.has(address)) return { success: false, error: 'Already a guest' };

    this.guestAddresses.add(address);

    const { width, height } = this.dimensions;
    const margin = 150;
    const holder = {
      address,
      balance: 0,
      percentage: 0,
      color: `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`,
      radius: 18,
      x: margin + Math.random() * (width - margin * 2),
      y: margin + Math.random() * (height - margin * 2),
      vx: (Math.random() - 0.5) * 2,
      vy: (Math.random() - 0.5) * 2,
      isGuest: true,
    };
    this.holders.push(holder);

    const medianXp = this.getMedianXp();
    const lvl = calcLevel(medianXp);
    const maxHealth = calcMaxHealth(lvl);
    const attackPower = calcAttackPower(lvl);

    const bubble = {
      address,
      health: maxHealth,
      maxHealth,
      attackPower,
      isGhost: false,
      ghostUntil: null,
      lastShotTime: 0,
      kills: 0,
      deaths: 0,
      xp: medianXp,
      healthLevel: lvl,
      attackLevel: lvl,
      isAlive: true,
      talents: createEmptyTalents(),
      manualBuild: false,
      lastHitTarget: null,
      focusFireStacks: 0,
      shotCounter: 0,
      talentResets: 0,
      _lastDash: 0,
      _lastDashHit: 0,
      _lastContactDmg: 0,
      killRushUntil: 0,
      _lastNova: 0,
    };
    const newTalents = autoAllocateTalents(bubble);
    this.battleBubbles.set(address, bubble);

    this.eventLog.unshift(`Guest joined the arena!`);
    if (this.eventLog.length > 50) this.eventLog.pop();

    return { success: true, address };
  }

  removeGuest(address) {
    if (!this.guestAddresses.has(address)) return;
    this.guestAddresses.delete(address);
    this.holders = this.holders.filter(h => h.address !== address);
    this.battleBubbles.delete(address);
    this.playerCache.delete(address);
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
        talents: b.talents || {},
        talentPoints: calcTalentPoints(calcLevel(b.xp || 0)) - totalPointsSpent(b.talents || {}),
        manualBuild: b.manualBuild || false,
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
        isBloodBolt: b.isBloodBolt || false,
        isLifeTap: b.isLifeTap || false,
        isBloodWave: b.isBloodWave || false,
      })),
      damageNumbers: this.damageNumbers,
      vfx: this.vfx,
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
      const initialized = await this.magicBlock.initialize();
      if (!initialized) {
        console.warn('MagicBlock ER not available — game runs locally only');
        return;
      }

      console.log('MagicBlock ER integration active!');
      console.log('   Arena:', this.magicBlock.arenaPda.toBase58());
      console.log('   Delegated:', this.magicBlock.arenaDelegated);

      // Restore persisted state from ER BEFORE enabling magicBlockReady.
      // This prevents the game loop from sending stale level-1 attacks to
      // the ER and overwriting real player data.
      console.log('Restoring player state from Ephemeral Rollup...');
      await this.syncFromER();
      console.log(`ER state restored for ${this.playerCache.size} players`);

      // NOW enable ER features — game loop can safely send attacks
      this.magicBlockReady = true;

      this.magicBlock.startCommitTimer(30000);

      // Register all holders that loaded before MagicBlock was ready.
      for (const holder of this.holders) {
        this._queueRegistration(holder.address);
      }

      // Process any talent allocations queued before MagicBlock was ready
      this._processTalentSyncQueue();

      // Start periodic ER sync
      this.erSyncInterval = setInterval(() => this.syncFromER(), 10000);
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
      console.log('Committing all player state to base layer before shutdown...');
      await this.magicBlock.commitAllPlayers();
      await this.magicBlock.commitState();
    }
  }
}

module.exports = { GameState, BATTLE_CONFIG, PHYSICS_CONFIG, calcLevel };
