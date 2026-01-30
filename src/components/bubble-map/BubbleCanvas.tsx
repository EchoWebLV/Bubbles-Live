"use client";

import { useRef, useEffect, useCallback } from "react";
import type { Holder } from "./types";
import type { EffectsState } from "./effects";
import { drawEffects, getBubbleEffectModifiers } from "./effects";

interface BubbleCanvasProps {
  holders: Holder[];
  width: number;
  height: number;
  hoveredHolder: Holder | null;
  effectsState: EffectsState;
  onHolderClick: (holder: Holder) => void;
  onHolderHover: (holder: Holder | null) => void;
}

export function BubbleCanvas({
  holders,
  width,
  height,
  hoveredHolder,
  effectsState,
  onHolderClick,
  onHolderHover,
}: BubbleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holdersRef = useRef<Holder[]>(holders);

  // Keep holdersRef updated for click detection
  useEffect(() => {
    holdersRef.current = holders;
  }, [holders]);

  // Set up canvas size
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height) return;
    
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
  }, [width, height]);

  // Draw whenever holders or effects change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height || !holders.length) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    
    // Reset transform and clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);

    // Draw effects background (ripples, global effects)
    drawEffects(ctx, effectsState, width, height);

    // Draw each bubble
    holders.forEach((holder) => {
      if (holder.x === undefined || holder.y === undefined) return;

      const isHovered = hoveredHolder?.address === holder.address;
      const x = holder.x;
      const y = holder.y;
      
      // Get effect modifiers
      const { scale, glowColor, glowIntensity } = getBubbleEffectModifiers(
        holder.address,
        effectsState
      );
      
      let radius = holder.radius * scale;
      if (isHovered) radius *= 1.15;

      // Draw effect glow if present
      if (glowColor && glowIntensity > 0) {
        const glowRadius = radius + 15 + glowIntensity * 10;
        const glowGradient = ctx.createRadialGradient(x, y, radius, x, y, glowRadius);
        glowGradient.addColorStop(0, `${glowColor}${Math.floor(glowIntensity * 80).toString(16).padStart(2, '0')}`);
        glowGradient.addColorStop(1, `${glowColor}00`);
        
        ctx.beginPath();
        ctx.arc(x, y, glowRadius, 0, Math.PI * 2);
        ctx.fillStyle = glowGradient;
        ctx.fill();
      }

      // Create gradient for 3D bubble effect
      const gradient = ctx.createRadialGradient(
        x - radius * 0.3,
        y - radius * 0.3,
        0,
        x,
        y,
        radius
      );

      // Use glow color if in effect, otherwise use holder color
      const baseColor = (glowColor && glowIntensity > 0.5) 
        ? blendColors(holder.color, glowColor, glowIntensity * 0.5)
        : holder.color;
        
      gradient.addColorStop(0, adjustBrightness(baseColor, 50));
      gradient.addColorStop(0.5, baseColor);
      gradient.addColorStop(1, adjustBrightness(baseColor, -40));

      // Draw outer glow for hovered bubble
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 10, 0, Math.PI * 2);
        const hoverGlow = ctx.createRadialGradient(x, y, radius, x, y, radius + 20);
        hoverGlow.addColorStop(0, `${holder.color}60`);
        hoverGlow.addColorStop(1, `${holder.color}00`);
        ctx.fillStyle = hoverGlow;
        ctx.fill();
      }

      // Draw main bubble
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = gradient;
      ctx.fill();

      // Add highlight reflection
      ctx.beginPath();
      ctx.arc(x - radius * 0.25, y - radius * 0.25, radius * 0.25, 0, Math.PI * 2);
      const highlightGradient = ctx.createRadialGradient(
        x - radius * 0.25,
        y - radius * 0.25,
        0,
        x - radius * 0.25,
        y - radius * 0.25,
        radius * 0.25
      );
      highlightGradient.addColorStop(0, "rgba(255, 255, 255, 0.5)");
      highlightGradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = highlightGradient;
      ctx.fill();

      // Draw percentage text for larger bubbles
      if (radius > 18) {
        ctx.fillStyle = "white";
        ctx.font = `bold ${Math.max(10, radius / 3)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        
        const pctText = holder.percentage >= 1 
          ? `${holder.percentage.toFixed(1)}%` 
          : holder.percentage >= 0.1
          ? `${holder.percentage.toFixed(1)}%`
          : "";
        
        if (pctText) {
          ctx.fillText(pctText, x, y);
        }
      }
    });

    // Draw explosion particles on top
    effectsState.explosions.forEach(explosion => {
      explosion.particles.forEach(particle => {
        ctx.beginPath();
        ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
        
        const gradient = ctx.createRadialGradient(
          particle.x, particle.y, 0,
          particle.x, particle.y, particle.radius
        );
        gradient.addColorStop(0, particle.color);
        gradient.addColorStop(1, `${particle.color}00`);
        
        ctx.fillStyle = gradient;
        ctx.globalAlpha = particle.alpha;
        ctx.fill();
        ctx.globalAlpha = 1;
      });
    });
    
  }, [holders, width, height, hoveredHolder, effectsState]);

  // Handle mouse interactions
  const findHolderAtPosition = useCallback(
    (clientX: number, clientY: number): Holder | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      const x = clientX - rect.left;
      const y = clientY - rect.top;

      // Check holders from largest to smallest (for overlapping bubbles)
      const sortedHolders = [...holdersRef.current].sort(
        (a, b) => b.radius - a.radius
      );

      for (const holder of sortedHolders) {
        if (holder.x === undefined || holder.y === undefined) continue;

        const dx = holder.x - x;
        const dy = holder.y - y;
        const distance = Math.sqrt(dx * dx + dy * dy);

        if (distance <= holder.radius) {
          return holder;
        }
      }

      return null;
    },
    []
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const holder = findHolderAtPosition(e.clientX, e.clientY);
      onHolderHover(holder);

      const canvas = canvasRef.current;
      if (canvas) {
        canvas.style.cursor = holder ? "pointer" : "default";
      }
    },
    [findHolderAtPosition, onHolderHover]
  );

  const handleClick = useCallback(
    (e: React.MouseEvent<HTMLCanvasElement>) => {
      const holder = findHolderAtPosition(e.clientX, e.clientY);
      if (holder) {
        onHolderClick(holder);
      }
    },
    [findHolderAtPosition, onHolderClick]
  );

  const handleMouseLeave = useCallback(() => {
    onHolderHover(null);
  }, [onHolderHover]);

  return (
    <canvas
      ref={canvasRef}
      className="absolute inset-0"
      onMouseMove={handleMouseMove}
      onClick={handleClick}
      onMouseLeave={handleMouseLeave}
    />
  );
}

// Helper function to adjust color brightness
function adjustBrightness(hex: string, percent: number): string {
  hex = hex.replace(/^#/, "");

  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);

  r = Math.min(255, Math.max(0, r + (r * percent) / 100));
  g = Math.min(255, Math.max(0, g + (g * percent) / 100));
  b = Math.min(255, Math.max(0, b + (b * percent) / 100));

  return `#${Math.round(r).toString(16).padStart(2, "0")}${Math.round(g)
    .toString(16)
    .padStart(2, "0")}${Math.round(b).toString(16).padStart(2, "0")}`;
}

// Blend two hex colors
function blendColors(color1: string, color2: string, ratio: number): string {
  const hex1 = color1.replace(/^#/, "");
  const hex2 = color2.replace(/^#/, "");
  
  const r1 = parseInt(hex1.substring(0, 2), 16);
  const g1 = parseInt(hex1.substring(2, 4), 16);
  const b1 = parseInt(hex1.substring(4, 6), 16);
  
  const r2 = parseInt(hex2.substring(0, 2), 16);
  const g2 = parseInt(hex2.substring(2, 4), 16);
  const b2 = parseInt(hex2.substring(4, 6), 16);
  
  const r = Math.round(r1 * (1 - ratio) + r2 * ratio);
  const g = Math.round(g1 * (1 - ratio) + g2 * ratio);
  const b = Math.round(b1 * (1 - ratio) + b2 * ratio);
  
  return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b.toString(16).padStart(2, "0")}`;
}
