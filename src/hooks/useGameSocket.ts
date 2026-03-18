"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { io, Socket } from "socket.io-client";

// Types matching server state
export interface GameHolder {
  address: string;
  balance: number;
  percentage: number;
  color: string;
  radius: number;
  x?: number;
  y?: number;
  isNew?: boolean;
  spawnTime?: number;
  hasPhoto?: boolean;
}

export interface TalentRanks {
  // Tank
  armor: number;
  ironSkin: number;
  regeneration: number;
  lifesteal: number;
  vitalityStrike: number;
  // Firepower
  heavyHitter: number;
  rapidFire: number;
  criticalStrike: number;
  multiShot: number;
  dualCannon: number;
  // Brawler
  dash: number;
  bodySlam: number;
  relentless: number;
  orbit: number;
  shockwave: number;
  // Mass Damage
  ricochet: number;
  counterAttack: number;
  chainLightning: number;
  orbitalLaser: number;
  focusFire: number;
  rocket: number;
  // Blood Thirst
  experience: number;
  execute: number;
  killRush: number;
  reaperArc: number;
  berserker: number;
  // Echo
  decoy: number;
  deathMirage: number;
  decoyBarrage: number;
  volatileDecoy: number;
  singularity: number;
  // Swift
  quickfire: number;
  velocityRounds: number;
  longShot: number;
  overdrive: number;
  bulletStorm: number;
  [key: string]: number;
}

export interface GameBattleBubble {
  address: string;
  health: number;
  maxHealth: number;
  isGhost: boolean;
  ghostUntil: number | null;
  kills: number;
  deaths: number;
  level: number;
  xp: number;
  healthLevel: number;
  attackLevel: number;
  attackPower: number;
  isAlive: boolean;
  talents: TalentRanks;
  talentPoints: number;
  manualBuild: boolean;
  classId: number;
  talentResetsUsed: number;
}

export interface GameBullet {
  id: string;
  shooterAddress: string;
  shooterColor: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  progress: number;
  curveDirection: number;
  curveStrength: number;
  isBloodBolt?: boolean;
  isRocket?: boolean;
  vx?: number;
  vy?: number;
}

export interface GameDamageNumber {
  id: string;
  x: number;
  y: number;
  damage: number;
  createdAt: number;
  alpha: number;
}

export interface GameKillFeed {
  killer: string;
  victim: string;
  time: number;
}

export interface GamePopEffect {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  time: number;
  progress: number;
}

export interface GameVfx {
  type: 'bloodbath' | 'shockwave' | 'bulletPop' | 'lightning' | 'reaperArc' | 'mineExplode' | 'megaMine' | 'singularityStart' | 'singularityExplode' | 'decoySpawn' | 'decoyDeath' | 'rocketExplode' | 'orbitalLaser';
  x: number;
  y: number;
  targetX?: number;
  targetY?: number;
  radius?: number;
  angle?: number;
  range?: number;
  beamWidth?: number;
  color: string;
  createdAt: number;
  small?: boolean;
}

export interface GameMine {
  id: string;
  ownerAddress: string;
  x: number;
  y: number;
  radius: number;
  isMegaMine: boolean;
  isDetonating: boolean;
  singularityRank: number;
  createdAt: number;
  durationMs: number;
  singularityState: {
    rank: number;
    startTime: number;
    pullRadius: number;
  } | null;
}

export interface GameDecoyClone {
  id: string;
  ownerAddress: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  health: number;
  maxHealth: number;
}

export interface GameState {
  holders: GameHolder[];
  battleBubbles: GameBattleBubble[];
  bullets: GameBullet[];
  damageNumbers: GameDamageNumber[];
  vfx: GameVfx[];
  mines: GameMine[];
  decoyClones: GameDecoyClone[];
  killFeed: GameKillFeed[];
  eventLog: string[];
  topKillers: { address: string; kills: number; level: number }[];
  popEffects: GamePopEffect[];
  token: {
    address: string;
    symbol: string;
    name: string;
    logoUri?: string;
    totalSupply: number;
    decimals: number;
  } | null;
  priceData: {
    price: number;
    priceChange1h: number;
    priceChange24h?: number;
    volume24h?: number;
    liquidity?: number;
    marketCap?: number;
  } | null;
  dimensions: { width: number; height: number };
  timestamp: number;
  seasonId?: number;
  seasonNumber?: number;
  seasonEndsAt?: number;
  magicBlock?: {
    ready: boolean;
    arenaPda: string | null;
    arenaDelegated: boolean;
    playersRegistered: number;
    playersDelegated: number;
    stats: {
      attacksSent: number;
      attacksConfirmed: number;
      attacksFailed: number;
      attacksRejected: number;
      commits: number;
      lastCommitTime: number;
      erLatencyMs: number;
    };
    eventLog: OnchainEvent[];
    rpc: {
      baseLayer: string;
      ephemeralRollup: string;
    };
    programId: string;
    erValidator: string;
  };
}

