// ─── Talent Tree Configuration ────────────────────────────────────────────
// All percentages, caps, and balance knobs in one place.
// Edit values here to tweak balance without touching game logic.

const MAX_LEVEL = 100;
const LEVEL_SCALE = 10; // XP needed per level: xp = (level-1)^2 * LEVEL_SCALE
const MAX_RANK_OLD = 5;   // original trees (strength/speed/precision)
const MAX_RANK_NEW = 3;   // new trees (utility/chaos)
const MAX_RANK = MAX_RANK_OLD; // backwards compat for code that reads MAX_RANK

// ─── STRENGTH ─────────────────────────────────────────────────────────────
const STRENGTH = {
  ironSkin: {
    id: 'ironSkin',
    name: 'Iron Skin',
    description: '+{value}% max HP',
    tree: 'strength',
    maxRank: MAX_RANK_OLD,
    perRank: 0.10,        // +10% per rank
    hardCap: 0.50,        // max +50%
  },
  heavyHitter: {
    id: 'heavyHitter',
    name: 'Heavy Hitter',
    description: '+{value}% bullet damage',
    tree: 'strength',
    maxRank: MAX_RANK_OLD,
    perRank: 0.12,        // +12% per rank
    hardCap: 0.60,        // max +60%
  },
  regeneration: {
    id: 'regeneration',
    name: 'Regeneration',
    description: 'Heal {value} HP/sec',
    tree: 'strength',
    maxRank: MAX_RANK_OLD,
    perRank: 1,           // +1 HP/sec per rank
    hardCap: 5,           // max 5 HP/sec
    healCeiling: 0.80,    // only heals up to 80% of max HP
  },
  lifesteal: {
    id: 'lifesteal',
    name: 'Lifesteal',
    description: 'Heal {value}% of damage dealt',
    tree: 'strength',
    maxRank: MAX_RANK_OLD,
    perRank: 0.08,        // +8% per rank
    hardCap: 0.40,        // max 40%
    healCeiling: 0.80,    // only heals up to 80% of max HP
  },
  armor: {
    id: 'armor',
    name: 'Armor',
    description: 'Reduce incoming damage by {value}%',
    tree: 'strength',
    maxRank: MAX_RANK_OLD,
    perRank: 0.08,        // -8% per rank
    hardCap: 0.40,        // max 40% reduction
  },
};

// ─── SPEED ────────────────────────────────────────────────────────────────
const SPEED = {
  swift: {
    id: 'swift',
    name: 'Swift',
    description: '+{value}% movement speed',
    tree: 'speed',
    maxRank: MAX_RANK_OLD,
    perRank: 0.10,        // +10% per rank
    hardCap: 0.50,        // max +50%
    maxSpeedCap: 4.5,     // absolute max speed value
  },
  rapidFire: {
    id: 'rapidFire',
    name: 'Rapid Fire',
    description: '-{value}% fire rate cooldown',
    tree: 'speed',
    maxRank: MAX_RANK_OLD,
    perRank: 0.10,        // -10% per rank
    hardCap: 0.50,        // max -50%
    minCooldownMs: 100,   // absolute minimum fire cooldown
  },
  evasion: {
    id: 'evasion',
    name: 'Evasion',
    description: '{value}% dodge chance',
    tree: 'speed',
    maxRank: MAX_RANK_OLD,
    perRank: 0.06,        // +6% per rank
    hardCap: 0.30,        // max 30% dodge
  },
  quickRespawn: {
    id: 'quickRespawn',
    name: 'Quick Respawn',
    description: '-{value}% ghost duration',
    tree: 'speed',
    maxRank: MAX_RANK_OLD,
    perRank: 0.12,        // -12% per rank
    hardCap: 0.60,        // max -60%
    minGhostMs: 10000,    // absolute minimum 10s ghost
  },
  momentum: {
    id: 'momentum',
    name: 'Momentum',
    description: '+{value}% damage while moving fast',
    tree: 'speed',
    maxRank: MAX_RANK_OLD,
    perRank: 0.05,        // +5% per rank
    hardCap: 0.25,        // max +25%
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
    maxRank: MAX_RANK_OLD,
    perRank: 0.12,        // +12% per rank
    hardCap: 0.60,        // max +60%
    hpThreshold: 0.30,    // triggers below 30% HP
  },
  criticalStrike: {
    id: 'criticalStrike',
    name: 'Critical Strike',
    description: '{value}% chance for 2x damage',
    tree: 'precision',
    maxRank: MAX_RANK_OLD,
    perRank: 0.07,        // +7% per rank
    hardCap: 0.35,        // max 35% crit
    critMultiplier: 2.0,
  },
  focusFire: {
    id: 'focusFire',
    name: 'Focus Fire',
    description: '+{value}% damage per consecutive hit (max 3 stacks)',
    tree: 'precision',
    maxRank: MAX_RANK_OLD,
    perRank: 0.08,        // +8% per stack per rank
    hardCap: 0.40,        // max +40% per stack
    maxStacks: 3,
  },
  multiShot: {
    id: 'multiShot',
    name: 'Multi Shot',
    description: '{value}% chance to fire 2 bullets',
    tree: 'precision',
    maxRank: MAX_RANK_OLD,
    perRank: 0.12,        // +12% per rank
    hardCap: 0.60,        // max 60% chance
    secondBulletDamage: 0.70,
  },
  dualCannon: {
    id: 'dualCannon',
    name: 'Dual Cannon',
    description: 'Slow straight second weapon targeting a 2nd enemy',
    tree: 'precision',
    maxRank: MAX_RANK_OLD,
    // Rank 1-5: fires every Nth shot
    fireFrequency: [6, 5, 4, 3, 2],
    secondCannonDamage: 0.50,
    secondCannonSpeed: 1.20,
    canCrit: false,
  },
};

