// Mainnet reward service — registers season winners on the hodlwarz_rewards program.
// Separate from MagicBlock (devnet) because rewards live on mainnet.

const anchor = require('@coral-xyz/anchor');
const { PublicKey, Connection, Keypair, SystemProgram } = require('@solana/web3.js');
const { TOKEN_PROGRAM_ID } = require('@solana/spl-token');
const fs = require('fs');
const path = require('path');

const REWARDS_PROGRAM_ID = new PublicKey(
  process.env.REWARDS_PROGRAM_ID || 'HWRZrewArdS111111111111111111111111111111111'
);
const MAINNET_RPC = process.env.SOLANA_MAINNET_RPC || 'https://api.mainnet-beta.solana.com';
const WARZ_MINT = new PublicKey(process.env.NEXT_PUBLIC_TOKEN_ADDRESS || '11111111111111111111111111111111');

const VAULT_SEED = Buffer.from('reward_vault');
const CLAIM_SEED = Buffer.from('reward_claim');

class RewardService {
  constructor() {
    this.connection = new Connection(MAINNET_RPC, 'confirmed');
    this.ready = false;
    this.program = null;
    this.vaultPda = null;
    this.vaultBump = null;
    this.vaultTokenAccount = null;

    try {
      let keypairData;
      if (process.env.REWARDS_PRIVATE_KEY) {
        keypairData = JSON.parse(process.env.REWARDS_PRIVATE_KEY);
      } else if (process.env.SOLANA_PRIVATE_KEY) {
        keypairData = JSON.parse(process.env.SOLANA_PRIVATE_KEY);
      } else {
        const keypairPath = process.env.REWARDS_KEYPAIR_PATH ||
          path.join(require('os').homedir(), '.config', 'solana', 'id.json');
        keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
      }
      this.serverKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
      this.wallet = new anchor.Wallet(this.serverKeypair);
      console.log('RewardService: Mainnet wallet loaded:', this.serverKeypair.publicKey.toBase58().slice(0, 8) + '...');
    } catch (err) {
      console.error('RewardService: Failed to load keypair:', err.message);
      this.serverKeypair = null;
      this.wallet = null;
    }
  }

  async initialize() {
    if (!this.serverKeypair) {
      console.warn('RewardService: No keypair — mainnet rewards disabled');
      return false;
    }

    try {
      const idlPath = path.join(__dirname, 'hodlwarz_rewards.json');
      if (!fs.existsSync(idlPath)) {
        console.warn('RewardService: IDL not found at', idlPath, '— build the rewards program first');
        return false;
      }

      const rewardsIdl = JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
      if (process.env.REWARDS_PROGRAM_ID) {
        rewardsIdl.address = process.env.REWARDS_PROGRAM_ID;
      }

      this.provider = new anchor.AnchorProvider(
        this.connection,
        this.wallet,
        { commitment: 'confirmed', skipPreflight: true }
      );
      this.program = new anchor.Program(rewardsIdl, this.provider);

      [this.vaultPda, this.vaultBump] = PublicKey.findProgramAddressSync(
        [VAULT_SEED],
        REWARDS_PROGRAM_ID
      );

      const vaultAccount = await this.connection.getAccountInfo(this.vaultPda);
      if (vaultAccount) {
        const vaultState = this.program.coder.accounts.decode('vaultState', vaultAccount.data);
        this.vaultTokenAccount = vaultState.vaultTokenAccount;
        console.log('RewardService: Vault found, token account:', this.vaultTokenAccount.toBase58().slice(0, 12) + '...');
      } else {
        console.warn('RewardService: Vault PDA not initialized — call initVault first');
      }

      this.ready = true;
      console.log('RewardService: Mainnet rewards ready');
      console.log('  Program:', REWARDS_PROGRAM_ID.toBase58());
      console.log('  Vault PDA:', this.vaultPda.toBase58());
      return true;
    } catch (err) {
      console.error('RewardService: Initialization failed:', err.message);
      return false;
    }
  }

  async registerWinners(seasonNumber, totalReward, winners) {
    if (!this.ready || !this.vaultTokenAccount) {
      console.error('RewardService: Not ready or vault not initialized');
      return null;
    }

    try {
      const winnerInputs = winners.slice(0, 10).map(w => ({
        wallet: new PublicKey(w.wallet || w.address),
        kills: new anchor.BN(w.kills),
        level: w.level,
      }));

      const [seasonRegPda] = PublicKey.findProgramAddressSync(
        [CLAIM_SEED, Buffer.from(new Uint32Array([seasonNumber]).buffer)],
        REWARDS_PROGRAM_ID
      );

      const tx = await this.program.methods
        .registerWinners(seasonNumber, new anchor.BN(totalReward), winnerInputs)
        .accounts({
          vaultState: this.vaultPda,
          seasonRegistration: seasonRegPda,
          vaultTokenAccount: this.vaultTokenAccount,
          authority: this.serverKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`RewardService: Season ${seasonNumber} winners registered on mainnet, tx:`, tx);
      return tx;
    } catch (err) {
      console.error('RewardService: registerWinners failed:', err.message);
      if (err.logs) console.error('Logs:', err.logs);
      return null;
    }
  }

  async getSeasonRegistration(seasonNumber) {
    if (!this.ready) return null;

    try {
      const [seasonRegPda] = PublicKey.findProgramAddressSync(
        [CLAIM_SEED, Buffer.from(new Uint32Array([seasonNumber]).buffer)],
        REWARDS_PROGRAM_ID
      );

      const account = await this.program.account.seasonRegistration.fetch(seasonRegPda);
      return {
        seasonNumber: account.seasonNumber,
        totalReward: typeof account.totalReward === 'object' ? account.totalReward.toNumber() : account.totalReward,
        winnerCount: account.winnerCount,
        registeredAt: typeof account.registeredAt === 'object' ? account.registeredAt.toNumber() : account.registeredAt,
        winners: account.winners.slice(0, account.winnerCount).map(w => ({
          wallet: w.wallet.toBase58(),
          kills: typeof w.kills === 'object' ? w.kills.toNumber() : w.kills,
          level: w.level,
          rewardAmount: typeof w.rewardAmount === 'object' ? w.rewardAmount.toNumber() : w.rewardAmount,
          claimed: w.claimed,
        })),
      };
    } catch (err) {
      return null;
    }
  }

  getVaultInfo() {
    return {
      ready: this.ready,
      programId: REWARDS_PROGRAM_ID.toBase58(),
      vaultPda: this.vaultPda?.toBase58() || null,
      vaultTokenAccount: this.vaultTokenAccount?.toBase58() || null,
      mint: WARZ_MINT.toBase58(),
      rpc: MAINNET_RPC,
    };
  }
}

module.exports = { RewardService };
