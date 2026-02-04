// Server-side game state management
// This runs continuously and maintains the battle simulation

const BATTLE_CONFIG = {
  maxHealth: 100,
  bulletDamage: 0.1,
  fireRate: 200, // ms between shots
  bulletSpeed: 8,
  ghostDuration: 60000, // 60 seconds
  curveStrength: { min: 25, max: 60 },
};

const PHYSICS_CONFIG = {
  minSpeed: 0.3,
  maxSpeed: 2.5,
  velocityDecay: 0.998,
  collisionPadding: 5,
  wallBounce: 0.7,
};

class GameState {
  constructor() {
    this.holders = [];
    this.battleBubbles = new Map();
    this.bullets = [];
    this.damageNumbers = [];
    this.killFeed = [];
    this.eventLog = [];
    this.topKillers = [];
    this.dimensions = { width: 3840, height: 2160 }; // Default dimensions (2x larger)
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
    this.minRefreshInterval = 5000; // Minimum 5 seconds between refreshes
    this.lastPriceUpdate = 0;
  }

  // Fast price-only update (doesn't fetch full metadata)
  async updatePrice() {
    try {
      const isPumpToken = this.tokenAddress.toLowerCase().endsWith('pump');
      
      // Try multiple sources in parallel for fastest response
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

      // Try Jupiter first (usually faster and more accurate)
      if (jupResult.status === 'fulfilled' && jupResult.value?.data?.[this.tokenAddress]) {
        price = parseFloat(jupResult.value.data[this.tokenAddress].price) || 0;
      }

      // Use DexScreener as backup or for additional data
      if (dexResult.status === 'fulfilled' && dexResult.value?.pairs?.[0]) {
        const pair = dexResult.value.pairs[0];
        if (!price) {
          price = parseFloat(pair.priceUsd) || 0;
        }
        priceChange1h = pair.priceChange?.h1 || 0;
        priceChange24h = pair.priceChange?.h24 || 0;
        
        // Update logo if we don't have one
        if (!this.token.logoUri && pair.info?.imageUrl) {
          this.token.logoUri = pair.info.imageUrl;
        }
      }

      if (price > 0) {
        // Calculate market cap (pump.fun tokens have 1B supply)
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

  // Fetch token metadata from DexScreener + Jupiter for accurate pricing
  async fetchTokenMetadata() {
    try {
      if (!this.tokenAddress) {
        console.log('No token address provided, skipping metadata fetch');
        return;
      }

      // Check if this is a pump.fun token (address ends with "pump")
      const isPumpToken = this.tokenAddress.toLowerCase().endsWith('pump');
      
      // Get DexScreener data for token info
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
          totalSupply: isPumpToken ? 1_000_000_000 : 0, // pump.fun tokens have 1B supply
          logoUri: pair.info?.imageUrl || '',
        };
        
        // For pump.fun tokens, calculate market cap from price * total supply
        // pump.fun tokens have 1 billion total supply with 6 decimals
        let marketCap = parseFloat(pair.fdv) || parseFloat(pair.marketCap) || 0;
        const price = parseFloat(pair.priceUsd) || 0;
        
        // If FDV seems off, calculate from price (pump.fun tokens = 1B supply)
        if (isPumpToken && price > 0) {
          const calculatedMcap = price * 1_000_000_000;
          // Use the larger value as pump.fun shows circulating supply mcap
          // which is close to fully diluted for most pump tokens
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
        console.log('Token logo:', this.token.logoUri || 'none');
        return;
      }

      // Fallback: Try Helius DAS API for metadata
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
          
          console.log('Token metadata from Helius:', this.token.symbol, '-', this.token.name);
          return;
        }
      }

      console.log('Could not fetch token metadata');
    } catch (error) {
      console.error('Error fetching token metadata:', error.message);
    }
  }

