// MagicBlock BOLT integration layer
// Replaces PostgreSQL with onchain state via BOLT ECS on Solana devnet

const anchor = require('@coral-xyz/anchor');
const { PublicKey, Connection, Keypair } = require('@solana/web3.js');
const {
  InitializeNewWorld,
  AddEntity,
  InitializeComponent,
  ApplySystem,
  FindComponentPda,
  FindEntityPda,
  FindWorldPda,
} = require('@magicblock-labs/bolt-sdk');
const fs = require('fs');
const path = require('path');

// Program IDs (deployed to devnet)
const WORLD_PROGRAM_ID = new PublicKey('WorLD15A7CrDwLcLy4fRqtaTb9fbd8o8iqiEMUDse2n');
const PLAYER_STATS_COMPONENT_ID = new PublicKey('9keor8BL7FDNrb16o7tT7nqo37hE9M5LtuZc6vvVeDqz');
const INIT_PLAYER_SYSTEM_ID = new PublicKey('Fyd3jGqzimv14JWwDHMqJNSN968xVRkzj1Myer7W8viM');
const RECORD_KILL_SYSTEM_ID = new PublicKey('HZuiYWHV2K8v4uaGbG41BheXzkeWi4ePGtvV49WnaozA');
const UPGRADE_STAT_SYSTEM_ID = new PublicKey('52uWfPzp8rzReBkyP5XoXHR8yWoZkY7kgmKxvPCZvY6S');

// Devnet RPC
const DEVNET_RPC = 'https://api.devnet.solana.com';

// Load IDL
const playerStatsIdl = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'onchain', 'idl', 'player_stats.json'), 'utf-8')
);

