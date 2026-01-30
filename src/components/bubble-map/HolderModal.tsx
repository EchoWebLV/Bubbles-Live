"use client";

import { motion } from "framer-motion";
import { ExternalLink, Copy, Check, Wallet, TrendingUp, Percent } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Holder, TokenInfo } from "./types";
import { shortenAddress, formatNumber, formatPercentage } from "@/lib/utils";

interface HolderModalProps {
  holder: Holder | null;
  token: TokenInfo | null;
  onClose: () => void;
}

export function HolderModal({ holder, token, onClose }: HolderModalProps) {
  const [copied, setCopied] = useState(false);

  if (!holder) return null;

  const handleCopyAddress = async () => {
    await navigator.clipboard.writeText(holder.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const solscanUrl = `https://solscan.io/account/${holder.address}`;
  const solanaFmUrl = `https://solana.fm/address/${holder.address}`;

  return (
    <Dialog open={!!holder} onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ backgroundColor: holder.color }}
            >
              <Wallet className="w-6 h-6 text-white" />
            </motion.div>
            <div>
              <div className="font-mono text-lg">{shortenAddress(holder.address, 6)}</div>
              <DialogDescription className="text-sm">
                {token ? `${token.symbol} Holder` : "Token Holder"}
              </DialogDescription>
            </div>
          </DialogTitle>
        </DialogHeader>

        <div className="mt-6 space-y-4">
          {/* Stats Cards */}
          <div className="grid grid-cols-2 gap-4">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.1 }}
              className="bg-slate-800/50 rounded-xl p-4 border border-slate-700"
            >
              <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                <Percent className="w-4 h-4" />
                Ownership
              </div>
              <div className="text-2xl font-bold text-white">
                {formatPercentage(holder.percentage)}
              </div>
            </motion.div>

            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 }}
              className="bg-slate-800/50 rounded-xl p-4 border border-slate-700"
            >
              <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                <TrendingUp className="w-4 h-4" />
                Balance
              </div>
              <div className="text-2xl font-bold text-white">
                {formatNumber(holder.balance / Math.pow(10, token?.decimals || 9))}
              </div>
              {token && (
                <div className="text-xs text-slate-500 mt-1">{token.symbol}</div>
              )}
            </motion.div>
          </div>

          {/* Holder Category */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2 }}
            className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-xl p-4 border border-purple-500/20"
          >
            <div className="text-sm text-slate-400 mb-1">Holder Category</div>
            <div className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full"
                style={{ backgroundColor: holder.color }}
              />
              <span className="font-medium text-white">
                {getHolderCategory(holder.percentage)}
              </span>
            </div>
          </motion.div>

          {/* Full Address */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.25 }}
            className="bg-slate-800/50 rounded-xl p-4 border border-slate-700"
          >
            <div className="text-sm text-slate-400 mb-2">Wallet Address</div>
            <div className="flex items-center gap-2">
              <code className="text-xs text-slate-300 bg-slate-900 px-2 py-1 rounded flex-1 overflow-hidden text-ellipsis">
                {holder.address}
              </code>
              <Button
                size="icon"
                variant="ghost"
                className="h-8 w-8 shrink-0"
                onClick={handleCopyAddress}
              >
                {copied ? (
                  <Check className="h-4 w-4 text-green-500" />
                ) : (
                  <Copy className="h-4 w-4" />
                )}
              </Button>
            </div>
          </motion.div>

          {/* External Links */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.3 }}
            className="flex gap-3"
          >
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => window.open(solscanUrl, "_blank")}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Solscan
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => window.open(solanaFmUrl, "_blank")}
            >
              <ExternalLink className="w-4 h-4 mr-2" />
              Solana FM
            </Button>
          </motion.div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function getHolderCategory(percentage: number): string {
  if (percentage >= 10) return "Mega Whale";
  if (percentage >= 5) return "Whale";
  if (percentage >= 1) return "Large Holder";
  if (percentage >= 0.1) return "Medium Holder";
  if (percentage >= 0.01) return "Small Holder";
  return "Micro Holder";
}
