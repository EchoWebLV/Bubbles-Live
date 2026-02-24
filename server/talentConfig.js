// ─── Talent Tree Configuration (v2) ──────────────────────────────────────
// 5 trees, 5 talents each, linear chain prerequisite (tier N requires 1 rank in tier N-1).
// Tiers 1-4: max 5 ranks.  Tier 5 (capstone): max 3 ranks.
// 1 talent point per 2 levels → 50 points at level 100 → enough for 2 full trees + 4 spare.

const MAX_LEVEL = 100;
const LEVEL_SCALE = 10;
const MAX_RANK = 5;
const MAX_RANK_CAPSTONE = 3;

// ─── TANK ─────────────────────────────────────────────────────────────────
const TANK = {
  armor: {
    id: 'armor',
    name: 'Armor',
    description: 'Reduce incoming damage by {value}%',
    tree: 'tank',
    tier: 1,
    requires: null,
    maxRank: MAX_RANK,
    perRank: [0.04, 0.08, 0.12, 0.16, 0.24],
  },
  ironSkin: {
    id: 'ironSkin',
    name: 'Iron Skin',
    description: '+{value}% max HP',
    tree: 'tank',
    tier: 2,
    requires: 'armor',
    maxRank: MAX_RANK,
    perRank: [0.10, 0.15, 0.20, 0.25, 0.30],
  },
  regeneration: {
    id: 'regeneration',
    name: 'Regeneration',
    description: 'Heal {value} HP/sec',
    tree: 'tank',
    tier: 3,
    requires: 'ironSkin',
    maxRank: MAX_RANK,
    perRank: 0.3,
    hardCap: 1.5,
    healCeiling: 0.80,
  },
  lifesteal: {
    id: 'lifesteal',
    name: 'Lifesteal',
    description: 'Heal {value}% of damage dealt',
    tree: 'tank',
    tier: 4,
    requires: 'regeneration',
    maxRank: MAX_RANK,
    perRank: [0.05, 0.10, 0.15, 0.20, 0.25],
    healCeiling: 0.80,
  },
  vitalityStrike: {
    id: 'vitalityStrike',
    name: 'Vitality Strike',
    description: 'Bullets deal +{value}% of max HP as bonus damage',
    tree: 'tank',
    tier: 5,
    requires: 'lifesteal',
    maxRank: MAX_RANK_CAPSTONE,
    perRank: [0.002, 0.0035, 0.005],
  },
};

// ─── FIREPOWER ────────────────────────────────────────────────────────────
const FIREPOWER = {
  heavyHitter: {
    id: 'heavyHitter',
    name: 'Heavy Hitter',
    description: '+{value}% bullet damage',
    tree: 'firepower',
    tier: 1,
    requires: null,
    maxRank: MAX_RANK,
    perRank: [0.04, 0.08, 0.12, 0.16, 0.24],
  },
  rapidFire: {
    id: 'rapidFire',
    name: 'Rapid Fire',
    description: '-{value}% fire cooldown',
    tree: 'firepower',
    tier: 2,
    requires: 'heavyHitter',
    maxRank: MAX_RANK,
    perRank: [0.06, 0.12, 0.18, 0.24, 0.30],
    minCooldownMs: 80,
  },
  criticalStrike: {
    id: 'criticalStrike',
    name: 'Critical Strike',
    description: '{value}% crit chance (2/2.2/2.6/2.8/3x dmg)',
    tree: 'firepower',
    tier: 3,
    requires: 'rapidFire',
    maxRank: MAX_RANK,
    perRank: 0.07,
    hardCap: 0.35,
    critMultiplier: [2.0, 2.2, 2.6, 2.8, 3.0],
  },
  multiShot: {
    id: 'multiShot',
    name: 'Multi Shot',
    description: '{value}% chance to fire 2 bullets (75% dmg)',
    tree: 'firepower',
    tier: 4,
    requires: 'criticalStrike',
    maxRank: MAX_RANK,
    perRank: 0.12,
    hardCap: 0.60,
    secondBulletDamage: 0.75,
  },
  dualCannon: {
    id: 'dualCannon',
    name: 'Homing Cannon',
    description: 'Every 16/13/10th shot: homing bullet targeting lowest HP enemy, 150% dmg',
    tree: 'firepower',
    tier: 5,
    requires: 'multiShot',
    maxRank: MAX_RANK_CAPSTONE,
    fireFrequency: [16, 13, 10],
    homingDamageMultiplier: 1.5,
    homingStrength: 0.15,
  },
};

