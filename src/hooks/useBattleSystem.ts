"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  BattleState,
  BattleBubble,
  Bullet,
  DamageNumber,
  createBattleState,
  updateBattleState,
  BATTLE_CONFIG,
} from "@/components/bubble-map/battle";
import type { Holder } from "@/components/bubble-map/types";

interface UseBattleSystemOptions {
  enabled?: boolean;
}

export function useBattleSystem({ enabled = true }: UseBattleSystemOptions = {}) {
  const [battleState, setBattleState] = useState<BattleState>(createBattleState);
  const battleStateRef = useRef<BattleState>(battleState);
  const [kills, setKills] = useState<{ address: string; killerAddress: string; timestamp: number }[]>([]);

  // Keep ref in sync
  useEffect(() => {
    battleStateRef.current = battleState;
  }, [battleState]);

  // Update battle (call this with current bubble positions)
  const updateBattle = useCallback((
    bubblePositions: { address: string; x: number; y: number; radius: number }[]
  ) => {
    if (!enabled) return;

    const now = Date.now();
    const state = battleStateRef.current;

    const { deaths, respawns } = updateBattleState(state, bubblePositions, now);

    // Log kills
    if (deaths.length > 0) {
      setKills(prev => [
        ...deaths.map(d => ({ ...d, timestamp: now })),
        ...prev.slice(0, 9), // Keep last 10 kills
      ]);
    }

    // Trigger re-render
    setBattleState({ ...state });
  }, [enabled]);

  // Get battle info for a specific bubble
  const getBubbleBattle = useCallback((address: string): BattleBubble | null => {
    return battleStateRef.current.bubbles.get(address) || null;
  }, []);

  // Get all bullets
  const getBullets = useCallback((): Bullet[] => {
    return battleStateRef.current.bullets;
  }, []);

  // Get damage numbers
  const getDamageNumbers = useCallback((): DamageNumber[] => {
    return battleStateRef.current.damageNumbers;
  }, []);

  // Reset battle state
  const resetBattle = useCallback(() => {
    const newState = createBattleState();
    battleStateRef.current = newState;
    setBattleState(newState);
    setKills([]);
  }, []);

  return {
    battleState,
    updateBattle,
    getBubbleBattle,
    getBullets,
    getDamageNumbers,
    kills,
    resetBattle,
  };
}
