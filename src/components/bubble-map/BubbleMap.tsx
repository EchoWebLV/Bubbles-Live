"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, RefreshCw, Users, Coins } from "lucide-react";
import { BubbleCanvas } from "./BubbleCanvas";
import { HolderModal } from "./HolderModal";
import { useBubbleSimulation } from "@/hooks/useBubbleSimulation";
import type { Holder, TokenInfo, HoldersResponse } from "./types";
import { Button } from "@/components/ui/button";
import { formatNumber } from "@/lib/utils";

interface BubbleMapProps {
  tokenAddress?: string;
}

export function BubbleMap({ tokenAddress }: BubbleMapProps) {
  const [holders, setHolders] = useState<Holder[]>([]);
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedHolder, setSelectedHolder] = useState<Holder | null>(null);
  const [hoveredHolder, setHoveredHolder] = useState<Holder | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const containerRef = useRef<HTMLDivElement>(null);

  // Fetch holder data
  const fetchHolders = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const url = tokenAddress
        ? `/api/holders?token=${tokenAddress}`
        : "/api/holders";

      const response = await fetch(url);
      if (!response.ok) {
        throw new Error("Failed to fetch holders");
      }

      const data: HoldersResponse = await response.json();
      setToken(data.token);
      setHolders(data.holders);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [tokenAddress]);

  // Initial fetch and auto-refresh every 30 seconds
  useEffect(() => {
    fetchHolders();
    
    // Auto-refresh interval
    const interval = setInterval(() => {
      fetchHolders();
    }, 30000); // Refresh every 30 seconds
    
    return () => clearInterval(interval);
  }, [fetchHolders]);

  // Handle resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        setDimensions({
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        });
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // Simulation hook - nodes are updated by the hook directly
  const { nodes, reheat } = useBubbleSimulation({
    holders,
    width: dimensions.width,
    height: dimensions.height,
  });

  const handleRefresh = () => {
    fetchHolders();
    reheat();
  };

  return (
    <div className="relative w-full h-full" ref={containerRef}>
      {/* Background gradient effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1/3 h-1/3 bg-indigo-500/5 rounded-full blur-3xl" />
      </div>

      {/* Header Stats */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between"
      >
        <div className="flex items-center gap-4">
          {token && (
            <div className="bg-slate-900/80 backdrop-blur-md rounded-xl px-4 py-2 border border-slate-700/50">
              <div className="flex items-center gap-3">
                {token.logoUri && (
                  <img
                    src={token.logoUri}
                    alt={token.symbol}
                    className="w-8 h-8 rounded-full"
                  />
                )}
                <div>
                  <div className="font-bold text-white">{token.symbol}</div>
                  <div className="text-xs text-slate-400">{token.name}</div>
                </div>
              </div>
            </div>
          )}

          <div className="bg-slate-900/80 backdrop-blur-md rounded-xl px-4 py-2 border border-slate-700/50">
            <div className="flex items-center gap-2 text-slate-400 text-xs">
              <Users className="w-3 h-3" />
              Holders
            </div>
            <div className="text-lg font-bold text-white">
              {nodes.length}
            </div>
          </div>

          {token && token.totalSupply > 0 && (
            <div className="bg-slate-900/80 backdrop-blur-md rounded-xl px-4 py-2 border border-slate-700/50">
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <Coins className="w-3 h-3" />
                Supply
              </div>
              <div className="text-lg font-bold text-white">
                {formatNumber(token.totalSupply / Math.pow(10, token.decimals))}
              </div>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3">
          {/* Live indicator */}
          <div className="bg-slate-900/80 backdrop-blur-md rounded-xl px-3 py-2 border border-slate-700/50 flex items-center gap-2">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            <span className="text-xs text-slate-400">LIVE</span>
          </div>
          
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={loading}
            className="bg-slate-900/80 backdrop-blur-md border-slate-700/50"
          >
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            Refresh
          </Button>
        </div>
      </motion.div>

      {/* Loading State */}
      <AnimatePresence>
        {loading && holders.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-slate-950/50 backdrop-blur-sm z-20"
          >
            <div className="flex flex-col items-center gap-4">
              <div className="relative">
                <div className="w-16 h-16 rounded-full border-4 border-purple-500/30 animate-pulse" />
                <Loader2 className="absolute inset-0 w-16 h-16 text-purple-500 animate-spin" />
              </div>
              <div className="text-slate-400">Loading token holders...</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Error State */}
      {error && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="absolute inset-0 flex items-center justify-center z-20"
        >
          <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-6 max-w-md text-center">
            <div className="text-red-400 font-medium mb-2">Error</div>
            <div className="text-slate-300 text-sm mb-4">{error}</div>
            <Button onClick={handleRefresh} variant="outline">
              Try Again
            </Button>
          </div>
        </motion.div>
      )}

      {/* Bubble Canvas */}
      {dimensions.width > 0 && dimensions.height > 0 && (
        <BubbleCanvas
          holders={nodes}
          width={dimensions.width}
          height={dimensions.height}
          hoveredHolder={hoveredHolder}
          onHolderClick={setSelectedHolder}
          onHolderHover={setHoveredHolder}
        />
      )}

      {/* Hover Tooltip */}
      <AnimatePresence>
        {hoveredHolder && !selectedHolder && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10"
          >
            <div className="bg-slate-900/90 backdrop-blur-md rounded-xl px-4 py-2 border border-slate-700/50 flex items-center gap-3">
              <div
                className="w-4 h-4 rounded-full"
                style={{ backgroundColor: hoveredHolder.color }}
              />
              <div className="text-sm">
                <span className="text-slate-400">
                  {hoveredHolder.address.slice(0, 8)}...
                </span>
                <span className="text-white font-bold ml-2">
                  {hoveredHolder.percentage.toFixed(2)}%
                </span>
              </div>
              <div className="text-xs text-slate-500">Click for details</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Holder Detail Modal */}
      <HolderModal
        holder={selectedHolder}
        token={token}
        onClose={() => setSelectedHolder(null)}
      />

      {/* Legend */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ delay: 0.5 }}
        className="absolute bottom-4 right-4 bg-slate-900/80 backdrop-blur-md rounded-xl p-3 border border-slate-700/50 z-10"
      >
        <div className="text-xs text-slate-400 mb-2 font-medium">Bubble Size = % Held</div>
        <div className="space-y-1.5 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <div className="w-4 h-4 rounded-full bg-gradient-to-br from-purple-400 to-blue-500" />
            <span>Larger = More tokens</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-gradient-to-br from-green-400 to-cyan-500" />
            <span>Smaller = Fewer tokens</span>
          </div>
          <div className="text-slate-500 text-[10px] mt-1">
            Each wallet has a unique color
          </div>
        </div>
      </motion.div>
    </div>
  );
}

