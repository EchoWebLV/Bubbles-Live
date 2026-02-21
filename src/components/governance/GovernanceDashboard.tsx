"use client";

import { useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  Wallet, Vote, Plus, RefreshCw, Shield, Swords, Zap, ChevronRight,
  ExternalLink, Loader2, ArrowLeft, Settings, TrendingUp, Users,
} from "lucide-react";
import { useGovernance } from "@/hooks/useGovernance";
import { ProposalCard } from "./ProposalCard";
import { CreateProposalModal } from "./CreateProposalModal";

export function GovernanceDashboard() {
  const { publicKey, connected, disconnect } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const {
    status, voterInfo, loading, error, submitting,
    activeProposals, passedProposals,
    depositTokens, withdrawTokens, createProposal, castVote, refresh,
  } = useGovernance();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [filter, setFilter] = useState<"all" | "active" | "passed" | "other">("all");

  const walletAddress = publicKey?.toBase58() || null;

  const handleVote = useCallback(async (pubkey: string, approve: boolean) => {
    await castVote(pubkey, approve);
  }, [castVote]);

  const handleCreateProposal = useCallback(async (
    name: string,
    metadata: { type: string; key: string; value: number; description?: string },
  ) => {
    return await createProposal(name, metadata);
  }, [createProposal]);

  const filteredProposals = status?.proposals.filter(p => {
    if (filter === "active") return p.stateLabel === "Voting";
    if (filter === "passed") return ["Completed", "Succeeded", "Executing"].includes(p.stateLabel);
    if (filter === "other") return !["Voting", "Completed", "Succeeded", "Executing"].includes(p.stateLabel);
    return true;
  }) || [];

  const hasDeposited = voterInfo?.hasRecord && Number(voterInfo.deposited || "0") > 0;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950/20 to-slate-950">
      {/* Synthwave grid bg */}
      <div
        className="fixed inset-0 opacity-[0.04] pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(168,85,247,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(168,85,247,0.5) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      <div className="relative z-10 max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10">
        {/* Header */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
          <div>
            <a
              href="/"
              className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-purple-400 transition-colors mb-3"
            >
              <ArrowLeft className="w-3 h-3" />
              Back to Arena
            </a>
            <h1
              className="text-2xl sm:text-3xl font-black tracking-wider"
              style={{
                background: "linear-gradient(90deg, #a78bfa, #60a5fa, #a78bfa)",
                backgroundSize: "200% auto",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                backgroundClip: "text",
              }}
            >
              $WARZ Governance
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              Token holders govern the arena. Your bags = your voting power.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={refresh}
              className="p-2 rounded-lg bg-slate-900/80 border border-slate-700/50 text-slate-400 hover:text-white transition-colors"
              title="Refresh"
            >
              <RefreshCw className="w-4 h-4" />
            </button>

            {connected && walletAddress ? (
              <button
                onClick={() => disconnect()}
                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900/80 border border-purple-500/50 text-purple-300 hover:border-purple-400/70 transition-colors"
              >
                <Wallet className="w-4 h-4" />
                <span className="text-xs font-mono">{walletAddress.slice(0, 4)}..{walletAddress.slice(-4)}</span>
              </button>
            ) : (
              <button
                onClick={() => setWalletModalVisible(true)}
                className="flex items-center gap-2 px-5 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white font-medium text-sm transition-colors"
              >
                <Wallet className="w-4 h-4" />
                Connect Wallet
              </button>
            )}
          </div>
        </div>

        {/* Loading state */}
        {loading && (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-purple-500 animate-spin" />
          </div>
        )}

        {/* Not initialized state */}
        {!loading && !status?.initialized && (
          <div className="text-center py-16">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-900 border border-slate-700 mb-4">
              <Shield className="w-8 h-8 text-slate-500" />
            </div>
            <h2 className="text-xl font-bold text-white mb-2">Governance Not Active</h2>
            <p className="text-sm text-slate-400 max-w-md mx-auto mb-6">
              The $WARZ Realms DAO has not been set up yet. Once the Realm is created,
              token holders will be able to vote on game parameters, season resets, and balance changes.
            </p>
            <div className="bg-slate-900/80 border border-slate-700/50 rounded-xl p-6 max-w-lg mx-auto text-left">
              <h3 className="text-sm font-bold text-white mb-3 flex items-center gap-2">
                <Settings className="w-4 h-4 text-purple-400" />
                Setup Guide
              </h3>
              <ol className="space-y-2 text-xs text-slate-400">
                <li className="flex gap-2">
                  <span className="text-purple-400 font-bold shrink-0">1.</span>
                  Run <code className="text-purple-300 bg-slate-800 px-1.5 py-0.5 rounded">node scripts/setup-realm.js</code> to create the Realm
                </li>
                <li className="flex gap-2">
                  <span className="text-purple-400 font-bold shrink-0">2.</span>
                  Copy the Realm address and set <code className="text-purple-300 bg-slate-800 px-1.5 py-0.5 rounded">GOVERNANCE_REALM_ADDRESS</code> in your .env.local
                </li>
                <li className="flex gap-2">
                  <span className="text-purple-400 font-bold shrink-0">3.</span>
                  Restart the server — governance will auto-initialize
                </li>
              </ol>
            </div>

            {/* Show what will be governable */}
            <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-2xl mx-auto">
              <div className="bg-slate-900/60 border border-red-500/20 rounded-xl p-4">
                <Swords className="w-5 h-5 text-red-400 mb-2" />
                <h4 className="text-sm font-bold text-white">Battle Config</h4>
                <p className="text-[11px] text-slate-400 mt-1">Fire rate, bullet damage, bullet speed, respawn timers</p>
              </div>
              <div className="bg-slate-900/60 border border-blue-500/20 rounded-xl p-4">
                <Zap className="w-5 h-5 text-blue-400 mb-2" />
                <h4 className="text-sm font-bold text-white">Physics</h4>
                <p className="text-[11px] text-slate-400 mt-1">Movement speed, collision, bounce, repulsion</p>
              </div>
              <div className="bg-slate-900/60 border border-purple-500/20 rounded-xl p-4">
                <TrendingUp className="w-5 h-5 text-purple-400 mb-2" />
                <h4 className="text-sm font-bold text-white">Progression</h4>
                <p className="text-[11px] text-slate-400 mt-1">XP per kill, HP per level, damage scaling</p>
              </div>
            </div>
          </div>
        )}

        {/* Initialized state */}
        {!loading && status?.initialized && (
          <>
            {/* Stats bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
              <div className="bg-slate-900/80 border border-slate-700/50 rounded-xl p-4">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Realm</div>
                <div className="text-sm font-bold text-white truncate">{status.realm?.name}</div>
                <a
                  href={`https://app.realms.today/dao/${status.realm?.address}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[10px] text-purple-400 hover:text-purple-300 flex items-center gap-1 mt-1"
                >
                  View on Realms <ExternalLink className="w-2.5 h-2.5" />
                </a>
              </div>

              <div className="bg-slate-900/80 border border-blue-500/20 rounded-xl p-4">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Active Votes</div>
                <div className="text-2xl font-black text-blue-400">{status.stats.activeProposals}</div>
              </div>

              <div className="bg-slate-900/80 border border-green-500/20 rounded-xl p-4">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Passed</div>
                <div className="text-2xl font-black text-green-400">{status.stats.passedProposals}</div>
              </div>

              <div className="bg-slate-900/80 border border-amber-500/20 rounded-xl p-4">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Config Overrides</div>
                <div className="text-2xl font-black text-amber-400">{status.stats.appliedOverrides}</div>
              </div>
            </div>

            {/* Voter panel */}
            {connected && walletAddress && (
              <div className="bg-slate-900/80 border border-purple-500/20 rounded-xl p-4 mb-6">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-white flex items-center gap-2">
                      <Users className="w-4 h-4 text-purple-400" />
                      Your Voting Power
                    </h3>
                    <p className="text-xs text-slate-400 mt-0.5">
                      {hasDeposited
                        ? `${BigInt(voterInfo!.deposited).toLocaleString()} tokens deposited`
                        : "Deposit $WARZ tokens to vote on proposals"
                      }
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {!hasDeposited && (
                      <p className="text-[10px] text-slate-500 max-w-[200px]">
                        Deposit via{" "}
                        <a
                          href={`https://app.realms.today/dao/${status.realm?.address}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-purple-400 hover:text-purple-300"
                        >
                          Realms UI
                        </a>
                      </p>
                    )}
                    <button
                      onClick={() => setShowCreateModal(true)}
                      disabled={!hasDeposited || submitting}
                      className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-xs font-medium bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      New Proposal
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Active config overrides */}
            {Object.keys(status.configOverrides).length > 0 && (
              <div className="bg-slate-900/60 border border-amber-500/20 rounded-xl p-4 mb-6">
                <h3 className="text-sm font-bold text-amber-400 mb-3 flex items-center gap-2">
                  <Settings className="w-4 h-4" />
                  Active Governance Overrides
                </h3>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {Object.entries(status.configOverrides).map(([type, overrides]) =>
                    Object.entries(overrides).map(([key, value]) => (
                      <div key={`${type}-${key}`} className="flex items-center justify-between bg-slate-800/50 rounded-lg px-3 py-2">
                        <div>
                          <span className="text-[10px] text-slate-500">{type}</span>
                          <div className="text-xs font-mono text-white">{key}</div>
                        </div>
                        <span className="text-sm font-bold text-amber-400">{String(value)}</span>
                      </div>
                    ))
                  )}
                </div>
              </div>
            )}

            {/* Filter tabs */}
            <div className="flex items-center gap-1 mb-4 overflow-x-auto">
              {(["all", "active", "passed", "other"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition-colors ${
                    filter === f
                      ? "bg-purple-500/20 border border-purple-500/40 text-purple-300"
                      : "bg-slate-800/50 border border-slate-700/30 text-slate-400 hover:text-white"
                  }`}
                >
                  {f === "all" && `All (${status.proposals.length})`}
                  {f === "active" && `Active (${activeProposals.length})`}
                  {f === "passed" && `Passed (${passedProposals.length})`}
                  {f === "other" && "Other"}
                </button>
              ))}
            </div>

            {/* Proposals */}
            {filteredProposals.length === 0 ? (
              <div className="text-center py-12">
                <Vote className="w-10 h-10 text-slate-600 mx-auto mb-3" />
                <p className="text-sm text-slate-400">
                  {filter === "all"
                    ? "No proposals yet. Be the first to shape the arena."
                    : `No ${filter} proposals.`
                  }
                </p>
              </div>
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {filteredProposals.map(proposal => (
                  <ProposalCard
                    key={proposal.pubkey}
                    proposal={proposal}
                    onVote={handleVote}
                    canVote={!!hasDeposited}
                    voting={submitting}
                  />
                ))}
              </div>
            )}
          </>
        )}

        {/* Footer */}
        <div className="mt-12 pt-6 border-t border-slate-800/50 flex items-center justify-between text-[10px] text-slate-600">
          <span>Powered by Realms (SPL Governance)</span>
          <a
            href="https://docs.realms.today/"
            target="_blank"
            rel="noopener noreferrer"
            className="hover:text-slate-400 transition-colors flex items-center gap-1"
          >
            Docs <ExternalLink className="w-2.5 h-2.5" />
          </a>
        </div>
      </div>

      {/* Create Proposal Modal */}
      <CreateProposalModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSubmit={handleCreateProposal}
        configurableKeys={status?.configurableKeys || {}}
        submitting={submitting}
      />
    </div>
  );
}
