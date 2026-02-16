// Visual effects system for HODLWARZ

export type EffectType = 
  | "explosion"      // New buyer - particles exploding outward
  | "shrink"         // Sell alert - bubble shrinks and turns red
  | "ripple"         // Whale movement - screen-wide ripple
  | "pump"           // Price pump - green glow on all bubbles
  | "dump";          // Price dump - red glow on all bubbles

export interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  color: string;
  alpha: number;
  decay: number;
}

export interface Explosion {
  x: number;
  y: number;
  particles: Particle[];
  createdAt: number;
  duration: number;
}

export interface Ripple {
  x: number;
  y: number;
  radius: number;
  maxRadius: number;
  alpha: number;
  color: string;
  createdAt: number;
}

export interface BubbleEffect {
  address: string;
  type: "shrink" | "glow";
  color: string;
  intensity: number;
  startedAt: number;
  duration: number;
}

export interface GlobalEffect {
  type: "pump" | "dump";
  intensity: number;
  startedAt: number;
  duration: number;
}

export interface EffectsState {
  explosions: Explosion[];
  ripples: Ripple[];
  bubbleEffects: BubbleEffect[];
  globalEffect: GlobalEffect | null;
}

export function createInitialEffectsState(): EffectsState {
  return {
    explosions: [],
    ripples: [],
    bubbleEffects: [],
    globalEffect: null,
  };
}

// Create explosion effect for new buyer
export function createExplosion(x: number, y: number, color: string): Explosion {
  const particles: Particle[] = [];
  const particleCount = 20;
  
  for (let i = 0; i < particleCount; i++) {
    const angle = (i / particleCount) * Math.PI * 2;
    const speed = 2 + Math.random() * 3;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 3 + Math.random() * 4,
      color,
      alpha: 1,
      decay: 0.02 + Math.random() * 0.02,
    });
  }
  
  // Add some sparkles
  for (let i = 0; i < 10; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 4 + Math.random() * 4;
    particles.push({
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      radius: 1 + Math.random() * 2,
      color: "#ffffff",
      alpha: 1,
      decay: 0.03 + Math.random() * 0.02,
    });
  }
  
  return {
    x,
    y,
    particles,
    createdAt: Date.now(),
    duration: 2000,
  };
}

// Create ripple effect for whale movement
export function createRipple(x: number, y: number, color: string, maxRadius: number = 500): Ripple {
  return {
    x,
    y,
    radius: 10,
    maxRadius,
    alpha: 0.8,
    color,
    createdAt: Date.now(),
  };
}

// Create shrink effect for seller
export function createShrinkEffect(address: string): BubbleEffect {
  return {
    address,
    type: "shrink",
    color: "#ef4444", // Red
    intensity: 1,
    startedAt: Date.now(),
    duration: 2000,
  };
}

// Create glow effect for specific bubble
export function createGlowEffect(address: string, color: string): BubbleEffect {
  return {
    address,
    type: "glow",
    color,
    intensity: 1,
    startedAt: Date.now(),
    duration: 3000,
  };
}

// Create global pump/dump effect
export function createGlobalEffect(type: "pump" | "dump"): GlobalEffect {
  return {
    type,
    intensity: 1,
    startedAt: Date.now(),
    duration: 3000,
  };
}

