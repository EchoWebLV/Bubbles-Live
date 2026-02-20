// ─── Talent Tree Configuration ────────────────────────────────────────────
// All percentages, caps, and balance knobs in one place.
// Edit values here to tweak balance without touching game logic.

const MAX_LEVEL = 100;
const LEVEL_SCALE = 10; // XP needed per level: xp = (level-1)^2 * LEVEL_SCALE
const MAX_RANK = 3;     // max points per ability

// ─── STRENGTH ─────────────────────────────────────────────────────────────
const STRENGTH = {
  ironSkin: {
    id: 'ironSkin',
    name: 'Iron Skin',
    description: '+{value}% max HP',
    tree: 'strength',
    maxRank: MAX_RANK,
    perRank: 0.10,        // +10% per rank
    hardCap: 0.30,        // max +30%
  },
  heavyHitter: {
    id: 'heavyHitter',
    name: 'Heavy Hitter',
    description: '+{value}% bullet damage',
    tree: 'strength',
    maxRank: MAX_RANK,
    perRank: 0.12,        // +12% per rank
    hardCap: 0.36,        // max +36%
  },
  regeneration: {
    id: 'regeneration',
    name: 'Regeneration',
    description: 'Heal {value} HP/sec',
    tree: 'strength',
    maxRank: MAX_RANK,
    perRank: 1,           // +1 HP/sec per rank
    hardCap: 3,           // max 3 HP/sec
    healCeiling: 0.80,    // only heals up to 80% of max HP
  },
  lifesteal: {
    id: 'lifesteal',
    name: 'Lifesteal',
    description: 'Heal {value}% of damage dealt',
    tree: 'strength',
    maxRank: MAX_RANK,
    perRank: 0.08,        // +8% per rank
    hardCap: 0.24,        // max 24%
    healCeiling: 0.80,    // only heals up to 80% of max HP
  },
  armor: {
    id: 'armor',
    name: 'Armor',
    description: 'Reduce incoming damage by {value}%',
    tree: 'strength',
    maxRank: MAX_RANK,
    perRank: 0.08,        // -8% per rank
    hardCap: 0.25,        // max 25% reduction
  },
};

// ─── SPEED ────────────────────────────────────────────────────────────────
const SPEED = {
  swift: {
    id: 'swift',
    name: 'Swift',
    description: '+{value}% movement speed',
    tree: 'speed',
    maxRank: MAX_RANK,
    perRank: 0.10,        // +10% per rank
    hardCap: 0.30,        // max +30%
    maxSpeedCap: 4.0,     // absolute max speed value
  },
  rapidFire: {
    id: 'rapidFire',
    name: 'Rapid Fire',
    description: '-{value}% fire rate cooldown',
    tree: 'speed',
    maxRank: MAX_RANK,
    perRank: 0.10,        // -10% per rank
    hardCap: 0.30,        // max -30%
    minCooldownMs: 130,   // absolute minimum fire cooldown
  },
  evasion: {
    id: 'evasion',
    name: 'Evasion',
    description: '{value}% dodge chance',
    tree: 'speed',
    maxRank: MAX_RANK,
    perRank: 0.06,        // +6% per rank
    hardCap: 0.20,        // max 20% dodge
  },
  quickRespawn: {
    id: 'quickRespawn',
    name: 'Quick Respawn',
    description: '-{value}% ghost duration',
    tree: 'speed',
    maxRank: MAX_RANK,
    perRank: 0.12,        // -12% per rank
    hardCap: 0.36,        // max -36%
    minGhostMs: 30000,    // absolute minimum 30s ghost
  },
  momentum: {
    id: 'momentum',
    name: 'Momentum',
    description: '+{value}% damage while moving fast',
    tree: 'speed',
    maxRank: MAX_RANK,
    perRank: 0.05,        // +5% per rank
    hardCap: 0.15,        // max +15%
    speedThreshold: 0.70, // must be above 70% of max speed to trigger
  },
};