export interface OnchainEvent {
  type: 'arena' | 'register' | 'delegate' | 'attack' | 'attack_pending' | 'respawn' | 'kill' | 'death' | 'upgrade' | 'commit' | 'system' | 'error';
  message: string;
  tx: string | null;
  txFull: string | null;
  explorer: string | null;
  time: number;
  status?: 'pending' | 'confirmed' | null;
  attacker?: string;
  victim?: string;
  wallet?: string;
  damage?: number;
  latencyMs?: number;
  [key: string]: unknown;
}

export interface OnchainPlayerStats {
  walletAddress: string;
  wallet: string;
  health: number;
  maxHealth: number;
  attackPower: number;
  xp: number;
  kills: number;
  deaths: number;
  healthLevel: number;
  attackLevel: number;
  isAlive: boolean;
  respawnAt: number;
  initialized: boolean;
  playerPda: string;
}

interface UseGameSocketOptions {
  onTransaction?: (event: { type: string; signature: string; timestamp: number }) => void;
}

const SERVER_TICK_MS = 100; // 10fps server broadcast
const STATE_UPDATE_THROTTLE_MS = 50; // Throttle React setState to reduce re-renders; canvas uses ref for smooth 60fps

const _prevHolderMap = new Map<string, GameHolder>();
const _prevBulletMap = new Map<string, GameState['bullets'][number]>();

function lerpPositions(prev: GameState | null, next: GameState, t: number): GameState {
  if (!prev || t >= 1) return next;

  _prevHolderMap.clear();
  for (const h of prev.holders) _prevHolderMap.set(h.address, h);

  _prevBulletMap.clear();
  for (const b of prev.bullets) _prevBulletMap.set(b.id, b);

  return {
    ...next,
    holders: next.holders.map(h => {
      const p = _prevHolderMap.get(h.address);
      if (!p || p.x === undefined || h.x === undefined) return h;
      return { ...h, x: p.x + (h.x - p.x) * t, y: p.y! + (h.y! - p.y!) * t };
    }),
    bullets: next.bullets.map(b => {
      const p = _prevBulletMap.get(b.id);
      if (!p) return b;
      return {
        ...b,
        x: p.x + (b.x - p.x) * t,
        y: p.y + (b.y - p.y) * t,
        progress: p.progress + (b.progress - p.progress) * t,
      };
    }),
  };
}

