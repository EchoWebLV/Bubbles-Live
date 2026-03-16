#!/usr/bin/env node
const { PublicKey, Connection } = require('@solana/web3.js');

const COMBAT_PROGRAM_ID = new PublicKey('AyQ8ZnxYyFxYiHmxjFXs3ptgPvrSKi4WWfxhfLqccFsw');
const RPC = process.env.SOLANA_BASE_RPC || 'https://api.devnet.solana.com';

const SEASON_SEED = Buffer.from('season');
const LEADERBOARD_SEED = Buffer.from('leaderboard');

function getLeaderboardPda(seasonNumber) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(seasonNumber);
  const [pda] = PublicKey.findProgramAddressSync([LEADERBOARD_SEED, buf], COMBAT_PROGRAM_ID);
  return pda;
}

async function main() {
  const connection = new Connection(RPC, 'confirmed');

  const [seasonPda] = PublicKey.findProgramAddressSync([SEASON_SEED], COMBAT_PROGRAM_ID);
  const seasonInfo = await connection.getAccountInfo(seasonPda);
  if (!seasonInfo) { console.log('No season PDA found'); return; }

  // Parse SeasonState: 8 disc + 32 authority + 4 season_number + 8 started_at + 8 duration_secs + 1 is_finalized
  const data = seasonInfo.data;
  const authority = new PublicKey(data.slice(8, 40)).toBase58();
  const seasonNumber = data.readUInt32LE(40);
  const startedAt = Number(data.readBigInt64LE(44));
  const durationSecs = Number(data.readBigInt64LE(52));
  const isFinalized = data[60] === 1;

  const endsAt = new Date((startedAt + durationSecs) * 1000);
  const expired = Date.now() > (startedAt + durationSecs) * 1000;

  console.log('=== On-Chain Season State ===');
  console.log(`  Season Number:  ${seasonNumber}`);
  console.log(`  Authority:      ${authority.slice(0, 12)}...`);
  console.log(`  Started At:     ${new Date(startedAt * 1000).toISOString()}`);
  console.log(`  Duration:       ${durationSecs}s (${(durationSecs / 3600).toFixed(1)}h)`);
  console.log(`  Ends At:        ${endsAt.toISOString()}`);
  console.log(`  Is Finalized:   ${isFinalized}`);
  console.log(`  Expired:        ${expired}`);

  // Check leaderboards 8-12
  for (let sn = 8; sn <= 12; sn++) {
    const lbPda = getLeaderboardPda(sn);
    const lbInfo = await connection.getAccountInfo(lbPda);
    console.log(`  Leaderboard ${sn}: ${lbInfo ? 'EXISTS (' + lbInfo.data.length + ' bytes)' : 'does not exist'}`);
  }
}

main().catch(console.error);
