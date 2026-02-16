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
}

export interface GameBattleBubble {
  address: string;
  health: number;
  maxHealth: number;
  isGhost: boolean;
  ghostUntil: number | null;
  kills: number;
  deaths: number;
  // Progression data from Ephemeral Rollup
  level: number;
  xp: number;
  healthLevel: number;
  attackLevel: number;
  attackPower: number;
  shootingLevel?: number; // legacy alias
  holdStreakDays?: number;
  isAlive: boolean;
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

export interface GameState {
  holders: GameHolder[];
  battleBubbles: GameBattleBubble[];
  bullets: GameBullet[];
  damageNumbers: GameDamageNumber[];
  killFeed: GameKillFeed[];
  eventLog: string[];
  topKillers: { address: string; kills: number }[];
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

export function useGameSocket(options: UseGameSocketOptions = {}) {
  const [connected, setConnected] = useState(false);
  const [gameState, setGameState] = useState<GameState | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const dimensionsSentRef = useRef(false);

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

  useEffect(() => {
    // Connect to Socket.io server
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

    socket.on("disconnect", () => {
      console.log("Disconnected from game server");
      setConnected(false);
    });

    socket.on("gameState", (state: GameState) => {
      setGameState(state);
    });

    socket.on("connect_error", (error) => {
      console.error("Connection error:", error);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  return {
    connected,
    gameState,
    setDimensions,
    sendTransaction,
    upgradeStat,
    getOnchainStats,
  };
}
