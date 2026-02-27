"use client";

import { motion, AnimatePresence } from "framer-motion";
import { Gift, X, ExternalLink } from "lucide-react";
import type { AirdropInfo } from "@/hooks/useAirdropChecker";

const STREAMFLOW_CLAIM_URL = "https://app.streamflow.finance/airdrops";

function formatTokenAmount(raw: number, decimals = 6): string {
  const amount = raw / 10 ** decimals;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(2)}M`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(1)}K`;
  return amount.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

interface AirdropBannerProps {
  airdropInfo: AirdropInfo;
  tokenDecimals?: number;
  tokenSymbol?: string;
}

export function AirdropBanner({
  airdropInfo,
  tokenDecimals = 6,
  tokenSymbol = "$WARZ",
}: AirdropBannerProps) {
  const { claims, totalUnclaimed, dismissed, dismiss } = airdropInfo;

  const show = claims.length > 0 && totalUnclaimed > 0 && !dismissed;

  return (
    <AnimatePresence>
      {show && (
        <>
          {/* Backdrop overlay */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm"
          />

          {/* Centered modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.85, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.9, y: 10 }}
            transition={{ type: "spring", stiffness: 300, damping: 25 }}
            className="fixed inset-0 z-50 flex items-center justify-center p-4"
          >
            <div className="relative w-full max-w-sm overflow-hidden rounded-2xl border border-emerald-500/40 bg-slate-900/95 backdrop-blur-xl shadow-2xl shadow-emerald-500/20">
              {/* Animated glow bar */}
              <div
                className="absolute inset-x-0 top-0 h-1"
                style={{
                  background:
                    "linear-gradient(90deg, transparent, #34d399, #a78bfa, #34d399, transparent)",
                  backgroundSize: "200% 100%",
                  animation: "shimmer 2s linear infinite",
                }}
              />

              {/* Close button */}
              <button
                onClick={dismiss}
                className="absolute top-3 right-3 z-10 rounded-lg p-1.5 text-slate-500 transition-colors hover:bg-slate-800 hover:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>

              <div className="flex flex-col items-center px-6 py-8 text-center">
                {/* Gift icon with glow */}
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-2xl bg-emerald-500/20 shadow-lg shadow-emerald-500/10">
                  <Gift className="h-8 w-8 text-emerald-400" />
                </div>

                <h2 className="text-lg font-bold text-emerald-400">
                  Unclaimed Airdrop!
                </h2>

                <p className="mt-2 text-sm text-slate-300">
                  You have{" "}
                  <span className="font-bold text-white">
                    {formatTokenAmount(totalUnclaimed, tokenDecimals)} {tokenSymbol}
                  </span>{" "}
                  waiting to be claimed
                </p>

                <a
                  href={STREAMFLOW_CLAIM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 inline-flex items-center gap-2 rounded-xl bg-emerald-500/20 px-5 py-2.5 text-sm font-semibold text-emerald-300 transition-all hover:bg-emerald-500/30 hover:text-emerald-200 hover:shadow-lg hover:shadow-emerald-500/10"
                >
                  Claim on Streamflow
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
