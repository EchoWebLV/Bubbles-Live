"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, RefreshCw, Users, TrendingUp, TrendingDown, Wifi, WifiOff, Swords, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Volume2, VolumeX, Info, Wallet, Shield, Crosshair, Zap, Star, Camera } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WelcomeModal } from "@/components/WelcomeModal";
import { BubbleCanvas } from "./BubbleCanvas";
import { HolderModal } from "./HolderModal";
import { useGameSocket, GameState, GameHolder, GameBattleBubble, OnchainPlayerStats, OnchainEvent } from "@/hooks/useGameSocket";
import { useHolderWebSocket } from "@/hooks/useHolderWebSocket";
import type { Holder, TokenInfo } from "./types";
import type { BattleState } from "./battle";
import {
  EffectsState,
  createInitialEffectsState,
  updateEffects,
} from "./effects";
import { Button } from "@/components/ui/button";

// Kill streak announcement
interface KillAnnouncement {
  id: string;
  text: string;
  subtext: string;
  color: string;
  glowColor: string;
  time: number;
  type: 'streak' | 'banner';
}

const STREAK_LABELS: { min: number; text: string; color: string; glow: string }[] = [
  { min: 7, text: 'LEGENDARY',   color: '#facc15', glow: 'rgba(250,204,21,0.6)' },
  { min: 6, text: 'GODLIKE',     color: '#f59e0b', glow: 'rgba(245,158,11,0.6)' },
  { min: 5, text: 'RAMPAGE',     color: '#ef4444', glow: 'rgba(239,68,68,0.5)' },
  { min: 4, text: 'ULTRA KILL',  color: '#a855f7', glow: 'rgba(168,85,247,0.5)' },
  { min: 3, text: 'TRIPLE KILL', color: '#3b82f6', glow: 'rgba(59,130,246,0.5)' },
  { min: 2, text: 'DOUBLE KILL', color: '#22c55e', glow: 'rgba(34,197,94,0.4)' },
];

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
  const [isMusicPlaying, setIsMusicPlaying] = useState(false);
  const [musicStarted, setMusicStarted] = useState(false);
  const [showRules, setShowRules] = useState(false);
  const [followingAddress, setFollowingAddress] = useState<string | null>(null);
  const [photoUploading, setPhotoUploading] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const keysPressed = useRef<Set<string>>(new Set());
  const photoInputRef = useRef<HTMLInputElement>(null);

  // Wallet connection
  const { publicKey, connected: walletConnected, disconnect: disconnectWallet } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const connectedWalletAddress = publicKey?.toBase58() || null;
  const lastMousePos = useRef<{ x: number; y: number } | null>(null);
  const lastTouchPos = useRef<{ x: number; y: number } | null>(null);
  const lastPinchDist = useRef<number | null>(null);

  // Initialize audio element and autoplay
  useEffect(() => {
    const audio = new Audio("/where-it-leads.mp3");
    audio.loop = true;
    audio.volume = 0.4;
    audioRef.current = audio;

    // Attempt autoplay — browsers may block until user interacts
    audio.play().then(() => {
      setIsMusicPlaying(true);
      setMusicStarted(true);
    }).catch(() => {
      // Autoplay blocked — start on first user click anywhere
      const startOnClick = () => {
        audio.play().then(() => {
          setIsMusicPlaying(true);
          setMusicStarted(true);
        }).catch(() => {});
        document.removeEventListener("click", startOnClick);
        document.removeEventListener("keydown", startOnClick);
      };
      document.addEventListener("click", startOnClick, { once: true });
      document.addEventListener("keydown", startOnClick, { once: true });
    });

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, []);

  // Toggle music
  const toggleMusic = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;

    if (isMusicPlaying) {
      audio.pause();
      setIsMusicPlaying(false);
    } else {
      audio.play().then(() => {
        setIsMusicPlaying(true);
        setMusicStarted(true);
      }).catch(() => {
        // Browser blocked autoplay — user needs to click again
        console.log("Audio play blocked by browser");
      });
    }
  }, [isMusicPlaying]);

  // Connect to game server
  const { connected, gameState, playerPhotos, setDimensions: sendDimensions, sendTransaction, upgradeStat, getOnchainStats, uploadPhoto, removePhoto } = useGameSocket();

  const handlePhotoUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !connectedWalletAddress) return;
    if (!file.type.startsWith('image/')) return;
    
    setPhotoUploading(true);
    try {
      const canvas = document.createElement('canvas');
      const img = new Image();
      const url = URL.createObjectURL(file);
      
      await new Promise<void>((resolve, reject) => {
        img.onload = () => resolve();
        img.onerror = reject;
        img.src = url;
      });
      
      const size = 128;
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      
      const minDim = Math.min(img.width, img.height);
      const sx = (img.width - minDim) / 2;
      const sy = (img.height - minDim) / 2;
      ctx.drawImage(img, sx, sy, minDim, minDim, 0, 0, size, size);
      URL.revokeObjectURL(url);
      
      const dataUrl = canvas.toDataURL('image/jpeg', 0.75);
      console.log(`Uploading photo: ${Math.round(dataUrl.length / 1024)}KB for ${connectedWalletAddress}`);
      const ok = await uploadPhoto(connectedWalletAddress, dataUrl);
      console.log(`Photo upload result: ${ok}`);
      if (!ok) console.warn('Photo upload failed');
    } catch (err) {
      console.error('Photo upload error:', err);
    } finally {
      setPhotoUploading(false);
      if (photoInputRef.current) photoInputRef.current.value = '';
    }
  }, [connectedWalletAddress, uploadPhoto]);
  const [upgrading, setUpgrading] = useState<number | null>(null); // 0=health, 1=shooting
  const [onchainStats, setOnchainStats] = useState<OnchainPlayerStats | null>(null);
  const [showUpgradePanel, setShowUpgradePanel] = useState(false);
  const [showOnchainPanel, setShowOnchainPanel] = useState(true);

  // Kill streak announcements
  const [announcements, setAnnouncements] = useState<KillAnnouncement[]>([]);
  const [isShaking, setIsShaking] = useState(false);
  const killStreaksRef = useRef<Map<string, { count: number; lastKillTime: number }>>(new Map());
  const lastKillTimeRef = useRef(0);
  const firstBloodFiredRef = useRef(false);

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

  // Fetch onchain stats when wallet is connected
  useEffect(() => {
    if (!connectedWalletAddress || !connected || !gameState?.magicBlock?.ready) {
      setOnchainStats(null);
      return;
    }
    // Fetch every 10 seconds
    const fetchStats = async () => {
      const stats = await getOnchainStats(connectedWalletAddress);
      if (stats) setOnchainStats(stats);
    };
    fetchStats();
    const interval = setInterval(fetchStats, 10000);
    return () => clearInterval(interval);
  }, [connectedWalletAddress, connected, gameState?.magicBlock?.ready, getOnchainStats]);

  // Handle upgrade request
  const handleUpgrade = useCallback(async (statType: number) => {
    if (!connectedWalletAddress || upgrading !== null) return;
    setUpgrading(statType);
    try {
      const result = await upgradeStat(connectedWalletAddress, statType);
      if (result.success) {
        // Refresh stats after successful upgrade
        const stats = await getOnchainStats(connectedWalletAddress);
        if (stats) setOnchainStats(stats);
      }
    } finally {
      setUpgrading(null);
    }
  }, [connectedWalletAddress, upgrading, upgradeStat, getOnchainStats]);

  // Kill streak detection — watches the kill feed for new kills
  useEffect(() => {
    if (!gameState?.killFeed?.length) return;

    const newKills = gameState.killFeed.filter(k => k.time > lastKillTimeRef.current);
    if (newKills.length === 0) return;

    lastKillTimeRef.current = Math.max(...newKills.map(k => k.time));

    const STREAK_WINDOW = 10_000;

    for (const kill of newKills) {
      const now = Date.now();
      const streaks = killStreaksRef.current;
      const prev = streaks.get(kill.killer) || { count: 0, lastKillTime: 0 };

      if (now - prev.lastKillTime > STREAK_WINDOW) {
        prev.count = 0;
      }
      prev.count++;
      prev.lastKillTime = now;
      streaks.set(kill.killer, prev);

      const isMyKill = kill.killer === connectedWalletAddress;
      const killerLabel = kill.killer.slice(0, 6) + '...';
      const victimLabel = kill.victim.slice(0, 6) + '...';

      // First blood
      if (!firstBloodFiredRef.current) {
        firstBloodFiredRef.current = true;
        setAnnouncements(a => [...a, {
          id: `fb-${now}`,
          text: 'FIRST BLOOD',
          subtext: `${killerLabel} drew first blood`,
          color: '#ef4444',
          glowColor: 'rgba(239,68,68,0.5)',
          time: now,
          type: 'streak',
        }]);
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 400);
      }

      // Kill streak announcement
      const streakDef = STREAK_LABELS.find(s => prev.count >= s.min);
      if (streakDef) {
        setAnnouncements(a => [...a, {
          id: `streak-${now}-${kill.killer}`,
          text: streakDef.text,
          subtext: `${killerLabel} (${prev.count} kill streak)`,
          color: streakDef.color,
          glowColor: streakDef.glow,
          time: now + 1,
          type: 'streak',
        }]);
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 400);
      }

      if (isMyKill) {
        setIsShaking(true);
        setTimeout(() => setIsShaking(false), 400);
      }
    }
  }, [gameState?.killFeed, connectedWalletAddress]);

  // Clean up expired announcements
  useEffect(() => {
    const interval = setInterval(() => {
      setAnnouncements(a => a.filter(ann => Date.now() - ann.time < 3200));
    }, 500);
    return () => clearInterval(interval);
  }, []);

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
    if (e.button === 0 && e.target === containerRef.current?.querySelector('canvas')) {
      setIsDragging(true);
      setFollowingAddress(null);
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

  // Touch handlers for mobile pan (one finger) and pinch zoom (two fingers)
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'CANVAS') return;

    if (e.touches.length === 1) {
      setFollowingAddress(null);
      lastTouchPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
      lastPinchDist.current = null;
    } else if (e.touches.length === 2) {
      lastTouchPos.current = null;
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      lastPinchDist.current = Math.sqrt(dx * dx + dy * dy);
    }
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (e.touches.length === 1 && lastTouchPos.current) {
      e.preventDefault();
      const dx = e.touches[0].clientX - lastTouchPos.current.x;
      const dy = e.touches[0].clientY - lastTouchPos.current.y;
      setCamera(prev => ({
        ...prev,
        x: prev.x + dx / prev.zoom,
        y: prev.y + dy / prev.zoom,
      }));
      lastTouchPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    } else if (e.touches.length === 2 && lastPinchDist.current !== null) {
      e.preventDefault();
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const delta = (dist - lastPinchDist.current) * 0.005;
      setCamera(prev => ({
        ...prev,
        zoom: Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, prev.zoom + delta)),
      }));
      lastPinchDist.current = dist;
    }
  }, []);

  const handleTouchEnd = useCallback(() => {
    lastTouchPos.current = null;
    lastPinchDist.current = null;
  }, []);

  // Scroll wheel zoom — only when scrolling over the canvas, not UI panels
  const handleWheel = useCallback((e: React.WheelEvent) => {
    const target = e.target as HTMLElement;
    if (target.tagName !== 'CANVAS') return;
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

  // Effects animation loop + camera movement + follow target
  useEffect(() => {
    let animationId: number;
    
    const animate = () => {
      setEffectsState(prev => updateEffects(prev));
      
      // Handle continuous key presses for smooth camera movement
      const keys = keysPressed.current;
      let manualMove = false;
      if (keys.has('ArrowUp') || keys.has('w') || keys.has('W')) {
        moveCamera(0, CAMERA_SPEED); manualMove = true;
      }
      if (keys.has('ArrowDown') || keys.has('s') || keys.has('S')) {
        moveCamera(0, -CAMERA_SPEED); manualMove = true;
      }
      if (keys.has('ArrowLeft') || keys.has('a') || keys.has('A')) {
        moveCamera(CAMERA_SPEED, 0); manualMove = true;
      }
      if (keys.has('ArrowRight') || keys.has('d') || keys.has('D')) {
        moveCamera(-CAMERA_SPEED, 0); manualMove = true;
      }
      if (keys.has('+') || keys.has('=')) {
        zoomCamera(0.02);
      }
      if (keys.has('-') || keys.has('_')) {
        zoomCamera(-0.02);
      }

      if (manualMove) {
        setFollowingAddress(null);
      }
      
      animationId = requestAnimationFrame(animate);
    };
    
    animationId = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(animationId);
  }, [moveCamera, zoomCamera]);

  // Follow target: smoothly track the followed bubble
  useEffect(() => {
    if (!followingAddress || !gameState) return;
    const holder = gameState.holders.find((h: { address: string }) => h.address === followingAddress);
    if (!holder || holder.x === undefined || holder.y === undefined) {
      setFollowingAddress(null);
      return;
    }
    const hx = holder.x;
    const hy = holder.y;
    const cw = dimensions.width / 2;
    const ch = dimensions.height / 2;
    setCamera(prev => ({
      ...prev,
      x: prev.x + ((-hx + cw) - prev.x) * 0.1,
      y: prev.y + ((-hy + ch) - prev.y) * 0.1,
    }));
  }, [followingAddress, gameState, dimensions]);

  // Convert game state to component formats
  const holders: Holder[] = gameState?.holders.map(h => ({
    address: h.address,
    balance: h.balance,
    percentage: h.percentage,
    color: h.color,
    radius: h.radius,
    x: h.x,
    y: h.y,
    isNew: h.isNew,
    spawnTime: h.spawnTime,
    photo: playerPhotos[h.address] || null,
  })) || [];

  // Pop effects for holders who sold
  const popEffects = gameState?.popEffects || [];

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
        // Progression
        level: b.level ?? 1,
        xp: b.xp ?? 0,
        healthLevel: b.healthLevel ?? 1,
        attackLevel: b.attackLevel ?? 1,
        attackPower: b.attackPower ?? 10,
        isAlive: b.isAlive !== false,
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
  const rawEventLog = gameState?.eventLog || [];
  const eventLogKey = rawEventLog.slice(0, 8).join('|');
  const eventLog = useMemo(() => rawEventLog, [eventLogKey]);
  const topKillers = gameState?.topKillers || [];

  const isLoading = !connected || !gameState;

  return (
    <div 
      className={`relative w-full h-full ${isDragging ? 'cursor-grabbing' : 'cursor-grab'} touch-none ${isShaking ? 'camera-shake' : ''}`}
      ref={containerRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
    >
      {/* Background gradient effects */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute -top-1/4 -left-1/4 w-1/2 h-1/2 bg-purple-500/10 rounded-full blur-3xl" />
        <div className="absolute -bottom-1/4 -right-1/4 w-1/2 h-1/2 bg-blue-500/10 rounded-full blur-3xl" />
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-1/3 h-1/3 bg-indigo-500/5 rounded-full blur-3xl" />
      </div>

      {/* Centered Title */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 z-20 pointer-events-none hidden sm:block">
        <div className="px-5 sm:px-8 pt-2 pb-1.5 bg-slate-950/80 backdrop-blur-md rounded-b-xl border-x border-b border-slate-700/40">
          <span
            className="text-base sm:text-lg font-black tracking-wider"
            style={{
              background: 'linear-gradient(90deg, #a78bfa, #60a5fa, #a78bfa)',
              backgroundSize: '200% auto',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              backgroundClip: 'text',
              animation: 'shimmer 3s linear infinite',
            }}
          >
            $WARZ
          </span>
        </div>
      </div>

      {/* Header Stats */}
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="absolute top-2 sm:top-4 left-2 sm:left-4 right-2 sm:right-4 z-10 flex items-center justify-between gap-2"
      >
        {/* Left: token info + market cap + fighters — hide some on mobile */}
        <div className="flex items-center gap-1.5 sm:gap-3 min-w-0">
          {token && (
            <div className="bg-slate-900/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 border border-slate-700/50 shrink-0">
              <div className="flex items-center gap-1.5 sm:gap-3">
                {token.logoUri && (
                  <img
                    src={token.logoUri}
                    alt={token.symbol}
                    className="w-5 h-5 sm:w-8 sm:h-8 rounded-full"
                  />
                )}
                <div className="hidden sm:block">
                  <div className="font-bold text-white text-sm">{token.symbol}</div>
                  <div className="text-[10px] text-slate-400">{token.name}</div>
                </div>
              </div>
            </div>
          )}

          {priceData && (
            <div className="bg-slate-900/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 border border-slate-700/50 hidden sm:block">
              <div className="text-[10px] text-slate-400">Market Cap</div>
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-bold text-white">
                  {formatMarketCap(priceData.marketCap ?? 0)}
                </span>
                <span className={`text-[10px] flex items-center ${priceData.priceChange1h >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {priceData.priceChange1h >= 0 ? <TrendingUp className="w-2.5 h-2.5 mr-0.5" /> : <TrendingDown className="w-2.5 h-2.5 mr-0.5" />}
                  {priceData.priceChange1h >= 0 ? '+' : ''}{priceData.priceChange1h.toFixed(1)}%
                </span>
              </div>
            </div>
          )}

          <div className="bg-slate-900/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 border border-red-500/30 shrink-0">
            <div className="flex items-center gap-1 text-red-400 text-[10px] sm:text-xs">
              <Swords className="w-3 h-3" />
              <span className="hidden sm:inline">BATTLE MODE</span>
            </div>
            <div className="text-sm sm:text-base font-bold text-white">
              {holders.length}<span className="hidden sm:inline"> fighters</span>
            </div>
          </div>
        </div>

        {/* Right: connection, onchain toggle, wallet, music */}
        <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
          {/* Server connection — icon-only on mobile */}
          <div className={`bg-slate-900/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 border flex items-center gap-1.5 ${
            connected ? 'border-green-500/50' : 'border-red-500/50'
          }`}>
            {connected ? (
              <>
                <Wifi className="w-3 h-3 text-green-500" />
                <div className="w-1.5 h-1.5 sm:w-2 sm:h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-[10px] sm:text-xs text-green-400 hidden sm:inline">SYNCED</span>
              </>
            ) : (
              <>
                <WifiOff className="w-3 h-3 text-red-500" />
                <span className="text-[10px] text-red-400 hidden sm:inline">Connecting...</span>
              </>
            )}
          </div>

          {/* Helius WebSocket — hidden on mobile */}
          {txWsConnected && (
            <div className="bg-slate-900/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 border border-blue-500/30 items-center gap-1.5 hidden sm:flex">
              <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
              <span className="text-xs text-blue-400">TXs: {transactionCount}</span>
            </div>
          )}

          {/* On-chain records toggle */}
          {gameState?.magicBlock?.ready && (
            <button
              onClick={() => setShowOnchainPanel(!showOnchainPanel)}
              className={`bg-slate-900/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 border flex items-center gap-1.5 transition-colors ${
                showOnchainPanel ? 'border-amber-500/50' : 'border-amber-500/30 hover:border-amber-400/60'
              }`}
            >
              <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
              <span className="text-[10px] sm:text-xs text-amber-400">{showOnchainPanel ? 'HIDE' : 'ONCHAIN'}</span>
            </button>
          )}

          {/* Wallet Connect */}
          {walletConnected && connectedWalletAddress ? (
            <button
              onClick={() => disconnectWallet()}
              className="bg-slate-900/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 border border-purple-500/50 flex items-center gap-1.5 hover:border-purple-400/70 transition-colors"
            >
              <Wallet className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] sm:text-xs text-purple-300 font-mono">
                {connectedWalletAddress.slice(0, 4)}..{connectedWalletAddress.slice(-3)}
              </span>
            </button>
          ) : (
            <button
              onClick={() => setWalletModalVisible(true)}
              className="bg-purple-600/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2.5 sm:px-4 py-1.5 sm:py-2 border border-purple-500/50 flex items-center gap-1.5 hover:bg-purple-500/80 transition-colors"
            >
              <Wallet className="w-3 h-3 text-white" />
              <span className="text-[10px] sm:text-xs text-white font-medium">Connect</span>
            </button>
          )}

          {/* Photo Upload */}
          {walletConnected && connectedWalletAddress && (
            <>
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={handlePhotoUpload}
              />
              <button
                onClick={() => photoInputRef.current?.click()}
                disabled={photoUploading}
                className="bg-slate-900/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 border border-cyan-500/50 flex items-center gap-1.5 hover:border-cyan-400/70 transition-colors disabled:opacity-50"
                title="Upload profile photo"
              >
                <Camera className="w-3 h-3 text-cyan-400" />
                <span className="text-[10px] sm:text-xs text-cyan-300 hidden sm:inline">
                  {photoUploading ? '...' : 'Photo'}
                </span>
              </button>
            </>
          )}

          {/* Music toggle — compact on mobile */}
          <button
            onClick={toggleMusic}
            className={`bg-slate-900/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 border flex items-center gap-1.5 transition-all hover:bg-slate-800/80 ${
              isMusicPlaying ? 'border-purple-500/50' : 'border-slate-700/50'
            }`}
            title={isMusicPlaying ? "Pause music" : "Play music"}
          >
            {isMusicPlaying ? (
              <Volume2 className="w-3.5 h-3.5 text-purple-400" />
            ) : (
              <VolumeX className="w-3.5 h-3.5 text-slate-400" />
            )}
          </button>
        </div>
      </motion.div>

      {/* Top Killers Leaderboard — scrollable, click to follow */}
      {topKillers.length > 0 && (
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="absolute top-14 sm:top-20 left-2 sm:left-4 z-10 w-40 sm:w-48"
        >
          <div className="bg-slate-900/80 backdrop-blur-md rounded-lg sm:rounded-xl border border-yellow-500/30 overflow-hidden">
            <div className="px-2 sm:px-3 py-1.5 border-b border-yellow-500/15 flex items-center justify-between">
              <span className="text-[10px] sm:text-xs text-yellow-400 font-medium">Top Killers</span>
              {followingAddress && (
                <button
                  onClick={() => setFollowingAddress(null)}
                  className="text-[9px] text-red-400 hover:text-red-300 transition-colors"
                >
                  UNFOLLOW
                </button>
              )}
            </div>
            <div className="max-h-64 sm:max-h-80 overflow-y-auto scrollbar-thin" onWheel={e => e.stopPropagation()}>
              {topKillers.map((killer: { address: string; kills: number }, i: number) => (
                <button
                  key={killer.address}
                  onClick={() => setFollowingAddress(followingAddress === killer.address ? null : killer.address)}
                  className={`w-full text-[10px] sm:text-xs flex items-center gap-1.5 px-2 sm:px-3 py-1 sm:py-1.5 transition-colors ${
                    followingAddress === killer.address
                      ? 'bg-yellow-500/20 border-l-2 border-yellow-400'
                      : 'hover:bg-slate-800/50 border-l-2 border-transparent'
                  }`}
                >
                  <span className={`w-4 text-right font-bold shrink-0 ${i < 3 ? 'text-yellow-400' : 'text-slate-500'}`}>
                    {i + 1}
                  </span>
                  <span className="text-slate-300 font-mono truncate">
                    {killer.address.slice(0, 6)}..
                  </span>
                  <span className="text-yellow-400 font-bold ml-auto shrink-0">{killer.kills}</span>
                </button>
              ))}
            </div>
          </div>
        </motion.div>
      )}

      {/* On-Chain Records Top Bar */}
      <AnimatePresence>
        {showOnchainPanel && gameState?.magicBlock && (
          <motion.div
            initial={{ opacity: 0, y: -40 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -40 }}
            transition={{ type: 'spring', damping: 25, stiffness: 300 }}
            className="absolute top-12 sm:top-[72px] right-2 sm:right-4 z-20 w-[calc(100%-1rem)] sm:w-80"
          >
            <div className="bg-slate-950/90 backdrop-blur-xl rounded-xl border border-amber-500/30 shadow-lg shadow-amber-500/5 overflow-hidden" onWheel={e => e.stopPropagation()}>
              {/* Compact header row */}
              <div className="px-3 py-1.5 flex items-center gap-3 border-b border-amber-500/15 bg-gradient-to-r from-amber-500/5 to-orange-500/5">
                <div className="flex items-center gap-1.5 shrink-0">
                  <div className="w-2 h-2 bg-amber-500 rounded-full animate-pulse" />
                  <span className="text-[11px] font-bold text-amber-400">On-Chain Records</span>
                </div>
                <div className="flex items-center gap-3 text-[9px] text-slate-500">
                  <span>ER <span className="text-amber-400 font-bold">{gameState.magicBlock.stats?.erLatencyMs ?? 0}ms</span></span>
                </div>
                <div className="ml-auto flex items-center gap-2">
                  <a
                    href={`https://explorer.solana.com/address/${gameState.magicBlock.programId}?cluster=devnet`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[9px] text-slate-600 hover:text-amber-400 transition-colors font-mono"
                  >
                    {gameState.magicBlock.programId?.slice(0, 10)}...
                  </a>
                  <button
                    onClick={() => setShowOnchainPanel(false)}
                    className="text-slate-500 hover:text-white transition-colors text-sm leading-none px-1"
                  >
                    &times;
                  </button>
                </div>
              </div>

              {/* Scrollable event log */}
              <div className="max-h-28 sm:max-h-36 overflow-y-auto scrollbar-thin">
                {(!gameState.magicBlock.eventLog || gameState.magicBlock.eventLog.length === 0) ? (
                  <div className="px-4 py-3 text-center text-[10px] text-slate-500">
                    Waiting for on-chain events...
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/15">
                    {gameState.magicBlock.eventLog
                      .filter((event: OnchainEvent) => event.type !== 'attack' && event.type !== 'attack_pending')
                      .map((event: OnchainEvent, i: number) => {

                      const iconMap: Record<string, string> = {
                        arena: '🏟️', register: '👤', delegate: '🔗', respawn: '💫',
                        kill: '💀', death: '☠️', upgrade: '⬆️', commit: '📤',
                        system: '⚙️', error: '❌',
                      };
                      const colorMap: Record<string, string> = {
                        arena: 'text-blue-400', register: 'text-cyan-400', delegate: 'text-purple-400',
                        respawn: 'text-teal-400', kill: 'text-red-400', death: 'text-rose-500',
                        upgrade: 'text-amber-400', commit: 'text-orange-400', system: 'text-slate-400',
                        error: 'text-red-500',
                      };
                      const age = Math.floor((Date.now() - event.time) / 1000);
                      const ageStr = age < 5 ? 'now' : age < 60 ? `${age}s` : age < 3600 ? `${Math.floor(age / 60)}m` : `${Math.floor(age / 3600)}h`;

                      return (
                        <div
                          key={`${event.time}-${i}`}
                          className={`px-3 py-1 hover:bg-slate-800/30 transition-colors ${i < 2 ? 'bg-slate-800/10' : ''}`}
                          style={{ opacity: Math.max(0.4, 1 - i * 0.02) }}
                        >
                          <div className="flex items-center gap-2">
                            <span className="text-[10px] leading-none shrink-0">{iconMap[event.type] || '📝'}</span>
                            <span className={`text-[10px] font-medium truncate ${colorMap[event.type] || 'text-slate-300'}`}>
                              {event.message}
                            </span>
                            {event.tx && (
                              <a
                                href={event.explorer || '#'}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-[8px] text-slate-600 hover:text-amber-400 transition-colors font-mono truncate max-w-[70px] shrink-0"
                              >
                                {event.tx}
                              </a>
                            )}
                            <span className="text-[8px] text-slate-600 shrink-0 ml-auto">{ageStr}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Player Stats & Upgrade Panel (connected wallet) */}
      {walletConnected && connectedWalletAddress && gameState?.magicBlock?.ready && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-14 sm:bottom-16 left-2 sm:left-4 z-10 w-56 sm:w-64"
        >
          <div className="bg-slate-900/90 backdrop-blur-md rounded-xl p-3 border border-purple-500/30">
            <div className="flex items-center justify-between mb-2">
              <div className="text-xs text-purple-400 font-medium flex items-center gap-2">
                <Zap className="w-3 h-3" />
                YOUR STATS (On-Chain)
              </div>
              <button
                onClick={() => setShowUpgradePanel(!showUpgradePanel)}
                className="text-[10px] text-purple-400/60 hover:text-purple-300 transition-colors"
              >
                {showUpgradePanel ? 'Hide' : 'Upgrades'}
              </button>
            </div>

            {(() => {
              const myBubble = battleState.bubbles.get(connectedWalletAddress);
              if (!myBubble) return <div className="text-xs text-slate-500">Not a holder of this token</div>;

              const xp = myBubble.xp ?? onchainStats?.xp ?? 0;
              const level = myBubble.level ?? 1;
              const healthLvl = myBubble.healthLevel ?? onchainStats?.healthLevel ?? 1;
              const attackLvl = myBubble.attackLevel ?? onchainStats?.attackLevel ?? 1;
              const kills = myBubble.kills;
              const deaths = myBubble.deaths;

              // Upgrade cost formula matches onchain: base 100 + level * 50
              const healthUpgradeCost = 100 + healthLvl * 50;
              const attackUpgradeCost = 100 + attackLvl * 50;

              return (
                <div className="space-y-2">
                  {/* Level & XP bar */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Star className="w-3 h-3 text-yellow-400" />
                      <span className="text-sm font-bold text-white">Level {level}</span>
                    </div>
                    <span className="text-xs text-amber-400 font-mono">{xp} XP</span>
                  </div>

                  {/* K/D */}
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-green-400">Kills: {kills}</span>
                    <span className="text-red-400">Deaths: {deaths}</span>
                    <span className="text-slate-400">KD: {deaths > 0 ? (kills / deaths).toFixed(1) : kills.toFixed(0)}</span>
                  </div>

                  {/* Stat levels */}
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="flex items-center gap-1.5 bg-slate-800/50 rounded-lg px-2 py-1.5">
                      <Shield className="w-3 h-3 text-green-400" />
                      <span className="text-slate-300">HP Lv.{healthLvl}</span>
                    </div>
                    <div className="flex items-center gap-1.5 bg-slate-800/50 rounded-lg px-2 py-1.5">
                      <Crosshair className="w-3 h-3 text-red-400" />
                      <span className="text-slate-300">ATK Lv.{attackLvl}</span>
                    </div>
                  </div>

                  {/* Upgrade buttons */}
                  {showUpgradePanel && (
                    <motion.div
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      className="space-y-1.5 pt-2 border-t border-slate-700/50"
                    >
                      <div className="text-[10px] text-slate-500 uppercase tracking-wider">Spend XP to Upgrade</div>
                      <button
                        onClick={() => handleUpgrade(0)}
                        disabled={upgrading !== null || xp < healthUpgradeCost}
                        className="w-full flex items-center justify-between bg-green-900/30 hover:bg-green-900/50 disabled:opacity-40 disabled:hover:bg-green-900/30 rounded-lg px-3 py-2 text-xs transition-colors border border-green-500/20"
                      >
                        <div className="flex items-center gap-2">
                          <Shield className="w-3.5 h-3.5 text-green-400" />
                          <span className="text-green-300">Health Lv.{healthLvl} → {healthLvl + 1}</span>
                        </div>
                        <span className={`font-mono ${xp >= healthUpgradeCost ? 'text-amber-400' : 'text-slate-500'}`}>
                          {upgrading === 0 ? '...' : `${healthUpgradeCost} XP`}
                        </span>
                      </button>
                      <button
                        onClick={() => handleUpgrade(1)}
                        disabled={upgrading !== null || xp < attackUpgradeCost}
                        className="w-full flex items-center justify-between bg-red-900/30 hover:bg-red-900/50 disabled:opacity-40 disabled:hover:bg-red-900/30 rounded-lg px-3 py-2 text-xs transition-colors border border-red-500/20"
                      >
                        <div className="flex items-center gap-2">
                          <Crosshair className="w-3.5 h-3.5 text-red-400" />
                          <span className="text-red-300">Attack Lv.{attackLvl} → {attackLvl + 1}</span>
                        </div>
                        <span className={`font-mono ${xp >= attackUpgradeCost ? 'text-amber-400' : 'text-slate-500'}`}>
                          {upgrading === 1 ? '...' : `${attackUpgradeCost} XP`}
                        </span>
                      </button>
                    </motion.div>
                  )}

                  {/* Onchain verification */}
                  {onchainStats && (
                    <div className="text-[10px] text-amber-500/50 flex items-center gap-1 pt-1">
                      <div className="w-1.5 h-1.5 bg-amber-500 rounded-full" />
                      Verified on-chain
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        </motion.div>
      )}

      {/* Kill Streak Announcements */}
      <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
        {announcements
          .filter(a => a.type === 'streak')
          .slice(-2)
          .map(ann => (
            <div
              key={ann.id}
              className="absolute inset-0 flex items-center justify-center"
              style={{
                animation: 'streak-pulse 3s ease-out forwards',
              }}
            >
              <div className="text-center">
                <div
                  className="text-5xl sm:text-7xl font-black tracking-widest select-none"
                  style={{
                    color: ann.color,
                    textShadow: `0 0 40px ${ann.glowColor}, 0 0 80px ${ann.glowColor}, 0 2px 4px rgba(0,0,0,0.8)`,
                    WebkitTextStroke: '1px rgba(255,255,255,0.15)',
                  }}
                >
                  {ann.text}
                </div>
                <div
                  className="text-sm sm:text-base font-bold mt-2 tracking-wide"
                  style={{
                    color: ann.color,
                    opacity: 0.8,
                    textShadow: `0 0 10px ${ann.glowColor}`,
                  }}
                >
                  {ann.subtext}
                </div>
              </div>
            </div>
          ))}
      </div>

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
          popEffects={popEffects}
          camera={camera}
          connectedWallet={connectedWalletAddress}
          onHolderClick={setSelectedHolder}
          onHolderHover={setHoveredHolder}
        />
      )}

      {/* Compact Bottom Control Bar */}
      <div className="absolute bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 z-20">
        <div className="flex items-center gap-0.5 sm:gap-1 bg-slate-900/70 backdrop-blur-md rounded-full px-1.5 sm:px-2 py-1 sm:py-1.5 border border-slate-700/50 scale-90 sm:scale-100 origin-center">
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

      {/* Hover Tooltip — hidden on mobile (no hover) */}
      <AnimatePresence>
        {hoveredHolder && !selectedHolder && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10 hidden sm:block"
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
              {battleState.bubbles.get(hoveredHolder.address) && (() => {
                const b = battleState.bubbles.get(hoveredHolder.address)!;
                return (
                  <div className="text-xs text-slate-400 border-l border-slate-600 pl-3 flex items-center gap-2">
                    {(b.level ?? 1) > 1 && (
                      <span className="text-purple-400 font-bold">Lv.{b.level}</span>
                    )}
                    <span>❤️ {b.health.toFixed(0)}/{b.maxHealth} HP</span>
                    {b.kills > 0 && (
                      <span className="text-yellow-400">
                        ☠️ {b.kills}
                      </span>
                    )}
                    {(b.holdStreakDays ?? 0) > 0 && (
                      <span className="text-blue-400">
                        💎 {b.holdStreakDays}d
                      </span>
                    )}
                  </div>
                );
              })()}
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

      {/* Live Feed */}
      {eventLog.length > 0 && (
        <div className="absolute bottom-12 sm:bottom-4 right-2 sm:right-4 bg-slate-900/80 backdrop-blur-md rounded-lg sm:rounded-xl p-2 sm:p-3 border border-slate-700/50 z-10 w-48 sm:w-64">
          <div className="text-xs text-slate-400 mb-2 font-medium">📊 Live Feed</div>
          <div className="space-y-1">
            {eventLog.slice(0, 8).map((event, i) => (
              <div
                key={`ev-${i}`}
                className="text-xs text-slate-300 font-mono truncate"
                style={{ opacity: Math.max(0.3, 1 - i * 0.1) }}
              >
                {event}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Info button — bottom left */}
      <button
        onClick={() => setShowRules(true)}
        className="absolute bottom-12 sm:bottom-4 left-2 sm:left-4 z-20 w-8 h-8 sm:w-9 sm:h-9 rounded-full flex items-center justify-center transition-all hover:scale-110 active:scale-95"
        style={{
          background: "linear-gradient(135deg, rgba(255,0,255,0.15), rgba(0,255,255,0.15))",
          border: "1px solid rgba(255,0,255,0.3)",
          boxShadow: "0 0 15px rgba(255,0,255,0.1)",
        }}
        title="Game rules"
      >
        <Info className="w-4 h-4 text-purple-300" />
      </button>

      {/* Welcome modal — shows once per device */}
      <WelcomeModal />

      {/* Rules modal — opened via info button */}
      {showRules && (
        <WelcomeModal
          forceOpen
          onClose={() => setShowRules(false)}
        />
      )}
    </div>
  );
}
