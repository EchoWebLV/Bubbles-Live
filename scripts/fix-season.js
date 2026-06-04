#!/usr/bin/env node
/**
 * Fix accidental double season reset.
 * 1. Read current on-chain SeasonState
 * 2. Close SeasonLeaderboard PDAs for seasons 9 and 10 (if they exist)
 * 3. Set season number to 9 with is_finalized = false
 *
 * Usage: node scripts/fix-season.js
 */

const anchor = require('@coral-xyz/anchor');
const { PublicKey, Keypair, SystemProgram, Connection } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

const COMBAT_PROGRAM_ID = new PublicKey('AyQ8ZnxYyFxYiHmxjFXs3ptgPvrSKi4WWfxhfLqccFsw');
const RPC = process.env.SOLANA_BASE_RPC || 'https://api.devnet.solana.com';
const SEASON_SEED = Buffer.from('season');
const LEADERBOARD_SEED = Buffer.from('leaderboard');

const TARGET_SEASON = parseInt(process.env.TARGET_SEASON || '10', 10);
const SKIP_SET_SEASON = process.env.SKIP_SET_SEASON === '1';
const SEASONS_TO_CLOSE = process.env.SEASONS_TO_CLOSE ? process.env.SEASONS_TO_CLOSE.split(',').map(s => parseInt(s.trim(), 10)) : [11];

function loadKeypair() {
  const keypairPath = process.env.ANCHOR_WALLET ||
    process.env.SOLANA_KEYPAIR_PATH ||
    path.join(require('os').homedir(), '.config', 'solana', 'id.json');
  const data = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
  return Keypair.fromSecretKey(Uint8Array.from(data));
}

function getSeasonPda() {
  const [pda] = PublicKey.findProgramAddressSync([SEASON_SEED], COMBAT_PROGRAM_ID);
  return pda;
}

function getLeaderboardPda(seasonNumber) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(seasonNumber);
  const [pda] = PublicKey.findProgramAddressSync([LEADERBOARD_SEED, buf], COMBAT_PROGRAM_ID);
  return pda;
}

async function main() {
  const keypair = loadKeypair();
  console.log('Authority:', keypair.publicKey.toBase58());

  const connection = new Connection(RPC, 'confirmed');
  const wallet = new anchor.Wallet(keypair);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  const idlPath = path.join(__dirname, '..', 'combat', 'hodlwarz_combat', 'target', 'idl', 'hodlwarz_combat.json');
  const idl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  const program = new anchor.Program(idl, provider);

  const seasonPda = getSeasonPda();

  // Read current state
  const seasonInfo = await connection.getAccountInfo(seasonPda);
  if (!seasonInfo) {
    console.error('SeasonState PDA not found!');
    process.exit(1);
  }
  const currentSeasonNumber = seasonInfo.data.readUInt32LE(40); // 8 disc + 32 authority
  const isFinalized = seasonInfo.data[56] === 1; // 8+32+4+8+8 = 60, but bool at offset 56
  console.log(`Current on-chain season: ${currentSeasonNumber}, finalized: ${isFinalized}`);

  // Step 1: Close leaderboard PDAs for seasons to remove
  for (const sn of SEASONS_TO_CLOSE) {
    const lbPda = getLeaderboardPda(sn);
    const lbInfo = await connection.getAccountInfo(lbPda);
    if (!lbInfo) {
      console.log(`Season ${sn} leaderboard: does not exist, skipping`);
      continue;
    }
    console.log(`Closing season ${sn} leaderboard (${lbPda.toBase58()})...`);
    try {
      const tx = await program.methods
        .adminCloseLeaderboard(sn)
        .accounts({
          season: seasonPda,
          leaderboard: lbPda,
          authority: keypair.publicKey,
        })
        .rpc();
      console.log(`  Closed season ${sn} leaderboard, tx: ${tx}`);
    } catch (err) {
      console.error(`  Failed to close season ${sn} leaderboard:`, err.message);
    }
  }

  // Step 2: Set season number to target (skip with SKIP_SET_SEASON=1)
  if (SKIP_SET_SEASON) {
    console.log(`\nSkipping adminSetSeason (SKIP_SET_SEASON=1)`);
  } else {
    console.log(`\nSetting season number to ${TARGET_SEASON}...`);
    try {
      const tx = await program.methods
        .adminSetSeason(TARGET_SEASON)
        .accounts({
          season: seasonPda,
          authority: keypair.publicKey,
        })
        .rpc();
      console.log(`  Season set to ${TARGET_SEASON}, tx: ${tx}`);
    } catch (err) {
      console.error('  Failed to set season:', err.message);
      process.exit(1);
    }
  }

  // Verify
  const updatedInfo = await connection.getAccountInfo(seasonPda);
  const newSeason = updatedInfo.data.readUInt32LE(40);
  console.log(`\nVerification: on-chain season is now ${newSeason}`);

  const balance = await connection.getBalance(keypair.publicKey);
  console.log(`Remaining balance: ${balance / 1e9} SOL`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