// ─── PRECISION ────────────────────────────────────────────────────────────
const PRECISION = {
  weakspot: {
    id: 'weakspot',
    name: 'Weakspot',
    description: '+{value}% damage vs targets below 30% HP',
    tree: 'precision',
    maxRank: MAX_RANK,
    perRank: 0.12,        // +12% per rank
    hardCap: 0.36,        // max +36%
    hpThreshold: 0.30,    // triggers below 30% HP
  },
  criticalStrike: {
    id: 'criticalStrike',
    name: 'Critical Strike',
    description: '{value}% chance for 2x damage',
    tree: 'precision',
    maxRank: MAX_RANK,
    perRank: 0.07,        // +7% per rank
    hardCap: 0.25,        // max 25% crit
    critMultiplier: 2.0,
  },
  focusFire: {
    id: 'focusFire',
    name: 'Focus Fire',
    description: '+{value}% damage per consecutive hit (max 3 stacks)',
    tree: 'precision',
    maxRank: MAX_RANK,
    perRank: 0.08,        // +8% per stack per rank
    hardCap: 0.24,        // max +24% per stack
    maxStacks: 3,         // stacks reset after 3 hits
  },
  multiShot: {
    id: 'multiShot',
    name: 'Multi Shot',
    description: '{value}% chance to fire 2 bullets',
    tree: 'precision',
    maxRank: MAX_RANK,
    perRank: 0.12,        // +12% per rank
    hardCap: 0.40,        // max 40% chance
    secondBulletDamage: 0.70, // second bullet does 70% damage
  },
  dualCannon: {
    id: 'dualCannon',
    name: 'Dual Cannon',
    description: 'Slow straight second weapon targeting a 2nd enemy',
    tree: 'precision',
    maxRank: MAX_RANK,
    // Rank 1: fires every 6th shot, Rank 2: every 4th, Rank 3: every 2nd
    fireFrequency: [6, 4, 2],
    secondCannonDamage: 0.50, // 50% of normal damage
    secondCannonSpeed: 1.20,  // 120% of normal bullet speed
    canCrit: false,
  },
};

// All talents in a flat lookup for easy access
const ALL_TALENTS = {
  ...STRENGTH,
  ...SPEED,
  ...PRECISION,
};

// Ordered list per tree (determines UI order)
const TREE_ORDER = {
  strength: ['ironSkin', 'heavyHitter', 'regeneration', 'lifesteal', 'armor'],
  speed:    ['swift', 'rapidFire', 'evasion', 'quickRespawn', 'momentum'],
  precision: ['weakspot', 'criticalStrike', 'focusFire', 'multiShot', 'dualCannon'],
};

// Default auto-allocation order for idle players.
// Cycles through these in order, skipping any that are maxed.
const AUTO_ALLOCATE_ORDER = [
  'ironSkin', 'swift', 'criticalStrike',
  'heavyHitter', 'rapidFire', 'weakspot',
  'armor', 'evasion', 'focusFire',
  'regeneration', 'quickRespawn', 'multiShot',
  'lifesteal', 'momentum', 'dualCannon',
];

function getTalentValue(talentId, rank) {
  const t = ALL_TALENTS[talentId];
  if (!t || rank <= 0) return 0;
  if (t.perRank !== undefined) {
    return Math.min(t.perRank * rank, t.hardCap);
  }
  return 0;
}

function createEmptyTalents() {
  const talents = {};
  for (const id of Object.keys(ALL_TALENTS)) {
    talents[id] = 0;
  }
  return talents;
}

function totalPointsSpent(talents) {
  let total = 0;
  for (const rank of Object.values(talents)) {
    total += rank;
  }
  return total;
}

function pointsInTree(talents, treeName) {
  let total = 0;
  for (const id of TREE_ORDER[treeName]) {
    total += (talents[id] || 0);
  }
  return total;
}

module.exports = {
  MAX_LEVEL,
  LEVEL_SCALE,
  MAX_RANK,
  STRENGTH,
  SPEED,
  PRECISION,
  ALL_TALENTS,
  TREE_ORDER,
  AUTO_ALLOCATE_ORDER,
  getTalentValue,
  createEmptyTalents,
  totalPointsSpent,
  pointsInTree,
};
