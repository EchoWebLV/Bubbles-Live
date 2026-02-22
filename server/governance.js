// Governance module — reads Realms DAO proposals and exposes config overrides.
// Runs independently of gameState; the game loop can read `getConfigOverrides()`
// to pick up parameter changes passed through governance.

const { Connection, PublicKey } = require('@solana/web3.js');
const {
  getRealm,
  getAllGovernances,
  getAllProposals,
  getTokenOwnerRecordsByOwner,
  getGovernanceAccounts,
  pubkeyFilter,
  Governance,
  Proposal,
  ProposalState,
} = require('@solana/spl-governance');

const SPL_GOVERNANCE_PROGRAM_ID = new PublicKey('GovER5Lthms3bLBqWub97yVrMmEogzX7xNjdXpPPCVZw');

// Proposal metadata is JSON-encoded in the description link.
// Format: { "type": "battle_config", "key": "fireRate", "value": 150 }
function parseProposalMetadata(descriptionLink) {
  try {
    if (!descriptionLink) return null;
    const parsed = JSON.parse(descriptionLink);
    if (parsed && parsed.type && parsed.key !== undefined) return parsed;
    return null;
  } catch {
    return null;
  }
}

const CONFIGURABLE_KEYS = {
  battle_config: [
    'maxHealth', 'bulletDamage', 'fireRate', 'bulletSpeed',
    'ghostBaseMs', 'ghostPerLevelMs',
  ],
  physics_config: [
    'minSpeed', 'maxSpeed', 'velocityDecay', 'wallBounce',
    'repulsionRange', 'repulsionStrength', 'nudgeInterval', 'nudgeStrength',
  ],
  progression: [
    'xpPerKillBase', 'xpPerKillPerLevel', 'xpPerDeath',
    'healthPerLevel', 'damagePerLevel', 'baseHealth', 'baseDamage',
  ],
};

class GovernanceManager {
  constructor() {
    this.realmPk = null;
    this.connection = null;
    this.isInitialized = false;
    this.proposals = [];
    this.configOverrides = {};
    this.appliedProposals = new Set();
    this.pollInterval = null;
    this.lastPollTime = 0;
    this.realmInfo = null;
    this.governances = [];
    this.stats = {
      totalProposals: 0,
      activeProposals: 0,
      passedProposals: 0,
      appliedOverrides: 0,
    };
  }

  async initialize() {
    const realmAddress = process.env.GOVERNANCE_REALM_ADDRESS;
    if (!realmAddress) {
      console.log('Governance: No GOVERNANCE_REALM_ADDRESS set — governance disabled');
      return false;
    }

    const rpcUrl = process.env.HELIUS_API_KEY
      ? `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY}`
      : 'https://api.mainnet-beta.solana.com';

    try {
      this.realmPk = new PublicKey(realmAddress);
      this.connection = new Connection(rpcUrl, 'confirmed');

      this.realmInfo = await getRealm(this.connection, this.realmPk);
      console.log('Governance: Connected to Realm:', this.realmInfo.account.name);
      console.log('Governance: Community Mint:', this.realmInfo.account.communityMint.toBase58());

      this.isInitialized = true;
      await this.pollProposals();
      return true;
    } catch (err) {
      console.error('Governance: Init failed:', err.message);
      return false;
    }
  }