// ─── BRAWLER ──────────────────────────────────────────────────────────────
const BRAWLER = {
  dash: {
    id: 'dash',
    name: 'Dash',
    description: 'Burst dash every {value}s',
    tree: 'brawler',
    tier: 1,
    requires: null,
    maxRank: MAX_RANK,
    cooldownMs: [12000, 10000, 8000, 6000, 4000],
    dashStrength: 7,
  },
  bodySlam: {
    id: 'bodySlam',
    name: 'Body Slam',
    description: 'Contact deals {value}% of max HP as damage',
    tree: 'brawler',
    tier: 2,
    requires: 'dash',
    maxRank: MAX_RANK,
    perRank: [0.015, 0.025, 0.035, 0.045, 0.055],
  },
  relentless: {
    id: 'relentless',
    name: 'Relentless',
    description: 'Body Slam hit reduces Dash cooldown by {value}s',
    tree: 'brawler',
    tier: 3,
    requires: 'bodySlam',
    maxRank: MAX_RANK,
    cdReduction: [500, 1000, 1500, 2000, 2500],
  },
  orbit: {
    id: 'orbit',
    name: 'Orbit',
    description: '2 orbs circle you, dealing {value}% max HP on contact (0.5s cd)',
    tree: 'brawler',
    tier: 4,
    requires: 'relentless',
    maxRank: MAX_RANK,
    perRank: [0.005, 0.0075, 0.01, 0.0125, 0.015],
    orbCount: 2,
    orbRadius: 40,
    orbHitCooldown: 375,
    orbRotationSpeed: 4 * Math.PI,
    orbSize: 6,
  },
  shockwave: {
    id: 'shockwave',
    name: 'Shockwave',
    description: 'Body hits deal {value}% max HP AoE damage',
    tree: 'brawler',
    tier: 5,
    requires: 'orbit',
    maxRank: MAX_RANK_CAPSTONE,
    perRank: [0.05, 0.07, 0.09],
    radius: [100, 150, 200],
  },
};

// ─── MASS DAMAGE ──────────────────────────────────────────────────────────
const MASS_DAMAGE = {
  ricochet: {
    id: 'ricochet',
    name: 'Ricochet',
    description: '{value}% chance to bounce to 2nd target',
    tree: 'massDamage',
    tier: 1,
    requires: null,
    maxRank: MAX_RANK,
    perRank: [0.11, 0.19, 0.26, 0.34, 0.49],
    bounceDamage: 1.0,
  },
  counterAttack: {
    id: 'counterAttack',
    name: 'Counter Attack',
    description: '{value}% chance when hit to fire bullet at attacker',
    tree: 'massDamage',
    tier: 2,
    requires: 'ricochet',
    maxRank: MAX_RANK,
    perRank: 0.08,
    hardCap: 0.40,
  },
  focusFire: {
    id: 'focusFire',
    name: 'Focus Fire',
    description: '+{value}% damage per consecutive hit on same target (max 3 stacks)',
    tree: 'massDamage',
    tier: 3,
    requires: 'counterAttack',
    maxRank: MAX_RANK,
    perRank: [0.03, 0.06, 0.09, 0.12, 0.15],
    maxStacks: 3,
  },
  nova: {
    id: 'nova',
    name: 'Nova',
    description: 'Emit {value} projectiles every 2s',
    tree: 'massDamage',
    tier: 4,
    requires: 'focusFire',
    maxRank: MAX_RANK,
    projectiles: [5, 8, 11, 14, 18],
    intervalMs: 1000,
    novaDamageMultiplier: 1.0,
    novaSpeed: 6,
    novaRange: 500,
    spiralSpread: 0.5,
  },
  chainLightning: {
    id: 'chainLightning',
    name: 'Chain Lightning',
    description: 'Every hit arcs lightning to {value} nearby enemies (80% dmg)',
    tree: 'massDamage',
    tier: 5,
    requires: 'nova',
    maxRank: MAX_RANK_CAPSTONE,
    procChance: [0.05, 0.10, 0.15],
    arcTargets: [2, 3, 4],
    arcDamage: 4.0,
    arcDecay: 0.50,
    arcRange: 500,
  },
};

