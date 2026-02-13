// Battle system for bubble wars

export interface BattleBubble {
  address: string;
  health: number;
  maxHealth: number;
  isGhost: boolean;
  ghostUntil: number | null; // Timestamp when ghost mode ends
  lastShotTime: number;
  kills: number;
  deaths: number;
  // Progression (from DB, via server)
  level?: number;
  xp?: number;
  healthLevel?: number;
  shootingLevel?: number;
  holdStreakDays?: number;
}

export interface Bullet {
  id: string;
  shooterAddress: string;
  targetAddress: string;
  shooterColor: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  progress: number; // 0 to 1 along the path
  curveDirection: number; // 1 or -1 for curve direction
  curveStrength: number; // How much the bullet curves
  vx: number;
  vy: number;
  damage: number;
  createdAt: number;
}

export interface DamageNumber {
  id: string;
  x: number;
  y: number;
  damage: number;
  createdAt: number;
  alpha: number;
}

export interface BattleState {
  bubbles: Map<string, BattleBubble>;
  bullets: Bullet[];
  damageNumbers: DamageNumber[];
  lastUpdateTime: number;
}

// Game constants
export const BATTLE_CONFIG = {
  maxHealth: 100,
  bulletDamage: 0.1,
  fireRate: 200, // ms between shots (0.2 seconds)
  bulletSpeed: 8, // pixels per frame
  bulletRadius: 3,
  ghostDuration: 60000, // 60 seconds in ms
  respawnHealth: 100,
};

// Initialize battle state for a bubble
export function createBattleBubble(address: string): BattleBubble {
  return {
    address,
    health: BATTLE_CONFIG.maxHealth,
    maxHealth: BATTLE_CONFIG.maxHealth,
    isGhost: false,
    ghostUntil: null,
    lastShotTime: 0,
    kills: 0,
    deaths: 0,
  };
}

// Create initial battle state
export function createBattleState(): BattleState {
  return {
    bubbles: new Map(),
    bullets: [],
    damageNumbers: [],
    lastUpdateTime: Date.now(),
  };
}

// Find closest non-ghost bubble
export function findClosestTarget(
  shooterAddress: string,
  shooterX: number,
  shooterY: number,
  allBubbles: { address: string; x: number; y: number; isGhost: boolean }[]
): { address: string; x: number; y: number } | null {
  let closest: { address: string; x: number; y: number } | null = null;
  let closestDist = Infinity;

  for (const bubble of allBubbles) {
    // Skip self and ghosts
    if (bubble.address === shooterAddress || bubble.isGhost) continue;

    const dx = bubble.x - shooterX;
    const dy = bubble.y - shooterY;
    const dist = Math.sqrt(dx * dx + dy * dy);

    if (dist < closestDist) {
      closestDist = dist;
      closest = bubble;
    }
  }

  return closest;
}

// Create a bullet with curved path
let bulletIdCounter = 0;
export function createBullet(
  shooterAddress: string,
  targetAddress: string,
  shooterColor: string,
  startX: number,
  startY: number,
  targetX: number,
  targetY: number
): Bullet {
  const dx = targetX - startX;
  const dy = targetY - startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  // Normalize and apply speed
  const vx = (dx / dist) * BATTLE_CONFIG.bulletSpeed;
  const vy = (dy / dist) * BATTLE_CONFIG.bulletSpeed;

  // Random curve direction and strength for variety
  const curveDirection = Math.random() > 0.5 ? 1 : -1;
  const curveStrength = 30 + Math.random() * 40; // Curve amount in pixels

  return {
    id: `bullet-${bulletIdCounter++}`,
    shooterAddress,
    targetAddress,
    shooterColor,
    x: startX,
    y: startY,
    startX,
    startY,
    targetX,
    targetY,
    progress: 0,
    curveDirection,
    curveStrength,
    vx,
    vy,
    damage: BATTLE_CONFIG.bulletDamage,
    createdAt: Date.now(),
  };
}

// Calculate curved bullet position using quadratic bezier
export function getCurvedBulletPosition(bullet: Bullet): { x: number; y: number } {
  const t = bullet.progress;
  
  // Calculate perpendicular offset for control point
  const dx = bullet.targetX - bullet.startX;
  const dy = bullet.targetY - bullet.startY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  
  // Perpendicular vector (normalized)
  const perpX = -dy / dist;
  const perpY = dx / dist;
  
  // Control point at midpoint, offset perpendicular to the line
  const midX = (bullet.startX + bullet.targetX) / 2;
  const midY = (bullet.startY + bullet.targetY) / 2;
  const controlX = midX + perpX * bullet.curveStrength * bullet.curveDirection;
  const controlY = midY + perpY * bullet.curveStrength * bullet.curveDirection;
  
  // Quadratic bezier formula: B(t) = (1-t)²P0 + 2(1-t)tP1 + t²P2
  const oneMinusT = 1 - t;
  const x = oneMinusT * oneMinusT * bullet.startX + 
            2 * oneMinusT * t * controlX + 
            t * t * bullet.targetX;
  const y = oneMinusT * oneMinusT * bullet.startY + 
            2 * oneMinusT * t * controlY + 
            t * t * bullet.targetY;
  
  return { x, y };
}

// Create damage number
let damageIdCounter = 0;
export function createDamageNumber(x: number, y: number, damage: number): DamageNumber {
  return {
    id: `dmg-${damageIdCounter++}`,
    x: x + (Math.random() - 0.5) * 20,
    y: y - 10,
    damage,
    createdAt: Date.now(),
    alpha: 1,
  };
}

