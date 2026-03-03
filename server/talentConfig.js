// ─── Talent Tree Configuration (v2) ──────────────────────────────────────
// 5 trees, 5 talents each, linear chain prerequisite (tier N requires 1 rank in tier N-1).
// Tiers 1-4: max 5 ranks.  Tier 5 (capstone): max 3 ranks.
// 1 talent point per 2 levels → 50 points at level 100 → enough for 2 full trees + 4 spare.

const MAX_LEVEL = 100;
const LEVEL_SCALE_EARLY = 10;  // levels 1-25: easier to reach
const LEVEL_SCALE = 22;        // levels 26-50
const LEVEL_SCALE_50PLUS = 25; // levels 51-100: scales to ~450k total at 100
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
    perRank: [0.0015, 0.003, 0.004],
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
    perRank: [0.04, 0.06, 0.08, 0.10, 0.14],
    minCooldownMs: 80,
  },
  criticalStrike: {
    id: 'criticalStrike',
    name: 'Critical Strike',
    description: '{value}% crit chance (2x dmg)',
    tree: 'firepower',
    tier: 3,
    requires: 'rapidFire',
    maxRank: MAX_RANK,
    perRank: 0.07,
    hardCap: 0.35,
    critMultiplier: 2,
  },
  multiShot: {
    id: 'multiShot',
    name: 'Multi Shot',
    description: '{value}% chance to fire 2 bullets (50% dmg)',
    tree: 'firepower',
    tier: 4,
    requires: 'criticalStrike',
    maxRank: MAX_RANK,
    perRank: [0.10, 0.20, 0.30, 0.40, 0.50],
    hardCap: 0.50,
    secondBulletDamage: 0.50,
  },
  dualCannon: {
    id: 'dualCannon',
    name: 'Homing Cannon',
    description: 'Every 9/7/5th shot: homing bullet toward your target',
    tree: 'firepower',
    tier: 5,
    requires: 'multiShot',
    maxRank: MAX_RANK_CAPSTONE,
    fireFrequency: [9, 7, 5],
    homingDamageMultiplier: 2.0,
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
    perRank: [0.04, 0.06, 0.08],
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
    perRank: [0.11, 0.18, 0.25, 0.33, 0.40],
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
    _retired: true,
  },
  focusFire: {
    id: 'focusFire',
    name: 'Focus Fire',
    description: '+{value}% damage per consecutive hit on same target (max 3 stacks)',
    tree: 'massDamage',
    tier: 2,
    requires: 'ricochet',
    maxRank: MAX_RANK,
    perRank: [0.03, 0.06, 0.09, 0.12, 0.15],
    maxStacks: 3,
  },
  orbitalLaser: {
    id: 'orbitalLaser',
    name: 'Infernal Lance',
    description: 'Every {value}s, fire a piercing beam through all enemies in a line',
    tree: 'massDamage',
    tier: 3,
    requires: 'focusFire',
    maxRank: MAX_RANK,
    intervalMs: [3500, 3200, 3000, 2800, 2500],
    damageMultiplier: [2.22, 3.33, 4.44, 5.55, 6.66],
    beamWidth: [12, 14, 16, 18, 22],
    beamRange: 600,
    beamDurationMs: 300,
  },
  rocket: {
    id: 'rocket',
    name: 'Rocket',
    description: 'Every {value}th shot fires a homing rocket that explodes on impact',
    tree: 'massDamage',
    tier: 4,
    requires: 'orbitalLaser',
    maxRank: MAX_RANK,
    fireFrequency: [18, 16, 14, 12, 10],
    blastRadius: 300,
    blastDamageMultiplier: [1.0, 1.0, 1.0, 1.0, 1.0],
    rocketSpeed: 4,
  },
  chainLightning: {
    id: 'chainLightning',
    name: 'Chain Lightning',
    description: 'Every hit arcs lightning to {value} nearby enemies (400% dmg, -50% per jump)',
    tree: 'massDamage',
    tier: 5,
    requires: 'rocket',
    maxRank: MAX_RANK_CAPSTONE,
    procChance: [0.04, 0.08, 0.12],
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
    description: 'Every 15th hit: 360° sweep. Deals 1/2/3/4/5% max HP, costs 0.5/1/1.5/2/2.5% HP',
    tree: 'bloodThirst',
    tier: 4,
    requires: 'killRush',
    maxRank: MAX_RANK,
    hitInterval: [15, 15, 15, 15, 15],
    sweepDamagePct: [0.01, 0.02, 0.03, 0.04, 0.05],
    hpCost: [0.005, 0.01, 0.015, 0.02, 0.025],
    sweepRange: 200,
    sweepAngle: Math.PI * 2,
    sweepDurationMs: 300,
  },
  berserker: {
    id: 'berserker',
    name: 'Berserker',
    description: 'Below 33% HP: +{value}% atk speed & dmg',
    tree: 'bloodThirst',
    tier: 5,
    requires: 'reaperArc',
    maxRank: MAX_RANK_CAPSTONE,
    atkSpeedBonus: [0.10, 0.20, 0.30],
    dmgBonus: [0.10, 0.20, 0.30],
    hpThreshold: 0.33,
  },
};

