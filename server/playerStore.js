// Player persistence layer
// Handles loading, saving, and progression logic for player stats

const db = require('./db');

// ─── Progression Config ────────────────────────────────────────────
// Tweak these to balance the game

const PROGRESSION = {
  // XP rewards
  xpPerKill: 25,
  xpPerDeath: 5,         // small consolation XP
  xpPerTransaction: 10,
  xpPerBuy: 15,
  xpPerHoldDay: 20,      // daily reward for diamond hands

  // Level formula: level = 1 + floor(sqrt(xp / scale))
  // e.g. scale=50 → level 2 at 50xp, level 3 at 200xp, level 5 at 800xp
  levelScale: 50,

  // Stat bonuses per level
  healthPerLevel: 10,    // +10 max HP per level  (level 1 = 100, level 5 = 140)
  damagePerLevel: 0.01,  // +0.01 bullet damage per level

  // Base stats
  baseHealth: 100,
  baseDamage: 0.1,
};

/**
 * Calculate level from XP
 */
function calcLevel(xp) {
  return 1 + Math.floor(Math.sqrt(xp / PROGRESSION.levelScale));
}

/**
 * Calculate max health for a given health_level
 */
function calcMaxHealth(healthLevel) {
  return PROGRESSION.baseHealth + (healthLevel - 1) * PROGRESSION.healthPerLevel;
}

/**
 * Calculate bullet damage for a given shooting_level
 */
function calcBulletDamage(shootingLevel) {
  return PROGRESSION.baseDamage + (shootingLevel - 1) * PROGRESSION.damagePerLevel;
}

/**
 * Derive health_level and shooting_level from XP.
 * Both scale together for now; you can split them later.
 */
function deriveStats(xp) {
  const level = calcLevel(xp);
  return {
    level,
    healthLevel: level,
    shootingLevel: level,
    maxHealth: calcMaxHealth(level),
    bulletDamage: calcBulletDamage(level),
  };
}

// ─── Database operations ───────────────────────────────────────────

/**
 * Load a single player (or return default stats for new players)
 */
async function loadPlayer(walletAddress) {
  const result = await db.query(
    'SELECT * FROM players WHERE wallet_address = $1',
    [walletAddress]
  );

  if (result && result.rows.length > 0) {
    const row = result.rows[0];
    const stats = deriveStats(row.xp);
    return {
      walletAddress: row.wallet_address,
      xp: row.xp,
      kills: row.kills,
      deaths: row.deaths,
      holdStreakDays: row.hold_streak_days,
      totalTransactions: row.total_transactions,
      totalBuys: row.total_buys,
      totalSells: row.total_sells,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      ...stats,
    };
  }

  // New player — default stats
  return {
    walletAddress,
    xp: 0,
    kills: 0,
    deaths: 0,
    holdStreakDays: 0,
    totalTransactions: 0,
    totalBuys: 0,
    totalSells: 0,
    firstSeen: new Date(),
    lastSeen: new Date(),
    ...deriveStats(0),
  };
}

/**
 * Load all known players (for startup cache)
 */
async function loadAllPlayers() {
  const result = await db.query('SELECT * FROM players');
  if (!result) return new Map();

  const map = new Map();
  for (const row of result.rows) {
    const stats = deriveStats(row.xp);
    map.set(row.wallet_address, {
      walletAddress: row.wallet_address,
      xp: row.xp,
      kills: row.kills,
      deaths: row.deaths,
      holdStreakDays: row.hold_streak_days,
      totalTransactions: row.total_transactions,
      totalBuys: row.total_buys,
      totalSells: row.total_sells,
      firstSeen: row.first_seen,
      lastSeen: row.last_seen,
      ...stats,
    });
  }
  return map;
}

/**
 * Upsert a player record (insert or update)
 */
async function savePlayer(player) {
  return db.query(`
    INSERT INTO players (
      wallet_address, xp, kills, deaths,
      health_level, shooting_level,
      hold_streak_days, total_transactions, total_buys, total_sells,
      first_seen, last_seen
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
    ON CONFLICT (wallet_address) DO UPDATE SET
      xp = $2,
      kills = $3,
      deaths = $4,
      health_level = $5,
      shooting_level = $6,
      hold_streak_days = $7,
      total_transactions = $8,
      total_buys = $9,
      total_sells = $10,
      last_seen = NOW()
  `, [
    player.walletAddress,
    player.xp,
    player.kills,
    player.deaths,
    player.healthLevel,
    player.shootingLevel,
    player.holdStreakDays,
    player.totalTransactions,
    player.totalBuys,
    player.totalSells,
    player.firstSeen,
  ]);
}

