"use client";

import { useRef, useEffect, useCallback } from "react";
import type { Holder } from "./types";

interface BubbleCanvasProps {
  holders: Holder[];
  width: number;
  height: number;
  hoveredHolder: Holder | null;
  onHolderClick: (holder: Holder) => void;
  onHolderHover: (holder: Holder | null) => void;
}

export function BubbleCanvas({
  holders,
  width,
  height,
  hoveredHolder,
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

  // Draw whenever holders change (they update every frame from simulation)
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

    // Draw each bubble
    holders.forEach((holder) => {
      if (holder.x === undefined || holder.y === undefined) return;

      const isHovered = hoveredHolder?.address === holder.address;
      const x = holder.x;
      const y = holder.y;
      const radius = isHovered ? holder.radius * 1.15 : holder.radius;

      // Create gradient for 3D bubble effect
      const gradient = ctx.createRadialGradient(
        x - radius * 0.3,
        y - radius * 0.3,
        0,
        x,
        y,
        radius
      );

      const baseColor = holder.color;
      gradient.addColorStop(0, adjustBrightness(baseColor, 50));
      gradient.addColorStop(0.5, baseColor);
      gradient.addColorStop(1, adjustBrightness(baseColor, -40));

      // Draw outer glow for hovered bubble
      if (isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 10, 0, Math.PI * 2);
        const glowGradient = ctx.createRadialGradient(x, y, radius, x, y, radius + 20);
        glowGradient.addColorStop(0, `${baseColor}60`);
        glowGradient.addColorStop(1, `${baseColor}00`);
        ctx.fillStyle = glowGradient;
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
  }, [holders, width, height, hoveredHolder]);

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
