"use client";

import { useRef, useEffect, useCallback } from "react";
import type { Holder, PopEffect } from "./types";
import type { EffectsState } from "./effects";
import type { BattleState, BattleBubble, Bullet, DamageNumber } from "./battle";
import { drawEffects, getBubbleEffectModifiers } from "./effects";
import { BATTLE_CONFIG, getGhostRemainingTime, getCurvedBulletPosition } from "./battle";

interface Camera {
  x: number;
  y: number;
  zoom: number;
}

const DEFAULT_CAMERA: Camera = { x: 0, y: 0, zoom: 1 };

interface BubbleCanvasProps {
  holders: Holder[];
  width: number;
  height: number;
  hoveredHolder: Holder | null;
  effectsState: EffectsState;
  battleState: BattleState;
  popEffects: PopEffect[];
  camera?: Camera;
  connectedWallet?: string | null;
  onHolderClick: (holder: Holder) => void;
  onHolderHover: (holder: Holder | null) => void;
}

interface Spark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

export function BubbleCanvas({
  holders,
  width,
  height,
  hoveredHolder,
  effectsState,
  battleState,
  popEffects,
  camera = DEFAULT_CAMERA,
  connectedWallet,
  onHolderClick,
  onHolderHover,
}: BubbleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const holdersRef = useRef<Holder[]>(holders);
  const sparksRef = useRef<Spark[]>([]);
  const prevDamageCountRef = useRef(0);
  const imageCache = useRef<Map<string, HTMLImageElement | null>>(new Map());
  const imageSrcCache = useRef<Map<string, string>>(new Map());

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

  // Draw whenever holders, effects, or battle state change
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !width || !height || !holders.length) return;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const now = Date.now();
    
    // Reset transform and clear
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.scale(dpr, dpr);
    
    // Apply camera transform (pan and zoom)
    const centerX = width / 2;
    const centerY = height / 2;
    ctx.translate(centerX, centerY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-centerX + camera.x, -centerY + camera.y);

    // Synthwave grid background (zooms with camera)
    const gridSize = 60;
    const viewLeft = -centerX / camera.zoom + centerX - camera.x;
    const viewTop = -centerY / camera.zoom + centerY - camera.y;
    const viewRight = viewLeft + width / camera.zoom;
    const viewBottom = viewTop + height / camera.zoom;
    const startX = Math.floor(viewLeft / gridSize) * gridSize;
    const startY = Math.floor(viewTop / gridSize) * gridSize;

    ctx.strokeStyle = 'rgba(147, 51, 234, 0.08)';
    ctx.lineWidth = 1 / camera.zoom;
    ctx.beginPath();
    for (let x = startX; x <= viewRight; x += gridSize) {
      ctx.moveTo(x, viewTop);
      ctx.lineTo(x, viewBottom);
    }
    for (let y = startY; y <= viewBottom; y += gridSize) {
      ctx.moveTo(viewLeft, y);
      ctx.lineTo(viewRight, y);
    }
    ctx.stroke();

    // Draw effects background (ripples, global effects)
    drawEffects(ctx, effectsState, width, height);

    // Build a map of holder positions for targeting lines
    const holderPositions = new Map<string, { x: number; y: number; color: string }>();
    holders.forEach(h => {
      if (h.x !== undefined && h.y !== undefined) {
        holderPositions.set(h.address, { x: h.x, y: h.y, color: h.color });
      }
    });

    // Draw targeting lines (behind everything)
    drawTargetingLines(ctx, holders, battleState, holderPositions);

    // Draw curved bullet trails and bullets
    drawBullets(ctx, battleState.bullets, holderPositions);

    // Draw each bubble
    holders.forEach((holder) => {
      if (holder.x === undefined || holder.y === undefined) return;

      const battleBubble = battleState.bubbles.get(holder.address);
      const isGhost = battleBubble?.isGhost || false;
      const health = battleBubble?.health ?? BATTLE_CONFIG.maxHealth;
      const maxHealth = battleBubble?.maxHealth ?? BATTLE_CONFIG.maxHealth;

      const isHovered = hoveredHolder?.address === holder.address;
      const isConnectedWallet = connectedWallet === holder.address;
      const x = holder.x;
      const y = holder.y;
      
      // Check if this is a new holder (spawn animation)
      const isNew = holder.isNew && holder.spawnTime;
      let spawnProgress = 1;
      if (isNew && holder.spawnTime) {
        spawnProgress = Math.min(1, (now - holder.spawnTime) / 500); // 500ms spawn animation
      }
      
      // Get effect modifiers
      const { scale, glowColor, glowIntensity } = getBubbleEffectModifiers(
        holder.address,
        effectsState
      );
      
      // Apply spawn animation scale (bounce effect)
      const spawnScale = isNew ? (spawnProgress < 1 ? 
        0.3 + spawnProgress * 0.7 * (1 + Math.sin(spawnProgress * Math.PI) * 0.3) : 1) : 1;
      
      let radius = holder.radius * scale * spawnScale;
      if (isHovered) radius *= 1.15;

      // Ghost mode - semi-transparent and gray
      const ghostAlpha = isGhost ? 0.4 : 1;
      ctx.globalAlpha = ghostAlpha;

      // Draw spawn glow for new holders
      if (isNew && spawnProgress < 1) {
        const spawnGlowRadius = radius + 30 * (1 - spawnProgress);
        const spawnGlow = ctx.createRadialGradient(x, y, radius * 0.5, x, y, spawnGlowRadius);
        spawnGlow.addColorStop(0, `${holder.color}99`);
        spawnGlow.addColorStop(0.5, `${holder.color}44`);
        spawnGlow.addColorStop(1, `${holder.color}00`);
        
        ctx.beginPath();
        ctx.arc(x, y, spawnGlowRadius, 0, Math.PI * 2);
        ctx.fillStyle = spawnGlow;
        ctx.fill();
      }

      // Draw connected wallet glow (pulsing purple/gold aura)
      if (isConnectedWallet && !isGhost) {
        const pulsePhase = (now % 2000) / 2000; // 2-second pulse cycle
        const pulseIntensity = 0.5 + Math.sin(pulsePhase * Math.PI * 2) * 0.3;
        const glowSize = radius + 20 + Math.sin(pulsePhase * Math.PI * 2) * 8;
        
        // Outer pulsing glow
        const walletGlow = ctx.createRadialGradient(x, y, radius * 0.8, x, y, glowSize);
        walletGlow.addColorStop(0, `rgba(168, 85, 247, ${pulseIntensity * 0.6})`);
        walletGlow.addColorStop(0.5, `rgba(168, 85, 247, ${pulseIntensity * 0.3})`);
        walletGlow.addColorStop(0.75, `rgba(250, 204, 21, ${pulseIntensity * 0.15})`);
        walletGlow.addColorStop(1, `rgba(168, 85, 247, 0)`);
        
        ctx.beginPath();
        ctx.arc(x, y, glowSize, 0, Math.PI * 2);
        ctx.fillStyle = walletGlow;
        ctx.fill();
        
        // Rotating ring
        const ringAngle = (now % 4000) / 4000 * Math.PI * 2;
        ctx.beginPath();
        ctx.arc(x, y, radius + 8, ringAngle, ringAngle + Math.PI * 1.5);
        ctx.strokeStyle = `rgba(168, 85, 247, ${0.4 + pulseIntensity * 0.4})`;
        ctx.lineWidth = 2;
        ctx.stroke();
        
        // Second ring (opposite direction)
        ctx.beginPath();
        ctx.arc(x, y, radius + 12, -ringAngle, -ringAngle + Math.PI);
        ctx.strokeStyle = `rgba(250, 204, 21, ${0.3 + pulseIntensity * 0.3})`;
        ctx.lineWidth = 1.5;
        ctx.stroke();
      }

      // Draw effect glow if present (and not ghost)
      if (glowColor && glowIntensity > 0 && !isGhost) {
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

      // Ghost bubbles are gray
      let baseColor = holder.color;
      if (isGhost) {
        baseColor = "#6b7280"; // Gray
      } else if (glowColor && glowIntensity > 0.5) {
        baseColor = blendColors(holder.color, glowColor, glowIntensity * 0.5);
      }
        
      gradient.addColorStop(0, adjustBrightness(baseColor, 50));
      gradient.addColorStop(0.5, baseColor);
      gradient.addColorStop(1, adjustBrightness(baseColor, -40));

      // Draw outer glow for hovered bubble
      if (isHovered && !isGhost) {
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

      // Draw profile photo clipped to circle (if available)
      const photoUrl = holder.photo;
      if (photoUrl && !isGhost) {
        let cachedImg = imageCache.current.get(holder.address);
        const cachedSrc = imageSrcCache.current.get(holder.address);
        if (cachedImg === undefined || cachedSrc !== photoUrl) {
          imageCache.current.set(holder.address, null);
          imageSrcCache.current.set(holder.address, photoUrl);
          const img = new Image();
          img.crossOrigin = 'anonymous';
          img.onload = () => { imageCache.current.set(holder.address, img); };
          img.onerror = () => { imageCache.current.set(holder.address, null); };
          img.src = photoUrl;
          cachedImg = null;
        }
        if (cachedImg) {
          ctx.save();
          ctx.beginPath();
          ctx.arc(x, y, radius * 0.85, 0, Math.PI * 2);
          ctx.clip();
          const imgSize = radius * 1.7;
          ctx.drawImage(cachedImg, x - imgSize / 2, y - imgSize / 2, imgSize, imgSize);
          ctx.restore();
          ctx.globalAlpha = ghostAlpha;
        }
        // Photo border ring
        ctx.beginPath();
        ctx.arc(x, y, radius * 0.88, 0, Math.PI * 2);
        ctx.strokeStyle = baseColor;
        ctx.lineWidth = Math.max(2, radius * 0.08);
        ctx.stroke();
      } else if (!photoUrl && imageCache.current.has(holder.address)) {
        imageCache.current.delete(holder.address);
        imageSrcCache.current.delete(holder.address);
      }

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
      highlightGradient.addColorStop(0, "rgba(255, 255, 255, 0.3)");
      highlightGradient.addColorStop(1, "rgba(255, 255, 255, 0)");
      ctx.fillStyle = highlightGradient;
      ctx.fill();

      ctx.globalAlpha = 1;

      // Draw health bar (above bubble)
      if (!isGhost) {
        drawHealthBar(ctx, x, y - radius - 12, radius * 1.5, 6, health, maxHealth);
      } else {
        // Draw ghost timer
        const remainingTime = getGhostRemainingTime(battleBubble!, now);
        ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
        ctx.font = "bold 12px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${remainingTime}s`, x, y - radius - 10);
        
        // Draw skull emoji in the center of dead bubbles
        ctx.font = `${Math.max(16, radius * 0.6)}px system-ui, sans-serif`;
        ctx.fillText("💀", x, y);
      }

      // Draw percentage text for larger bubbles
      if (radius > 18 && !isGhost) {
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

      // Draw level badge (top-right of bubble)
      if (battleBubble && (battleBubble.level ?? 1) > 1 && !isGhost) {
        const lvl = battleBubble.level ?? 1;
        const badgeX = x + radius * 0.7;
        const badgeY = y - radius * 0.7;
        const badgeR = Math.max(8, radius * 0.3);

        // Badge background
        const badgeGrad = ctx.createRadialGradient(badgeX, badgeY, 0, badgeX, badgeY, badgeR);
        badgeGrad.addColorStop(0, "#a855f7");
        badgeGrad.addColorStop(1, "#7c3aed");
        ctx.beginPath();
        ctx.arc(badgeX, badgeY, badgeR, 0, Math.PI * 2);
        ctx.fillStyle = badgeGrad;
        ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,0.6)";
        ctx.lineWidth = 1;
        ctx.stroke();

        // Level number
        ctx.fillStyle = "#fff";
        ctx.font = `bold ${Math.max(7, badgeR * 0.9)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(`${lvl}`, badgeX, badgeY);
      }

      // Draw kill count if any
      if (battleBubble && battleBubble.kills > 0 && !isGhost) {
        ctx.fillStyle = "#fbbf24";
        ctx.font = "bold 10px system-ui, sans-serif";
        ctx.textAlign = "center";
        ctx.fillText(`☠${battleBubble.kills}`, x, y + radius + 12);
      }

      // Draw "YOU" label for connected wallet
      if (isConnectedWallet) {
        const youPulse = 0.8 + Math.sin((now % 1500) / 1500 * Math.PI * 2) * 0.2;
        ctx.globalAlpha = youPulse;
        ctx.fillStyle = "#a855f7";
        ctx.font = `bold ${Math.max(11, radius / 2.5)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("⭐ YOU", x, y + radius + (battleBubble?.kills ? 24 : 14));
        ctx.globalAlpha = 1;
      }
    });

    // Draw damage numbers on top
    drawDamageNumbers(ctx, battleState.damageNumbers);

    // Spawn sparks for new damage numbers (impact particles)
    const currentDmgCount = battleState.damageNumbers.length;
    if (currentDmgCount > prevDamageCountRef.current) {
      const newHits = battleState.damageNumbers.slice(0, currentDmgCount - prevDamageCountRef.current);
      for (const dn of newHits) {
        const sparkCount = 4 + Math.floor(Math.random() * 4);
        for (let i = 0; i < sparkCount; i++) {
          const angle = Math.random() * Math.PI * 2;
          const speed = 0.8 + Math.random() * 2.5;
          sparksRef.current.push({
            x: dn.x + (Math.random() - 0.5) * 6,
            y: dn.y + (Math.random() - 0.5) * 6,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 1,
            maxLife: 0.6 + Math.random() * 0.4,
            color: Math.random() > 0.4 ? '#fbbf24' : (Math.random() > 0.5 ? '#ff6b6b' : '#ffffff'),
            size: 1 + Math.random() * 2,
          });
        }
      }
    }
    prevDamageCountRef.current = currentDmgCount;

    // Update and draw impact sparks
    const sparks = sparksRef.current;
    for (let i = sparks.length - 1; i >= 0; i--) {
      const s = sparks[i];
      s.x += s.vx;
      s.y += s.vy;
      s.vy += 0.04; // slight gravity
      s.vx *= 0.97; // drag
      s.life -= 0.04;

      if (s.life <= 0) {
        sparks.splice(i, 1);
        continue;
      }

      const alpha = s.life / s.maxLife;
      const r = s.size * alpha;

      ctx.globalAlpha = alpha * 0.9;
      ctx.beginPath();
      ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = s.color;
      ctx.fill();
    }
    ctx.globalAlpha = 1;

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

    // Draw pop effects (when holders sell everything)
    popEffects.forEach(pop => {
      const progress = pop.progress;
      if (progress >= 1) return;
      
      const alpha = 1 - progress;
      const expandScale = 1 + progress * 2; // Expand to 3x size
      const expandedRadius = pop.radius * expandScale;
      
      // Outer expanding ring
      ctx.beginPath();
      ctx.arc(pop.x, pop.y, expandedRadius, 0, Math.PI * 2);
      ctx.strokeStyle = `${pop.color}${Math.floor(alpha * 200).toString(16).padStart(2, '0')}`;
      ctx.lineWidth = 3 * (1 - progress);
      ctx.stroke();
      
      // Inner fading circle
      const innerGradient = ctx.createRadialGradient(
        pop.x, pop.y, 0,
        pop.x, pop.y, expandedRadius * 0.8
      );
      innerGradient.addColorStop(0, `${pop.color}${Math.floor(alpha * 100).toString(16).padStart(2, '0')}`);
      innerGradient.addColorStop(0.5, `${pop.color}${Math.floor(alpha * 50).toString(16).padStart(2, '0')}`);
      innerGradient.addColorStop(1, `${pop.color}00`);
      
      ctx.beginPath();
      ctx.arc(pop.x, pop.y, expandedRadius * 0.8, 0, Math.PI * 2);
      ctx.fillStyle = innerGradient;
      ctx.fill();
      
      // Particle burst effect
      const numParticles = 8;
      for (let i = 0; i < numParticles; i++) {
        const angle = (i / numParticles) * Math.PI * 2;
        const particleDistance = expandedRadius * 0.5 + progress * pop.radius * 2;
        const particleX = pop.x + Math.cos(angle) * particleDistance;
        const particleY = pop.y + Math.sin(angle) * particleDistance;
        const particleSize = 4 * (1 - progress);
        
        ctx.beginPath();
        ctx.arc(particleX, particleY, particleSize, 0, Math.PI * 2);
        ctx.fillStyle = `${pop.color}${Math.floor(alpha * 255).toString(16).padStart(2, '0')}`;
        ctx.fill();
      }
      
      // "POP" text
      if (progress < 0.5) {
        ctx.globalAlpha = (0.5 - progress) * 2;
        ctx.fillStyle = "#ff4444";
        ctx.font = `bold ${Math.max(14, pop.radius * 0.5)}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("💥 SOLD", pop.x, pop.y);
        ctx.globalAlpha = 1;
      }
    });
    
  }, [holders, width, height, hoveredHolder, effectsState, battleState, popEffects, camera, connectedWallet]);

  // Store camera ref for click detection
  const cameraRef = useRef(camera);
  useEffect(() => {
    cameraRef.current = camera;
  }, [camera]);

  // Handle mouse interactions
  const findHolderAtPosition = useCallback(
    (clientX: number, clientY: number): Holder | null => {
      const canvas = canvasRef.current;
      if (!canvas) return null;

      const rect = canvas.getBoundingClientRect();
      let x = clientX - rect.left;
      let y = clientY - rect.top;

      // Reverse the camera transform to get world coordinates
      const cam = cameraRef.current;
      const centerX = rect.width / 2;
      const centerY = rect.height / 2;
      
      // Reverse: translate, then scale, then translate back
      x = (x - centerX) / cam.zoom + centerX - cam.x;
      y = (y - centerY) / cam.zoom + centerY - cam.y;

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

// Draw health bar
function drawHealthBar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  health: number,
  maxHealth: number
) {
  const healthPercent = health / maxHealth;
  const barX = x - width / 2;
  
  // Background
  ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
  ctx.fillRect(barX, y, width, height);
  
  // Health fill - color based on health level
  let healthColor = "#22c55e"; // Green
  if (healthPercent < 0.3) {
    healthColor = "#ef4444"; // Red
  } else if (healthPercent < 0.6) {
    healthColor = "#f59e0b"; // Yellow
  }
  
  ctx.fillStyle = healthColor;
  ctx.fillRect(barX, y, width * healthPercent, height);
  
  // Border
  ctx.strokeStyle = "rgba(255, 255, 255, 0.3)";
  ctx.lineWidth = 1;
  ctx.strokeRect(barX, y, width, height);
}

// Draw targeting lines from shooter to target
function drawTargetingLines(
  ctx: CanvasRenderingContext2D,
  holders: Holder[],
  battleState: BattleState,
  holderPositions: Map<string, { x: number; y: number; color: string }>
) {
  // Group bullets by shooter to find current targets
  const shooterTargets = new Map<string, string>();
  
  // Get the most recent bullet for each shooter to determine their target
  for (const bullet of battleState.bullets) {
    shooterTargets.set(bullet.shooterAddress, bullet.targetAddress);
  }

  // Draw curved targeting lines
  shooterTargets.forEach((targetAddress, shooterAddress) => {
    const shooter = holderPositions.get(shooterAddress);
    const target = holderPositions.get(targetAddress);
    const battleBubble = battleState.bubbles.get(shooterAddress);
    
    if (!shooter || !target || battleBubble?.isGhost) return;

    // Calculate curve control point
    const dx = target.x - shooter.x;
    const dy = target.y - shooter.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    // Perpendicular vector
    const perpX = -dy / dist;
    const perpY = dx / dist;
    
    // Alternate curve direction based on shooter address hash
    const curveDir = shooterAddress.charCodeAt(0) % 2 === 0 ? 1 : -1;
    const curveStrength = 30;
    
    const midX = (shooter.x + target.x) / 2;
    const midY = (shooter.y + target.y) / 2;
    const controlX = midX + perpX * curveStrength * curveDir;
    const controlY = midY + perpY * curveStrength * curveDir;

    // Draw curved line with gradient
    ctx.beginPath();
    ctx.moveTo(shooter.x, shooter.y);
    ctx.quadraticCurveTo(controlX, controlY, target.x, target.y);
    
    // Create gradient along the line
    const gradient = ctx.createLinearGradient(shooter.x, shooter.y, target.x, target.y);
    gradient.addColorStop(0, `${shooter.color}60`);
    gradient.addColorStop(0.5, `${shooter.color}30`);
    gradient.addColorStop(1, `${shooter.color}10`);
    
    ctx.strokeStyle = gradient;
    ctx.lineWidth = 2;
    ctx.setLineDash([8, 4]);
    ctx.stroke();
    ctx.setLineDash([]);
  });
}

// Draw bullets with curved trails
function drawBullets(
  ctx: CanvasRenderingContext2D, 
  bullets: Bullet[],
  holderPositions: Map<string, { x: number; y: number; color: string }>
) {
  bullets.forEach(bullet => {
    const shooterColor = bullet.shooterColor || "#ffff00";
    
    // Draw bullet trail (curved path behind the bullet)
    const trailPoints: { x: number; y: number; alpha: number }[] = [];
    const numTrailPoints = 8;
    
    for (let i = 0; i < numTrailPoints; i++) {
      const trailProgress = Math.max(0, bullet.progress - (i * 0.03));
      if (trailProgress <= 0) break;
      
      // Calculate trail point position on the curve
      const t = trailProgress;
      const dx = bullet.targetX - bullet.startX;
      const dy = bullet.targetY - bullet.startY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      const perpX = -dy / dist;
      const perpY = dx / dist;
      const midX = (bullet.startX + bullet.targetX) / 2;
      const midY = (bullet.startY + bullet.targetY) / 2;
      const controlX = midX + perpX * bullet.curveStrength * bullet.curveDirection;
      const controlY = midY + perpY * bullet.curveStrength * bullet.curveDirection;
      
      const oneMinusT = 1 - t;
      const x = oneMinusT * oneMinusT * bullet.startX + 
                2 * oneMinusT * t * controlX + 
                t * t * bullet.targetX;
      const y = oneMinusT * oneMinusT * bullet.startY + 
                2 * oneMinusT * t * controlY + 
                t * t * bullet.targetY;
      
      trailPoints.push({ x, y, alpha: 1 - (i / numTrailPoints) });
    }
    
    // Draw trail
    for (let i = trailPoints.length - 1; i >= 0; i--) {
      const point = trailPoints[i];
      const trailSize = 2 + (trailPoints.length - i) * 0.3;
      
      ctx.beginPath();
      ctx.arc(point.x, point.y, trailSize, 0, Math.PI * 2);
      ctx.fillStyle = `${shooterColor}${Math.floor(point.alpha * 100).toString(16).padStart(2, '0')}`;
      ctx.fill();
    }
    
    // Bullet glow with shooter's color
    const glowGradient = ctx.createRadialGradient(
      bullet.x, bullet.y, 0,
      bullet.x, bullet.y, 10
    );
    glowGradient.addColorStop(0, `${shooterColor}cc`);
    glowGradient.addColorStop(0.5, `${shooterColor}60`);
    glowGradient.addColorStop(1, `${shooterColor}00`);
    
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = glowGradient;
    ctx.fill();
    
    // Bullet core (white center)
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = "#fff";
    ctx.fill();
    
    // Inner color ring
    ctx.beginPath();
    ctx.arc(bullet.x, bullet.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = shooterColor;
    ctx.fill();
  });
}

// Draw damage numbers
function drawDamageNumbers(ctx: CanvasRenderingContext2D, damageNumbers: DamageNumber[]) {
  damageNumbers.forEach(dn => {
    ctx.globalAlpha = dn.alpha;
    ctx.fillStyle = "#ff4444";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`-${dn.damage.toFixed(1)}`, dn.x, dn.y);
    ctx.globalAlpha = 1;
  });
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