// ─── UTILITY ──────────────────────────────────────────────────────────────
const UTILITY = {
  deflect: {
    id: 'deflect',
    name: 'Deflect',
    description: '{value}% chance to reflect bullets',
    tree: 'utility',
    maxRank: MAX_RANK_NEW,
    perRank: 0.05,        // +5% per rank
    hardCap: 0.15,        // max 15% reflect
  },
  absorb: {
    id: 'absorb',
    name: 'Absorb',
    description: 'Kills grant {value}% of victim HP as shield',
    tree: 'utility',
    maxRank: MAX_RANK_NEW,
    perRank: 0.10,        // +10% of victim max HP per rank
    hardCap: 0.30,        // max 30%
    shieldDurationMs: 5000,
  },
  lastStand: {
    id: 'lastStand',
    name: 'Last Stand',
    description: '+{value}% damage when below 25% HP',
    tree: 'utility',
    maxRank: MAX_RANK_NEW,
    perRank: 0.10,        // +10% per rank
    hardCap: 0.30,        // max +30%
    hpThreshold: 0.25,    // triggers below 25% HP
  },
  cloak: {
    id: 'cloak',
    name: 'Cloak',
    description: 'Untargetable for 1.5s every {value}s',
    tree: 'utility',
    maxRank: MAX_RANK_NEW,
    cooldownMs: [15000, 12000, 9000],
    durationMs: 1500,
  },
  dash: {
    id: 'dash',
    name: 'Dash',
    description: 'Burst dash every {value}s',
    tree: 'utility',
    maxRank: MAX_RANK_NEW,
    cooldownMs: [12000, 10000, 8000],
    dashStrength: 8,      // velocity multiplier on dash
  },
};

// ─── CHAOS ────────────────────────────────────────────────────────────────
const CHAOS = {
  rampage: {
    id: 'rampage',
    name: 'Rampage',
    description: '+{value}% damage for 3 shots after a kill',
    tree: 'chaos',
    maxRank: MAX_RANK_NEW,
    perRank: 0.24,        // +24% per rank
    hardCap: 0.72,        // max +72%
    bulletsCount: 3,
  },
  homing: {
    id: 'homing',
    name: 'Homing',
    description: '+{value}% bullet hit radius',
    tree: 'chaos',
    maxRank: MAX_RANK_NEW,
    perRank: 0.10,        // +10% per rank
    hardCap: 0.30,        // max +30%
  },
  ricochet: {
    id: 'ricochet',
    name: 'Ricochet',
    description: '{value}% chance to bounce to 2nd target',
    tree: 'chaos',
    maxRank: MAX_RANK_NEW,
    perRank: 0.10,        // +10% per rank
    hardCap: 0.30,        // max 30%
    bounceDamage: 0.60,   // bounce bullet does 60% damage
    bounceRange: 200,     // pixels — max range for bounce target
  },
  deathbomb: {
    id: 'deathbomb',
    name: 'Deathbomb',
    description: 'Explode on death for {value}% max HP damage',
    tree: 'chaos',
    maxRank: MAX_RANK_NEW,
    perRank: 0.10,        // +10% per rank
    hardCap: 0.30,        // max 30%
    explosionRadius: 120, // pixels
  },
  frenzy: {
    id: 'frenzy',
    name: 'Frenzy',
    description: '+{value}% fire rate per kill streak',
    tree: 'chaos',
    maxRank: MAX_RANK_NEW,
    perRank: 0.15,        // +15% per kill per rank
    hardCap: 0.45,        // max +45% per kill
    decayMs: 5000,        // stacks reset after 5s without a kill
    maxStacks: 5,
  },
};

// All talents in a flat lookup for easy access
const ALL_TALENTS = {
  ...STRENGTH,
  ...SPEED,
  ...PRECISION,
  ...UTILITY,
  ...CHAOS,
};

// Ordered list per tree (determines UI order)
const TREE_ORDER = {
  strength:  ['ironSkin', 'heavyHitter', 'regeneration', 'lifesteal', 'armor'],
  speed:     ['swift', 'rapidFire', 'evasion', 'quickRespawn', 'momentum'],
  precision: ['weakspot', 'criticalStrike', 'focusFire', 'multiShot', 'dualCannon'],
  utility:   ['deflect', 'absorb', 'lastStand', 'cloak', 'dash'],
  chaos:     ['rampage', 'homing', 'ricochet', 'deathbomb', 'frenzy'],
};

// Default auto-allocation order for idle players.
const AUTO_ALLOCATE_ORDER = [
  'ironSkin', 'swift', 'criticalStrike', 'deflect', 'rampage',
  'heavyHitter', 'rapidFire', 'weakspot', 'absorb', 'homing',
  'armor', 'evasion', 'focusFire', 'lastStand', 'ricochet',
  'regeneration', 'quickRespawn', 'multiShot', 'cloak', 'deathbomb',
  'lifesteal', 'momentum', 'dualCannon', 'dash', 'frenzy',
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
  MAX_RANK_OLD,
  MAX_RANK_NEW,
  STRENGTH,
  SPEED,
  PRECISION,
  UTILITY,
  CHAOS,
  ALL_TALENTS,
  TREE_ORDER,
  AUTO_ALLOCATE_ORDER,
  getTalentValue,
  createEmptyTalents,
  totalPointsSpent,
  pointsInTree,
};
