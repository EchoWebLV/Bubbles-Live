// MagicBlock Ephemeral Rollups integration layer
// Dual connection: base layer (Solana devnet) + Ephemeral Rollup (MagicBlock)
// Combat logic runs ON the ER — the server sends process_attack txs, reads state from ER

const anchor = require('@coral-xyz/anchor');
const { PublicKey, Connection, Keypair, SystemProgram } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Program IDs — configurable via env for dev/production split
// Dev:  8rSofJ1enam27SS3btJQAefNQGhUWue8vMMZeUiXscie
// Prod: AyQ8ZnxYyFxYiHmxjFXs3ptgPvrSKi4WWfxhfLqccFsw
const COMBAT_PROGRAM_ID = new PublicKey(
  process.env.COMBAT_PROGRAM_ID || '8rSofJ1enam27SS3btJQAefNQGhUWue8vMMZeUiXscie'
);
const DELEGATION_PROGRAM_ID = new PublicKey(
  process.env.DELEGATION_PROGRAM_ID || 'DELeGGvXpWV2fqJUhqcF5ZSYMS4JTLjteaAMARRSaeSh'
);
const ER_VALIDATOR = new PublicKey(
  process.env.ER_VALIDATOR || 'MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57'
);

// RPC Endpoints — override via env for dev vs production
const BASE_RPC = process.env.SOLANA_BASE_RPC || 'https://api.devnet.solana.com';
const ER_RPC = process.env.MAGICBLOCK_ER_RPC || 'https://devnet.magicblock.app';
const ER_WS = process.env.MAGICBLOCK_ER_WS || 'wss://devnet.magicblock.app';

// PDA Seeds (must match Rust program)
const ARENA_SEED = Buffer.from('arena');
const PLAYER_SEED = Buffer.from('player_v2');

// On-chain uses u16 integers for damage/attack (BASE_ATTACK=10).
// Local game uses floats (bulletDamage=0.1).  Scale factor = 100.
const DAMAGE_SCALE = 100;

// Load IDL — patch embedded addresses when using a non-default program ID
const combatIdl = JSON.parse(
  fs.readFileSync(path.join(__dirname, 'hodlwarz_combat.json'), 'utf-8')
);
if (process.env.COMBAT_PROGRAM_ID) {
  const pid = process.env.COMBAT_PROGRAM_ID;
  combatIdl.address = pid;
  if (combatIdl.accounts) {
    for (const acct of combatIdl.accounts) {
      if (acct.address) acct.address = pid;
    }
  }
}

console.log(`MagicBlock: Program ID = ${COMBAT_PROGRAM_ID.toBase58()}`);
console.log(`MagicBlock: Base RPC  = ${BASE_RPC}`);
console.log(`MagicBlock: ER RPC    = ${ER_RPC}`);

function extractTxError(err) {
  if (err.transactionMessage) return err.transactionMessage;
  if (err.message && !err.message.startsWith('Unknown action')) return err.message;
  if (err.logs) return err.logs.slice(-3).join(' | ');
  return String(err);
}