class MagicBlockService {
  constructor() {
    this.connection = new Connection(DEVNET_RPC, 'confirmed');
    this.worldPda = null;
    this.entityMap = new Map(); // walletAddress -> { entityPda, entityId, componentPda }
    this.ready = false;
    this.playerStatsProgram = null;
    this.nextEntityId = 0;
    this.initQueue = []; // Queue for player init to avoid rate limits
    this.isProcessingQueue = false;
    this.pendingInits = new Set(); // Addresses currently being initialized

    // Kill batching — accumulate kills, settle every 60 seconds
    this.killBuffer = []; // Array of { killer, victim, timestamp }
    this.isSettling = false;
    this.settlementInterval = null;
    this.batchStats = { queued: 0, settled: 0, skipped: 0, lastSettleTime: 0 };
    this.MAX_BATCH_TX = 20; // Max transactions per settlement (cap RPC load)

    // Onchain event log — rolling buffer of recent tx events for frontend display
    this.eventLog = []; // { type, message, tx, time, explorer, status }
    this.MAX_EVENT_LOG = 200;

    // Load server keypair for signing transactions
    // Supports: SOLANA_PRIVATE_KEY (JSON array string) > ANCHOR_WALLET (file path) > default path
    try {
      let keypairData;

      if (process.env.SOLANA_PRIVATE_KEY) {
        // Production: keypair provided as JSON array in env var (e.g. "[1,2,3,...]")
        keypairData = JSON.parse(process.env.SOLANA_PRIVATE_KEY);
        // Write to a temp file so Anchor SDK can find it via ANCHOR_WALLET
        const tmpKeypath = path.join(require('os').tmpdir(), 'solana-keypair.json');
        fs.writeFileSync(tmpKeypath, JSON.stringify(keypairData));
        process.env.ANCHOR_WALLET = tmpKeypath;
      } else {
        // Local dev: load from file
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

  // Push an event to the rolling onchain log
  _logEvent(type, message, tx = null, extra = {}) {
    const event = {
      type,       // 'world' | 'entity' | 'component' | 'init' | 'kill' | 'kill_pending' | 'upgrade' | 'batch' | 'error'
      message,
      tx: tx ? tx.slice(0, 20) + '...' : null,
      txFull: tx || null,
      explorer: tx ? `https://explorer.solana.com/tx/${tx}?cluster=devnet` : null,
      time: Date.now(),
      status: tx ? 'confirmed' : (type === 'kill_pending' ? 'pending' : null),
      ...extra,
    };
    this.eventLog.unshift(event);
    if (this.eventLog.length > this.MAX_EVENT_LOG) {
      this.eventLog.length = this.MAX_EVENT_LOG;
    }
  }

  async initialize() {
    if (!this.serverKeypair) {
      console.warn('MagicBlock: No server keypair - onchain features disabled');
      return false;
    }

    try {
      // Set up Anchor provider
      this.provider = new anchor.AnchorProvider(
        this.connection,
        this.wallet,
        { commitment: 'confirmed', skipPreflight: true }
      );
      anchor.setProvider(this.provider);

      // Initialize the PlayerStats program interface for reading
      this.playerStatsProgram = new anchor.Program(playerStatsIdl, this.provider);

      // Initialize a new World
      console.log('MagicBlock: Initializing World on devnet...');
      const initWorld = await InitializeNewWorld({
        payer: this.serverKeypair.publicKey,
        connection: this.connection,
      });

      const txSign = await this.provider.sendAndConfirm(initWorld.transaction);
      this.worldPda = initWorld.worldPda;
      console.log('MagicBlock: World initialized!', this.worldPda.toBase58());
      console.log('MagicBlock: World tx:', txSign);
      this._logEvent('world', `World created: ${this.worldPda.toBase58().slice(0, 12)}...`, txSign, { worldPda: this.worldPda.toBase58() });

      this.ready = true;
      return true;
    } catch (err) {
      console.error('MagicBlock: Initialization failed:', err.message);
      this.ready = false;
      return false;
    }
  }

  // Queue a player for initialization (rate-limited)
  async initPlayer(walletAddress) {
    if (!this.ready) return null;
    if (this.entityMap.has(walletAddress)) return this.entityMap.get(walletAddress);
    if (this.pendingInits.has(walletAddress)) return null;

    this.pendingInits.add(walletAddress);
    this.initQueue.push(walletAddress);
    this.processQueue(); // Start processing if not already
    return null;
  }

  // Process init queue with delays to avoid rate limits
  async processQueue() {
    if (this.isProcessingQueue) return;
    this.isProcessingQueue = true;

    while (this.initQueue.length > 0) {
      const walletAddress = this.initQueue.shift();
      if (!walletAddress || this.entityMap.has(walletAddress)) {
        this.pendingInits.delete(walletAddress);
        continue;
      }

      try {
        await this._initPlayerOnchain(walletAddress);
      } catch (err) {
        console.error(`MagicBlock: initPlayer failed for ${walletAddress.slice(0, 8)}:`, err.message);
      }

      this.pendingInits.delete(walletAddress);
      // Wait 2 seconds between inits to respect devnet rate limits
      await new Promise(r => setTimeout(r, 2000));
    }

    this.isProcessingQueue = false;
  }

  // Actually create entity + component onchain
  async _initPlayerOnchain(walletAddress) {
    // Step 1: Add entity to world
    const addEntity = await AddEntity({
      payer: this.serverKeypair.publicKey,
      world: this.worldPda,
      connection: this.connection,
    });
    const entityTx = await this.provider.sendAndConfirm(addEntity.transaction);
    const entityPda = addEntity.entityPda;
    const entityId = addEntity.entityId;

    console.log(`MagicBlock: Entity created for ${walletAddress.slice(0, 8)}... entityPda=${entityPda.toBase58().slice(0, 12)}`);
    this._logEvent('entity', `Entity created for ${walletAddress.slice(0, 8)}...`, entityTx, { wallet: walletAddress, entityPda: entityPda.toBase58() });
    await new Promise(r => setTimeout(r, 1500));

    // Step 2: Attach PlayerStats component
    let componentPda;
    try {
      const initComponent = await InitializeComponent({
        payer: this.serverKeypair.publicKey,
        entity: entityPda,
        componentId: PLAYER_STATS_COMPONENT_ID,
      });
      const componentTx = await this.provider.sendAndConfirm(initComponent.transaction);
      componentPda = initComponent.componentPda;
      console.log(`MagicBlock: Component attached for ${walletAddress.slice(0, 8)}, PDA=${componentPda.toBase58().slice(0, 12)}`);
      this._logEvent('component', `PlayerStats attached to ${walletAddress.slice(0, 8)}...`, componentTx, { wallet: walletAddress, componentPda: componentPda.toBase58() });
    } catch (compErr) {
      console.error(`MagicBlock: Component attach failed for ${walletAddress.slice(0, 8)}:`, compErr.message);
      // Still save entity even without component
      const playerInfo = { entityPda, entityId, componentPda: null, walletAddress };
      this.entityMap.set(walletAddress, playerInfo);
      return playerInfo;
    }
    await new Promise(r => setTimeout(r, 1500));

    // Step 3: Apply init_player system
    try {
      const applyInit = await ApplySystem({
        authority: this.serverKeypair.publicKey,
        systemId: INIT_PLAYER_SYSTEM_ID,
        world: this.worldPda,
        entities: [{
          entity: entityPda,
          components: [{ componentId: PLAYER_STATS_COMPONENT_ID }],
        }],
      });
      const initTx = await this.provider.sendAndConfirm(applyInit.transaction);
      console.log(`MagicBlock: Player ${walletAddress.slice(0, 8)} initialized onchain! tx: ${initTx.slice(0, 16)}...`);
      this._logEvent('init', `Player ${walletAddress.slice(0, 8)}... initialized`, initTx, { wallet: walletAddress });
    } catch (sysErr) {
      console.error(`MagicBlock: System apply failed for ${walletAddress.slice(0, 8)}:`, sysErr.message);
    }

    const playerInfo = { entityPda, entityId, componentPda, walletAddress };
    this.entityMap.set(walletAddress, playerInfo);
    return playerInfo;
  }

  // Queue a kill for batched settlement (instead of sending immediately)
  queueKill(killerAddress, victimAddress) {
    if (!this.ready) return;
    this.killBuffer.push({ killer: killerAddress, victim: victimAddress, timestamp: Date.now() });
    this.batchStats.queued++;

    // Log each kill immediately so the frontend can display it in real-time
    this._logEvent('kill_pending', `${killerAddress.slice(0, 6)}... killed ${victimAddress.slice(0, 6)}...`, null, {
      killer: killerAddress,
      victim: victimAddress,
      status: 'pending',
    });
  }

  // Start the batch settlement timer (call once after initialize)
  startBatchSettlement(intervalMs = 60000) {
    if (this.settlementInterval) clearInterval(this.settlementInterval);
    this.settlementInterval = setInterval(() => this.settleKillBatch(), intervalMs);
    console.log(`MagicBlock: Batch settlement started (every ${intervalMs / 1000}s, max ${this.MAX_BATCH_TX} tx/batch)`);
  }

  // Stop the settlement timer
  stopBatchSettlement() {
    if (this.settlementInterval) {
      clearInterval(this.settlementInterval);
      this.settlementInterval = null;
    }
  }

  // Settle accumulated kills onchain — each kill is its own transaction (no dedup)
  async settleKillBatch() {
    if (this.isSettling || !this.ready || this.killBuffer.length === 0) return;
    this.isSettling = true;

    // Take up to MAX_BATCH_TX kills from the buffer
    const batch = this.killBuffer.splice(0, this.MAX_BATCH_TX);
    const remaining = this.killBuffer.length;
    const batchSize = batch.length;

    // Filter out kills where either entity isn't initialized onchain yet
    const txList = [];
    for (const kill of batch) {
      const killerEntity = this.entityMap.get(kill.killer);
      const victimEntity = this.entityMap.get(kill.victim);
      if (!killerEntity || !victimEntity) {
        this.batchStats.skipped++;
        continue;
      }
      txList.push(kill);
    }

    console.log(`MagicBlock: Settling ${txList.length} kills onchain (${remaining} still queued)`);
    this._logEvent('batch', `Settling ${txList.length} kills onchain...`, null, { batchSize, txCount: txList.length, remaining });

    // Send each kill as its own transaction
    let successCount = 0;
    for (const kill of txList) {
      try {
        const killerEntity = this.entityMap.get(kill.killer);
        const victimEntity = this.entityMap.get(kill.victim);

        const applySystem = await ApplySystem({
          authority: this.serverKeypair.publicKey,
          systemId: RECORD_KILL_SYSTEM_ID,
          world: this.worldPda,
          entities: [
            {
              entity: killerEntity.entityPda,
              components: [{ componentId: PLAYER_STATS_COMPONENT_ID }],
            },
            {
              entity: victimEntity.entityPda,
              components: [{ componentId: PLAYER_STATS_COMPONENT_ID }],
            },
          ],
          args: Buffer.from([1]),
        });

        const tx = await this.provider.sendAndConfirm(applySystem.transaction);
        successCount++;
        this._logEvent('kill', `${kill.killer.slice(0, 6)}... → ${kill.victim.slice(0, 6)}...`, tx, {
          killer: kill.killer,
          victim: kill.victim,
          status: 'confirmed',
        });
      } catch (err) {
        console.error(`MagicBlock: Kill tx failed (${kill.killer.slice(0, 6)} -> ${kill.victim.slice(0, 6)}):`, err.message);
        this._logEvent('error', `Kill tx failed: ${kill.killer.slice(0, 6)}→${kill.victim.slice(0, 6)}`, null, { error: err.message });
      }
      // Small delay between transactions to avoid rate limits
      await new Promise(r => setTimeout(r, 400));
    }

    this.batchStats.settled += successCount;
    this.batchStats.lastSettleTime = Date.now();
    console.log(`MagicBlock: Batch done — ${successCount}/${txList.length} confirmed (${remaining} still queued)`);
    this._logEvent('batch', `${successCount}/${txList.length} kills confirmed onchain`, null, { success: successCount, total: txList.length, remaining });

    // After settlement, sync onchain state back to inform the game
    if (successCount > 0 && this.onBatchSettled) {
      try {
        await this.onBatchSettled();
      } catch (err) {
        console.error('MagicBlock: onBatchSettled callback error:', err.message);
      }
    }

    this.isSettling = false;
  }

  // Register a callback to run after each successful batch settlement
  setOnBatchSettled(callback) {
    this.onBatchSettled = callback;
  }

  // Upgrade a player stat onchain (called from frontend when player chooses to upgrade)
  async upgradeStat(walletAddress, statType) {
    if (!this.ready) return false;

    try {
      const player = this.entityMap.get(walletAddress);
      if (!player) return false;

      const applySystem = await ApplySystem({
        authority: this.serverKeypair.publicKey,
        systemId: UPGRADE_STAT_SYSTEM_ID,
        world: this.worldPda,
        entities: [{
          entity: player.entityPda,
          components: [{ componentId: PLAYER_STATS_COMPONENT_ID }],
        }],
        args: Buffer.from([statType]), // 0=health, 1=shooting
      });

      const tx = await this.provider.sendAndConfirm(applySystem.transaction);
      const statName = statType === 0 ? 'Health' : 'Attack';
      console.log(`MagicBlock: Stat upgraded onchain! ${walletAddress.slice(0, 6)} type=${statType}`);
      this._logEvent('upgrade', `${walletAddress.slice(0, 8)}... upgraded ${statName}`, tx, { wallet: walletAddress, statType, statName });
      return true;
    } catch (err) {
      console.error('MagicBlock: upgradeStat failed:', err.message);
      this._logEvent('error', `Upgrade failed: ${err.message}`, null, { wallet: walletAddress });
      return false;
    }
  }

  // Read player stats from onchain
  async getPlayerStats(walletAddress) {
    if (!this.ready || !this.playerStatsProgram) return null;

    try {
      const player = this.entityMap.get(walletAddress);
      if (!player) return null;

      const account = await this.playerStatsProgram.account.playerStats.fetch(player.componentPda);
      return {
        walletAddress,
        xp: account.xp.toNumber(),
        kills: account.kills.toNumber(),
        deaths: account.deaths.toNumber(),
        healthLevel: account.healthLevel,
        shootingLevel: account.shootingLevel,
        holdStreakDays: account.holdStreakDays,
        totalBuys: account.totalBuys,
        totalSells: account.totalSells,
        initialized: account.initialized,
        lastUpdated: account.lastUpdated.toNumber(),
        entityPda: player.entityPda.toBase58(),
        componentPda: player.componentPda.toBase58(),
      };
    } catch (err) {
      console.error(`MagicBlock: getPlayerStats failed for ${walletAddress.slice(0, 8)}:`, err.message);
      return null;
    }
  }

  // Get all player stats (for the game state)
  async getAllPlayerStats() {
    if (!this.ready) return new Map();

    const stats = new Map();
    for (const [walletAddress] of this.entityMap) {
      const playerStats = await this.getPlayerStats(walletAddress);
      if (playerStats) {
        stats.set(walletAddress, playerStats);
      }
    }
    return stats;
  }

  // Get status info for displaying in the UI
  getStatus() {
    return {
      ready: this.ready,
      worldPda: this.worldPda?.toBase58() || null,
      playersOnchain: this.entityMap.size,
      killsPending: this.killBuffer.length,
      batchStats: { ...this.batchStats },
      eventLog: this.eventLog.slice(0, 100), // Last 100 events for the frontend
      rpc: DEVNET_RPC,
      programs: {
        playerStats: PLAYER_STATS_COMPONENT_ID.toBase58(),
        initPlayer: INIT_PLAYER_SYSTEM_ID.toBase58(),
        recordKill: RECORD_KILL_SYSTEM_ID.toBase58(),
        upgradeStat: UPGRADE_STAT_SYSTEM_ID.toBase58(),
      },
    };
  }
}

module.exports = { MagicBlockService };
