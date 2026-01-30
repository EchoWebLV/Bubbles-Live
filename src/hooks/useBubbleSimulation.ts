"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type { Holder } from "@/components/bubble-map/types";

interface UseBubbleSimulationOptions {
  holders: Holder[];
  width: number;
  height: number;
}

export function useBubbleSimulation({
  holders,
  width,
  height,
}: UseBubbleSimulationOptions) {
  const [nodes, setNodes] = useState<Holder[]>([]);
  const nodesRef = useRef<Holder[]>([]);
  const animationRef = useRef<number>(0);
  const positionsRef = useRef<Map<string, { x: number; y: number; vx: number; vy: number }>>(new Map());

  // Update nodes when holders change - PRESERVE POSITIONS
  useEffect(() => {
    if (!holders.length || !width || !height) return;

    const padding = 80;
    
    // Merge new holder data with existing positions
    const updated = holders.map((h) => {
      const existingPos = positionsRef.current.get(h.address);
      
      if (existingPos) {
        // Keep existing position and velocity
        return {
          ...h,
          x: existingPos.x,
          y: existingPos.y,
          vx: existingPos.vx,
          vy: existingPos.vy,
        };
      } else {
        // New holder - spawn at random position
        const x = padding + Math.random() * (width - padding * 2);
        const y = padding + Math.random() * (height - padding * 2);
        return {
          ...h,
          x,
          y,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
        };
      }
    });

    nodesRef.current = updated;
    setNodes([...updated]);
  }, [holders, width, height]);

  // Animation loop
  useEffect(() => {
    if (!width || !height) return;

    let lastTime = performance.now();

    const animate = (currentTime: number) => {
      const deltaTime = Math.min((currentTime - lastTime) / 16, 2); // Normalize to ~60fps
      lastTime = currentTime;

      const currentNodes = nodesRef.current;
      if (!currentNodes.length) {
        animationRef.current = requestAnimationFrame(animate);
        return;
      }

      // Update each node
      currentNodes.forEach((node) => {
        // Move based on velocity
        node.x = (node.x || 0) + (node.vx || 0) * deltaTime;
        node.y = (node.y || 0) + (node.vy || 0) * deltaTime;
      });

      // Check collisions between bubbles
      for (let i = 0; i < currentNodes.length; i++) {
        for (let j = i + 1; j < currentNodes.length; j++) {
          const a = currentNodes[i];
          const b = currentNodes[j];

          const dx = (b.x || 0) - (a.x || 0);
          const dy = (b.y || 0) - (a.y || 0);
          const distance = Math.sqrt(dx * dx + dy * dy);
          const minDistance = a.radius + b.radius + 2;

          if (distance < minDistance && distance > 0) {
            // Normalize
            const nx = dx / distance;
            const ny = dy / distance;

            // Push apart
            const overlap = minDistance - distance;
            const pushX = (overlap / 2) * nx;
            const pushY = (overlap / 2) * ny;

            a.x = (a.x || 0) - pushX;
            a.y = (a.y || 0) - pushY;
            b.x = (b.x || 0) + pushX;
            b.y = (b.y || 0) + pushY;

            // Bounce velocities
            const relVelX = (a.vx || 0) - (b.vx || 0);
            const relVelY = (a.vy || 0) - (b.vy || 0);
            const relVelDotNormal = relVelX * nx + relVelY * ny;

            if (relVelDotNormal > 0) {
              const bounce = 0.7;
              a.vx = (a.vx || 0) - relVelDotNormal * nx * bounce;
              a.vy = (a.vy || 0) - relVelDotNormal * ny * bounce;
              b.vx = (b.vx || 0) + relVelDotNormal * nx * bounce;
              b.vy = (b.vy || 0) + relVelDotNormal * ny * bounce;
            }
          }
        }
      }

      // Wall collisions and speed management
      currentNodes.forEach((node) => {
        const r = node.radius;

        // Bounce off walls
        if ((node.x || 0) <= r) {
          node.x = r;
          node.vx = Math.abs(node.vx || 0.2) * 0.9;
        }
        if ((node.x || 0) >= width - r) {
          node.x = width - r;
          node.vx = -Math.abs(node.vx || 0.2) * 0.9;
        }
        if ((node.y || 0) <= r) {
          node.y = r;
          node.vy = Math.abs(node.vy || 0.2) * 0.9;
        }
        if ((node.y || 0) >= height - r) {
          node.y = height - r;
          node.vy = -Math.abs(node.vy || 0.2) * 0.9;
        }

        // Keep bubbles moving slowly
        const speed = Math.sqrt((node.vx || 0) ** 2 + (node.vy || 0) ** 2);
        
        if (speed < 0.15) {
          // Too slow - give a gentle push
          const angle = Math.random() * Math.PI * 2;
          node.vx = Math.cos(angle) * 0.2;
          node.vy = Math.sin(angle) * 0.2;
        } else if (speed > 0.8) {
          // Too fast - slow down
          node.vx = ((node.vx || 0) / speed) * 0.8;
          node.vy = ((node.vy || 0) / speed) * 0.8;
        }
        
        // Save position for persistence across refreshes
        positionsRef.current.set(node.address, {
          x: node.x || 0,
          y: node.y || 0,
          vx: node.vx || 0,
          vy: node.vy || 0,
        });
      });

      // Update state to trigger re-render
      setNodes([...currentNodes]);

      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(animationRef.current);
    };
  }, [width, height]);

  const reheat = useCallback(() => {
    nodesRef.current.forEach((node) => {
      const angle = Math.random() * Math.PI * 2;
      node.vx = Math.cos(angle) * 0.5;
      node.vy = Math.sin(angle) * 0.5;
    });
  }, []);

  return { nodes, reheat };
}