// ─── SAPPER ──────────────────────────────────────────────────────────────
const SAPPER = {
  decoy: {
    id: 'decoy',
    name: 'Decoy',
    description: 'Spawn a decoy clone every {value}s that shoots for 5s',
    tree: 'sapper',
    tier: 1,
    requires: null,
    maxRank: MAX_RANK,
    cooldownMs: [20000, 18000, 16000, 14000, 10000],
    cloneHpPct: [0.30, 0.40, 0.50, 0.60, 0.70],
    cloneDamagePct: [0.50, 0.60, 0.70, 0.80, 0.90],
    cloneDurationMs: 5000,
  },
  deathMirage: {
    id: 'deathMirage',
    name: 'Death Mirage',
    description: 'On death, leave a decoy behind + -{value}% respawn time',
    tree: 'sapper',
    tier: 2,
    requires: 'decoy',
    maxRank: MAX_RANK,
    respawnReduction: [0.05, 0.10, 0.15, 0.20, 0.25],
    mirageHpPct: [0.40, 0.50, 0.60, 0.70, 0.80],
    mirageDurationMs: 6000,
  },
  decoyBarrage: {
    id: 'decoyBarrage',
    name: 'Decoy Barrage',
    description: 'Every {value}s, launch a decoy at the nearest enemy',
    tree: 'sapper',
    tier: 3,
    requires: 'deathMirage',
    maxRank: MAX_RANK,
    cooldownMs: [16000, 14000, 12000, 10000, 8000],
    barrageDurationMs: 4000,
    barrageHpPct: [0.25, 0.30, 0.35, 0.45, 0.55],
    barrageDmgPct: [0.40, 0.50, 0.60, 0.70, 0.80],
    launchSpeed: 5,
  },
  volatileDecoy: {
    id: 'volatileDecoy',
    name: 'Volatile Decoy',
    description: 'Decoys explode on death for {value}% of your max HP as AoE',
    tree: 'sapper',
    tier: 4,
    requires: 'decoyBarrage',
    maxRank: MAX_RANK,
    explosionDmgPct: [0.012, 0.024, 0.036, 0.048, 0.06],
    explosionRadius: [60, 70, 80, 100, 120],
  },
  singularity: {
    id: 'singularity',
    name: 'Singularity',
    description: '33% chance decoy explosion becomes a black hole: {value}s pull, 1% HP/s DoT, +3/5/7% detonation',
    tree: 'sapper',
    tier: 5,
    requires: 'volatileDecoy',
    maxRank: MAX_RANK_CAPSTONE,
    procChance: 0.33,
    pullDurationMs: [1500, 2000, 2500],
    pullRadius: [120, 160, 200],
    dotPerSecondPct: 0.01,
    detonationBonus: [0.02, 0.04, 0.06],
    maxPulled: [1, 2, 3],
    pullStrength: 0.03,
  },
  // Legacy mine config — kept for future use, not in talent tree
  landmine: {
    id: 'landmine',
    name: 'Landmine',
    _retired: true,
    tree: 'sapper',
    tier: 0,
    requires: null,
    maxRank: MAX_RANK,
    cooldownMs: [18000, 16000, 14000, 12000, 10000],
    mineDamagePct: [0.05, 0.055, 0.06, 0.065, 0.07],
    mineDurationMs: 20000,
    maxActiveMines: [3, 4, 5, 6, 8],
    mineRadius: 18,
    mineDetectionRadius: 22,
  },
};

// ─── Flat lookup ──────────────────────────────────────────────────────────
const ALL_TALENTS = {
  ...TANK,
  ...FIREPOWER,
  ...BRAWLER,
  ...MASS_DAMAGE,
  ...BLOOD_THIRST,
  ...SAPPER,
};