  // Initialize holders from API
  async fetchHolders() {
    try {
      const apiKey = process.env.HELIUS_API_KEY;
      console.log('Fetching holders... API Key:', apiKey ? 'present' : 'MISSING', 'Token:', this.tokenAddress);
      
      if (!apiKey || !this.tokenAddress) {
        console.error('ERROR: Missing HELIUS_API_KEY or TOKEN_ADDRESS - cannot fetch real holders');
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
      console.log('Processing', accounts.length, 'real holder accounts');

      // Show all holders above minimum percentage threshold
      const maxHolders = parseInt(process.env.MAX_HOLDERS_DISPLAY) || 500;
      const minPercentage = 0.01; // Filter out holders with 0.01% or less
      
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
        .filter(h => h.percentage > minPercentage) // Only show holders above 0.01%
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

  // Initialize positions for holders
  initializePositions() {
    const { width, height } = this.dimensions;
    const centerX = width / 2;
    const centerY = height / 2;
    const margin = 150;

    this.holders.forEach((holder, i) => {
      if (holder.x === undefined || holder.y === undefined) {
        // Random position within bounds - spread across the larger canvas
        holder.x = margin + Math.random() * (width - margin * 2);
        holder.y = margin + Math.random() * (height - margin * 2);
        holder.vx = (Math.random() - 0.5) * 2;
        holder.vy = (Math.random() - 0.5) * 2;
      }

      // Initialize battle bubble if not exists
      if (!this.battleBubbles.has(holder.address)) {
        this.battleBubbles.set(holder.address, {
          address: holder.address,
          health: BATTLE_CONFIG.maxHealth,
          maxHealth: BATTLE_CONFIG.maxHealth,
          isGhost: false,
          ghostUntil: null,
          lastShotTime: 0,
          kills: 0,
          deaths: 0,
        });
      }
    });
  }

  // Main game loop tick
  tick() {
    const now = Date.now();
    const deltaTime = Math.min((now - this.lastUpdateTime) / 16, 3);
    this.lastUpdateTime = now;

    if (this.holders.length === 0) return;

    const { width, height } = this.dimensions;

    // Update physics for each holder
    this.holders.forEach(holder => {
      if (holder.x === undefined || holder.y === undefined) return;

      // Apply velocity
      holder.x += (holder.vx || 0) * deltaTime;
      holder.y += (holder.vy || 0) * deltaTime;

      // Apply velocity decay
      holder.vx = (holder.vx || 0) * PHYSICS_CONFIG.velocityDecay;
      holder.vy = (holder.vy || 0) * PHYSICS_CONFIG.velocityDecay;

      // Wall collisions
      const margin = holder.radius + 10;
      if (holder.x < margin) {
        holder.x = margin;
        holder.vx = Math.abs(holder.vx) * PHYSICS_CONFIG.wallBounce;
      }
      if (holder.x > width - margin) {
        holder.x = width - margin;
        holder.vx = -Math.abs(holder.vx) * PHYSICS_CONFIG.wallBounce;
      }
      if (holder.y < margin) {
        holder.y = margin;
        holder.vy = Math.abs(holder.vy) * PHYSICS_CONFIG.wallBounce;
      }
      if (holder.y > height - margin) {
        holder.y = height - margin;
        holder.vy = -Math.abs(holder.vy) * PHYSICS_CONFIG.wallBounce;
      }

      // Maintain minimum speed
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

      // Cap max speed
      if (speed > PHYSICS_CONFIG.maxSpeed) {
        const scale = PHYSICS_CONFIG.maxSpeed / speed;
        holder.vx *= scale;
        holder.vy *= scale;
      }
    });

    // Bubble-to-bubble collisions
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

          // Separate bubbles
          const separation = overlap / 2 + 1;
          a.x -= nx * separation;
          a.y -= ny * separation;
          b.x += nx * separation;
          b.y += ny * separation;

          // Elastic collision response
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

    // Check for ghost respawns
    this.battleBubbles.forEach((bubble, address) => {
      if (bubble.isGhost && bubble.ghostUntil && now >= bubble.ghostUntil) {
        bubble.isGhost = false;
        bubble.ghostUntil = null;
        bubble.health = BATTLE_CONFIG.maxHealth;
        this.addEventLog(`👻 ${address.slice(0, 6)}... respawned!`);
      }
    });

    // Shooting logic
    this.holders.forEach(holder => {
      if (holder.x === undefined) return;
      
      const battleBubble = this.battleBubbles.get(holder.address);
      if (!battleBubble || battleBubble.isGhost) return;

      if (now - battleBubble.lastShotTime < BATTLE_CONFIG.fireRate) return;

      // Find closest non-ghost target
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
          damage: BATTLE_CONFIG.bulletDamage,
          createdAt: now,
        });

        battleBubble.lastShotTime = now;
      }
    });

    // Update bullets
    const bulletsToRemove = new Set();

    this.bullets.forEach(bullet => {
      // Update progress along curved path
      const totalDist = Math.sqrt(
        Math.pow(bullet.targetX - bullet.startX, 2) +
        Math.pow(bullet.targetY - bullet.startY, 2)
      );
      const progressSpeed = BATTLE_CONFIG.bulletSpeed / totalDist;
      bullet.progress += progressSpeed;

      // Calculate curved position
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

      // Remove if completed path
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
          targetBattle.health -= bullet.damage;

          // Add damage number
          this.damageNumbers.push({
            id: `dmg-${now}-${Math.random()}`,
            x: target.x + (Math.random() - 0.5) * 20,
            y: target.y - 10,
            damage: bullet.damage,
            createdAt: now,
            alpha: 1,
          });

          // Check for death
          if (targetBattle.health <= 0) {
            targetBattle.health = 0;
            targetBattle.isGhost = true;
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

            this.addEventLog(`☠️ ${target.address.slice(0, 6)}... killed by ${bullet.shooterAddress.slice(0, 6)}...`);
            this.updateTopKillers();
          }
        }
      });
    });

    this.bullets = this.bullets.filter(b => !bulletsToRemove.has(b.id));

    // Update damage numbers
    this.damageNumbers = this.damageNumbers
      .map(dn => ({ ...dn, y: dn.y - 0.5, alpha: dn.alpha - 0.02 }))
      .filter(dn => dn.alpha > 0);
  }

  addEventLog(message) {
    this.eventLog.unshift(message);
    this.eventLog = this.eventLog.slice(0, 10);
  }

  // Handle incoming transaction - trigger throttled refresh
  async handleTransaction(event) {
    const now = Date.now();
    
    // Log the transaction
    if (event.type === 'buy') {
      this.addEventLog(`🟢 BUY tx: ${event.signature?.slice(0, 8) || 'unknown'}...`);
    } else if (event.type === 'sell') {
      this.addEventLog(`🔴 SELL tx: ${event.signature?.slice(0, 8) || 'unknown'}...`);
    } else {
      this.addEventLog(`💫 TX: ${event.signature?.slice(0, 8) || 'unknown'}...`);
    }

    // Always update price immediately on any transaction
    this.updatePrice();

    // Throttle holder refreshes - don't refresh more than once per minRefreshInterval
    if (now - this.lastRefreshTime < this.minRefreshInterval) {
      // Schedule a pending refresh if not already scheduled
      if (!this.pendingRefresh) {
        this.pendingRefresh = true;
        const delay = this.minRefreshInterval - (now - this.lastRefreshTime);
        setTimeout(() => this.refreshHoldersNow(), delay);
      }
      return;
    }

    // Refresh holders immediately
    await this.refreshHoldersNow();
  }

  // Refresh holders immediately (with change detection)
  async refreshHoldersNow() {
    this.pendingRefresh = false;
    this.lastRefreshTime = Date.now();
    
    const oldHolders = new Map(this.holders.map(h => [h.address, h]));
    const newHolders = await this.fetchHolders();
    
    // Track changes
    const newAddresses = new Set(newHolders.map(h => h.address));
    const oldAddresses = new Set(this.holders.map(h => h.address));
    
    // Find removed holders (sold everything - bubble pops!)
    for (const [address, holder] of oldHolders) {
      if (!newAddresses.has(address)) {
        // This holder sold everything - create pop effect
        this.addEventLog(`💥 ${address.slice(0, 6)}... sold everything!`);
        
        // Remove their battle bubble
        this.battleBubbles.delete(address);
        
        // You could add explosion effects here if you track them
        console.log(`Holder removed (sold all): ${address.slice(0, 8)}...`);
      }
    }
    
    // Find new holders
    for (const holder of newHolders) {
      if (!oldAddresses.has(holder.address)) {
        // New holder appeared!
        this.addEventLog(`🆕 ${holder.address.slice(0, 6)}... joined! (${holder.percentage.toFixed(2)}%)`);
        console.log(`New holder: ${holder.address.slice(0, 8)}... with ${holder.percentage.toFixed(2)}%`);
      }
    }
    
    // Find holders with significant balance changes
    for (const newHolder of newHolders) {
      const oldHolder = oldHolders.get(newHolder.address);
      if (oldHolder) {
        const pctChange = newHolder.percentage - oldHolder.percentage;
        
        // Preserve position and velocity from old holder
        newHolder.x = oldHolder.x;
        newHolder.y = oldHolder.y;
        newHolder.vx = oldHolder.vx;
        newHolder.vy = oldHolder.vy;
        
        // Log significant changes (more than 0.1% change)
        if (Math.abs(pctChange) > 0.1) {
          if (pctChange > 0) {
            this.addEventLog(`📈 ${newHolder.address.slice(0, 6)}... +${pctChange.toFixed(2)}%`);
          } else {
            this.addEventLog(`📉 ${newHolder.address.slice(0, 6)}... ${pctChange.toFixed(2)}%`);
          }
        }
      }
    }
    
    this.holders = newHolders;
    this.initializePositions();
    console.log(`Live refresh: ${this.holders.length} holders`);
  }

  updateTopKillers() {
    this.topKillers = Array.from(this.battleBubbles.values())
      .filter(b => b.kills > 0)
      .sort((a, b) => b.kills - a.kills)
      .slice(0, 5)
      .map(b => ({ address: b.address, kills: b.kills }));
  }

  // Get serializable state for clients
  getState() {
    return {
      holders: this.holders.map(h => ({
        address: h.address,
        balance: h.balance,
        percentage: h.percentage,
        color: h.color,
        radius: h.radius,
        x: h.x,
        y: h.y,
      })),
      battleBubbles: Array.from(this.battleBubbles.entries()).map(([addr, b]) => ({
        address: addr,
        health: b.health,
        maxHealth: b.maxHealth,
        isGhost: b.isGhost,
        ghostUntil: b.ghostUntil,
        kills: b.kills,
        deaths: b.deaths,
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
    };
  }

  // Start the game loop
  async start() {
    if (this.isRunning) return;
    
    console.log('Starting game state...');
    this.isRunning = true;

    // Fetch token metadata (name, symbol, logo)
    await this.fetchTokenMetadata();

    // Fetch initial holders
    this.holders = await this.fetchHolders();
    this.initializePositions();
    
    console.log(`Loaded ${this.holders.length} holders`);

    // Run game loop at 60fps
    this.gameLoop = setInterval(() => {
      this.tick();
    }, 1000 / 60);

    // Refresh holders every 2 minutes
    this.holderRefresh = setInterval(async () => {
      const newHolders = await this.fetchHolders();
      // Preserve positions for existing holders
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
      console.log(`Refreshed holders: ${this.holders.length}`);
    }, 120000);

    // Fast price refresh every 5 seconds
    this.priceRefresh = setInterval(async () => {
      await this.updatePrice();
    }, 5000);

    // Full metadata refresh every 60 seconds (for logo, name updates)
    this.metadataRefresh = setInterval(async () => {
      await this.fetchTokenMetadata();
    }, 60000);
  }

  stop() {
    this.isRunning = false;
    if (this.gameLoop) clearInterval(this.gameLoop);
    if (this.holderRefresh) clearInterval(this.holderRefresh);
    if (this.priceRefresh) clearInterval(this.priceRefresh);
    if (this.metadataRefresh) clearInterval(this.metadataRefresh);
  }
}

module.exports = { GameState, BATTLE_CONFIG, PHYSICS_CONFIG };
