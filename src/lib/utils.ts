import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Shortens a Solana address for display
 */
export function shortenAddress(address: string, chars = 4): string {
  return `${address.slice(0, chars)}...${address.slice(-chars)}`;
}

/**
 * Formats a number with appropriate suffix (K, M, B, T)
 */
export function formatNumber(num: number): string {
  if (num >= 1e12) return (num / 1e12).toFixed(2) + "T";
  if (num >= 1e9) return (num / 1e9).toFixed(2) + "B";
  if (num >= 1e6) return (num / 1e6).toFixed(2) + "M";
  if (num >= 1e3) return (num / 1e3).toFixed(2) + "K";
  return num.toFixed(2);
}

/**
 * Formats a percentage value
 */
export function formatPercentage(value: number): string {
  if (value >= 1) return value.toFixed(2) + "%";
  if (value >= 0.01) return value.toFixed(3) + "%";
  return value.toFixed(4) + "%";
}

const MAX_LEVEL = 100;
const LEVEL_SCALE_EARLY = 10;
const LEVEL_SCALE = 22;
const LEVEL_SCALE_50PLUS = 25;
const COMPOUND = 1.035;

/**
 * Returns XP thresholds for a given level: { xpForCurrent, xpForNext }.
 * Mirrors the server calcLevel formula exactly.
 */
export function getXpThresholds(level: number): { xpForCurrent: number; xpForNext: number } {
  let totalXp = 0;
  let penalty = 1;
  let xpForCurrent = 0;
  let xpForNext = 0;

  for (let lvl = 1; lvl < MAX_LEVEL; lvl++) {
    const scale = lvl <= 25 ? LEVEL_SCALE_EARLY : lvl <= 50 ? LEVEL_SCALE : LEVEL_SCALE_50PLUS;
    const baseCost = (2 * lvl - 1) * scale;
    if (lvl > 50) penalty *= COMPOUND;
    totalXp += baseCost * penalty;

    if (lvl === level - 1) xpForCurrent = Math.round(totalXp);
    if (lvl === level) { xpForNext = Math.round(totalXp); break; }
  }

  if (level <= 1) xpForCurrent = 0;
  if (level >= MAX_LEVEL) xpForNext = xpForCurrent;

  return { xpForCurrent, xpForNext };
}
