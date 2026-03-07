"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Trophy, X, ExternalLink } from "lucide-react";
import type { SeasonPlacementInfo } from "@/hooks/useSeasonPlacement";

const RANK_LABELS: Record<number, { emoji: string; label: string; color: string }> = {
  1: { emoji: "🥇", label: "1st Place", color: "#facc15" },
  2: { emoji: "🥈", label: "2nd Place", color: "#94a3b8" },
  3: { emoji: "🥉", label: "3rd Place", color: "#d97706" },
  4: { emoji: "🏅", label: "4th Place", color: "#a78bfa" },
  5: { emoji: "🏅", label: "5th Place", color: "#a78bfa" },
  6: { emoji: "⭐", label: "6th Place", color: "#60a5fa" },
  7: { emoji: "⭐", label: "7th Place", color: "#60a5fa" },
  8: { emoji: "⭐", label: "8th Place", color: "#60a5fa" },
  9: { emoji: "⭐", label: "9th Place", color: "#60a5fa" },
  10: { emoji: "⭐", label: "10th Place", color: "#60a5fa" },
};

interface SeasonPlacementPopupProps {
  placement: SeasonPlacementInfo;
}

export function SeasonPlacementPopup({ placement }: SeasonPlacementPopupProps) {
  const { myEntry, dismissed, dismiss } = placement;

  const show = !!myEntry && !dismissed;
  const rankInfo = myEntry
    ? RANK_LABELS[myEntry.place] || { emoji: "⭐", label: `#${myEntry.place}`, color: "#60a5fa" }
    : null;

  return (
    <AnimatePresence>
      {show && myEntry && rankInfo && (
        <>
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
            onClick={dismiss}
          />

          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-amber-500/40 bg-slate-900/95 backdrop-blur-xl shadow-2xl shadow-amber-500/20">
              <div
                className="absolute inset-x-0 top-0 h-1"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, #facc15, #f59e0b, #facc15, transparent)",
                  backgroundSize: "200% 100%",
                  animation: "shimmer 2s linear infinite",
                }}
              />

              <button
                onClick={dismiss}
                className="absolute top-3 right-3 z-10 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex flex-col items-center px-6 py-8 text-center">
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-500/20 shadow-lg shadow-amber-500/10">
                  <Trophy className="h-8 w-8 text-amber-400" />
                </div>

                <h2 className="text-lg font-bold text-amber-400">
                  Season {myEntry.seasonNumber} Complete!
                </h2>

                <div className="mt-3 flex flex-col items-center gap-1">
                  <div className="flex items-center gap-2">
                    <span className="text-3xl">{rankInfo.emoji}</span>
                    <span
                      className="text-xl font-bold"
                      style={{ color: rankInfo.color }}
                    >
                      {rankInfo.label}
                    </span>
                  </div>

                  <div className="mt-2 flex items-center gap-3 text-sm text-slate-400">
                    <span>
                      Lv. <span className="font-bold text-white">{myEntry.level}</span>
                    </span>
                    <span className="text-slate-600">|</span>
                    <span>
                      <span className="font-bold text-red-400">{myEntry.kills}</span> kills
                    </span>
                  </div>
                </div>

                <p className="mt-4 text-sm text-slate-400">
                  Your placement has been recorded on-chain permanently.
                </p>

                <a
                  href="/rewards"
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-amber-500/20 px-5 py-2.5 text-sm font-semibold text-amber-300 transition-all hover:bg-amber-500/30 hover:text-amber-200"
                >
                  View Season History
                  <ExternalLink className="h-4 w-4" />
                </a>

                <button
                  onClick={dismiss}
                  className="mt-3 text-xs text-slate-500 transition-colors hover:text-slate-400"
                >
                  Dismiss
                </button>
              </div>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