export function useGameSocket(options: UseGameSocketOptions = {}) {
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const [playerPhotos, setPlayerPhotos] = useState<Record<string, string>>({});
  const [guestAddress, setGuestAddress] = useState<string | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const dimensionsSentRef = useRef(false);

  const prevStateRef = useRef<GameState | null>(null);
  const nextStateRef = useRef<GameState | null>(null);
  const lastServerTime = useRef(0);
  const rafRef = useRef<number>(0);
  const lastRafUpdate = useRef(0);
  const lastSetStateTime = useRef(0);
  /** Latest interpolated state, updated every frame. Use this in canvas rAF for 60fps without triggering React. */
  const gameStateRef = useRef<GameState | null>(null);

  // Send dimensions to server
  const setDimensions = useCallback((width: number, height: number) => {
    if (socketRef.current?.connected && !dimensionsSentRef.current) {
      socketRef.current.emit("setDimensions", { width, height });
      dimensionsSentRef.current = true;
    }
  }, []);

  // Send transaction event to server
  const sendTransaction = useCallback((event: { type: string; signature: string; timestamp: number }) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("transaction", event);
    }
  }, []);

  // Request onchain stat upgrade (0=health, 1=shooting)
  const upgradeStat = useCallback((walletAddress: string, statType: number): Promise<{ success: boolean; error?: string }> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve({ success: false, error: "Not connected" });
        return;
      }
      socketRef.current.emit("upgradeStat", { walletAddress, statType });
      socketRef.current.once("upgradeResult", (result: { success: boolean; error?: string }) => {
        resolve(result);
      });
      // Timeout after 15s
      setTimeout(() => resolve({ success: false, error: "Timeout" }), 15000);
    });
  }, []);

  // Upload profile photo for a wallet
  const uploadPhoto = useCallback((walletAddress: string, photo: string): Promise<boolean> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve(false);
        return;
      }
      let resolved = false;
      const handler = (result: { success: boolean }) => {
        if (resolved) return;
        resolved = true;
        resolve(result.success);
      };
      socketRef.current.emit("uploadPhoto", { walletAddress, photo });
      socketRef.current.once("photoUploaded", handler);
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          socketRef.current?.off("photoUploaded", handler);
          console.warn("Photo upload timed out");
          resolve(false);
        }
      }, 10000);
    });
  }, []);

  // Remove profile photo
  const removePhoto = useCallback((walletAddress: string) => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("removePhoto", { walletAddress });
    }
  }, []);

  const joinAsGuest = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("joinAsGuest");
    }
  }, []);

  const leaveGuest = useCallback(() => {
    if (socketRef.current?.connected) {
      socketRef.current.emit("leaveGuest");
    }
    setGuestAddress(null);
  }, []);

  // Allocate a talent point
  const allocateTalent = useCallback((walletAddress: string, talentId: string): Promise<{ success: boolean; talents?: TalentRanks; talentPoints?: number; error?: string }> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve({ success: false, error: "Not connected" });
        return;
      }
      socketRef.current.emit("allocateTalent", { walletAddress, talentId });
      socketRef.current.once("talentResult", (result: { success: boolean; talents?: TalentRanks; talentPoints?: number; error?: string }) => {
        resolve(result);
      });
      setTimeout(() => resolve({ success: false, error: "Timeout" }), 10000);
    });
  }, []);

  // Select class (Fortify/Velocity/Impact)
  const selectClass = useCallback((walletAddress: string, classId: number): Promise<{ success: boolean; classId?: number; error?: string }> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve({ success: false, error: "Not connected" });
        return;
      }
      socketRef.current.emit("selectClass", { walletAddress, classId });
      socketRef.current.once("classResult", (result: { success: boolean; classId?: number; error?: string }) => {
        resolve(result);
      });
      setTimeout(() => resolve({ success: false, error: "Timeout" }), 10000);
    });
  }, []);

  // Reset all talent points
  const resetTalents = useCallback((walletAddress: string): Promise<{ success: boolean; talents?: TalentRanks; talentPoints?: number; error?: string }> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve({ success: false, error: "Not connected" });
        return;
      }
      socketRef.current.emit("resetTalents", { walletAddress });
      socketRef.current.once("talentResult", (result: { success: boolean; talents?: TalentRanks; talentPoints?: number; error?: string }) => {
        resolve(result);
      });
      setTimeout(() => resolve({ success: false, error: "Timeout" }), 10000);
    });
  }, []);

  // Fetch onchain stats for a player
  const getOnchainStats = useCallback((walletAddress: string): Promise<OnchainPlayerStats | null> => {
    return new Promise((resolve) => {
      if (!socketRef.current?.connected) {
        resolve(null);
        return;
      }
      socketRef.current.emit("getOnchainStats", { walletAddress });
      socketRef.current.once("onchainStats", (stats: OnchainPlayerStats | null) => {
        resolve(stats);
      });
      setTimeout(() => resolve(null), 10000);
    });
  }, []);

  // Fetch photos via HTTP (much lighter than WebSocket)
  useEffect(() => {
    let cancelled = false;
    const fetchPhotos = async () => {
      try {
        const res = await fetch("/api/photos");
        if (!res.ok) return;
        const photos = await res.json();
        if (!cancelled) setPlayerPhotos(photos || {});
      } catch { /* ignore */ }
    };
    fetchPhotos();
    const photoInterval = setInterval(fetchPhotos, 30000);
    return () => { cancelled = true; clearInterval(photoInterval); };
  }, []);

  useEffect(() => {
    const socket = io({
      transports: ["websocket", "polling"],
      reconnection: true,
      reconnectionAttempts: Infinity,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
    });

    socketRef.current = socket;

    socket.on("connect", () => {
      console.log("Connected to game server");
      setConnected(true);
      dimensionsSentRef.current = false;
    });

    socket.on("disconnect", (reason) => {
      console.log("Disconnected from game server:", reason);
      setConnected(false);
      setGuestAddress(null);
    });

    socket.on("gameState", (state: GameState) => {
      prevStateRef.current = nextStateRef.current;
      nextStateRef.current = state;
      lastServerTime.current = performance.now();
      gameStateRef.current = state;
      if (!prevStateRef.current) {
        setGameState(state);
      }
    });

    socket.on("gameStateUpdate", (update: Partial<GameState>) => {
      if (!nextStateRef.current) return;
      const base = nextStateRef.current;
      const merged: GameState = {
        ...base,
        bullets: update.bullets ?? base.bullets,
        damageNumbers: update.damageNumbers ?? base.damageNumbers,
        vfx: update.vfx ?? base.vfx,
        killFeed: update.killFeed ?? base.killFeed,
        popEffects: update.popEffects ?? base.popEffects,
        mines: update.mines ?? base.mines,
        decoyClones: update.decoyClones ?? base.decoyClones,
        timestamp: update.timestamp ?? base.timestamp,
      };
      if (update.holders) {
        const posMap = new Map(update.holders.map(h => [h.address, h]));
        merged.holders = base.holders.map(h => {
          const pos = posMap.get(h.address);
          return pos ? { ...h, x: pos.x, y: pos.y } : h;
        });
      }
      if (update.battleBubbles) {
        const bbMap = new Map(update.battleBubbles.map(b => [b.address, b]));
        merged.battleBubbles = base.battleBubbles.map(b => {
          const u = bbMap.get(b.address);
          return u ? { ...b, health: u.health, maxHealth: u.maxHealth, isGhost: u.isGhost, isAlive: u.isAlive } : b;
        });
      }
      prevStateRef.current = nextStateRef.current;
      nextStateRef.current = merged;
      lastServerTime.current = performance.now();
      gameStateRef.current = merged;
    });

    socket.on("playerPhotos", (photos: Record<string, string>) => {
      setPlayerPhotos(photos || {});
    });

    socket.on("guestJoined", (result: { success: boolean; address?: string; error?: string }) => {
      if (result.success && result.address) {
        setGuestAddress(result.address);
      }
    });

    socket.on("guestLeft", () => {
      setGuestAddress(null);
    });

    socket.on("seasonReset", (payload: { seasonId: number; seasonNumber?: number; seasonEndsAt?: number }) => {
      const patch: Partial<GameState> = { seasonId: payload.seasonId };
      if (payload.seasonNumber !== undefined) patch.seasonNumber = payload.seasonNumber;
      if (payload.seasonEndsAt !== undefined) patch.seasonEndsAt = payload.seasonEndsAt;
      const updated = { ...(nextStateRef.current || {}), ...patch } as GameState;
      nextStateRef.current = updated;
      if (prevStateRef.current) prevStateRef.current = { ...prevStateRef.current, ...patch };
      setGameState((prev) => (prev ? { ...prev, ...patch } : prev));
    });

    socket.on("connect_error", (error) => {
      console.error("Connection error:", error);
    });

    const interpolate = (now: number) => {
      if (nextStateRef.current) {
        const elapsed = performance.now() - lastServerTime.current;
        const t = Math.min(elapsed / SERVER_TICK_MS, 1);
        const lerped = lerpPositions(prevStateRef.current, nextStateRef.current, t);
        gameStateRef.current = lerped;
        // Throttle React setState to reduce re-renders; canvas reads gameStateRef for smooth 60fps
        if (now - lastSetStateTime.current >= STATE_UPDATE_THROTTLE_MS) {
          lastSetStateTime.current = now;
          setGameState(lerped);
        }
      }
      rafRef.current = requestAnimationFrame(interpolate);
    };
    rafRef.current = requestAnimationFrame(interpolate);

    return () => {
      cancelAnimationFrame(rafRef.current);
      socket.disconnect();
    };
  }, []);

  return {
    connected,
    gameState,
    gameStateRef,
    playerPhotos,
    guestAddress,
    setDimensions,
    sendTransaction,
    upgradeStat,
    selectClass,
    allocateTalent,
    resetTalents,
    getOnchainStats,
    uploadPhoto,
    removePhoto,
    joinAsGuest,
    leaveGuest,
  };
}
