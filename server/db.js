// Database connection for player photos only.
// Game state (kills, XP, talents) is persisted on the MagicBlock Ephemeral Rollup.
// Works with local PostgreSQL and Railway Postgres (just set DATABASE_URL)

const { Pool } = require('pg');

let pool = null;

/**
 * Get or create the connection pool.
 * DATABASE_URL is set automatically by Railway when you add Postgres.
 * For local dev, use: postgresql://postgres:postgres@localhost:5432/hodlwarz
 */
function getPool() {
  if (pool) return pool;

  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    console.warn('⚠️  DATABASE_URL not set — player photos won\'t persist');
    return null;
  }

  pool = new Pool({
    connectionString,
    // Railway Postgres requires SSL in production
    ssl: process.env.NODE_ENV === 'production'
      ? { rejectUnauthorized: false }
      : false,
    // Pool settings
    max: 10,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  });

  pool.on('error', (err) => {
    console.error('Unexpected database pool error:', err.message);
  });

  return pool;
}

/**
 * Run migrations on startup — creates tables if they don't exist.
 * Safe to call multiple times (uses IF NOT EXISTS).
 */
async function migrate() {
  const db = getPool();
  if (!db) return false;

  try {
    await db.query(`
      CREATE TABLE IF NOT EXISTS player_photos (
        wallet_address TEXT PRIMARY KEY,
        photo          TEXT NOT NULL,
        updated_at     TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      );
    `);

    console.log('✅ Database migrated successfully');
    return true;
  } catch (err) {
    console.error('❌ Database migration failed:', err.message);
    return false;
  }
}

/**
 * Run a query with error handling.
 * Returns { rows, rowCount } or null on failure.
 */
async function query(text, params) {
  const db = getPool();
  if (!db) return null;

  try {
    return await db.query(text, params);
  } catch (err) {
    console.error('Database query error:', err.message);
    return null;
  }
}

/**
 * Gracefully close the pool (call on shutdown).
 */
async function close() {
  if (pool) {
    await pool.end();
    pool = null;
    console.log('Database pool closed');
  }
}

module.exports = { getPool, migrate, query, close };
