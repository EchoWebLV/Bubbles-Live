import type { SimulationNodeDatum } from "d3";

export interface Holder extends SimulationNodeDatum {
  address: string;
  balance: number;
  percentage: number;
  radius: number;
  color: string;
  // D3 simulation properties
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface TokenInfo {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  totalSupply: number;
  logoUri?: string;
}

export interface HoldersResponse {
  token: TokenInfo;
  holders: Holder[];
  totalHolders: number;
  lastUpdated: string;
}

export interface BubbleMapConfig {
  minRadius: number;
  maxRadius: number;
  collisionPadding: number;
  velocityDecay: number;
  alphaDecay: number;
  chargeStrength: number;
  centerStrength: number;
}

export const DEFAULT_CONFIG: BubbleMapConfig = {
  minRadius: 8,
  maxRadius: 50,
  collisionPadding: 2,
  velocityDecay: 0.3,
  alphaDecay: 0.01,
  chargeStrength: -8,
  centerStrength: 0.003,
};

// Color palette for bubbles based on percentage
export const BUBBLE_COLORS = {
  whale: ["#9333ea", "#7c3aed", "#6366f1"], // Purple for top holders (>5%)
  large: ["#3b82f6", "#0ea5e9", "#06b6d4"], // Blue for large holders (1-5%)
  medium: ["#10b981", "#14b8a6", "#22d3d8"], // Teal for medium holders (0.1-1%)
  small: ["#f59e0b", "#f97316", "#ef4444"], // Orange/Red for small holders (<0.1%)
};

export function getHolderColor(percentage: number): string {
  if (percentage >= 5) {
    return BUBBLE_COLORS.whale[Math.floor(Math.random() * BUBBLE_COLORS.whale.length)];
  }
  if (percentage >= 1) {
    return BUBBLE_COLORS.large[Math.floor(Math.random() * BUBBLE_COLORS.large.length)];
  }
  if (percentage >= 0.1) {
    return BUBBLE_COLORS.medium[Math.floor(Math.random() * BUBBLE_COLORS.medium.length)];
  }
  return BUBBLE_COLORS.small[Math.floor(Math.random() * BUBBLE_COLORS.small.length)];
}

export function calculateRadius(
  percentage: number,
  minRadius: number = DEFAULT_CONFIG.minRadius,
  maxRadius: number = DEFAULT_CONFIG.maxRadius
): number {
  // Use square root scale so small holders are still visible
  const minPercent = 0.01;
  const maxPercent = 20;

  const clampedPercentage = Math.max(percentage, minPercent);
  // Square root scale for better visual distribution
  const normalized = Math.sqrt(clampedPercentage / maxPercent);

  return minRadius + Math.min(normalized, 1) * (maxRadius - minRadius);
}
