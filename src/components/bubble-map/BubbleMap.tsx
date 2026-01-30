"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, RefreshCw, Users, Coins, TrendingUp, TrendingDown, Wifi, WifiOff } from "lucide-react";
import { BubbleCanvas } from "./BubbleCanvas";
import { HolderModal } from "./HolderModal";
import { useBubbleSimulation } from "@/hooks/useBubbleSimulation";
import { useHolderChanges } from "@/hooks/useHolderChanges";
import { usePriceTracker } from "@/hooks/usePriceTracker";
import { useHolderWebSocket } from "@/hooks/useHolderWebSocket";
import type { Holder, TokenInfo, HoldersResponse } from "./types";
import { getHolderColor, calculateRadius } from "./types";
import {
  EffectsState,
  createInitialEffectsState,
  createExplosion,
  createRipple,
  createShrinkEffect,
  createGlobalEffect,
  updateEffects,
} from "./effects";
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
  const [effectsState, setEffectsState] = useState<EffectsState>(createInitialEffectsState());
  const [eventLog, setEventLog] = useState<string[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const isFirstLoadRef = useRef(true);
  const dimensionsRef = useRef({ width: 0, height: 0 });

  // Holder changes detection
  const { detectChanges } = useHolderChanges({
    whaleThreshold: 1,
    significantChangeThreshold: 5,
  });
  const detectChangesRef = useRef(detectChanges);
  detectChangesRef.current = detectChanges;

  // Price tracking - check every 60 seconds
  const { priceData, priceEvent } = usePriceTracker({
    tokenAddress: tokenAddress || "",
    pollInterval: 60000,
    pumpThreshold: 3,
    dumpThreshold: -3,
  });

  // WebSocket for real-time transactions
  const heliusApiKey = process.env.NEXT_PUBLIC_HELIUS_API_KEY || "";
  const { connected: wsConnected, transactionCount } = useHolderWebSocket({
    tokenAddress: tokenAddress || "",
    heliusApiKey,
    enabled: !!tokenAddress && !!heliusApiKey,
    onTransaction: useCallback((event: { type: string; signature: string; timestamp: number }) => {
      const dims = dimensionsRef.current;
      
      if (event.type === "buy") {
        // Buy - explosion effect at random position
        const randomColor = `hsl(${Math.random() * 120 + 100}, 70%, 50%)`; // Green-ish
        setEffectsState(prev => ({
          ...prev,
          explosions: [...prev.explosions, createExplosion(
            dims.width * 0.2 + Math.random() * dims.width * 0.6,
            dims.height * 0.2 + Math.random() * dims.height * 0.6,
            "#22c55e"
          )],
        }));
        setEventLog(prev => [`🟢 BUY tx: ${event.signature.slice(0, 8)}...`, ...prev.slice(0, 4)]);
      } else if (event.type === "sell") {
        // Sell - red explosion
        setEffectsState(prev => ({
          ...prev,
          explosions: [...prev.explosions, createExplosion(
            dims.width * 0.2 + Math.random() * dims.width * 0.6,
            dims.height * 0.2 + Math.random() * dims.height * 0.6,
            "#ef4444"
          )],
        }));
        setEventLog(prev => [`🔴 SELL tx: ${event.signature.slice(0, 8)}...`, ...prev.slice(0, 4)]);
      } else {
        // Transfer - blue effect
        setEffectsState(prev => ({
          ...prev,
          ripples: [...prev.ripples, createRipple(
            dims.width / 2,
            dims.height / 2,
            "#3b82f6",
            300
          )],
        }));
        setEventLog(prev => [`💫 TX: ${event.signature.slice(0, 8)}...`, ...prev.slice(0, 4)]);
      }
    }, []),
  });

  // Simulation hook
  const { nodes, reheat } = useBubbleSimulation({
    holders,
    width: dimensions.width,
    height: dimensions.height,
  });


  // Trigger global pump/dump effect
  const triggerGlobalEffect = useCallback((type: "pump" | "dump") => {
    setEffectsState(prev => ({
      ...prev,
      globalEffect: createGlobalEffect(type),
    }));
    
    // Also give all bubbles a bounce
    if (type === "pump") {
      reheat();
    }
  }, [reheat]);

  // Handle price events
  useEffect(() => {
    if (priceEvent) {
      if (priceEvent.type === "pump") {
        triggerGlobalEffect("pump");
        setEventLog(prev => [`📈 PUMP! +${priceEvent.changePercent.toFixed(1)}%`, ...prev.slice(0, 4)]);
      } else if (priceEvent.type === "dump") {
        triggerGlobalEffect("dump");
        setEventLog(prev => [`📉 DUMP! ${priceEvent.changePercent.toFixed(1)}%`, ...prev.slice(0, 4)]);
      }
    }
  }, [priceEvent, triggerGlobalEffect]);

  // Fetch holder data - using refs to avoid dependency changes
  const fetchHolders = useCallback(async () => {
    if (isFirstLoadRef.current) {
      setLoading(true);
    }
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
      
      // Detect changes if not first load
      if (!isFirstLoadRef.current) {
        const changes = detectChangesRef.current(data.holders);
        const dims = dimensionsRef.current;
        
        changes.forEach(change => {
          switch (change.type) {
            case "new_buyer":
              setEffectsState(prev => ({
                ...prev,
                explosions: [...prev.explosions, createExplosion(
                  dims.width / 2 + (Math.random() - 0.5) * 200,
                  dims.height / 2 + (Math.random() - 0.5) * 200,
                  change.holder.color
                )],
              }));
              setEventLog(prev => [`🆕 New buyer: ${change.address.slice(0, 6)}...`, ...prev.slice(0, 4)]);
              break;
              
            case "seller":
              setEffectsState(prev => ({
                ...prev,
                bubbleEffects: [...prev.bubbleEffects, createShrinkEffect(change.address)],
              }));
              setEventLog(prev => [`🔴 Sold: ${change.address.slice(0, 6)}...`, ...prev.slice(0, 4)]);
              break;
              
            case "whale_move":
              setEffectsState(prev => ({
                ...prev,
                ripples: [...prev.ripples, createRipple(
                  dims.width / 2,
                  dims.height / 2,
                  change.holder.color,
                  Math.max(dims.width, dims.height)
                )],
              }));
              const direction = (change.percentChange || 0) > 0 ? "bought" : "sold";
              setEventLog(prev => [`🐋 Whale ${direction}: ${change.address.slice(0, 6)}...`, ...prev.slice(0, 4)]);
              break;
          }
        });
      }
      
      setHolders(data.holders);
      isFirstLoadRef.current = false;
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    } finally {
      setLoading(false);
    }
  }, [tokenAddress]); // Only depends on tokenAddress

  // Initial fetch and auto-refresh every 2 minutes (WebSocket handles real-time)
  useEffect(() => {
    fetchHolders();
    
    const interval = setInterval(fetchHolders, 120000); // Refresh every 2 minutes
    
    return () => clearInterval(interval);
  }, [fetchHolders]);

  // Handle resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const newDims = {
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        };
        dimensionsRef.current = newDims;
        setDimensions(newDims);
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, []);

  // Effects animation loop
  useEffect(() => {
    let animationId: number;
    
    const animate = () => {
      setEffectsState(prev => updateEffects(prev));
      animationId = requestAnimationFrame(animate);
    };
    
    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, []);

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

          {/* Price Display */}
          {priceData && (
            <div className="bg-slate-900/80 backdrop-blur-md rounded-xl px-4 py-2 border border-slate-700/50">
              <div className="text-xs text-slate-400">Price</div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-white">
                  ${priceData.price < 0.01 ? priceData.price.toExponential(2) : priceData.price.toFixed(4)}
                </span>
                <span className={`text-xs flex items-center ${priceData.priceChange1h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {priceData.priceChange1h >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                  {priceData.priceChange1h >= 0 ? '+' : ''}{priceData.priceChange1h.toFixed(1)}%
                </span>
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
          {/* WebSocket connection indicator */}
          <div className={`bg-slate-900/80 backdrop-blur-md rounded-xl px-3 py-2 border flex items-center gap-2 ${
            wsConnected ? 'border-green-500/50' : 'border-slate-700/50'
          }`}>
            {wsConnected ? (
              <>
                <Wifi className="w-3 h-3 text-green-500" />
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs text-green-400">LIVE</span>
                {transactionCount > 0 && (
                  <span className="text-xs text-green-300 ml-1">({transactionCount} txs)</span>
                )}
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-slate-500" />
                <span className="text-xs text-slate-400">Connecting...</span>
              </>
            )}
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

      {/* Event Log */}
      <AnimatePresence>
        {eventLog.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: -20 }}
            animate={{ opacity: 1, x: 0 }}
            className="absolute top-24 left-4 z-10 w-64"
          >
            <div className="bg-slate-900/80 backdrop-blur-md rounded-xl p-3 border border-slate-700/50">
              <div className="text-xs text-slate-400 mb-2 font-medium">Live Events</div>
              <div className="space-y-1">
                {eventLog.map((event, i) => (
                  <motion.div
                    key={`${event}-${i}`}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1 - i * 0.2, x: 0 }}
                    className="text-xs text-slate-300"
                  >
                    {event}
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
          effectsState={effectsState}
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
        <div className="text-xs text-slate-400 mb-2 font-medium">Live Effects</div>
        <div className="space-y-1.5 text-xs text-slate-300">
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-green-500" />
            <span>Price Pump</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-red-500" />
            <span>Price Dump / Sell</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full bg-yellow-500 animate-pulse" />
            <span>New Buyer</span>
          </div>
          <div className="flex items-center gap-2">
            <div className="w-3 h-3 rounded-full border-2 border-blue-500" />
            <span>Whale Move</span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
