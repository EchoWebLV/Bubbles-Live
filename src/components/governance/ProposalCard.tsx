"use client";

import { useState } from "react";
import { CheckCircle, XCircle, Clock, Loader2, Award, Zap } from "lucide-react";
import type { GovernanceProposal } from "@/hooks/useGovernance";

const STATE_STYLES: Record<string, { bg: string; border: string; text: string; icon: React.ReactNode }> = {
  Voting: {
    bg: "bg-blue-500/10",
    border: "border-blue-500/30",
    text: "text-blue-400",
    icon: <Clock className="w-3.5 h-3.5" />,
  },
  Completed: {
    bg: "bg-green-500/10",
    border: "border-green-500/30",
    text: "text-green-400",
    icon: <CheckCircle className="w-3.5 h-3.5" />,
  },
  Succeeded: {
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/30",
    text: "text-emerald-400",
    icon: <CheckCircle className="w-3.5 h-3.5" />,
  },
  Executing: {
    bg: "bg-amber-500/10",
    border: "border-amber-500/30",
    text: "text-amber-400",
    icon: <Zap className="w-3.5 h-3.5" />,
  },
  Defeated: {
    bg: "bg-red-500/10",
    border: "border-red-500/30",
    text: "text-red-400",
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  Cancelled: {
    bg: "bg-slate-500/10",
    border: "border-slate-500/30",
    text: "text-slate-400",
    icon: <XCircle className="w-3.5 h-3.5" />,
  },
  Draft: {
    bg: "bg-slate-500/10",
    border: "border-slate-600/30",
    text: "text-slate-400",
    icon: <Clock className="w-3.5 h-3.5" />,
  },
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  battle_config: { label: "Battle", color: "text-red-400" },
  physics_config: { label: "Physics", color: "text-blue-400" },
  progression: { label: "Progression", color: "text-purple-400" },
  season_reset: { label: "Season", color: "text-amber-400" },
  custom: { label: "Custom", color: "text-slate-400" },
};

function formatVotes(value: string): string {
  const num = Number(value);
  if (num >= 1_000_000_000) return `${(num / 1e9).toFixed(1)}B`;
  if (num >= 1_000_000) return `${(num / 1e6).toFixed(1)}M`;
  if (num >= 1_000) return `${(num / 1e3).toFixed(1)}K`;
  return value;
}

function formatTimestamp(ts: number): string {
  if (!ts) return "—";
  const date = new Date(ts * 1000);
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

interface ProposalCardProps {
  proposal: GovernanceProposal;
  onVote?: (pubkey: string, approve: boolean) => void;
  canVote: boolean;
  voting: boolean;
}

export function ProposalCard({ proposal, onVote, canVote, voting }: ProposalCardProps) {
  const style = STATE_STYLES[proposal.stateLabel] || STATE_STYLES.Draft;
  const typeInfo = proposal.metadata ? TYPE_LABELS[proposal.metadata.type] || TYPE_LABELS.custom : null;

  const yesNum = Number(proposal.yesVotes);
  const noNum = Number(proposal.noVotes);
  const totalVotes = yesNum + noNum;
  const yesPercent = totalVotes > 0 ? Math.round((yesNum * 100) / totalVotes) : 0;
  const isVoting = proposal.stateLabel === "Voting";

  return (
    <div className={`rounded-xl border ${style.border} ${style.bg} p-4 transition-all hover:brightness-110`}>
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-bold text-white truncate">{proposal.name}</h3>
          <div className="flex items-center gap-2 mt-1">
            <span className={`inline-flex items-center gap-1 text-[10px] font-medium ${style.text}`}>
              {style.icon}
              {proposal.stateLabel}
            </span>
            {typeInfo && (
              <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded-full bg-slate-800/50 ${typeInfo.color}`}>
                {typeInfo.label}
              </span>
            )}
          </div>
        </div>
        {proposal.metadata && (
          <div className="text-right shrink-0">
            <div className="text-[10px] text-slate-500">Change</div>
            <div className="text-xs font-mono text-white">
              {proposal.metadata.key} → {proposal.metadata.value}
            </div>
          </div>
        )}
      </div>

      {/* Vote bar */}
      {totalVotes > 0 && (
        <div className="mb-3">
          <div className="flex items-center justify-between text-[10px] mb-1">
            <span className="text-green-400">Yes: {formatVotes(proposal.yesVotes)} ({yesPercent}%)</span>
            <span className="text-red-400">No: {formatVotes(proposal.noVotes)} ({100 - yesPercent}%)</span>
          </div>
          <div className="h-1.5 bg-slate-800 rounded-full overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-green-500 to-green-400 rounded-full transition-all duration-500"
              style={{ width: `${yesPercent}%` }}
            />
          </div>
        </div>
      )}

      {/* Metadata */}
      {proposal.metadata?.description && (
        <p className="text-[11px] text-slate-400 mb-3 leading-relaxed">
          {proposal.metadata.description}
        </p>
      )}

      {/* Timestamps */}
      <div className="flex items-center gap-3 text-[10px] text-slate-500 mb-3">
        {proposal.draftAt > 0 && <span>Created: {formatTimestamp(proposal.draftAt)}</span>}
        {proposal.votingAt > 0 && <span>Voting: {formatTimestamp(proposal.votingAt)}</span>}
        {proposal.votingCompletedAt > 0 && <span>Ended: {formatTimestamp(proposal.votingCompletedAt)}</span>}
      </div>

      {/* Vote buttons */}
      {isVoting && canVote && onVote && (
        <div className="flex items-center gap-2">
          <button
            onClick={() => onVote(proposal.pubkey, true)}
            disabled={voting}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-green-500/15 border border-green-500/30 text-green-400 hover:bg-green-500/25 transition-colors disabled:opacity-50"
          >
            {voting ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
            Approve
          </button>
          <button
            onClick={() => onVote(proposal.pubkey, false)}
            disabled={voting}
            className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-red-500/15 border border-red-500/30 text-red-400 hover:bg-red-500/25 transition-colors disabled:opacity-50"
          >
            {voting ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
            Reject
          </button>
        </div>
      )}

      {/* Pubkey */}
      <div className="mt-2 text-[9px] text-slate-600 font-mono truncate">
        {proposal.pubkey}
      </div>
    </div>
  );
}
