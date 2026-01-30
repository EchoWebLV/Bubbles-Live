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

/**
 * Generate a unique color based on wallet address
 * Uses a hash of the address to create a deterministic HSL color
 */
export function getHolderColor(percentage: number, address: string): string {
  // Simple hash function for the address
  let hash = 0;
  for (let i = 0; i < address.length; i++) {
    const char = address.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  
  // Use hash to generate HSL values
  // Hue: full range (0-360) for variety
  const hue = Math.abs(hash % 360);
  
  // Saturation: 65-90% for vibrant colors
  const saturation = 65 + Math.abs((hash >> 8) % 25);
  
  // Lightness: adjust based on holder size for visibility
  // Bigger holders (whales) are slightly brighter
  let lightness = 50;
  if (percentage >= 5) {
    lightness = 55 + Math.abs((hash >> 16) % 10); // 55-65%
  } else if (percentage >= 1) {
    lightness = 50 + Math.abs((hash >> 16) % 10); // 50-60%
  } else {
    lightness = 45 + Math.abs((hash >> 16) % 15); // 45-60%
  }
  
  return hslToHex(hue, saturation, lightness);
}

/**
 * Convert HSL to Hex color
 */
function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs((h / 60) % 2 - 1));
  const m = l - c / 2;
  
  let r = 0, g = 0, b = 0;
  
  if (0 <= h && h < 60) {
    r = c; g = x; b = 0;
  } else if (60 <= h && h < 120) {
    r = x; g = c; b = 0;
  } else if (120 <= h && h < 180) {
    r = 0; g = c; b = x;
  } else if (180 <= h && h < 240) {
    r = 0; g = x; b = c;
  } else if (240 <= h && h < 300) {
    r = x; g = 0; b = c;
  } else if (300 <= h && h < 360) {
    r = c; g = 0; b = x;
  }
  
  const toHex = (n: number) => {
    const hex = Math.round((n + m) * 255).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  };
  
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
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
