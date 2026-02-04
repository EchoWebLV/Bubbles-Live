"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, RefreshCw, Users, TrendingUp, TrendingDown, Wifi, WifiOff, Skull, Swords, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ZoomIn, ZoomOut } from "lucide-react";
import { BubbleCanvas } from "./BubbleCanvas";
import { HolderModal } from "./HolderModal";
import { useGameSocket, GameState, GameHolder, GameBattleBubble } from "@/hooks/useGameSocket";
import { useHolderWebSocket } from "@/hooks/useHolderWebSocket";
import type { Holder, TokenInfo } from "./types";
import type { BattleState } from "./battle";
import {
  EffectsState,
  createInitialEffectsState,
  updateEffects,
} from "./effects";
import { Button } from "@/components/ui/button";

// Camera/viewport state
interface Camera {
  x: number;
  y: number;
  zoom: number;
}

const CAMERA_SPEED = 20;
const ZOOM_SPEED = 0.1;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 2;

// Format market cap with K, M, B suffixes
function formatMarketCap(value: number): string {
  if (!value || value === 0) return '$0';
  if (value >= 1_000_000_000) {
    return `$${(value / 1_000_000_000).toFixed(2)}B`;
  }
  if (value >= 1_000_000) {
    return `$${(value / 1_000_000).toFixed(2)}M`;
  }
  if (value >= 1_000) {
    return `$${(value / 1_000).toFixed(2)}K`;
  }
  return `$${value.toFixed(2)}`;
}