// UI order per tree
const TREE_ORDER = {
  tank:        ['armor', 'ironSkin', 'regeneration', 'lifesteal', 'vitalityStrike'],
  firepower:   ['heavyHitter', 'rapidFire', 'criticalStrike', 'multiShot', 'dualCannon'],
  brawler:     ['dash', 'bodySlam', 'relentless', 'orbit', 'shockwave'],
  massDamage:  ['ricochet', 'focusFire', 'orbitalLaser', 'rocket', 'chainLightning'],
  bloodThirst: ['experience', 'execute', 'killRush', 'reaperArc', 'berserker'],
  sapper:      ['decoy', 'deathMirage', 'decoyBarrage', 'volatileDecoy', 'singularity'],
};

// Auto-allocate order: tier-by-tier across all trees
const AUTO_ALLOCATE_ORDER = [
  'armor', 'heavyHitter', 'dash', 'ricochet', 'experience', 'decoy',
  'ironSkin', 'rapidFire', 'bodySlam', 'focusFire', 'execute', 'deathMirage',
  'regeneration', 'criticalStrike', 'relentless', 'orbitalLaser', 'killRush', 'decoyBarrage',
  'lifesteal', 'multiShot', 'orbit', 'rocket', 'reaperArc', 'volatileDecoy',
  'vitalityStrike', 'dualCannon', 'shockwave', 'chainLightning', 'berserker', 'singularity',
];

// ─── Chain-ID mapping (on-chain u8 slots 0-29) ───────────────────────────
const TALENT_NAME_TO_CHAIN_ID = {
  armor: 0, ironSkin: 1, regeneration: 2, lifesteal: 3, vitalityStrike: 4,
  heavyHitter: 5, rapidFire: 6, criticalStrike: 7, multiShot: 8, dualCannon: 9,
  dash: 10, bodySlam: 11, relentless: 12, orbit: 13, shockwave: 14,
  ricochet: 15, counterAttack: 16, chainLightning: 17, orbitalLaser: 18, focusFire: 19, rocket: 30,
  experience: 20, execute: 21, killRush: 22, reaperArc: 23, berserker: 24,
  decoy: 25, deathMirage: 26, decoyBarrage: 27, volatileDecoy: 28, singularity: 29,
};

const CHAIN_ID_TO_TALENT_NAME = Object.fromEntries(
  Object.entries(TALENT_NAME_TO_CHAIN_ID).map(([k, v]) => [v, k])
);

// On-chain account field names in the order they map to chain slot 0-29
const CHAIN_SLOT_FIELDS = [
  'talentIronSkin', 'talentHeavyHitter', 'talentRegeneration', 'talentLifesteal', 'talentArmor',
  'talentSwift', 'talentRapidFire', 'talentEvasion', 'talentQuickRespawn', 'talentMomentum',
  'talentWeakspot', 'talentCriticalStrike', 'talentFocusFire', 'talentMultiShot', 'talentDualCannon',
  'talentDeflect', 'talentAbsorb', 'talentLastStand', 'talentCloak', 'talentDash',
  'talentRampage', 'talentHoming', 'talentRicochet', 'talentDeathbomb', 'talentFrenzy',
  'talentLandmine', 'talentEvasionSapper', 'talentDeadDrop', 'talentDecoy', 'talentSingularity',
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

const CAPSTONE_TALENTS = ['vitalityStrike', 'dualCannon', 'shockwave', 'chainLightning', 'berserker', 'singularity'];
const MAX_CAPSTONES = 2;

module.exports = {
  MAX_LEVEL,
  LEVEL_SCALE_EARLY,
  LEVEL_SCALE,
  LEVEL_SCALE_50PLUS,
  MAX_RANK,
  MAX_RANK_CAPSTONE,
  TANK,
  FIREPOWER,
  BRAWLER,
  MASS_DAMAGE,
  BLOOD_THIRST,
  SAPPER,
  ALL_TALENTS,
  TREE_ORDER,
  AUTO_ALLOCATE_ORDER,
  CAPSTONE_TALENTS,
  MAX_CAPSTONES,
  TALENT_NAME_TO_CHAIN_ID,
  CHAIN_ID_TO_TALENT_NAME,
  CHAIN_SLOT_FIELDS,
  getTalentValue,
  canAllocate,
  createEmptyTalents,
  totalPointsSpent,
  pointsInTree,
};
