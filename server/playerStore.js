// Player photo persistence layer (DB)
// Game state (kills, XP, talents) is persisted entirely on the MagicBlock Ephemeral Rollup.

const db = require('./db');

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
  loadAllPhotos,
  savePhoto,
  deletePhoto,
};