  startPolling(intervalMs = 30000) {
    if (this.pollInterval) clearInterval(this.pollInterval);
    this.pollInterval = setInterval(() => this.pollProposals(), intervalMs);
    console.log(`Governance: Polling every ${intervalMs / 1000}s`);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  async pollProposals() {
    if (!this.isInitialized) return;

    try {
      this.governances = await getAllGovernances(
        this.connection,
        SPL_GOVERNANCE_PROGRAM_ID,
        this.realmPk,
      );

      const allProposals = [];
      for (const gov of this.governances) {
        const proposals = await getAllProposals(
          this.connection,
          SPL_GOVERNANCE_PROGRAM_ID,
          gov.pubkey,
        );
        allProposals.push(...proposals);
      }

      this.proposals = allProposals.map(p => ({
        pubkey: p.pubkey.toBase58(),
        name: p.account.name,
        descriptionLink: p.account.descriptionLink || '',
        state: p.account.state,
        stateLabel: this._stateLabel(p.account.state),
        yesVotes: p.account.getYesVoteCount().toString(),
        noVotes: p.account.getNoVoteCount().toString(),
        draftAt: p.account.draftAt?.toNumber() || 0,
        votingAt: p.account.votingAt?.toNumber() || 0,
        votingCompletedAt: p.account.votingCompletedAt?.toNumber() || 0,
        metadata: parseProposalMetadata(p.account.descriptionLink),
      }));

      this.proposals.sort((a, b) => b.draftAt - a.draftAt);

      // Apply passed config proposals
      let newOverrides = {};
      let appliedCount = 0;
      for (const prop of this.proposals) {
        if (prop.state !== ProposalState.Completed && prop.state !== ProposalState.Executing) continue;
        if (!prop.metadata) continue;

        const { type, key, value } = prop.metadata;
        const allowedKeys = CONFIGURABLE_KEYS[type];
        if (!allowedKeys || !allowedKeys.includes(key)) continue;

        if (!newOverrides[type]) newOverrides[type] = {};
        // First completed proposal for a key wins (most recent first due to sort)
        if (newOverrides[type][key] === undefined) {
          newOverrides[type][key] = value;
          appliedCount++;
        }
      }

      this.configOverrides = newOverrides;

      const active = this.proposals.filter(p => p.state === ProposalState.Voting).length;
      this.stats = {
        totalProposals: this.proposals.length,
        activeProposals: active,
        passedProposals: this.proposals.filter(
          p => p.state === ProposalState.Completed || p.state === ProposalState.Executing
        ).length,
        appliedOverrides: appliedCount,
      };

      this.lastPollTime = Date.now();
    } catch (err) {
      console.error('Governance: Poll error:', err.message);
    }
  }

  _stateLabel(state) {
    const labels = {
      [ProposalState.Draft]: 'Draft',
      [ProposalState.SigningOff]: 'Signing Off',
      [ProposalState.Voting]: 'Voting',
      [ProposalState.Succeeded]: 'Succeeded',
      [ProposalState.Executing]: 'Executing',
      [ProposalState.Completed]: 'Completed',
      [ProposalState.Cancelled]: 'Cancelled',
      [ProposalState.Defeated]: 'Defeated',
      [ProposalState.ExecutingWithErrors]: 'Executing (Errors)',
    };
    return labels[state] || 'Unknown';
  }

  getConfigOverrides() {
    return { ...this.configOverrides };
  }

  getStatus() {
    return {
      initialized: this.isInitialized,
      realm: this.realmInfo ? {
        name: this.realmInfo.account.name,
        address: this.realmPk?.toBase58() || null,
        communityMint: this.realmInfo.account.communityMint.toBase58(),
      } : null,
      proposals: this.proposals,
      stats: this.stats,
      configOverrides: this.configOverrides,
      lastPollTime: this.lastPollTime,
      configurableKeys: CONFIGURABLE_KEYS,
    };
  }

  // Get voter info for a specific wallet
  async getVoterInfo(walletAddress) {
    if (!this.isInitialized) return null;
    try {
      const wallet = new PublicKey(walletAddress);
      const records = await getTokenOwnerRecordsByOwner(
        this.connection,
        SPL_GOVERNANCE_PROGRAM_ID,
        wallet,
      );

      const realmRecords = records.filter(
        r => r.account.realm.toBase58() === this.realmPk.toBase58()
      );

      if (realmRecords.length === 0) return { deposited: '0', hasRecord: false };

      const record = realmRecords[0];
      return {
        hasRecord: true,
        deposited: record.account.governingTokenDepositAmount.toString(),
        pubkey: record.pubkey.toBase58(),
        unrelinquishedVotes: record.account.unrelinquishedVotesCount,
      };
    } catch (err) {
      console.error('Governance: getVoterInfo error:', err.message);
      return null;
    }
  }
}

module.exports = { GovernanceManager, CONFIGURABLE_KEYS, SPL_GOVERNANCE_PROGRAM_ID };