/**
 * Batch save multiple players at once (called periodically)
 */
async function savePlayers(playersMap) {
  const pool = db.getPool();
  if (!pool) return;

  const players = Array.from(playersMap.values());
  if (players.length === 0) return;

  // Use a transaction for batch efficiency
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    for (const player of players) {
      await client.query(`
        INSERT INTO players (
          wallet_address, xp, kills, deaths,
          health_level, shooting_level,
          hold_streak_days, total_transactions, total_buys, total_sells,
          first_seen, last_seen
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, NOW())
        ON CONFLICT (wallet_address) DO UPDATE SET
          xp = $2,
          kills = $3,
          deaths = $4,
          health_level = $5,
          shooting_level = $6,
          hold_streak_days = $7,
          total_transactions = $8,
          total_buys = $9,
          total_sells = $10,
          last_seen = NOW()
      `, [
        player.walletAddress,
        player.xp,
        player.kills,
        player.deaths,
        player.healthLevel,
        player.shootingLevel,
        player.holdStreakDays,
        player.totalTransactions,
        player.totalBuys,
        player.totalSells,
        player.firstSeen,
      ]);
    }

    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Batch save failed:', err.message);
  } finally {
    client.release();
  }
}

/**
 * Get top players by kills (leaderboard)
 */
async function getTopKillers(limit = 10) {
  const result = await db.query(
    'SELECT wallet_address, kills, deaths, xp FROM players WHERE kills > 0 ORDER BY kills DESC LIMIT $1',
    [limit]
  );
  return result ? result.rows : [];
}

/**
 * Get top players by XP (leaderboard)
 */
async function getTopByXP(limit = 10) {
  const result = await db.query(
    'SELECT wallet_address, xp, kills, deaths FROM players WHERE xp > 0 ORDER BY xp DESC LIMIT $1',
    [limit]
  );
  return result ? result.rows : [];
}

/**
 * Update hold streak for all current holders.
 * Call this once per day (or on holder refresh).
 * Pass the list of current holder addresses.
 */
async function updateHoldStreaks(currentHolderAddresses) {
  if (currentHolderAddresses.length === 0) return;

  // Increment streak for holders still present
  const placeholders = currentHolderAddresses.map((_, i) => `$${i + 1}`).join(',');
  
  await db.query(`
    UPDATE players
    SET hold_streak_days = hold_streak_days + 1,
        xp = xp + ${PROGRESSION.xpPerHoldDay},
        last_hold_check = NOW()
    WHERE wallet_address IN (${placeholders})
      AND (last_hold_check IS NULL OR last_hold_check < NOW() - INTERVAL '20 hours')
  `, currentHolderAddresses);

  // Reset streak for holders who left (not in current list)
  await db.query(`
    UPDATE players
    SET hold_streak_days = 0
    WHERE wallet_address NOT IN (${placeholders})
      AND hold_streak_days > 0
  `, currentHolderAddresses);
}

// ─── Player Photos ────────────────────────────────────────────────

async function loadAllPhotos() {
  const result = await db.query('SELECT wallet_address, photo FROM player_photos');
  if (!result) return new Map();
  const map = new Map();
  for (const row of result.rows) {
    map.set(row.wallet_address, row.photo);
  }
  return map;
}

async function savePhoto(walletAddress, dataUrl) {
  return db.query(`
    INSERT INTO player_photos (wallet_address, photo, updated_at)
    VALUES ($1, $2, NOW())
    ON CONFLICT (wallet_address) DO UPDATE SET photo = $2, updated_at = NOW()
  `, [walletAddress, dataUrl]);
}

async function deletePhoto(walletAddress) {
  return db.query('DELETE FROM player_photos WHERE wallet_address = $1', [walletAddress]);
}

module.exports = {
  PROGRESSION,
  calcLevel,
  calcMaxHealth,
  calcBulletDamage,
  deriveStats,
  loadPlayer,
  loadAllPlayers,
  savePlayer,
  savePlayers,
  getTopKillers,
  getTopByXP,
  updateHoldStreaks,
  loadAllPhotos,
  savePhoto,
  deletePhoto,
};
