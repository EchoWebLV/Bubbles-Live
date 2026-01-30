"use client";

import { useState } from "react";
import { motion } from "framer-motion";
import { Search, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface TokenSearchProps {
  onTokenSelect: (address: string) => void;
  loading?: boolean;
}

// Popular tokens for quick access
const POPULAR_TOKENS = [
  { address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", symbol: "USDC", name: "USD Coin" },
  { address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", symbol: "USDT", name: "Tether" },
  { address: "So11111111111111111111111111111111111111112", symbol: "SOL", name: "Wrapped SOL" },
  { address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", symbol: "BONK", name: "Bonk" },
  { address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", symbol: "JUP", name: "Jupiter" },
];

export function TokenSearch({ onTokenSelect, loading }: TokenSearchProps) {
  const [address, setAddress] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (address.trim()) {
      onTokenSelect(address.trim());
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full max-w-2xl mx-auto"
    >
      {/* Search Form */}
      <form onSubmit={handleSubmit} className="relative">
        <div className="relative flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-slate-500" />
            <Input
              type="text"
              placeholder="Enter Solana token address..."
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              className="pl-10 h-12 text-base bg-slate-900/80 border-slate-700"
            />
          </div>
          <Button
            type="submit"
            disabled={!address.trim() || loading}
            className="h-12 px-6"
          >
            {loading ? (
              <Loader2 className="w-5 h-5 animate-spin" />
            ) : (
              "Visualize"
            )}
          </Button>
        </div>
      </form>

      {/* Popular Tokens */}
      <div className="mt-6">
        <div className="text-sm text-slate-400 mb-3">Popular Tokens</div>
        <div className="flex flex-wrap gap-2">
          {POPULAR_TOKENS.map((token) => (
            <motion.button
              key={token.address}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => {
                setAddress(token.address);
                onTokenSelect(token.address);
              }}
              className="px-4 py-2 bg-slate-800/50 hover:bg-slate-700/50 border border-slate-700 rounded-lg text-sm transition-colors"
            >
              <span className="font-medium text-white">{token.symbol}</span>
              <span className="text-slate-400 ml-2 hidden sm:inline">{token.name}</span>
            </motion.button>
          ))}
        </div>
      </div>
    </motion.div>
  );
}