// Update all effects (call each frame)
export function updateEffects(state: EffectsState): EffectsState {
  const now = Date.now();
  
  // Update explosions
  const explosions = state.explosions
    .map(explosion => {
      const particles = explosion.particles
        .map(p => ({
          ...p,
          x: p.x + p.vx,
          y: p.y + p.vy,
          vy: p.vy + 0.1, // Gravity
          alpha: p.alpha - p.decay,
        }))
        .filter(p => p.alpha > 0);
      
      return { ...explosion, particles };
    })
    .filter(e => e.particles.length > 0 && now - e.createdAt < e.duration);
  
  // Update ripples
  const ripples = state.ripples
    .map(ripple => ({
      ...ripple,
      radius: ripple.radius + 8,
      alpha: ripple.alpha * 0.96,
    }))
    .filter(r => r.radius < r.maxRadius && r.alpha > 0.05);
  
  // Update bubble effects
  const bubbleEffects = state.bubbleEffects
    .map(effect => {
      const elapsed = now - effect.startedAt;
      const progress = elapsed / effect.duration;
      return {
        ...effect,
        intensity: Math.max(0, 1 - progress),
      };
    })
    .filter(e => e.intensity > 0);
  
  // Update global effect
  let globalEffect = state.globalEffect;
  if (globalEffect) {
    const elapsed = now - globalEffect.startedAt;
    const progress = elapsed / globalEffect.duration;
    if (progress >= 1) {
      globalEffect = null;
    } else {
      globalEffect = {
        ...globalEffect,
        intensity: Math.sin(progress * Math.PI), // Fade in and out
      };
    }
  }
  
  return { explosions, ripples, bubbleEffects, globalEffect };
}

// Draw all effects on canvas
export function drawEffects(
  ctx: CanvasRenderingContext2D,
  state: EffectsState,
  width: number,
  height: number
): void {
  // Draw global effect (screen overlay)
  if (state.globalEffect) {
    const { type, intensity } = state.globalEffect;
    const color = type === "pump" ? "0, 255, 100" : "255, 50, 50";
    
    // Screen edge glow
    const gradient = ctx.createRadialGradient(
      width / 2, height / 2, 0,
      width / 2, height / 2, Math.max(width, height)
    );
    gradient.addColorStop(0, `rgba(${color}, 0)`);
    gradient.addColorStop(0.7, `rgba(${color}, 0)`);
    gradient.addColorStop(1, `rgba(${color}, ${intensity * 0.3})`);
    
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
  }
  
  // Draw ripples
  state.ripples.forEach(ripple => {
    ctx.beginPath();
    ctx.arc(ripple.x, ripple.y, ripple.radius, 0, Math.PI * 2);
    ctx.strokeStyle = ripple.color.replace(")", `, ${ripple.alpha})`).replace("rgb", "rgba");
    ctx.lineWidth = 3;
    ctx.stroke();
    
    // Inner ripple
    if (ripple.radius > 20) {
      ctx.beginPath();
      ctx.arc(ripple.x, ripple.y, ripple.radius * 0.7, 0, Math.PI * 2);
      ctx.strokeStyle = ripple.color.replace(")", `, ${ripple.alpha * 0.5})`).replace("rgb", "rgba");
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  });
  
  // Draw explosion particles
  state.explosions.forEach(explosion => {
    explosion.particles.forEach(particle => {
      ctx.beginPath();
      ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2);
      
      // Create glow effect
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
}

// Get effect modifiers for a specific bubble
export function getBubbleEffectModifiers(
  address: string,
  state: EffectsState
): { scale: number; glowColor: string | null; glowIntensity: number } {
  let scale = 1;
  let glowColor: string | null = null;
  let glowIntensity = 0;
  
  // Check bubble-specific effects
  const bubbleEffect = state.bubbleEffects.find(e => e.address === address);
  if (bubbleEffect) {
    if (bubbleEffect.type === "shrink") {
      scale = 0.7 + (1 - bubbleEffect.intensity) * 0.3;
      glowColor = bubbleEffect.color;
      glowIntensity = bubbleEffect.intensity;
    } else if (bubbleEffect.type === "glow") {
      glowColor = bubbleEffect.color;
      glowIntensity = bubbleEffect.intensity;
    }
  }
  
  // Check global effect
  if (state.globalEffect) {
    const color = state.globalEffect.type === "pump" ? "#22c55e" : "#ef4444";
    if (!glowColor) {
      glowColor = color;
      glowIntensity = state.globalEffect.intensity * 0.5;
    }
  }
  
  return { scale, glowColor, glowIntensity };
}
