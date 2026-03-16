"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { ArrowLeft, Loader2, Trophy, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useSeasonHistory, type SeasonRecord } from "@/hooks/useSeasonHistory";
import { Wallet } from "lucide-react";

const COMBAT_PROGRAM_ID = process.env.NEXT_PUBLIC_COMBAT_PROGRAM_ID || "AyQ8ZnxYyFxYiHmxjFXs3ptgPvrSKi4WWfxhfLqccFsw";

function formatDate(unixSecs: number): string {
  if (!unixSecs) return "—";
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PLACE_EMOJI = ["🥇", "🥈", "🥉", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
const PLACE_COLORS = [
  "text-yellow-400", "text-slate-300", "text-amber-600",
  "text-slate-400", "text-slate-400",
  "text-slate-500", "text-slate-500", "text-slate-500", "text-slate-500", "text-slate-500",
];

function SeasonCard({ season, connectedWallet }: { season: SeasonRecord; connectedWallet: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const preview = season.entries.slice(0, 3);
  const rest = season.entries.slice(3);

  return (
    <div className="bg-slate-800/40 rounded-lg border border-slate-700/40 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between border-b border-slate-700/30 hover:bg-slate-800/60 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white">Season {season.seasonNumber}</span>
          <span className="text-xs text-slate-500">{formatDate(season.finalizedAt)}</span>
          <span className="text-xs text-slate-400">{season.entryCount} players</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        )}
      </button>

      <div className="divide-y divide-slate-700/20">
        {preview.map((entry, i) => {
          const isMe = connectedWallet && entry.wallet === connectedWallet;
          return (
            <div
              key={entry.wallet}
              className={`flex items-center gap-3 px-4 py-2 text-sm ${isMe ? "bg-purple-500/10" : ""}`}
            >
              <span className={`w-8 font-bold text-right ${PLACE_COLORS[i]}`}>
                {PLACE_EMOJI[i]}
              </span>
              <span className="font-mono text-slate-300 truncate flex-1">
                {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                {isMe && <span className="ml-1 text-purple-400 text-xs">(you)</span>}
              </span>
              <span className="text-xs text-slate-400 tabular-nums w-12 text-right">Lv.{entry.level}</span>
              <span className="text-xs text-yellow-400 tabular-nums w-16 text-right">{entry.kills} kills</span>
            </div>
          );
        })}

        {expanded && rest.map((entry, i) => {
          const idx = i + 3;
          const isMe = connectedWallet && entry.wallet === connectedWallet;
          return (
            <div
              key={entry.wallet}
              className={`flex items-center gap-3 px-4 py-2 text-sm ${isMe ? "bg-purple-500/10" : ""}`}
            >
              <span className={`w-8 font-bold text-right ${PLACE_COLORS[idx] || "text-slate-500"}`}>
                {PLACE_EMOJI[idx]}
              </span>
              <span className="font-mono text-slate-300 truncate flex-1">
                {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                {isMe && <span className="ml-1 text-purple-400 text-xs">(you)</span>}
              </span>
              <span className="text-xs text-slate-400 tabular-nums w-12 text-right">Lv.{entry.level}</span>
              <span className="text-xs text-yellow-400 tabular-nums w-16 text-right">{entry.kills} kills</span>
            </div>
          );
        })}
      </div>

      {!expanded && rest.length > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full text-center text-xs text-slate-500 hover:text-slate-400 py-2 transition-colors"
        >
          +{rest.length} more
        </button>
      )}
    </div>
  );
}

export function RewardsPortal() {
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();

  const { seasons, isLoading: isLoadingSeasons, currentSeason } = useSeasonHistory(undefined, 10);
  const connectedWallet = publicKey?.toBase58() ?? null;

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950/30 to-slate-950">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <a href="/arena" className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </a>
          <div>
            <h1 className="text-2xl font-bold text-white">$WARZ Season Records</h1>
            <p className="text-sm text-slate-400">On-chain leaderboard history — top 10 killers each season</p>
          </div>
        </div>

        {/* Connect wallet to highlight your placement */}
        {!connected && (
          <Card>
            <CardContent className="pt-6 flex flex-col items-center gap-4">
              <Wallet className="w-10 h-10 text-purple-400" />
              <p className="text-slate-300 text-sm text-center">Connect your wallet to see if you placed in any season</p>
              <Button onClick={() => setVisible(true)} className="gap-2">
                <Wallet className="w-4 h-4" /> Connect Wallet
              </Button>
            </CardContent>
          </Card>
        )}

        {/* How it works */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">How It Works</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/30">
                <div className="text-emerald-400 font-bold mb-1">Every 24 hours</div>
                <div className="text-slate-400 text-xs">The season auto-resets and the top 10 killers are permanently recorded on Solana</div>
              </div>
              <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/30">
                <div className="text-yellow-400 font-bold mb-1">On-Chain Records</div>
                <div className="text-slate-400 text-xs">Each season&apos;s leaderboard is stored as a PDA on Solana devnet — permanent and verifiable</div>
              </div>
              <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/30">
                <div className="text-blue-400 font-bold mb-1">Top 10 Tracked</div>
                <div className="text-slate-400 text-xs">Wallet, kills, level, and placement are all recorded for each season&apos;s best players</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Season History */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-400" /> Season History
            </CardTitle>
            <CardDescription>
              {isLoadingSeasons
                ? "Loading on-chain records..."
                : seasons.length > 0
                  ? `${seasons.length} season${seasons.length !== 1 ? "s" : ""} recorded on Solana devnet${currentSeason ? ` (current: S${currentSeason})` : ""}`
                  : "No seasons finalized yet"}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {seasons.length === 0 && !isLoadingSeasons && (
              <p className="text-sm text-slate-500 text-center py-4">No seasons finalized yet</p>
            )}
            {isLoadingSeasons && (
              <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Reading on-chain leaderboards...</span>
              </div>
            )}
            {seasons.map((s) => (
              <SeasonCard key={s.seasonNumber} season={s} connectedWallet={connectedWallet} />
            ))}
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-slate-600 pb-8">
          Combat Program: {COMBAT_PROGRAM_ID.slice(0, 12)}... (devnet)
        </div>
      </div>
    </div>
  );
}
