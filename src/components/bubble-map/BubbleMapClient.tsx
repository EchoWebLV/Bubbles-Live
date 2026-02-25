"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2, RefreshCw, Users, TrendingUp, TrendingDown, Wifi, WifiOff, Swords, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Volume2, VolumeX, Info, Wallet, Shield, Crosshair, Zap, Star, Camera, User, X } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { WelcomeModal } from "@/components/WelcomeModal";
import { BubbleCanvas } from "./BubbleCanvas";
import { HolderModal } from "./HolderModal";
import { useGameSocket, GameState, GameHolder, GameBattleBubble, OnchainPlayerStats, OnchainEvent, TalentRanks } from "@/hooks/useGameSocket";
import { useHolderWebSocket } from "@/hooks/useHolderWebSocket";
import type { Holder, TokenInfo } from "./types";
import type { BattleState } from "./battle";
import {
  EffectsState,
  createInitialEffectsState,
  updateEffects,
  createDeathbombExplosion,
  createBulletPopFirework,
  createSmallBulletPop,
  createLightningArc,
  createLightningArcData,
  type LightningArc,
  type ReaperArcVfx,
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

// Talent tree display config (mirrors server/talentConfig.js for UI)
const TALENT_TREES = {
  tank: {
    name: 'Tank',
    color: 'green',
    icon: '🛡️',
    talents: [
      { id: 'armor', name: 'Armor', desc: '-4/8/12/16/24% incoming dmg', maxRank: 5 },
      { id: 'ironSkin', name: 'Iron Skin', desc: '+10/15/20/25/30% max HP', maxRank: 5 },
      { id: 'regeneration', name: 'Regeneration', desc: '+0.3/0.6/0.9/1.2/1.5 HP/sec', maxRank: 5 },
      { id: 'lifesteal', name: 'Lifesteal', desc: 'Heal 5/10/15/20/25% of dmg dealt', maxRank: 5 },
      { id: 'vitalityStrike', name: 'Vitality Strike', desc: '+0.25/0.4/0.6% max HP as bullet dmg', maxRank: 3 },
    ],
  },
  firepower: {
    name: 'Firepower',
    color: 'red',
    icon: '🎯',
    talents: [
      { id: 'heavyHitter', name: 'Heavy Hitter', desc: '+4/8/12/16/24% bullet dmg', maxRank: 5 },
      { id: 'rapidFire', name: 'Rapid Fire', desc: '-6/12/18/24/30% fire cooldown', maxRank: 5 },
      { id: 'criticalStrike', name: 'Critical Strike', desc: '7/14/21/28/35% crit (2/2.2/2.6/2.8/3x dmg)', maxRank: 5 },
      { id: 'multiShot', name: 'Multi Shot', desc: '12/24/36/48/60% chance 2nd bullet (75% dmg)', maxRank: 5 },
      { id: 'dualCannon', name: 'Homing Cannon', desc: 'Every 6/5/4th shot: homing bullet toward your target, 333% dmg', maxRank: 3 },
    ],
  },
  brawler: {
    name: 'Brawler',
    color: 'blue',
    icon: '💨',
    talents: [
      { id: 'dash', name: 'Dash', desc: 'Burst dash every 12/10/8/6/4s', maxRank: 5 },
      { id: 'bodySlam', name: 'Body Slam', desc: 'Contact deals 1.5/2.5/3.5/4.5/5.5% max HP dmg (1.5s cd)', maxRank: 5 },
      { id: 'relentless', name: 'Pinball', desc: 'Body Slam dashes you 50/100/150/200/250px toward nearest enemy', maxRank: 5 },
      { id: 'orbit', name: 'Orbit', desc: '2 orbs circle you, dealing 0.5/0.75/1/1.25/1.5% max HP on contact', maxRank: 5 },
      { id: 'shockwave', name: 'Shockwave', desc: 'Body hit AoE 4/6/8% max HP', maxRank: 3 },
    ],
  },
  massDamage: {
    name: 'Mass Damage',
    color: 'yellow',
    icon: '💥',
    talents: [
      { id: 'ricochet', name: 'Ricochet', desc: '11/19/26/34/49% chance to bounce', maxRank: 5 },
      { id: 'counterAttack', name: 'Counter Attack', desc: '8/16/24/32/40% chance to fire back', maxRank: 5 },
      { id: 'focusFire', name: 'Focus Fire', desc: '+3/6/9/12/15% dmg per hit on same target, max 3 stacks', maxRank: 5 },
      { id: 'nova', name: 'Nova', desc: 'Spiral 5/8/11/14/18 bullets every 1s', maxRank: 5 },
      { id: 'chainLightning', name: 'Chain Lightning', desc: '5/10/15% chance: lightning to 2/3/4 enemies (450% dmg, -50% per jump)', maxRank: 3 },
    ],
  },
  bloodThirst: {
    name: 'Blood Thirst',
    color: 'purple',
    icon: '🩸',
    talents: [
      { id: 'experience', name: 'Experience', desc: '+10/17/24/32/40% XP gained', maxRank: 5 },
      { id: 'execute', name: 'Execute', desc: '+8/16/24/32/48% dmg vs ≤50% HP', maxRank: 5 },
      { id: 'killRush', name: 'Kill Rush', desc: 'On kill: +20/40/60/80/100% fire rate for 4s', maxRank: 5 },
      { id: 'reaperArc', name: "Reaper's Arc", desc: 'Every 15th hit: 360° sweep. 1/2/3/4/5% max HP dmg, costs 0.5/1/1.5/2/2.5% HP', maxRank: 5 },
      { id: 'berserker', name: 'Berserker', desc: 'Below 33% HP: +20/30/40% atk speed & dmg. +1.5/2.5/3.5 HP/s regen', maxRank: 3 },
    ],
  },
} as const;

function totalPointsSpentClient(talents: Record<string, number>): number {
  let total = 0;
  for (const v of Object.values(talents)) total += (v || 0);
  return total;
}

const CAPSTONE_IDS = ['vitalityStrike', 'dualCannon', 'shockwave', 'chainLightning', 'berserker'];
const MAX_CAPSTONES = 2;

function capstonesChosen(talents: Record<string, number>): number {
  return CAPSTONE_IDS.filter(id => (talents[id] || 0) > 0).length;
}

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
  const { connected, gameState, playerPhotos, guestAddress, setDimensions: sendDimensions, sendTransaction, upgradeStat, allocateTalent, resetTalents, getOnchainStats, uploadPhoto, removePhoto, joinAsGuest, leaveGuest } = useGameSocket();
  const effectiveAddress = guestAddress || connectedWalletAddress;
  const isGuest = !!guestAddress;

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
  const [upgrading, setUpgrading] = useState<number | null>(null);
  const [onchainStats, setOnchainStats] = useState<OnchainPlayerStats | null>(null);
  const [showUpgradePanel, setShowUpgradePanel] = useState(false);
  const [showOnchainPanel, setShowOnchainPanel] = useState(true);
  const [showTalentTree, setShowTalentTree] = useState(false);
  const [allocatingTalent, setAllocatingTalent] = useState<string | null>(null);

  const handleAllocateTalent = useCallback(async (talentId: string) => {
    if (!effectiveAddress || allocatingTalent) return;
    setAllocatingTalent(talentId);
    try {
      await allocateTalent(effectiveAddress, talentId);
    } finally {
      setAllocatingTalent(null);
    }
  }, [effectiveAddress, allocatingTalent, allocateTalent]);

  const handleResetTalents = useCallback(async () => {
    if (!effectiveAddress || allocatingTalent) return;
    setAllocatingTalent('reset');
    try {
      await resetTalents(effectiveAddress);
    } finally {
      setAllocatingTalent(null);
    }
  }, [effectiveAddress, allocatingTalent, resetTalents]);

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

      const isMyKill = kill.killer === effectiveAddress;
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
  }, [gameState?.killFeed, effectiveAddress]);

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
        level: b.level ?? 1,
        xp: b.xp ?? 0,
        healthLevel: b.healthLevel ?? 1,
        attackLevel: b.attackLevel ?? 1,
        attackPower: b.attackPower ?? 10,
        isAlive: b.isAlive !== false,
        talents: b.talents ?? ({} as TalentRanks),
        talentPoints: b.talentPoints ?? 0,
        manualBuild: b.manualBuild ?? false,
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
  const killFeed = gameState?.killFeed || [];

  const isLoading = !gameState;

  const processedVfxRef = useRef<Set<string>>(new Set());
  const [lightningArcs, setLightningArcs] = useState<LightningArc[]>([]);
  const [reaperArcs, setReaperArcs] = useState<ReaperArcVfx[]>([]);
  const vfxList = gameState?.vfx || [];
  useEffect(() => {
    if (vfxList.length === 0) return;
    const newEffects: ReturnType<typeof createDeathbombExplosion>[] = [];
    const newArcs: LightningArc[] = [];
    const newReaperArcs: ReaperArcVfx[] = [];
    for (const v of vfxList) {
      const key = `${v.type}-${v.x}-${v.y}-${v.createdAt}`;
      if (processedVfxRef.current.has(key)) continue;
      processedVfxRef.current.add(key);
      if (v.type === 'bloodbath' || v.type === 'shockwave') {
        newEffects.push(createDeathbombExplosion(v.x, v.y, v.radius || 200, v.color));
      } else if (v.type === 'bulletPop') {
        newEffects.push(v.small ? createSmallBulletPop(v.x, v.y, v.color) : createBulletPopFirework(v.x, v.y, v.color));
      } else if (v.type === 'lightning' && v.targetX !== undefined && v.targetY !== undefined) {
        newEffects.push(createLightningArc(v.x, v.y, v.targetX, v.targetY, v.color));
        newArcs.push(createLightningArcData(v.x, v.y, v.targetX, v.targetY, v.color));
      } else if (v.type === 'reaperArc') {
        newReaperArcs.push({ x: v.x, y: v.y, angle: v.angle ?? 0, range: v.range ?? 200, color: v.color, createdAt: Date.now(), duration: 800 });
      }
    }
    if (newEffects.length > 0) {
      setEffectsState(prev => ({
        ...prev,
        explosions: [...prev.explosions, ...newEffects],
      }));
    }
    if (newArcs.length > 0) {
      setLightningArcs(prev => [...prev, ...newArcs].filter(a => Date.now() - a.createdAt < a.duration));
    }
    if (newReaperArcs.length > 0) {
      setReaperArcs(prev => [...prev, ...newReaperArcs].filter(a => Date.now() - a.createdAt < a.duration));
    }
    if (processedVfxRef.current.size > 500) {
      const entries = Array.from(processedVfxRef.current);
      processedVfxRef.current = new Set(entries.slice(-200));
    }
  }, [vfxList]);

  // Clean up expired lightning arcs and reaper arcs
  useEffect(() => {
    const interval = setInterval(() => {
      setLightningArcs(prev => prev.filter(a => Date.now() - a.createdAt < a.duration));
      setReaperArcs(prev => prev.filter(a => Date.now() - a.createdAt < a.duration));
    }, 100);
    return () => clearInterval(interval);
  }, []);

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
              <span className="text-[10px] sm:text-xs text-amber-400">{showOnchainPanel ? 'HIDE' : 'ER PANEL'}</span>
            </button>
          )}

          {/* Wallet Connect / Guest */}
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
          ) : isGuest ? (
            <button
              onClick={() => leaveGuest()}
              className="bg-slate-900/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2 sm:px-3 py-1.5 sm:py-2 border border-orange-500/50 flex items-center gap-1.5 hover:border-orange-400/70 transition-colors"
            >
              <User className="w-3 h-3 text-orange-400" />
              <span className="text-[10px] sm:text-xs text-orange-300 font-medium">Guest</span>
              <X className="w-2.5 h-2.5 text-orange-400/70" />
            </button>
          ) : (
            <div className="flex items-center gap-1.5">
              <button
                onClick={() => setWalletModalVisible(true)}
                className="bg-purple-600/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2.5 sm:px-4 py-1.5 sm:py-2 border border-purple-500/50 flex items-center gap-1.5 hover:bg-purple-500/80 transition-colors"
              >
                <Wallet className="w-3 h-3 text-white" />
                <span className="text-[10px] sm:text-xs text-white font-medium">Connect</span>
              </button>
              <button
                onClick={() => joinAsGuest()}
                className="bg-orange-600/80 backdrop-blur-md rounded-lg sm:rounded-xl px-2.5 sm:px-4 py-1.5 sm:py-2 border border-orange-500/50 flex items-center gap-1.5 hover:bg-orange-500/80 transition-colors"
              >
                <User className="w-3 h-3 text-white" />
                <span className="text-[10px] sm:text-xs text-white font-medium">Try as Guest</span>
              </button>
            </div>
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
              {topKillers.map((killer: { address: string; kills: number; level: number }, i: number) => (
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
                  <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[8px] font-bold shrink-0 ${
                    killer.level >= 5 ? 'bg-purple-500/80 text-white' :
                    killer.level >= 3 ? 'bg-blue-500/80 text-white' :
                    'bg-slate-600/80 text-slate-200'
                  }`}>
                    {killer.level}
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

      {/* Kill Feed — hidden for now */}
      {false && killFeed.length > 0 && (
        <div className="absolute bottom-2 sm:bottom-4 left-2 sm:left-4 z-10 w-44 sm:w-52">
          <div className="bg-slate-900/70 backdrop-blur-md rounded-lg border border-red-500/20 overflow-hidden">
            <div className="px-2 py-1 border-b border-red-500/10">
              <span className="text-[9px] sm:text-[10px] text-red-400 font-medium">Recent Kills</span>
            </div>
            <div className="flex flex-col">
              {killFeed.slice(0, 6).map((kill, i) => (
                <div
                  key={`${kill.killer}-${kill.victim}-${kill.time}`}
                  className="flex items-center gap-1 px-2 py-0.5 text-[9px] sm:text-[10px]"
                  style={{ opacity: 1 - i * 0.12 }}
                >
                  <span className="text-red-400 font-bold font-mono truncate max-w-[60px]">{kill.killer.slice(0, 6)}</span>
                  <span className="text-slate-500 shrink-0">killed</span>
                  <span className="text-slate-300 font-mono truncate max-w-[60px]">{kill.victim.slice(0, 6)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
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
                  <span className="text-[11px] font-bold text-amber-400">Ephemeral Rollup</span>
                </div>
                <div className="flex items-center gap-3 text-[9px] text-slate-500">
                  <span>Latency <span className="text-amber-400 font-bold">{gameState.magicBlock.stats?.erLatencyMs ?? 0}ms</span></span>
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

              {/* Chain authority badge */}
              <div className="px-3 py-1.5 border-b border-amber-500/10 bg-gradient-to-r from-green-900/10 to-emerald-900/5">
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1">
                    <div className="w-1.5 h-1.5 bg-green-500 rounded-full" />
                    <span className="text-[9px] font-semibold text-green-400">CHAIN AUTHORITY</span>
                  </div>
                  <span className="text-[8px] text-slate-500">Damage, XP & Kills computed on-chain</span>
                </div>
              </div>

              {/* Live stats grid */}
              {(() => {
                const stats = gameState.magicBlock.stats;
                const sent = stats?.attacksSent ?? 0;
                const confirmed = stats?.attacksConfirmed ?? 0;
                const rejected = stats?.attacksRejected ?? 0;
                const failed = stats?.attacksFailed ?? 0;
                const processed = confirmed + rejected;
                const successRate = processed > 0 ? Math.round((confirmed / processed) * 100) : 0;
                const commits = stats?.commits ?? 0;
                const lastCommit = stats?.lastCommitTime;
                const lastCommitAgo = lastCommit ? Math.floor((Date.now() - lastCommit) / 1000) : null;
                const lastCommitStr = lastCommitAgo === null ? '—' : lastCommitAgo < 60 ? `${lastCommitAgo}s ago` : `${Math.floor(lastCommitAgo / 60)}m ago`;
                const registered = gameState.magicBlock.playersRegistered ?? 0;
                const delegated = gameState.magicBlock.playersDelegated ?? 0;

                return (
                  <div className="px-3 py-2 border-b border-amber-500/10 space-y-1.5">
                    {/* Attacks row */}
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-500">Combat TXs</span>
                      <div className="flex items-center gap-2 text-[9px] font-mono">
                        <span className="text-emerald-400">{confirmed}</span>
                        <span className="text-slate-600">verified</span>
                        {rejected > 0 && <span className="text-slate-500">({rejected} stale)</span>}
                        {failed > 0 && <span className="text-red-400/70">({failed} err)</span>}
                      </div>
                    </div>
                    {/* Chain verification rate */}
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-500">Chain Verify Rate</span>
                      <span className={`text-[9px] font-mono font-bold ${successRate >= 80 ? 'text-emerald-400' : successRate >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                        {successRate}%
                      </span>
                    </div>
                    {/* Players on ER */}
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-500">Players on ER</span>
                      <div className="flex items-center gap-2 text-[9px] font-mono">
                        <span className="text-cyan-400">{delegated}</span>
                        <span className="text-slate-600">delegated</span>
                        <span className="text-slate-600">/</span>
                        <span className="text-slate-400">{registered}</span>
                        <span className="text-slate-600">registered</span>
                      </div>
                    </div>
                    {/* Commits row */}
                    <div className="flex items-center justify-between">
                      <span className="text-[9px] text-slate-500">Base Layer Commits</span>
                      <div className="flex items-center gap-2 text-[9px] font-mono">
                        <span className="text-orange-400">{commits}</span>
                        {lastCommit ? <span className="text-slate-600">(last: {lastCommitStr})</span> : null}
                      </div>
                    </div>
                  </div>
                );
              })()}

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

      {/* Player Stats Panel (connected wallet or guest) */}
      {(walletConnected && connectedWalletAddress || isGuest) && effectiveAddress && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="absolute bottom-14 sm:bottom-16 left-2 sm:left-4 z-10 w-56 sm:w-64"
        >
          <div className={`bg-slate-900/90 backdrop-blur-md rounded-xl p-3 border ${isGuest ? 'border-orange-500/30' : 'border-purple-500/30'}`}>
            {(() => {
              const myBubble = battleState.bubbles.get(effectiveAddress);
              if (!myBubble) return <div className="text-xs text-slate-500">{isGuest ? 'Joining...' : 'Not a holder of this token'}</div>;

              const xp = myBubble.xp ?? 0;
              const level = myBubble.level ?? 1;
              const kills = myBubble.kills;
              const deaths = myBubble.deaths;
              const tp = myBubble.talentPoints ?? 0;

              return (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5">
                      <Star className="w-3 h-3 text-yellow-400" />
                      <span className="text-sm font-bold text-white">Lv. {level}</span>
                      {isGuest && <span className="text-[9px] text-orange-400 bg-orange-500/20 px-1 rounded">GUEST</span>}
                    </div>
                    <span className="text-xs text-amber-400 font-mono">{xp} XP</span>
                  </div>
                  <div className="flex items-center gap-3 text-xs">
                    <span className="text-green-400">☠️ {kills}</span>
                    <span className="text-red-400">💀 {deaths}</span>
                    <span className="text-slate-400">KD: {deaths > 0 ? (kills / deaths).toFixed(1) : kills.toFixed(0)}</span>
                  </div>
                  <button
                    onClick={() => setFollowingAddress(followingAddress === effectiveAddress ? null : effectiveAddress)}
                    className={`w-full flex items-center justify-center gap-2 rounded-lg px-3 py-1.5 text-xs font-medium transition-colors border ${
                      followingAddress === effectiveAddress
                        ? 'bg-cyan-900/40 hover:bg-cyan-900/60 border-cyan-500/40 text-cyan-300'
                        : 'bg-slate-800/50 hover:bg-slate-700/50 border-slate-600/30 text-slate-300'
                    }`}
                  >
                    <Crosshair className="w-3 h-3" />
                    {followingAddress === effectiveAddress ? 'Unfollow' : 'Follow Me'}
                  </button>
                  <button
                    onClick={() => setShowTalentTree(!showTalentTree)}
                    className={`w-full flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-medium transition-colors border ${
                      tp > 0
                        ? 'bg-amber-900/40 hover:bg-amber-900/60 border-amber-500/40 text-amber-300 animate-pulse'
                        : 'bg-slate-800/50 hover:bg-slate-700/50 border-slate-600/30 text-slate-300'
                    }`}
                  >
                    <Zap className="w-3.5 h-3.5" />
                    {showTalentTree ? 'Hide Talents' : tp > 0 ? `Talent Tree (${tp} pts)` : 'Talent Tree'}
                  </button>
                </div>
              );
            })()}
          </div>
        </motion.div>
      )}

      {/* Bottom-center HUD — shows stats of followed bubble */}
      {followingAddress && (() => {
        const bubble = battleState.bubbles.get(followingAddress);
        if (!bubble) return null;
        const health = bubble.health ?? 0;
        const maxHealth = bubble.maxHealth ?? 1;
        const hpPct = Math.min(100, Math.max(0, (health / maxHealth) * 100));
        const hpBarColor = hpPct > 50 ? 'bg-green-500' : hpPct > 25 ? 'bg-yellow-500' : 'bg-red-500';
        const level = bubble.level ?? 1;
        const kills = bubble.kills;
        const deaths = bubble.deaths;
        const isMe = followingAddress === effectiveAddress;
        const shortAddr = followingAddress.slice(0, 4) + '...' + followingAddress.slice(-4);

        return (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="absolute bottom-3 sm:bottom-4 left-1/2 -translate-x-1/2 z-10"
          >
            <div className="bg-slate-900/80 backdrop-blur-md rounded-lg px-2 sm:px-3 py-1 sm:py-1.5 border border-slate-700/50 flex items-center gap-1.5 sm:gap-3 text-[9px] sm:text-[11px]">
              <span className="text-slate-500 font-mono hidden sm:inline">{isMe ? 'YOU' : shortAddr}</span>
              <span className="text-yellow-400 font-bold">Lv.{level}</span>
              <div className="flex items-center gap-1 sm:gap-1.5 min-w-[60px] sm:min-w-[110px]">
                <span className="text-slate-400 font-mono whitespace-nowrap">{Math.round(health)}/{Math.round(maxHealth)}</span>
                <div className="flex-1 h-1.5 sm:h-2 bg-slate-800 rounded-full overflow-hidden border border-slate-700/50">
                  <div className={`h-full ${hpBarColor} rounded-full transition-all duration-150`} style={{ width: `${hpPct}%` }} />
                </div>
              </div>
              <span className="text-green-400">{kills}k</span>
              <span className="text-red-400">{deaths}d</span>
            </div>
          </motion.div>
        );
      })()}

      {/* Talent Tree Modal */}
      <AnimatePresence>
        {showTalentTree && effectiveAddress && (walletConnected || isGuest) && (() => {
          const myBubble = battleState.bubbles.get(effectiveAddress);
          if (!myBubble) return null;
          const talents = myBubble.talents || {} as TalentRanks;
          const tp = myBubble.talentPoints ?? 0;

          const treeColorMap: Record<string, { bg: string; border: string; text: string; rankBg: string; rankFill: string }> = {
            green:  { bg: 'bg-green-900/20',  border: 'border-green-500/30',  text: 'text-green-400',  rankBg: 'bg-green-900/30',  rankFill: 'bg-green-500' },
            blue:   { bg: 'bg-blue-900/20',   border: 'border-blue-500/30',   text: 'text-blue-400',   rankBg: 'bg-blue-900/30',   rankFill: 'bg-blue-500' },
            red:    { bg: 'bg-red-900/20',    border: 'border-red-500/30',    text: 'text-red-400',    rankBg: 'bg-red-900/30',    rankFill: 'bg-red-500' },
            yellow: { bg: 'bg-yellow-900/20', border: 'border-yellow-500/30', text: 'text-yellow-400', rankBg: 'bg-yellow-900/30', rankFill: 'bg-yellow-500' },
            purple: { bg: 'bg-purple-900/20', border: 'border-purple-500/30', text: 'text-purple-400', rankBg: 'bg-purple-900/30', rankFill: 'bg-purple-500' },
          };

          return (
            <motion.div
              key="talent-tree"
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="absolute inset-0 z-40 flex items-center justify-center p-4 pointer-events-none"
            >
              <div className="pointer-events-auto bg-slate-950/95 backdrop-blur-xl rounded-2xl border border-purple-500/30 p-4 sm:p-6 max-w-6xl w-full max-h-[85vh] overflow-y-auto">
                <div className="flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <h2 className="text-lg font-bold text-white">Talent Tree</h2>
                    <span className="text-sm font-mono text-amber-400">
                      {tp > 0 ? `${tp} points available` : 'No points available'}
                    </span>
                    <span className="text-xs font-mono text-purple-400/80">
                      Ultimates: {capstonesChosen(talents)}/{MAX_CAPSTONES}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleResetTalents}
                      disabled={allocatingTalent !== null || totalPointsSpentClient(talents) === 0}
                      className="text-[10px] text-red-400/70 hover:text-red-300 disabled:opacity-30 transition-colors px-2 py-1 rounded border border-red-500/20 hover:border-red-500/40"
                    >
                      Reset All
                    </button>
                    <button
                      onClick={() => setShowTalentTree(false)}
                      className="text-slate-400 hover:text-white text-xl leading-none px-2"
                    >
                      ×
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-5 gap-3">
                  {Object.entries(TALENT_TREES).map(([treeKey, tree]) => {
                    const colors = treeColorMap[tree.color];
                    return (
                      <div key={treeKey} className={`rounded-xl border ${colors.border} ${colors.bg} p-3`}>
                        <div className={`text-sm font-bold ${colors.text} mb-3 flex items-center gap-2`}>
                          <span>{tree.icon}</span>
                          {tree.name}
                        </div>
                        <div className="space-y-2">
                          {tree.talents.map((talent, talentIdx) => {
                            const rank = talents[talent.id] ?? 0;
                            const isMaxed = rank >= talent.maxRank;
                            const prereqMet = talentIdx === 0 || (talents[tree.talents[talentIdx - 1].id] ?? 0) >= 1;
                            const isCapstone = CAPSTONE_IDS.includes(talent.id);
                            const capstoneLocked = isCapstone && rank === 0 && capstonesChosen(talents) >= MAX_CAPSTONES;
                            const canUpgrade = tp > 0 && !isMaxed && prereqMet && !capstoneLocked;
                            const isLocked = (!prereqMet && rank === 0) || capstoneLocked;
                            return (
                              <button
                                key={talent.id}
                                onClick={() => canUpgrade && handleAllocateTalent(talent.id)}
                                disabled={!canUpgrade || allocatingTalent !== null}
                                className={`w-full text-left rounded-lg px-3 py-2 transition-all border ${
                                  isLocked
                                    ? 'bg-slate-800/20 border-slate-700/20 opacity-30'
                                    : canUpgrade
                                      ? `${colors.bg} hover:brightness-125 ${colors.border} cursor-pointer`
                                      : isMaxed
                                        ? `${colors.bg} ${colors.border} opacity-70`
                                        : 'bg-slate-800/30 border-slate-700/30 opacity-50'
                                } ${allocatingTalent === talent.id ? 'animate-pulse' : ''}`}
                              >
                                <div className="flex items-center justify-between mb-1">
                                  <span className={`text-xs font-medium ${isLocked ? 'text-slate-500' : 'text-white'}`}>
                                    {capstoneLocked ? '🚫 ' : isLocked ? '🔒 ' : ''}{talent.name}
                                  </span>
                                  <div className="flex gap-0.5">
                                    {Array.from({ length: talent.maxRank }).map((_, i) => (
                                      <div
                                        key={i}
                                        className={`w-2.5 h-2.5 rounded-sm ${i < rank ? colors.rankFill : colors.rankBg}`}
                                      />
                                    ))}
                                  </div>
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {capstoneLocked ? 'Max 2 ultimates chosen' : talent.desc}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </motion.div>
          );
        })()}
      </AnimatePresence>

      {/* Kill Streak Announcements */}
      <div className="absolute inset-0 pointer-events-none z-30 overflow-hidden">
        {announcements
          .filter(a => a.type === 'streak')
          .slice(-2)
          .map(ann => (
            <div
              key={ann.id}
              className="absolute inset-0 flex justify-center"
              style={{
                animation: 'streak-pulse 3s ease-out forwards',
                paddingTop: '25vh',
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
          worldWidth={gameState?.dimensions?.width || 3840}
          worldHeight={gameState?.dimensions?.height || 2160}
          hoveredHolder={hoveredHolder}
          effectsState={effectsState}
          battleState={battleState}
          popEffects={popEffects}
          camera={camera}
          connectedWallet={effectiveAddress}
          lightningArcs={lightningArcs}
          reaperArcs={reaperArcs}
          onHolderClick={setSelectedHolder}
          onHolderHover={setHoveredHolder}
        />
      )}

      {/* Compact Bottom Control Bar — hidden for now */}
      <div className="absolute bottom-2 sm:bottom-3 left-1/2 -translate-x-1/2 z-20 hidden">
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
                    {(b.talentPoints ?? 0) > 0 && (
                      <span className="text-amber-400">
                        ⭐ {b.talentPoints}tp
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
        battleBubble={selectedHolder ? (battleState.bubbles.get(selectedHolder.address) ?? null) : null}
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