// ─── BLOOD THIRST ─────────────────────────────────────────────────────────
const BLOOD_THIRST = {
  experience: {
    id: 'experience',
    name: 'Experience',
    description: '+{value}% XP gained',
    tree: 'bloodThirst',
    tier: 1,
    requires: null,
    maxRank: MAX_RANK,
    perRank: [0.10, 0.17, 0.24, 0.32, 0.40],
  },
  execute: {
    id: 'execute',
    name: 'Execute',
    description: '+{value}% damage vs targets ≤50% HP',
    tree: 'bloodThirst',
    tier: 2,
    requires: 'experience',
    maxRank: MAX_RANK,
    perRank: [0.08, 0.16, 0.24, 0.32, 0.48],
    hpThreshold: 0.50,
  },
  killRush: {
    id: 'killRush',
    name: 'Kill Rush',
    description: 'On kill: +{value}% fire rate for 4s',
    tree: 'bloodThirst',
    tier: 3,
    requires: 'execute',
    maxRank: MAX_RANK,
    perRank: 0.20,
    hardCap: 1.00,
    durationMs: 4000,
  },
  bloodBolt: {
    id: 'bloodBolt',
    name: 'Blood Bolt',
    description: 'Shots become homing bolts. Cost {value}% max HP per shot (min 25% HP)',
    tree: 'bloodThirst',
    tier: 4,
    requires: 'killRush',
    maxRank: MAX_RANK,
    hpCost: [0.015, 0.0125, 0.01, 0.0075, 0.005],
    homingStrength: 0.12,
    minHpPct: 0.25,
  },
  reaperArc: {
    id: 'reaperArc',
    name: "Reaper's Arc",
    description: 'Every 15th hit: 360° sweep. Deals 0.75-3.75% max HP, costs 0.4-2% HP',
    tree: 'bloodThirst',
    tier: 4,
    requires: 'killRush',
    maxRank: MAX_RANK,
    hitInterval: [15, 15, 15, 15, 15],
    sweepDamagePct: [0.0075, 0.015, 0.0225, 0.03, 0.0375],
    hpCost: [0.004, 0.0075, 0.012, 0.015, 0.02],
    sweepRange: 200,
    sweepAngle: Math.PI * 2,
    sweepDurationMs: 300,
  },
  berserker: {
    id: 'berserker',
    name: 'Berserker',
    description: 'Below 33% HP: +{value}% atk speed & dmg. +1.5/2.5/3.5 HP/s regen',
    tree: 'bloodThirst',
    tier: 5,
    requires: 'reaperArc',
    maxRank: MAX_RANK_CAPSTONE,
    atkSpeedBonus: [0.25, 0.40, 0.55],
    dmgBonus: [0.25, 0.40, 0.55],
    regenPerSec: [1.5, 2.5, 3.5],
    hpThreshold: 0.33,
  },
};

// ─── Flat lookup ──────────────────────────────────────────────────────────
const ALL_TALENTS = {
  ...TANK,
  ...FIREPOWER,
  ...BRAWLER,
  ...MASS_DAMAGE,
  ...BLOOD_THIRST,
};

// UI order per tree
const TREE_ORDER = {
  tank:        ['armor', 'ironSkin', 'regeneration', 'lifesteal', 'vitalityStrike'],
  firepower:   ['heavyHitter', 'rapidFire', 'criticalStrike', 'multiShot', 'dualCannon'],
  brawler:     ['dash', 'bodySlam', 'relentless', 'orbit', 'shockwave'],
  massDamage:  ['ricochet', 'counterAttack', 'focusFire', 'nova', 'chainLightning'],
  bloodThirst: ['experience', 'execute', 'killRush', 'reaperArc', 'berserker'],
};