class MagicBlockService {
  constructor() {
    // Dual connections
    this.baseConnection = new Connection(BASE_RPC, 'confirmed');
    this.erConnection = new Connection(ER_RPC, {
      commitment: 'confirmed',
      wsEndpoint: ER_WS,
    });

    this.ready = false;
    this.arenaDelegated = false;
    this.playerDelegated = new Set(); // Set of wallet addresses delegated to ER

    // Track registered players: walletAddress -> { playerPda, playerBump }
    this.playerMap = new Map();

    // Arena PDA (derived deterministically)
    this.arenaPda = null;
    this.arenaBump = null;

    // Anchor programs (base layer and ER)
    this.baseProgram = null;
    this.erProgram = null;

    // State commit timer
    this.commitInterval = null;

    // Onchain event log for frontend
    this.eventLog = [];
    this.MAX_EVENT_LOG = 200;

    // Track players whose death has been logged to avoid duplicate entries.
    // Cleared when the player respawns.
    this.deathLogged = new Set();


    // Stats
    this.stats = {
      attacksSent: 0,
      attacksConfirmed: 0,
      attacksFailed: 0,
      attacksRejected: 0,
      commits: 0,
      lastCommitTime: 0,
      erLatencyMs: 0,
    };

    // Load server keypair
    try {
      let keypairData;
      if (process.env.SOLANA_PRIVATE_KEY) {
        keypairData = JSON.parse(process.env.SOLANA_PRIVATE_KEY);
        const tmpKeypath = path.join(require('os').tmpdir(), 'solana-keypair.json');
        fs.writeFileSync(tmpKeypath, JSON.stringify(keypairData));
        process.env.ANCHOR_WALLET = tmpKeypath;
      } else {
        const keypairPath = process.env.ANCHOR_WALLET ||
          process.env.SOLANA_KEYPAIR_PATH ||
          path.join(require('os').homedir(), '.config', 'solana', 'id.json');
        if (!process.env.ANCHOR_WALLET) {
          process.env.ANCHOR_WALLET = keypairPath;
        }
        keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
      }

      this.serverKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairData));
      this.wallet = new anchor.Wallet(this.serverKeypair);
      console.log('MagicBlock: Server wallet loaded:', this.serverKeypair.publicKey.toBase58().slice(0, 8) + '...');
    } catch (err) {
      console.error('MagicBlock: Failed to load server keypair:', err.message);
      this.serverKeypair = null;
      this.wallet = null;
    }
  }

  // ─── Event Logging ───────────────────────────────────────────────

  _logEvent(type, message, tx = null, extra = {}) {
    // Build explorer URL: base-layer txs go to devnet, ER txs use custom cluster
    let explorer = null;
    if (tx) {
      const isERTx = extra._er === true;
      if (isERTx) {
        explorer = `https://explorer.solana.com/tx/${tx}?cluster=custom&customUrl=${encodeURIComponent(ER_RPC)}`;
      } else {
        explorer = `https://explorer.solana.com/tx/${tx}?cluster=devnet`;
      }
    }

    // Remove internal-only flags before storing
    const { _er, ...publicExtra } = extra;

    const event = {
      type,
      message,
      tx: tx ? tx.slice(0, 20) + '...' : null,
      txFull: tx || null,
      explorer,
      time: Date.now(),
      status: tx ? 'confirmed' : (type.includes('pending') ? 'pending' : null),
      ...publicExtra,
    };
    this.eventLog.unshift(event);
    if (this.eventLog.length > this.MAX_EVENT_LOG) {
      this.eventLog.length = this.MAX_EVENT_LOG;
    }
  }

  // ─── Initialization ──────────────────────────────────────────────

  async initialize() {
    if (!this.serverKeypair) {
      console.warn('MagicBlock: No server keypair - ER features disabled');
      return false;
    }

    try {
      // Set up base layer provider + program
      this.baseProvider = new anchor.AnchorProvider(
        this.baseConnection,
        this.wallet,
        { commitment: 'confirmed', skipPreflight: true }
      );
      anchor.setProvider(this.baseProvider);
      this.baseProgram = new anchor.Program(combatIdl, this.baseProvider);

      // Set up ER provider + program
      this.erProvider = new anchor.AnchorProvider(
        this.erConnection,
        this.wallet,
        { commitment: 'confirmed', skipPreflight: true }
      );
      this.erProgram = new anchor.Program(combatIdl, this.erProvider);

      // Derive arena PDA
      [this.arenaPda, this.arenaBump] = PublicKey.findProgramAddressSync(
        [ARENA_SEED],
        COMBAT_PROGRAM_ID
      );
      console.log('MagicBlock: Arena PDA:', this.arenaPda.toBase58());

      // Check if arena already exists on base layer
      const arenaAccount = await this.baseConnection.getAccountInfo(this.arenaPda);
      if (arenaAccount) {
        console.log('MagicBlock: Arena already exists on base layer, reusing...');
        this._logEvent('arena', `Arena found: ${this.arenaPda.toBase58().slice(0, 12)}...`);

        // Check if already delegated
        if (arenaAccount.owner.toBase58() === DELEGATION_PROGRAM_ID.toBase58()) {
          console.log('MagicBlock: Arena already delegated to ER');
          this.arenaDelegated = true;
          this._logEvent('delegate', 'Arena already delegated to ER');
        }
      } else {
        // Initialize arena on base layer
        console.log('MagicBlock: Initializing Arena on base layer...');
        const tx = await this.baseProgram.methods
          .initArena()
          .accounts({
            arena: this.arenaPda,
            authority: this.serverKeypair.publicKey,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log('MagicBlock: Arena initialized! tx:', tx);
        this._logEvent('arena', `Arena created on Solana`, tx);
      }

      // Delegate arena to ER (if not already delegated)
      if (!this.arenaDelegated) {
        await this._delegateArena();
      }

      this.ready = true;
      console.log('MagicBlock: ER integration ready!');
      this._logEvent('system', 'Ephemeral Rollup integration active');

      // Discover existing players BEFORE returning — playerMap must be populated
      // so that syncFromER() can restore kills/XP/levels on startup.
      try {
        await this._discoverExistingPlayers();
      } catch (err) {
        console.warn('MagicBlock: Player discovery failed (non-fatal):', err.message);
      }

      return true;
    } catch (err) {
      console.error('MagicBlock: Initialization failed:', err.message);
      if (err.logs) console.error('Logs:', err.logs);
      this._logEvent('error', `Init failed: ${err.message}`);
      this.ready = false;
      return false;
    }
  }

  // ─── Player Discovery (restore state across restarts) ────────────

  async _discoverExistingPlayers() {
    const PLAYER_STATE_SIZE = 8 + 32 + 2 + 2 + 2 + 8 + 8 + 8 + 1 + 1 + 1 + 8 + 1 + 25 + 1;
    let discovered = 0;
    const RPC_TIMEOUT = 30000;

    const withTimeout = (promise, ms) =>
      Promise.race([promise, new Promise((_, rej) => setTimeout(() => rej(new Error('RPC timeout')), ms))]);

    // Scan ER for valid player accounts
    try {
      const erAccounts = await withTimeout(
        this.erConnection.getProgramAccounts(COMBAT_PROGRAM_ID),
        RPC_TIMEOUT
      );

      const validAccounts = erAccounts.filter(a => a.account.data.length === PLAYER_STATE_SIZE);
      console.log(`MagicBlock: ER accounts — ${validAccounts.length} valid players found`);

      for (const { pubkey, account } of validAccounts) {
        try {
          const decoded = this.erProgram.coder.accounts.decode('playerState', account.data);
          const wallet = decoded.wallet.toBase58();
          if (!this.playerMap.has(wallet)) {
            const [playerPda, playerBump] = PublicKey.findProgramAddressSync(
              [PLAYER_SEED, decoded.wallet.toBuffer()],
              COMBAT_PROGRAM_ID
            );
            this.playerMap.set(wallet, { playerPda, playerBump, walletAddress: wallet });
            this.playerDelegated.add(wallet);
            discovered++;
          }
        } catch (e) { /* skip malformed */ }
      }
    } catch (err) {
      console.warn('MagicBlock: ER player scan skipped:', err.message);
    }

    // Scan base layer for accounts not yet delegated
    try {
      const baseAccounts = await withTimeout(
        this.baseConnection.getProgramAccounts(COMBAT_PROGRAM_ID, {
          filters: [{ dataSize: PLAYER_STATE_SIZE }],
        }),
        RPC_TIMEOUT
      );

      for (const { pubkey, account } of baseAccounts) {
        try {
          const decoded = this.baseProgram.coder.accounts.decode('playerState', account.data);
          const wallet = decoded.wallet.toBase58();
          if (!this.playerMap.has(wallet)) {
            const [playerPda, playerBump] = PublicKey.findProgramAddressSync(
              [PLAYER_SEED, decoded.wallet.toBuffer()],
              COMBAT_PROGRAM_ID
            );
            this.playerMap.set(wallet, { playerPda, playerBump, walletAddress: wallet });
            discovered++;
          }
        } catch (e) { /* skip malformed */ }
      }
    } catch (err) {
      console.warn('MagicBlock: Base layer player scan skipped:', err.message);
    }

    // Mark base-layer accounts owned by delegation program as delegated
    for (const [wallet, info] of this.playerMap) {
      if (this.playerDelegated.has(wallet)) continue;
      try {
        const acct = await this.baseConnection.getAccountInfo(info.playerPda);
        if (acct && acct.owner.toBase58() === DELEGATION_PROGRAM_ID.toBase58()) {
          this.playerDelegated.add(wallet);
        }
      } catch (e) { /* best-effort */ }
    }

    console.log(`MagicBlock: Discovered ${discovered} valid players, ${this.playerDelegated.size} delegated`);
  }

  // ─── Delegation ──────────────────────────────────────────────────

  async _delegateArena() {
    try {
      console.log('MagicBlock: Delegating arena to ER...');

      // Derive delegation PDAs
      const [bufferPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('buffer'), this.arenaPda.toBuffer()],
        COMBAT_PROGRAM_ID
      );
      const [delegationRecord] = PublicKey.findProgramAddressSync(
        [Buffer.from('delegation'), this.arenaPda.toBuffer()],
        DELEGATION_PROGRAM_ID
      );
      const [delegationMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from('delegation-metadata'), this.arenaPda.toBuffer()],
        DELEGATION_PROGRAM_ID
      );

      const tx = await this.baseProgram.methods
        .delegateArena()
        .accounts({
          payer: this.serverKeypair.publicKey,
          bufferArena: bufferPda,
          delegationRecordArena: delegationRecord,
          delegationMetadataArena: delegationMetadata,
          arena: this.arenaPda,
          ownerProgram: COMBAT_PROGRAM_ID,
          delegationProgram: DELEGATION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: ER_VALIDATOR, isSigner: false, isWritable: false },
        ])
        .rpc();

      this.arenaDelegated = true;
      console.log('MagicBlock: Arena delegated to ER! tx:', tx);
      this._logEvent('delegate', 'Arena delegated to Ephemeral Rollup', tx);
    } catch (err) {
      console.error('MagicBlock: Arena delegation failed:', err.message);
      if (err.logs) console.error('Logs:', err.logs);
      this._logEvent('error', `Arena delegation failed: ${err.message}`);
    }
  }

  async _delegatePlayer(wallet) {
    try {
      const walletPubkey = new PublicKey(wallet);
      const [playerPda] = PublicKey.findProgramAddressSync(
        [PLAYER_SEED, walletPubkey.toBuffer()],
        COMBAT_PROGRAM_ID
      );

      const [bufferPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('buffer'), playerPda.toBuffer()],
        COMBAT_PROGRAM_ID
      );
      const [delegationRecord] = PublicKey.findProgramAddressSync(
        [Buffer.from('delegation'), playerPda.toBuffer()],
        DELEGATION_PROGRAM_ID
      );
      const [delegationMetadata] = PublicKey.findProgramAddressSync(
        [Buffer.from('delegation-metadata'), playerPda.toBuffer()],
        DELEGATION_PROGRAM_ID
      );

      const tx = await this.baseProgram.methods
        .delegatePlayer(walletPubkey)
        .accounts({
          payer: this.serverKeypair.publicKey,
          bufferPlayerState: bufferPda,
          delegationRecordPlayerState: delegationRecord,
          delegationMetadataPlayerState: delegationMetadata,
          playerState: playerPda,
          ownerProgram: COMBAT_PROGRAM_ID,
          delegationProgram: DELEGATION_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .remainingAccounts([
          { pubkey: ER_VALIDATOR, isSigner: false, isWritable: false },
        ])
        .rpc();

      this.playerDelegated.add(wallet);
      console.log(`MagicBlock: Player ${wallet.slice(0, 6)}... delegated to ER`);
      this._logEvent('delegate', `Player ${wallet.slice(0, 6)}... delegated to ER`, tx, { wallet });
    } catch (err) {
      console.error(`MagicBlock: Player delegation failed for ${wallet.slice(0, 6)}:`, err.message);
      this._logEvent('error', `Player delegation failed: ${wallet.slice(0, 6)}...`, null, { wallet, error: err.message });
    }
  }

  // ─── Player Registration ─────────────────────────────────────────

  async registerPlayer(walletAddress) {
    if (!this.ready) return null;
    if (this.playerMap.has(walletAddress)) return this.playerMap.get(walletAddress);

    try {
      const walletPubkey = new PublicKey(walletAddress);
      const [playerPda, playerBump] = PublicKey.findProgramAddressSync(
        [PLAYER_SEED, walletPubkey.toBuffer()],
        COMBAT_PROGRAM_ID
      );

      // Check if already registered on base layer
      const existing = await this.baseConnection.getAccountInfo(playerPda);
      if (existing) {
        console.log(`MagicBlock: Player ${walletAddress.slice(0, 6)}... already registered`);
        const playerInfo = { playerPda, playerBump, walletAddress };
        this.playerMap.set(walletAddress, playerInfo);

        // Check if delegated
        if (existing.owner.toBase58() === DELEGATION_PROGRAM_ID.toBase58()) {
          this.playerDelegated.add(walletAddress);
        } else if (!this.playerDelegated.has(walletAddress)) {
          await this._delegatePlayer(walletAddress);
        }
        return playerInfo;
      }

      // Register player on base layer (no arena needed)
      const tx = await this.baseProgram.methods
        .registerPlayer(walletPubkey)
        .accounts({
          playerState: playerPda,
          authority: this.serverKeypair.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log(`MagicBlock: Player ${walletAddress.slice(0, 6)}... registered on base layer`);
      this._logEvent('register', `Player ${walletAddress.slice(0, 6)}... registered`, tx, { wallet: walletAddress });

      const playerInfo = { playerPda, playerBump, walletAddress };
      this.playerMap.set(walletAddress, playerInfo);

      // Delegate to ER after registration
      await new Promise(r => setTimeout(r, 1500));
      await this._delegatePlayer(walletAddress);

      return playerInfo;
    } catch (err) {
      console.error(`MagicBlock: registerPlayer failed for ${walletAddress.slice(0, 6)}:`, err.message);
      this._logEvent('error', `Register failed: ${walletAddress.slice(0, 6)}...`, null, { error: err.message });
      return null;
    }
  }

  // ─── Combat (runs on ER) ─────────────────────────────────────────

  async processAttack(attackerAddress, victimAddress, hitCount) {
    if (!this.ready || !this.arenaDelegated) return null;

    const attacker = this.playerMap.get(attackerAddress);
    const victim = this.playerMap.get(victimAddress);
    if (!attacker || !victim) return null;
    if (!this.playerDelegated.has(attackerAddress) || !this.playerDelegated.has(victimAddress)) return null;

    if (this.deathLogged.has(victimAddress)) return null;

    if (typeof hitCount !== 'number' || !isFinite(hitCount) || hitCount <= 0) return null;
    const clampedHits = Math.min(Math.max(1, Math.round(hitCount)), 500);

    this.stats.attacksSent++;

    try {
      const start = Date.now();

      // Server sends hit count — the chain computes damage from on-chain talent state.
      // The server CANNOT dictate damage amounts.
      const tx = await this.erProgram.methods
        .processAttack(clampedHits)
        .accounts({
          attacker: attacker.playerPda,
          victim: victim.playerPda,
          arena: this.arenaPda,
        })
        .rpc();

      this.stats.erLatencyMs = Date.now() - start;
      this.stats.attacksConfirmed++;

      // After every successful attack, check if victim died on-chain.
      // If the local game already logged the kill/death (without tx),
      // patch those events with the tx signature so explorer links appear.
      try {
        const victimState = await this.erProgram.account.playerState.fetch(victim.playerPda);
        if (!victimState.isAlive && !this.deathLogged.has(victimAddress)) {
          this.deathLogged.add(victimAddress);
          const erExplorer = `https://explorer.solana.com/tx/${tx}?cluster=custom&customUrl=${encodeURIComponent(ER_RPC)}`;
          const txShort = tx.slice(0, 20) + '...';

          // Try to patch existing local events first
          let patched = false;
          for (const evt of this.eventLog) {
            if ((evt.type === 'kill' || evt.type === 'death') && evt.victim === victimAddress && !evt.txFull) {
              evt.tx = txShort;
              evt.txFull = tx;
              evt.explorer = erExplorer;
              evt.status = 'confirmed';
              patched = true;
            }
          }

          if (!patched) {
            this._logEvent('kill', `${attackerAddress.slice(0, 6)}... killed ${victimAddress.slice(0, 6)}...`, tx, {
              killer: attackerAddress, victim: victimAddress, _er: true,
            });
            this._logEvent('death', `${victimAddress.slice(0, 6)}... was eliminated`, tx, {
              victim: victimAddress, killer: attackerAddress, _er: true,
            });
          }
        }
      } catch (_) {
        // State fetch failed — not critical, will catch on next cycle
      }

      return tx;
    } catch (err) {
      const msg = extractTxError(err);
      const expected = ['blockhash', 'VictimDead', 'AttackerDead', 'NotInitialized'];
      if (expected.some(e => msg.includes(e))) {
        this.stats.attacksRejected++;
      } else {
        this.stats.attacksFailed++;
        console.error(`MagicBlock: Attack failed (${attackerAddress.slice(0, 6)} → ${victimAddress.slice(0, 6)}):`, msg);
      }
      return null;
    }
  }

  async respawnPlayer(walletAddress) {
    if (!this.ready) return null;
    const player = this.playerMap.get(walletAddress);
    if (!player || !this.playerDelegated.has(walletAddress)) return null;

    try {
      const tx = await this.erProgram.methods
        .respawnPlayer()
        .accounts({
          playerState: player.playerPda,
        })
        .rpc();

      this.deathLogged.delete(walletAddress); // allow future death detection
      this._logEvent('respawn', `Player ${walletAddress.slice(0, 6)}... respawned on ER`, tx, { wallet: walletAddress, _er: true });
      return tx;
    } catch (err) {
      const msg = extractTxError(err);
      const expected = ['AlreadyAlive', 'RespawnCooldown', 'blockhash'];
      if (!expected.some(e => msg.includes(e))) {
        console.error(`MagicBlock: Respawn failed for ${walletAddress.slice(0, 6)}:`, msg);
      }
      return null;
    }
  }

  async upgradeStat(walletAddress, statType) {
    if (!this.ready) return false;
    const player = this.playerMap.get(walletAddress);
    if (!player || !this.playerDelegated.has(walletAddress)) return false;

    try {
      const tx = await this.erProgram.methods
        .upgradeStat(statType)
        .accounts({
          playerState: player.playerPda,
        })
        .rpc();

      const statName = statType === 0 ? 'Health' : 'Attack';
      this._logEvent('upgrade', `${walletAddress.slice(0, 6)}... upgraded ${statName} on ER`, tx, {
        wallet: walletAddress,
        statType,
        statName,
        _er: true,
      });
      return true;
    } catch (err) {
      const msg = extractTxError(err);
      console.error(`MagicBlock: Upgrade failed for ${walletAddress.slice(0, 6)}:`, msg);
      this._logEvent('error', `Upgrade failed: ${msg}`, null, { wallet: walletAddress });
      return false;
    }
  }

  // ─── Talent Allocation (runs on ER) ─────────────────────────────

  async allocateTalentOnChain(walletAddress, talentId) {
    if (!this.ready) return false;
    const player = this.playerMap.get(walletAddress);
    if (!player || !this.playerDelegated.has(walletAddress)) return false;

    try {
      const tx = await this.erProgram.methods
        .allocateTalent(talentId)
        .accounts({
          playerState: player.playerPda,
        })
        .rpc();

      this._logEvent('talent', `${walletAddress.slice(0, 6)}... allocated talent #${talentId}`, tx, {
        wallet: walletAddress, talentId, _er: true,
      });
      return true;
    } catch (err) {
      const msg = extractTxError(err);
      const expected = ['NoTalentPoints', 'TalentMaxed', 'blockhash'];
      if (!expected.some(e => msg.includes(e))) {
        console.error(`MagicBlock: Talent alloc failed for ${walletAddress.slice(0, 6)}:`, msg);
      }
      return false;
    }
  }

  async resetTalentsOnChain(walletAddress) {
    if (!this.ready) return false;
    const player = this.playerMap.get(walletAddress);
    if (!player || !this.playerDelegated.has(walletAddress)) return false;

    try {
      const tx = await this.erProgram.methods
        .resetTalents()
        .accounts({
          playerState: player.playerPda,
        })
        .rpc();

      this._logEvent('talent', `${walletAddress.slice(0, 6)}... reset all talents`, tx, {
        wallet: walletAddress, _er: true,
      });
      return true;
    } catch (err) {
      console.error(`MagicBlock: Talent reset failed for ${walletAddress.slice(0, 6)}:`, extractTxError(err));
      return false;
    }
  }

  // ─── Season Reset (runs on ER) ──────────────────────────────────

  async resetPlayerByPda(playerPda, label) {
    try {
      const tx = await this.erProgram.methods
        .resetPlayer()
        .accounts({
          playerState: playerPda,
        })
        .rpc();

      this._logEvent('reset', `Player ${label} reset to base stats`, tx, { _er: true });
      return tx;
    } catch (err) {
      console.error(`MagicBlock: Reset failed for ${label}:`, err.message);
      return null;
    }
  }

  async resetPlayer(walletAddress) {
    if (!this.ready) return null;
    const player = this.playerMap.get(walletAddress);
    if (!player || !this.playerDelegated.has(walletAddress)) return null;
    return this.resetPlayerByPda(player.playerPda, walletAddress.slice(0, 6) + '...');
  }

  async resetAllPlayers() {
    if (!this.ready) return { success: 0, failed: 0 };

    let success = 0;
    let failed = 0;

    // Discover ALL PlayerState accounts on the ER, not just locally tracked ones
    try {
      const allAccounts = await this.erConnection.getProgramAccounts(COMBAT_PROGRAM_ID, {
        filters: [
          { dataSize: 8 + 32 + 2 + 2 + 2 + 8 + 8 + 8 + 1 + 1 + 1 + 8 + 1 + 25 + 1 },
        ],
      });

      console.log(`MagicBlock: Season reset — found ${allAccounts.length} player accounts on ER`);

      for (const { pubkey } of allAccounts) {
        const tx = await this.resetPlayerByPda(pubkey, pubkey.toBase58().slice(0, 8) + '...');
        if (tx) {
          success++;
        } else {
          failed++;
        }
      }
    } catch (err) {
      console.error('MagicBlock: Failed to fetch all accounts from ER, falling back to playerMap:', err.message);

      // Fallback: reset only locally tracked players
      for (const wallet of this.playerMap.keys()) {
        const tx = await this.resetPlayer(wallet);
        if (tx) { success++; } else { failed++; }
      }
    }

    console.log(`MagicBlock: Season reset complete — ${success} reset, ${failed} failed`);
    this._logEvent('season', `Season reset: ${success} players reset to base stats`, null, { success, failed });
    return { success, failed };
  }

  // ─── State Reading (from ER) ─────────────────────────────────────

  _formatPlayerState(walletAddress, account, playerPda) {
    return {
      walletAddress,
      wallet: account.wallet.toBase58(),
      health: account.health,
      maxHealth: account.maxHealth,
      attackPower: account.attackPower / DAMAGE_SCALE,
      xp: typeof account.xp === 'object' ? account.xp.toNumber() : account.xp,
      kills: typeof account.kills === 'object' ? account.kills.toNumber() : account.kills,
      deaths: typeof account.deaths === 'object' ? account.deaths.toNumber() : account.deaths,
      healthLevel: account.healthLevel,
      attackLevel: account.attackLevel,
      isAlive: account.isAlive,
      respawnAt: typeof account.respawnAt === 'object' ? account.respawnAt.toNumber() : account.respawnAt,
      initialized: account.initialized,
      playerPda: typeof playerPda === 'string' ? playerPda : playerPda.toBase58(),
      talents: {
        armor: account.talentIronSkin || 0,
        ironSkin: account.talentHeavyHitter || 0,
        regeneration: account.talentRegeneration || 0,
        lifesteal: account.talentLifesteal || 0,
        vitalityStrike: account.talentArmor || 0,
        heavyHitter: account.talentSwift || 0,
        rapidFire: account.talentRapidFire || 0,
        criticalStrike: account.talentEvasion || 0,
        multiShot: account.talentQuickRespawn || 0,
        dualCannon: account.talentMomentum || 0,
        dash: account.talentWeakspot || 0,
        bodySlam: account.talentCriticalStrike || 0,
        relentless: account.talentFocusFire || 0,
        orbit: account.talentMultiShot || 0,
        shockwave: account.talentDualCannon || 0,
        ricochet: account.talentDeflect || 0,
        counterAttack: account.talentAbsorb || 0,
        chainLightning: account.talentLastStand || 0,
        nova: account.talentCloak || 0,
        focusFire: account.talentDash || 0,
        experience: account.talentRampage || 0,
        execute: account.talentHoming || 0,
        killRush: account.talentRicochet || 0,
        reaperArc: account.talentDeathbomb || 0,
        berserker: account.talentFrenzy || 0,
      },
      manualBuild: account.manualBuild || false,
    };
  }

  async getPlayerState(walletAddress) {
    if (!this.ready) return null;
    const player = this.playerMap.get(walletAddress);
    if (!player) return null;

    try {
      const program = this.playerDelegated.has(walletAddress) ? this.erProgram : this.baseProgram;
      const account = await program.account.playerState.fetch(player.playerPda);
      return this._formatPlayerState(walletAddress, account, player.playerPda);
    } catch (err) {
      return null;
    }
  }

  // Read player state directly from base layer (committed state).
  // Works even for delegated accounts — decodes raw bytes regardless of owner.
  async getPlayerStateFromBase(walletAddress) {
    const walletPubkey = new PublicKey(walletAddress);
    const [playerPda] = PublicKey.findProgramAddressSync(
      [PLAYER_SEED, walletPubkey.toBuffer()],
      COMBAT_PROGRAM_ID
    );

    try {
      const acctInfo = await this.baseConnection.getAccountInfo(playerPda);
      if (!acctInfo || !acctInfo.data) return null;

      const account = this.baseProgram.coder.accounts.decode('playerState', acctInfo.data);
      return this._formatPlayerState(walletAddress, account, playerPda);
    } catch {
      return null;
    }
  }

  async getArenaState() {
    if (!this.ready) return null;

    try {
      const program = this.arenaDelegated ? this.erProgram : this.baseProgram;
      const account = await program.account.arena.fetch(this.arenaPda);
      return {
        authority: account.authority.toBase58(),
        playerCount: account.playerCount,
        totalKills: typeof account.totalKills === 'object' ? account.totalKills.toNumber() : account.totalKills,
        isActive: account.isActive,
      };
    } catch (err) {
      console.error('MagicBlock: getArenaState failed:', err.message);
      return null;
    }
  }

  async getAllPlayerStates() {
    if (!this.ready) return new Map();
    const states = new Map();
    const entries = [...this.playerMap.entries()];
    const BATCH = 10;

    for (let i = 0; i < entries.length; i += BATCH) {
      const batch = entries.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(([wallet]) => this.getPlayerState(wallet))
      );
      for (let j = 0; j < batch.length; j++) {
        const r = results[j];
        if (r.status === 'fulfilled' && r.value) {
          states.set(batch[j][0], r.value);
        }
      }
    }
    return states;
  }

  // Restore all player states on startup: reads from ER first, then falls back
  // to base layer for holders not found on ER (e.g. after an ER session reset).
  async restoreAllPlayerStates(holderAddresses = []) {
    if (!this.ready) return new Map();

    const states = new Map();

    const erStates = await this.getAllPlayerStates();
    for (const [wallet, state] of erStates) {
      states.set(wallet, state);
    }
    console.log(`MagicBlock: Restored ${states.size} player states from ER`);

    const missing = holderAddresses.filter(addr => !states.has(addr));
    if (missing.length > 0) {
      console.log(`MagicBlock: Checking base layer for ${missing.length} holders not found on ER...`);
      const BATCH = 10;
      let baseRestored = 0;
      for (let i = 0; i < missing.length; i += BATCH) {
        const batch = missing.slice(i, i + BATCH);
        const results = await Promise.allSettled(
          batch.map(addr => this.getPlayerStateFromBase(addr))
        );
        for (let j = 0; j < batch.length; j++) {
          const r = results[j];
          if (r.status === 'fulfilled' && r.value && r.value.xp > 0) {
            states.set(batch[j], r.value);
            baseRestored++;

            if (!this.playerMap.has(batch[j])) {
              const walletPubkey = new PublicKey(batch[j]);
              const [playerPda, playerBump] = PublicKey.findProgramAddressSync(
                [PLAYER_SEED, walletPubkey.toBuffer()],
                COMBAT_PROGRAM_ID
              );
              this.playerMap.set(batch[j], { playerPda, playerBump, walletAddress: batch[j] });
            }
          }
        }
      }
      if (baseRestored > 0) {
        console.log(`MagicBlock: Restored ${baseRestored} additional player states from base layer`);
      }
    }

    return states;
  }

  // ─── State Commit (ER → Base Layer) ──────────────────────────────

  async commitState() {
    if (!this.ready || !this.arenaDelegated) return;

    try {
      console.log('MagicBlock: Committing ER state to base layer...');
      const tx = await this.erProgram.methods
        .commitState()
        .accounts({
          payer: this.serverKeypair.publicKey,
          arena: this.arenaPda,
          magicProgram: new PublicKey('Magic11111111111111111111111111111111111111'),
          magicContext: new PublicKey('MagicContext1111111111111111111111111111111'),
        })
        .rpc();

      this.stats.commits++;
      this.stats.lastCommitTime = Date.now();
      console.log('MagicBlock: State committed! tx:', tx);
      this._logEvent('commit', 'ER state committed to Solana base layer', tx, { _er: true });
      return tx;
    } catch (err) {
      const msg = extractTxError(err);
      console.error('MagicBlock: Commit failed:', msg);
      this._logEvent('error', `Commit failed: ${msg}`);
      return null;
    }
  }

  async commitPlayer(walletAddress) {
    if (!this.ready) return null;
    const player = this.playerMap.get(walletAddress);
    if (!player || !this.playerDelegated.has(walletAddress)) return null;

    try {
      const tx = await this.erProgram.methods
        .commitPlayer()
        .accounts({
          payer: this.serverKeypair.publicKey,
          playerState: player.playerPda,
          magicProgram: new PublicKey('Magic11111111111111111111111111111111111111'),
          magicContext: new PublicKey('MagicContext1111111111111111111111111111111'),
        })
        .rpc();
      return tx;
    } catch (err) {
      const msg = extractTxError(err);
      if (!msg.includes('blockhash')) {
        console.error(`MagicBlock: Commit player ${walletAddress.slice(0, 6)}... failed:`, msg);
      }
      return null;
    }
  }

  async commitAllPlayers() {
    if (!this.ready) return 0;
    const wallets = [...this.playerDelegated];
    const BATCH = 5;
    let committed = 0;

    for (let i = 0; i < wallets.length; i += BATCH) {
      const batch = wallets.slice(i, i + BATCH);
      const results = await Promise.allSettled(
        batch.map(w => this.commitPlayer(w))
      );
      committed += results.filter(r => r.status === 'fulfilled' && r.value).length;
    }

    console.log(`MagicBlock: Committed ${committed}/${wallets.length} players to base layer`);
    return committed;
  }

  startCommitTimer(intervalMs = 30000) {
    if (this.commitInterval) clearInterval(this.commitInterval);
    this.commitInterval = setInterval(async () => {
      await this.commitState();
      await this.commitAllPlayers();
    }, intervalMs);
    console.log(`MagicBlock: State commit timer started (every ${intervalMs / 1000}s)`);
  }

  stopCommitTimer() {
    if (this.commitInterval) {
      clearInterval(this.commitInterval);
      this.commitInterval = null;
    }
  }

  // ─── Status ──────────────────────────────────────────────────────

  getStatus() {
    return {
      ready: this.ready,
      arenaPda: this.arenaPda?.toBase58() || null,
      arenaDelegated: this.arenaDelegated,
      playersRegistered: this.playerMap.size,
      playersDelegated: this.playerDelegated.size,
      stats: { ...this.stats },
      eventLog: this.eventLog.slice(0, 100),
      rpc: {
        baseLayer: BASE_RPC,
        ephemeralRollup: ER_RPC,
      },
      programId: COMBAT_PROGRAM_ID.toBase58(),
      erValidator: ER_VALIDATOR.toBase58(),
    };
  }
}

module.exports = { MagicBlockService };