// Check if bullet hits a bubble
export function checkBulletHit(
  bullet: Bullet,
  bubbleX: number,
  bubbleY: number,
  bubbleRadius: number
): boolean {
  const dx = bullet.x - bubbleX;
  const dy = bullet.y - bubbleY;
  const dist = Math.sqrt(dx * dx + dy * dy);
  return dist < bubbleRadius + BATTLE_CONFIG.bulletRadius;
}

// Update battle state (call every frame)
export function updateBattleState(
  state: BattleState,
  bubblePositions: { address: string; x: number; y: number; radius: number }[],
  now: number
): {
  newBullets: Bullet[];
  hits: { bulletId: string; targetAddress: string; damage: number; x: number; y: number }[];
  deaths: { address: string; killerAddress: string }[];
  respawns: string[];
} {
  const newBullets: Bullet[] = [];
  const hits: { bulletId: string; targetAddress: string; damage: number; x: number; y: number }[] = [];
  const deaths: { address: string; killerAddress: string }[] = [];
  const respawns: string[] = [];

  // Initialize battle bubbles for any new addresses
  for (const pos of bubblePositions) {
    if (!state.bubbles.has(pos.address)) {
      state.bubbles.set(pos.address, createBattleBubble(pos.address));
    }
  }

  // Check for respawns
  state.bubbles.forEach((bubble, address) => {
    if (bubble.isGhost && bubble.ghostUntil && now >= bubble.ghostUntil) {
      bubble.isGhost = false;
      bubble.ghostUntil = null;
      bubble.health = BATTLE_CONFIG.respawnHealth;
      respawns.push(address);
    }
  });

  // Shooting logic - each alive bubble shoots at closest target
  for (const pos of bubblePositions) {
    const battleBubble = state.bubbles.get(pos.address);
    if (!battleBubble || battleBubble.isGhost) continue;

    // Check if can shoot (fire rate)
    if (now - battleBubble.lastShotTime < BATTLE_CONFIG.fireRate) continue;

    // Find closest target
    const bubblesWithGhost = bubblePositions.map(p => ({
      ...p,
      isGhost: state.bubbles.get(p.address)?.isGhost || false,
    }));
    
    const target = findClosestTarget(pos.address, pos.x, pos.y, bubblesWithGhost);
    
    if (target) {
      // Create bullet (using white as default color - actual color set in BubbleMap)
      const bullet = createBullet(
        pos.address,
        target.address,
        "#ffffff",
        pos.x,
        pos.y,
        target.x,
        target.y
      );
      newBullets.push(bullet);
      battleBubble.lastShotTime = now;
    }
  }

  // Update bullet positions and check hits
  const bulletsToRemove = new Set<string>();
  
  for (const bullet of state.bullets) {
    // Move bullet
    bullet.x += bullet.vx;
    bullet.y += bullet.vy;

    // Check if out of bounds (give some margin)
    if (bullet.x < -100 || bullet.x > 3000 || bullet.y < -100 || bullet.y > 2000) {
      bulletsToRemove.add(bullet.id);
      continue;
    }

    // Check for hits
    for (const pos of bubblePositions) {
      const targetBubble = state.bubbles.get(pos.address);
      
      // Can't hit ghosts or self
      if (!targetBubble || targetBubble.isGhost || pos.address === bullet.shooterAddress) continue;

      if (checkBulletHit(bullet, pos.x, pos.y, pos.radius)) {
        // Hit!
        hits.push({
          bulletId: bullet.id,
          targetAddress: pos.address,
          damage: bullet.damage,
          x: pos.x,
          y: pos.y,
        });
        bulletsToRemove.add(bullet.id);

        // Apply damage
        targetBubble.health -= bullet.damage;

        // Check for death
        if (targetBubble.health <= 0) {
          targetBubble.health = 0;
          targetBubble.isGhost = true;
          targetBubble.ghostUntil = now + BATTLE_CONFIG.ghostDuration;
          targetBubble.deaths++;

          // Credit kill to shooter
          const shooter = state.bubbles.get(bullet.shooterAddress);
          if (shooter) {
            shooter.kills++;
          }

          deaths.push({
            address: pos.address,
            killerAddress: bullet.shooterAddress,
          });
        }

        break; // Bullet can only hit one target
      }
    }
  }

  // Remove hit/expired bullets
  state.bullets = state.bullets.filter(b => !bulletsToRemove.has(b.id));

  // Add new bullets
  state.bullets.push(...newBullets);

  // Update damage numbers (fade out)
  state.damageNumbers = state.damageNumbers
    .map(dn => ({
      ...dn,
      y: dn.y - 0.5, // Float up
      alpha: dn.alpha - 0.02,
    }))
    .filter(dn => dn.alpha > 0);

  // Add new damage numbers for hits
  for (const hit of hits) {
    state.damageNumbers.push(createDamageNumber(hit.x, hit.y, hit.damage));
  }

  state.lastUpdateTime = now;

  return { newBullets, hits, deaths, respawns };
}

// Get ghost remaining time in seconds
export function getGhostRemainingTime(bubble: BattleBubble, now: number): number {
  if (!bubble.isGhost || !bubble.ghostUntil) return 0;
  return Math.max(0, Math.ceil((bubble.ghostUntil - now) / 1000));
}