// Auto-allocate order: tier-by-tier across all trees
const AUTO_ALLOCATE_ORDER = [
  'armor', 'heavyHitter', 'dash', 'ricochet', 'experience',
  'ironSkin', 'rapidFire', 'bodySlam', 'counterAttack', 'execute',
  'regeneration', 'criticalStrike', 'relentless', 'focusFire', 'killRush',
  'lifesteal', 'multiShot', 'orbit', 'nova', 'reaperArc',
  'vitalityStrike', 'dualCannon', 'shockwave', 'chainLightning', 'berserker',
];

// ─── Chain-ID mapping (reuses 25 on-chain u8 slots 0-24) ─────────────────
const TALENT_NAME_TO_CHAIN_ID = {
  armor: 0, ironSkin: 1, regeneration: 2, lifesteal: 3, vitalityStrike: 4,
  heavyHitter: 5, rapidFire: 6, criticalStrike: 7, multiShot: 8, dualCannon: 9,
  dash: 10, bodySlam: 11, relentless: 12, orbit: 13, shockwave: 14,
  ricochet: 15, counterAttack: 16, chainLightning: 17, nova: 18, focusFire: 19,
  experience: 20, execute: 21, killRush: 22, reaperArc: 23, berserker: 24,
};

const CHAIN_ID_TO_TALENT_NAME = Object.fromEntries(
  Object.entries(TALENT_NAME_TO_CHAIN_ID).map(([k, v]) => [v, k])
);

// On-chain account field names in the order they map to chain slot 0-24
const CHAIN_SLOT_FIELDS = [
  'talentIronSkin', 'talentHeavyHitter', 'talentRegeneration', 'talentLifesteal', 'talentArmor',
  'talentSwift', 'talentRapidFire', 'talentEvasion', 'talentQuickRespawn', 'talentMomentum',
  'talentWeakspot', 'talentCriticalStrike', 'talentFocusFire', 'talentMultiShot', 'talentDualCannon',
  'talentDeflect', 'talentAbsorb', 'talentLastStand', 'talentCloak', 'talentDash',
  'talentRampage', 'talentHoming', 'talentRicochet', 'talentDeathbomb', 'talentFrenzy',
];

// ─── Helpers ──────────────────────────────────────────────────────────────

function getTalentValue(talentId, rank) {
  const t = ALL_TALENTS[talentId];
  if (!t || rank <= 0) return 0;
  if (Array.isArray(t.perRank)) {
    return t.perRank[Math.min(rank, t.perRank.length) - 1] || 0;
  }
  if (t.perRank !== undefined) {
    return Math.min(t.perRank * rank, t.hardCap);
  }
  return 0;
}

function canAllocate(talentId, talents) {
  const t = ALL_TALENTS[talentId];
  if (!t) return false;
  if ((talents[talentId] || 0) >= t.maxRank) return false;
  if (t.requires && (talents[t.requires] || 0) < 1) return false;
  return true;
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
  for (const id of Object.keys(ALL_TALENTS)) {
    total += (talents[id] || 0);
  }
  return total;
}

function pointsInTree(talents, treeName) {
  let total = 0;
  for (const id of (TREE_ORDER[treeName] || [])) {
    total += (talents[id] || 0);
  }
  return total;
}

module.exports = {
  MAX_LEVEL,
  LEVEL_SCALE,
  MAX_RANK,
  MAX_RANK_CAPSTONE,
  TANK,
  FIREPOWER,
  BRAWLER,
  MASS_DAMAGE,
  BLOOD_THIRST,
  ALL_TALENTS,
  TREE_ORDER,
  AUTO_ALLOCATE_ORDER,
  TALENT_NAME_TO_CHAIN_ID,
  CHAIN_ID_TO_TALENT_NAME,
  CHAIN_SLOT_FIELDS,
  getTalentValue,
  canAllocate,
  createEmptyTalents,
  totalPointsSpent,
  pointsInTree,
};
