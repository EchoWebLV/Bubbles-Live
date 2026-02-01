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
}

export interface GameBattleBubble {
  address: string;
  health: number;
  maxHealth: number;
  isGhost: boolean;
  ghostUntil: number | null;
  kills: number;
  deaths: number;
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

export interface GameState {
  holders: GameHolder[];
  battleBubbles: GameBattleBubble[];
  bullets: GameBullet[];
  damageNumbers: GameDamageNumber[];
  killFeed: GameKillFeed[];
  eventLog: string[];
  topKillers: { address: string; kills: number }[];
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
  } | null;
  dimensions: { width: number; height: number };
  timestamp: number;
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
  };
}
