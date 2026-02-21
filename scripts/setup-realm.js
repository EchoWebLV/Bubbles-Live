#!/usr/bin/env node

// Creates a Realms DAO for the $WARZ token.
// Run once:  node scripts/setup-realm.js
//
// Prerequisites:
//   - HELIUS_API_KEY or a Solana RPC in .env.local
//   - NEXT_PUBLIC_TOKEN_ADDRESS (the $WARZ mint) in .env.local
//   - A funded keypair file at ./governance-authority.json
//     (generate with: solana-keygen new -o governance-authority.json)
//
// After running, copy the Realm address printed at the end and add
//   GOVERNANCE_REALM_ADDRESS=<address>
// to your .env.local, then restart the server.

require('dotenv').config({ path: '.env.local' });

const {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');

const {
  MintMaxVoteWeightSource,
  withCreateRealm,
  withCreateGovernance,
  GovernanceConfig,
  VoteThreshold,
  VoteThresholdType,
  VoteTipping,
} = require('@solana/spl-governance');

const fs = require('fs');
const path = require('path');

const SPL_GOVERNANCE_PROGRAM_ID = new PublicKey('GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw');

async function main() {
  const tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS;
  if (!tokenAddress) {
    console.error('ERROR: NEXT_PUBLIC_TOKEN_ADDRESS not set in .env.local');
    process.exit(1);
  }

  const keyPath = path.resolve('governance-authority.json');
  if (!fs.existsSync(keyPath)) {
    console.error(`ERROR: Keypair file not found at ${keyPath}`);
    console.error('Generate one with: solana-keygen new -o governance-authority.json');
    console.error('Then fund it with some SOL for transaction fees.');
    process.exit(1);
  }

  const secretKey = JSON.parse(fs.readFileSync(keyPath, 'utf-8'));
  const authority = Keypair.fromSecretKey(Uint8Array.from(secretKey));

  const rpcUrl = process.env.HELIUS_API_KEY
    ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
    : 'https://api.mainnet-beta.solana.com';

  const connection = new Connection(rpcUrl, 'confirmed');
  const communityMint = new PublicKey(tokenAddress);

  console.log('');
  console.log('╔══════════════════════════════════════════════════╗');
  console.log('║         $WARZ Governance Realm Setup             ║');
  console.log('╚══════════════════════════════════════════════════╝');
  console.log('');
  console.log('RPC:            ', rpcUrl.slice(0, 50) + '...');
  console.log('Authority:      ', authority.publicKey.toBase58());
  console.log('Community Mint: ', communityMint.toBase58());
  console.log('');

  const balance = await connection.getBalance(authority.publicKey);
  console.log(`Authority balance: ${(balance / 1e9).toFixed(4)} SOL`);
  if (balance < 0.05 * 1e9) {
    console.error('ERROR: Authority needs at least 0.05 SOL for rent + fees');
    process.exit(1);
  }

  // ─── Step 1: Create the Realm ───────────────────────────────────

  console.log('\nStep 1: Creating Realm...');

  const realmInstructions = [];
  const realmPk = await withCreateRealm(
    realmInstructions,
    SPL_GOVERNANCE_PROGRAM_ID,
    2, // program version
    '$WARZ Arena Governance',
    authority.publicKey, // realm authority
    communityMint,
    authority.publicKey, // payer
    undefined, // council mint (none)
    MintMaxVoteWeightSource.FULL_SUPPLY_FRACTION,
    BigInt(1), // min tokens to create governance
    undefined, // community token config
  );

  const realmTx = new Transaction().add(...realmInstructions);
  realmTx.feePayer = authority.publicKey;
  realmTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const realmSig = await sendAndConfirmTransaction(connection, realmTx, [authority]);
  console.log('Realm created!');
  console.log('  Address:', realmPk.toBase58());
  console.log('  Tx:', realmSig);

  // ─── Step 2: Create Governance ──────────────────────────────────

  console.log('\nStep 2: Creating Governance...');

  const govInstructions = [];
  const governanceConfig = new GovernanceConfig({
    communityVoteThreshold: new VoteThreshold({
      type: VoteThresholdType.YesVotePercentage,
      value: 60, // 60% approval needed
    }),
    minCommunityTokensToCreateProposal: BigInt(1_000_000), // 0.1% of 1B supply
    minInstructionHoldUpTime: 0,
    baseVotingTime: 3 * 24 * 60 * 60, // 3 days in seconds
    communityVoteTipping: VoteTipping.Strict,
    councilVoteThreshold: new VoteThreshold({
      type: VoteThresholdType.Disabled,
      value: 0,
    }),
    councilVetoVoteThreshold: new VoteThreshold({
      type: VoteThresholdType.Disabled,
      value: 0,
    }),
    communityVetoVoteThreshold: new VoteThreshold({
      type: VoteThresholdType.Disabled,
      value: 0,
    }),
    councilVoteTipping: VoteTipping.Strict,
    minCouncilTokensToCreateProposal: BigInt(1),
    votingCoolOffTime: 0,
    depositExemptProposalCount: 0,
  });

  const governancePk = await withCreateGovernance(
    govInstructions,
    SPL_GOVERNANCE_PROGRAM_ID,
    2,
    realmPk,
    undefined, // governed account (none — this governs the game config)
    governanceConfig,
    authority.publicKey, // token owner record
    authority.publicKey, // payer
    authority.publicKey, // governance authority
    undefined, // voter weight record
  );

  const govTx = new Transaction().add(...govInstructions);
  govTx.feePayer = authority.publicKey;
  govTx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;

  const govSig = await sendAndConfirmTransaction(connection, govTx, [authority]);
  console.log('Governance created!');
  console.log('  Address:', governancePk.toBase58());
  console.log('  Tx:', govSig);

  // ─── Done ───────────────────────────────────────────────────────

  console.log('\n═══════════════════════════════════════════════════');
  console.log(' SETUP COMPLETE');
  console.log('═══════════════════════════════════════════════════');
  console.log('');
  console.log(' Add this to your .env.local:');
  console.log('');
  console.log(`   GOVERNANCE_REALM_ADDRESS=${realmPk.toBase58()}`);
  console.log('');
  console.log(' Then restart the server. The governance page will');
  console.log(' be live at /governance.');
  console.log('');
  console.log(' Realms UI:');
  console.log(`   https://app.realms.today/dao/${realmPk.toBase58()}`);
  console.log('');
}

main().catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