export function BubbleMapClient() {
  const [selectedHolder, setSelectedHolder] = useState<Holder | null>(null);
  const [hoveredHolder, setHoveredHolder] = useState<Holder | null>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [effectsState, setEffectsState] = useState<EffectsState>(createInitialEffectsState());
  const [camera, setCamera] = useState<Camera>({ x: 0, y: 0, zoom: 1 });
  const [isDragging, setIsDragging] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const keysPressed = useRef<Set<string>>(new Set());
  const lastMousePos = useRef<{ x: number; y: number } | null>(null);

  // Connect to game server
  const { connected, gameState, setDimensions: sendDimensions, sendTransaction } = useGameSocket();

  // WebSocket for real-time transactions (forwards to server)
  const tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS || "";
  const heliusApiKey = process.env.NEXT_PUBLIC_HELIUS_API_KEY || "";
  
  const { connected: txWsConnected, transactionCount } = useHolderWebSocket({
    tokenAddress,
    heliusApiKey,
    enabled: !!tokenAddress && !!heliusApiKey,
    onTransaction: useCallback((event: { type: string; signature: string; timestamp: number }) => {
      // Forward transaction to server
      sendTransaction(event);
    }, [sendTransaction]),
  });

  // Handle resize
  useEffect(() => {
    const updateDimensions = () => {
      if (containerRef.current) {
        const newDims = {
          width: containerRef.current.clientWidth,
          height: containerRef.current.clientHeight,
        };
        setDimensions(newDims);
        sendDimensions(newDims.width, newDims.height);
      }
    };

    updateDimensions();
    window.addEventListener("resize", updateDimensions);
    return () => window.removeEventListener("resize", updateDimensions);
  }, [sendDimensions]);

  // Send dimensions when connected
  useEffect(() => {
    if (connected && dimensions.width > 0) {
      sendDimensions(dimensions.width, dimensions.height);
    }
  }, [connected, dimensions, sendDimensions]);

  // Camera movement functions
  const moveCamera = useCallback((dx: number, dy: number) => {
    setCamera(prev => ({
      ...prev,
      x: prev.x + dx,
      y: prev.y + dy,
    }));
  }, []);

  const zoomCamera = useCallback((delta: number) => {
    setCamera(prev => ({
      ...prev,
      zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom + delta)),
    }));
  }, []);

  const resetCamera = useCallback(() => {
    setCamera({ x: 0, y: 0, zoom: 1 });
  }, []);

  // Mouse drag handlers for camera panning
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start drag on left click and not on UI elements
    if (e.button === 0 && e.target === containerRef.current?.querySelector('canvas')) {
      setIsDragging(true);
      lastMousePos.current = { x: e.clientX, y: e.clientY };
      e.preventDefault();
    }
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (isDragging && lastMousePos.current) {
      const dx = e.clientX - lastMousePos.current.x;
      const dy = e.clientY - lastMousePos.current.y;
      
      // Move camera (divide by zoom to keep consistent speed)
      setCamera(prev => ({
        ...prev,
        x: prev.x + dx / prev.zoom,
        y: prev.y + dy / prev.zoom,
      }));
      
      lastMousePos.current = { x: e.clientX, y: e.clientY };
    }
  }, [isDragging]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
    lastMousePos.current = null;
  }, []);

  const handleMouseLeave = useCallback(() => {
    setIsDragging(false);
    lastMousePos.current = null;
  }, []);

  // Scroll wheel zoom
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    const zoomDelta = e.deltaY > 0 ? -0.1 : 0.1;
    setCamera(prev => ({
      ...prev,
      zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom + zoomDelta)),
    }));
  }, []);

  // Keyboard controls
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      keysPressed.current.add(e.key);
      
      // Prevent scrolling with arrow keys
      if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
        e.preventDefault();
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      keysPressed.current.delete(e.key);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  // Effects animation loop + camera movement
  useEffect(() => {
    let animationId: number;
    
    const animate = () => {
      setEffectsState(prev => updateEffects(prev));
      
      // Handle continuous key presses for smooth camera movement
      const keys = keysPressed.current;
      if (keys.has('ArrowUp') || keys.has('w') || keys.has('W')) {
        moveCamera(0, CAMERA_SPEED);
      }
      if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) {
        moveCamera(0, -CAMERA_SPEED);
      }
      if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) {
        moveCamera(CAMERA_SPEED, 0);
      }
      if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) {
        moveCamera(-CAMERA_SPEED, 0);
      }
      if (keys.has('+') || keys.has('=')) {
        zoomCamera(0.02);
      }
      if (keys.has('-') || keys.has('_')) {
        zoomCamera(-0.02);
      }
      
      animationId = requestAnimationFrame(animate);
    };
    
    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [moveCamera, zoomCamera]);

  // Convert game state to component formats
  const holders: Holder[] = gameState?.holders.map(h => ({
    address: h.address,
    balance: h.balance,
    percentage: h.percentage,
    color: h.color,
    radius: h.radius,
    x: h.x,
    y: h.y,
  })) || [];

  const battleState: BattleState = {
    bubbles: new Map(
      gameState?.battleBubbles.map(b => [b.address, {
        address: b.address,
        health: b.health,
        maxHealth: b.maxHealth,
        isGhost: b.isGhost,
        ghostUntil: b.ghostUntil,
        lastShotTime: 0,
        kills: b.kills,
        deaths: b.deaths,
      }]) || []
    ),
    bullets: gameState?.bullets.map(b => ({
      id: b.id,
      shooterAddress: b.shooterAddress,
      targetAddress: "",
      shooterColor: b.shooterColor,
      x: b.x,
      y: b.y,
      startX: b.startX,
      startY: b.startY,
      targetX: b.targetX,
      targetY: b.targetY,
      progress: b.progress,
      curveDirection: b.curveDirection,
      curveStrength: b.curveStrength,
      vx: 0,
      vy: 0,
      damage: 0.1,
      createdAt: 0,
    })) || [],
    damageNumbers: gameState?.damageNumbers || [],
    lastUpdateTime: Date.now(),
  };

  const token: TokenInfo | null = gameState?.token || null;
  const priceData = gameState?.priceData || null;
  const eventLog = gameState?.eventLog || [];
  const killFeed = gameState?.killFeed || [];
  const topKillers = gameState?.topKillers || [];

  const isLoading = !connected || !gameState;

  return (
    <div 
      className={`relative w-full h-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
    >
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

          {priceData && (
            <div className="bg-slate-900/80 backdrop-blur-md rounded-xl px-4 py-2 border border-slate-700/50">
              <div className="text-xs text-slate-400">Market Cap</div>
              <div className="flex items-center gap-2">
                <span className="text-lg font-bold text-white">
                  {formatMarketCap(priceData.marketCap)}
                </span>
                <span className={`text-xs flex items-center ${priceData.priceChange1h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {priceData.priceChange1h >= 0 ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                  {priceData.priceChange1h >= 0 ? '+' : ''}{priceData.priceChange1h.toFixed(1)}%
                </span>
              </div>
            </div>
          )}

          <div className="bg-slate-900/80 backdrop-blur-md rounded-xl px-4 py-2 border border-red-500/30">
            <div className="flex items-center gap-2 text-red-400 text-xs">
              <Swords className="w-3 h-3" />
              BATTLE MODE
            </div>
            <div className="text-lg font-bold text-white">
              {holders.length} fighters
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          {/* Server connection indicator */}
          <div className={`bg-slate-900/80 backdrop-blur-md rounded-xl px-3 py-2 border flex items-center gap-2 ${
            connected ? 'border-green-500/50' : 'border-red-500/50'
          }`}>
            {connected ? (
              <>
                <Wifi className="w-3 h-3 text-green-500" />
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs text-green-400">SYNCED</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-red-500" />
                <span className="text-xs text-red-400">Connecting...</span>
              </>
            )}
          </div>

          {/* Helius WebSocket indicator */}
          {txWsConnected && (
            <div className="bg-slate-900/80 backdrop-blur-md rounded-xl px-3 py-2 border border-blue-500/30 flex items-center gap-2">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-xs text-blue-400">TXs: {transactionCount}</span>
            </div>
          )}
        </div>
      </motion.div>

      {/* Kill Feed */}
      <AnimatePresence>
        {killFeed.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            className="absolute top-24 right-4 z-10 w-72"
          >
            <div className="bg-slate-900/80 backdrop-blur-md rounded-xl p-3 border border-red-500/30">
              <div className="text-xs text-red-400 mb-2 font-medium flex items-center gap-2">
                <Skull className="w-3 h-3" />
                Kill Feed
              </div>
              <div className="space-y-1">
                {killFeed.map((kill, i) => (
                  <motion.div
                    key={`${kill.killer}-${kill.victim}-${kill.time}`}
                    initial={{ opacity: 0, x: 10 }}
                    animate={{ opacity: 1 - i * 0.2, x: 0 }}
                    className="text-xs flex items-center gap-1"
                  >
                    <span className="text-green-400 font-mono">{kill.killer.slice(0, 6)}</span>
                    <span className="text-slate-500">☠️</span>
                    <span className="text-red-400 font-mono">{kill.victim.slice(0, 6)}</span>
                  </motion.div>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Top Killers Leaderboard */}
      {topKillers.length > 0 && (
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="absolute top-24 left-4 z-10 w-48"
        >
          <div className="bg-slate-900/80 backdrop-blur-md rounded-xl p-3 border border-yellow-500/30">
            <div className="text-xs text-yellow-400 mb-2 font-medium">🏆 Top Killers</div>
            <div className="space-y-1">
              {topKillers.map((killer, i) => (
                <div key={killer.address} className="text-xs flex items-center justify-between">
                  <span className="text-slate-300 font-mono">
                    {i + 1}. {killer.address.slice(0, 6)}...
                  </span>
                  <span className="text-yellow-400 font-bold">{killer.kills} kills</span>
                </div>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* Loading State */}
      <AnimatePresence>
        {isLoading && (
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
              <div className="text-slate-400">
                {connected ? "Loading battle..." : "Connecting to server..."}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Bubble Canvas */}
      {dimensions.width > 0 && dimensions.height > 0 && holders.length > 0 && (
        <BubbleCanvas
          holders={holders}
          width={dimensions.width}
          height={dimensions.height}
          hoveredHolder={hoveredHolder}
          effectsState={effectsState}
          battleState={battleState}
          camera={camera}
          onHolderClick={setSelectedHolder}
          onHolderHover={setHoveredHolder}
        />
      )}

      {/* Compact Bottom Control Bar */}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-20">
        <div className="flex items-center gap-1 bg-slate-900/70 backdrop-blur-md rounded-full px-2 py-1.5 border border-slate-700/50">
          {/* Zoom Out */}
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/50 active:bg-slate-600/50 transition-colors touch-manipulation"
            onTouchStart={() => keysPressed.current.add('-')}
            onTouchEnd={() => keysPressed.current.delete('-')}
            onMouseDown={() => keysPressed.current.add('-')}
            onMouseUp={() => keysPressed.current.delete('-')}
            onMouseLeave={() => keysPressed.current.delete('-')}
          >
            <ZoomOut className="w-4 h-4" />
          </button>

          {/* Zoom Display */}
          <div className="w-12 text-center text-xs text-slate-400 font-mono">
            {Math.round(camera.zoom * 100)}%
          </div>

          {/* Zoom In */}
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/50 active:bg-slate-600/50 transition-colors touch-manipulation"
            onTouchStart={() => keysPressed.current.add('+')}
            onTouchEnd={() => keysPressed.current.delete('+')}
            onMouseDown={() => keysPressed.current.add('+')}
            onMouseUp={() => keysPressed.current.delete('+')}
            onMouseLeave={() => keysPressed.current.delete('+')}
          >
            <ZoomIn className="w-4 h-4" />
          </button>

          {/* Divider */}
          <div className="w-px h-5 bg-slate-600/50 mx-1" />

          {/* Direction Controls */}
          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/50 active:bg-slate-600/50 transition-colors touch-manipulation"
            onTouchStart={() => keysPressed.current.add('ArrowLeft')}
            onTouchEnd={() => keysPressed.current.delete('ArrowLeft')}
            onMouseDown={() => keysPressed.current.add('ArrowLeft')}
            onMouseUp={() => keysPressed.current.delete('ArrowLeft')}
            onMouseLeave={() => keysPressed.current.delete('ArrowLeft')}
          >
            <ChevronLeft className="w-4 h-4" />
          </button>

          <div className="flex flex-col gap-0.5">
            <button
              className="w-8 h-4 rounded-t flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/50 active:bg-slate-600/50 transition-colors touch-manipulation"
              onTouchStart={() => keysPressed.current.add('ArrowUp')}
              onTouchEnd={() => keysPressed.current.delete('ArrowUp')}
              onMouseDown={() => keysPressed.current.add('ArrowUp')}
              onMouseUp={() => keysPressed.current.delete('ArrowUp')}
              onMouseLeave={() => keysPressed.current.delete('ArrowUp')}
            >
              <ChevronUp className="w-4 h-4" />
            </button>
            <button
              className="w-8 h-4 rounded-b flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/50 active:bg-slate-600/50 transition-colors touch-manipulation"
              onTouchStart={() => keysPressed.current.add('ArrowDown')}
              onTouchEnd={() => keysPressed.current.delete('ArrowDown')}
              onMouseDown={() => keysPressed.current.add('ArrowDown')}
              onMouseUp={() => keysPressed.current.delete('ArrowDown')}
              onMouseLeave={() => keysPressed.current.delete('ArrowDown')}
            >
              <ChevronDown className="w-4 h-4" />
            </button>
          </div>

          <button
            className="w-8 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/50 active:bg-slate-600/50 transition-colors touch-manipulation"
            onTouchStart={() => keysPressed.current.add('ArrowRight')}
            onTouchEnd={() => keysPressed.current.delete('ArrowRight')}
            onMouseDown={() => keysPressed.current.add('ArrowRight')}
            onMouseUp={() => keysPressed.current.delete('ArrowRight')}
            onMouseLeave={() => keysPressed.current.delete('ArrowRight')}
          >
            <ChevronRight className="w-4 h-4" />
          </button>

          {/* Divider */}
          <div className="w-px h-5 bg-slate-600/50 mx-1" />

          {/* Reset */}
          <button
            className="px-3 h-8 rounded-full flex items-center justify-center text-slate-400 hover:text-white hover:bg-slate-700/50 active:bg-slate-600/50 transition-colors text-xs font-medium touch-manipulation"
            onClick={resetCamera}
          >
            Reset
          </button>
        </div>
      </div>

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
              {battleState.bubbles.get(hoveredHolder.address) && (
                <div className="text-xs text-slate-400 border-l border-slate-600 pl-3">
                  ❤️ {battleState.bubbles.get(hoveredHolder.address)!.health.toFixed(0)} HP
                  {battleState.bubbles.get(hoveredHolder.address)!.kills > 0 && (
                    <span className="ml-2 text-yellow-400">
                      ☠️ {battleState.bubbles.get(hoveredHolder.address)!.kills}
                    </span>
                  )}
                </div>
              )}
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

      {/* Transaction Log */}
      <AnimatePresence>
        {eventLog.length > 0 && (
          <motion.div
            initial={{ opacity: 0, x: 20 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0, x: 20 }}
            className="absolute bottom-4 right-4 bg-slate-900/80 backdrop-blur-md rounded-xl p-3 border border-slate-700/50 z-10 w-64"
          >
            <div className="text-xs text-slate-400 mb-2 font-medium">📊 Live Events</div>
            <div className="space-y-1">
              {eventLog.slice(0, 8).map((event, i) => (
                <motion.div
                  key={`${event}-${i}`}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1 - i * 0.1, x: 0 }}
                  className="text-xs text-slate-300 font-mono"
                >
                  {event}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
