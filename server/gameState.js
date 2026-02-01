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
    this.dimensions = { width: 1920, height: 1080 }; // Default dimensions
    this.lastUpdateTime = Date.now();
    this.bulletIdCounter = 0;
    this.isRunning = false;
    this.tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS || '';
    this.token = {
      address: this.tokenAddress,
      symbol: 'TOKEN',
      name: 'Token',
      decimals: 9,
      totalSupply: 0,
      logoUri: '',
    };
    this.priceData = null;
  }

  // Initialize holders from API
  async fetchHolders() {
    try {
      const apiKey = process.env.HELIUS_API_KEY;
      if (!apiKey || !this.tokenAddress) {
        console.log('Missing API key or token address, using mock data');
        return this.generateMockHolders();
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
      
      if (data.error || !data.result?.token_accounts) {
        console.error('Helius API error:', data.error);
        return this.generateMockHolders();
      }

      const accounts = data.result.token_accounts;
      const totalSupply = accounts.reduce((sum, acc) => sum + acc.amount, 0);

      const holders = accounts
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 100)
        .map((account, index) => {
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
        });

      return holders;
    } catch (error) {
      console.error('Error fetching holders:', error);
      return this.generateMockHolders();
    }
  }

  generateMockHolders() {
    const holders = [];
    const count = 50;
    let remaining = 100;

    for (let i = 0; i < count; i++) {
      const isLast = i === count - 1;
      const maxPct = Math.min(remaining, isLast ? remaining : remaining * 0.4);
      const percentage = isLast ? remaining : Math.random() * maxPct * 0.8 + maxPct * 0.1;
      remaining -= percentage;

      const address = `mock${i.toString().padStart(4, '0')}${Math.random().toString(36).slice(2, 10)}`;
      
      holders.push({
        address,
        balance: Math.floor(percentage * 1000000),
        percentage,
        color: this.getHolderColor(percentage, address),
        radius: this.calculateRadius(percentage),
        x: undefined,
        y: undefined,
        vx: (Math.random() - 0.5) * 2,
        vy: (Math.random() - 0.5) * 2,
      });
    }

    return holders.sort((a, b) => b.percentage - a.percentage);
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
    const minRadius = 12;
    const maxRadius = 80;
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
    const margin = 100;

    this.holders.forEach((holder, i) => {
      if (holder.x === undefined || holder.y === undefined) {
        // Random position within bounds
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
  }

  stop() {
    this.isRunning = false;
    if (this.gameLoop) clearInterval(this.gameLoop);
    if (this.holderRefresh) clearInterval(this.holderRefresh);
  }
}

module.exports = { GameState, BATTLE_CONFIG, PHYSICS_CONFIG };
