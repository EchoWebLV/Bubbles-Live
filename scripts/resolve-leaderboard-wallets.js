#!/usr/bin/env node
require('dotenv').config({ path: '.env.local' });
const { Connection, PublicKey } = require('@solana/web3.js');

const COMBAT_PROGRAM_ID = new PublicKey(
  process.env.COMBAT_PROGRAM_ID || 'AyQ8ZnxYyFxYiHmxjFXs3ptgPvrSKi4WWfxhfLqccFsw'
);
const RPC = process.env.SOLANA_BASE_RPC || 'https://api.devnet.solana.com';

const LEADERBOARD_SEED = Buffer.from('leaderboard');
const SEASON_SEED = Buffer.from('season');

const PREFIXES = [
  '3fEn1t', '7asau3', '8WgEp2', '7oMLTi', '6Wti8F',
  'EHXZP3', '4PpURU', '7nXGAo', 'CfmNoL', 'NjkM2f',
];

function getSeasonStatePda() {
  const [pda] = PublicKey.findProgramAddressSync([SEASON_SEED], COMBAT_PROGRAM_ID);
  return pda;
}

function getLeaderboardPda(seasonNumber) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(seasonNumber);
  const [pda] = PublicKey.findProgramAddressSync([LEADERBOARD_SEED, buf], COMBAT_PROGRAM_ID);
  return pda;
}

async function fetchCurrentSeasonNumber(connection) {
  try {
    const pda = getSeasonStatePda();
    const info = await connection.getAccountInfo(pda);
    if (!info || !info.data || info.data.length < 44) return null;
    return info.data.readUInt32LE(40);
  } catch { return null; }
}

function parseLeaderboard(data) {
  if (data.length < 21) return [];
  let offset = 8 + 4 + 8 + 1;
  const entryCount = data[offset - 1];
  const entries = [];
  for (let i = 0; i < entryCount && i < 10; i++) {
    const walletBytes = data.subarray(offset, offset + 32);
    if (walletBytes.every(b => b === 0)) { offset += 32 + 8 + 1 + 1; continue; }
    entries.push(new PublicKey(walletBytes).toBase58());
    offset += 32 + 8 + 1 + 1;
  }
  return entries;
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');
  const currentSeason = await fetchCurrentSeasonNumber(connection);
  if (currentSeason == null || currentSeason < 1) {
    console.log('No season state. Set SOLANA_BASE_RPC to your production RPC.');
    process.exit(1);
  }
  const pdas = [];
  for (let sn = currentSeason; sn >= Math.max(1, currentSeason - 25); sn--)
    pdas.push(getLeaderboardPda(sn));
  const accounts = await connection.getMultipleAccountsInfo(pdas);
  const allWallets = new Set();
  for (const info of accounts) {
    if (!info?.data) continue;
    parseLeaderboard(info.data).forEach(w => allWallets.add(w));
  }
  const prefixToFull = new Map();
  for (const wallet of allWallets) {
    const prefix = wallet.slice(0, 6);
    if (PREFIXES.includes(prefix)) prefixToFull.set(prefix, wallet);
  }
  console.log('--- Full wallet addresses ---');
  PREFIXES.forEach((p, i) => console.log(`${i + 1}. ${prefixToFull.get(p) || p + '.. (not found)'}`));
}

main().catch(e => { console.error(e); process.exit(1); });
