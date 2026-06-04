"use client";

import { useRef, useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Play, RotateCcw } from "lucide-react";

// ─── Types ──────────────────────────────────────────────────────────────

interface Ability {
  id: string;
  name: string;
  icon: string;
  desc: string;
  color: string;
  effect: (state: MiniGameState) => void;
}

interface MiniEnemy {
  id: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  health: number;
  maxHealth: number;
  color: string;
  level: number;
  kills: number;
  isGhost: boolean;
  ghostUntil: number;
  lastShot: number;
  _lastNudge: number;
}

interface MiniBullet {
  id: number;
  shooterIsPlayer: boolean;
  shooterColor: string;
  x: number;
  y: number;
  startX: number;
  startY: number;
  targetX: number;
  targetY: number;
  progress: number;
  curveDir: number;
  curveStr: number;
  damage: number;
  isCrit: boolean;
  isRicochet: boolean;
}

interface MiniDmgNumber {
  x: number;
  y: number;
  text: string;
  color: string;
  alpha: number;
  vy: number;
  fontSize: number;
}

interface MiniSpark {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  color: string;
  size: number;
}

interface MiniExplosionParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  alpha: number;
  color: string;
}

interface MiniGameState {
  playerX: number;
  playerY: number;
  playerVx: number;
  playerVy: number;
  playerRadius: number;
  playerHealth: number;
  playerMaxHealth: number;
  playerColor: string;
  playerLevel: number;
  playerKills: number;
  playerLastNudge: number;
  enemies: MiniEnemy[];
  bullets: MiniBullet[];
  dmgNumbers: MiniDmgNumber[];
  sparks: MiniSpark[];
  explosions: MiniExplosionParticle[];
  fireRate: number;
  bulletDamage: number;
  lastShot: number;
  critChance: number;
  ricochetChance: number;
  lifestealPct: number;
  multiShotChance: number;
  armorPct: number;
  executePct: number;
  wave: number;
  lastTickTime: number;

  nextBulletId: number;
  nextEnemyId: number;
}

// ─── Constants ──────────────────────────────────────────────────────────

const CANVAS_SIZE = 500;
const PLAYER_RADIUS = 20;
const BULLET_SPEED = 0.035;
const ENEMY_FIRE_RATE = 2200;

const PHYSICS = {
  minSpeed: 0.4,
  maxSpeed: 2.5,
  velocityDecay: 0.997,
  collisionPadding: 5,
  wallBounce: 0.75,
  repulsionRange: 15,
  repulsionStrength: 0.04,
  nudgeInterval: 3000,
  nudgeStrength: 0.35,
};

const ABILITIES: Ability[] = [
  // Tank tree: Armor (tier 1)
  {
    id: "armor", name: "Armor", icon: "🛡️", desc: "-40% incoming damage (Tank tree)", color: "#22c55e",
    effect: (s) => { s.armorPct = 0.4; },
  },
  // Tank tree: Iron Skin (tier 2)
  {
    id: "ironSkin", name: "Iron Skin", icon: "💚", desc: "+30% max HP (Tank tree)", color: "#22c55e",
    effect: (s) => { s.playerMaxHealth *= 1.3; s.playerHealth = s.playerMaxHealth; },
  },
  // Tank tree: Lifesteal (tier 4)
  {
    id: "lifesteal", name: "Lifesteal", icon: "🩸", desc: "Heal 33% of damage dealt (Tank tree)", color: "#22c55e",
    effect: (s) => { s.lifestealPct = 0.33; },
  },
  // Firepower tree: Heavy Hitter (tier 1)
  {
    id: "heavyHitter", name: "Heavy Hitter", icon: "🎯", desc: "+24% bullet damage (Firepower tree)", color: "#ef4444",
    effect: (s) => { s.bulletDamage *= 1.24; },
  },
  // Firepower tree: Rapid Fire (tier 2)
  {
    id: "rapidFire", name: "Rapid Fire", icon: "⚡", desc: "-14% fire cooldown (Firepower tree)", color: "#ef4444",
    effect: (s) => { s.fireRate *= 0.86; },
  },
  // Firepower tree: Critical Strike (tier 3)
  {
    id: "criticalStrike", name: "Critical Strike", icon: "💥", desc: "35% crit chance, 2x damage (Firepower tree)", color: "#ef4444",
    effect: (s) => { s.critChance = 0.35; },
  },
  // Firepower tree: Multi Shot (tier 4)
  {
    id: "multiShot", name: "Multi Shot", icon: "🔥", desc: "50% chance to fire 2nd bullet at 50% dmg (Firepower tree)", color: "#ef4444",
    effect: (s) => { s.multiShotChance = 0.5; },
  },
  // Mass Damage tree: Ricochet (tier 1)
  {
    id: "ricochet", name: "Ricochet", icon: "💥", desc: "50% chance bullet bounces to 2nd target (Mass Damage tree)", color: "#eab308",
    effect: (s) => { s.ricochetChance = 0.5; },
  },
  // Swift tree: Quickfire (tier 1)
  {
    id: "quickfire", name: "Quickfire", icon: "⚡", desc: "+24% fire rate (Swift tree)", color: "#f97316",
    effect: (s) => { s.fireRate *= 0.76; },
  },
  // Blood Thirst tree: Execute (tier 2)
  {
    id: "execute", name: "Execute", icon: "🩸", desc: "+33% damage vs targets below 50% HP (Blood Thirst tree)", color: "#a855f7",
    effect: (s) => { s.executePct = 0.33; },
  },
];

const MAX_PICKS = 3;

// ─── Helpers ────────────────────────────────────────────────────────────

const ENEMY_COLORS = ["#e74c3c", "#e67e22", "#f1c40f", "#2ecc71", "#1abc9c", "#3498db", "#9b59b6", "#e84393", "#fd79a8", "#00cec9"];

function pickEnemyColor(id: number): string {
  return ENEMY_COLORS[id % ENEMY_COLORS.length];
}

function dist(ax: number, ay: number, bx: number, by: number): number {
  return Math.sqrt((ax - bx) ** 2 + (ay - by) ** 2);
}

function adjustBrightness(hex: string, percent: number): string {
  hex = hex.replace(/^#/, "");
  let r = parseInt(hex.substring(0, 2), 16);
  let g = parseInt(hex.substring(2, 4), 16);
  let b = parseInt(hex.substring(4, 6), 16);
  r = Math.min(255, Math.max(0, r + (r * percent) / 100));
  g = Math.min(255, Math.max(0, g + (g * percent) / 100));
  b = Math.min(255, Math.max(0, b + (b * percent) / 100));
  return `#${Math.round(r).toString(16).padStart(2, "0")}${Math.round(g).toString(16).padStart(2, "0")}${Math.round(b).toString(16).padStart(2, "0")}`;
}

function bezierPos(b: MiniBullet): { x: number; y: number } {
  const t = b.progress;
  const dx = b.targetX - b.startX;
  const dy = b.targetY - b.startY;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / d;
  const py = dx / d;
  const mx = (b.startX + b.targetX) / 2 + px * b.curveStr * b.curveDir;
  const my = (b.startY + b.targetY) / 2 + py * b.curveStr * b.curveDir;
  const u = 1 - t;
  return {
    x: u * u * b.startX + 2 * u * t * mx + t * t * b.targetX,
    y: u * u * b.startY + 2 * u * t * my + t * t * b.targetY,
  };
}

function createEnemy(id: number, wave: number): MiniEnemy {
  const radius = 12 + Math.random() * 10;
  const margin = radius + 30;
  const baseHp = 25 + wave * 10;
  const angle = Math.random() * Math.PI * 2;
  const speed = PHYSICS.minSpeed + Math.random() * (PHYSICS.maxSpeed - PHYSICS.minSpeed) * 0.6;
  return {
    id,
    x: margin + Math.random() * (CANVAS_SIZE - margin * 2),
    y: margin + Math.random() * (CANVAS_SIZE - margin * 2),
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius,
    health: baseHp,
    maxHealth: baseHp,
    color: pickEnemyColor(id),
    level: Math.min(wave, 10),
    kills: 0,
    isGhost: false,
    ghostUntil: 0,
    lastShot: 0,
    _lastNudge: Date.now() - Math.random() * PHYSICS.nudgeInterval,
  };
}

// ─── Drawing functions (matching real game) ─────────────────────────────

function drawGrid(ctx: CanvasRenderingContext2D, size: number) {
  ctx.strokeStyle = "rgba(147, 51, 234, 0.07)";
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= size; x += 50) {
    ctx.moveTo(x, 0);
    ctx.lineTo(x, size);
  }
  for (let y = 0; y <= size; y += 50) {
    ctx.moveTo(0, y);
    ctx.lineTo(size, y);
  }
  ctx.stroke();
}

function drawBubble(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, radius: number, color: string,
  isGhost: boolean, ghostUntil: number, now: number,
  level: number, kills: number,
  isPlayer: boolean, health: number, maxHealth: number
) {
  const ghostAlpha = isGhost ? 0.4 : 1;
  ctx.globalAlpha = ghostAlpha;

  const baseColor = isGhost ? "#6b7280" : color;

  // Player glow
  if (isPlayer && !isGhost) {
    const pulsePhase = (now % 2000) / 2000;
    const pulseIntensity = 0.5 + Math.sin(pulsePhase * Math.PI * 2) * 0.3;
    const glowSize = radius + 18 + Math.sin(pulsePhase * Math.PI * 2) * 6;

    const walletGlow = ctx.createRadialGradient(x, y, radius * 0.8, x, y, glowSize);
    walletGlow.addColorStop(0, `rgba(168, 85, 247, ${pulseIntensity * 0.6})`);
    walletGlow.addColorStop(0.5, `rgba(168, 85, 247, ${pulseIntensity * 0.3})`);
    walletGlow.addColorStop(0.75, `rgba(250, 204, 21, ${pulseIntensity * 0.15})`);
    walletGlow.addColorStop(1, "rgba(168, 85, 247, 0)");
    ctx.beginPath();
    ctx.arc(x, y, glowSize, 0, Math.PI * 2);
    ctx.fillStyle = walletGlow;
    ctx.fill();

    const ringAngle = (now % 4000) / 4000 * Math.PI * 2;
    ctx.beginPath();
    ctx.arc(x, y, radius + 7, ringAngle, ringAngle + Math.PI * 1.5);
    ctx.strokeStyle = `rgba(168, 85, 247, ${0.4 + pulseIntensity * 0.4})`;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(x, y, radius + 11, -ringAngle, -ringAngle + Math.PI);
    ctx.strokeStyle = `rgba(250, 204, 21, ${0.3 + pulseIntensity * 0.3})`;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }

  // 3D bubble gradient
  const gradient = ctx.createRadialGradient(
    x - radius * 0.3, y - radius * 0.3, 0,
    x, y, radius
  );
  gradient.addColorStop(0, adjustBrightness(baseColor, 50));
  gradient.addColorStop(0.5, baseColor);
  gradient.addColorStop(1, adjustBrightness(baseColor, -40));

  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Highlight reflection
  ctx.beginPath();
  ctx.arc(x - radius * 0.25, y - radius * 0.25, radius * 0.25, 0, Math.PI * 2);
  const hlGrad = ctx.createRadialGradient(
    x - radius * 0.25, y - radius * 0.25, 0,
    x - radius * 0.25, y - radius * 0.25, radius * 0.25
  );
  hlGrad.addColorStop(0, "rgba(255, 255, 255, 0.3)");
  hlGrad.addColorStop(1, "rgba(255, 255, 255, 0)");
  ctx.fillStyle = hlGrad;
  ctx.fill();

  ctx.globalAlpha = 1;

  // Health bar
  if (!isGhost) {
    const barW = radius * 1.5;
    const barH = 5;
    const barX = x - barW / 2;
    const barY = y - radius - 11;
    const pct = health / maxHealth;

    ctx.fillStyle = "rgba(0, 0, 0, 0.5)";
    ctx.fillRect(barX, barY, barW, barH);
    ctx.fillStyle = pct > 0.6 ? "#22c55e" : pct > 0.3 ? "#f59e0b" : "#ef4444";
    ctx.fillRect(barX, barY, barW * pct, barH);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.25)";
    ctx.lineWidth = 0.5;
    ctx.strokeRect(barX, barY, barW, barH);
  } else {
    // Ghost timer
    const remaining = Math.max(0, Math.ceil((ghostUntil - now) / 1000));
    ctx.fillStyle = "rgba(255, 255, 255, 0.7)";
    ctx.font = "bold 11px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${remaining}s`, x, y - radius - 8);
    ctx.font = `${Math.max(14, radius * 0.55)}px system-ui, sans-serif`;
    ctx.fillText("💀", x, y);
  }

  // Level badge
  if (level > 1 && !isGhost) {
    const bx = x + radius * 0.7;
    const by = y - radius * 0.7;
    const br = Math.max(7, radius * 0.28);

    const badgeGrad = ctx.createRadialGradient(bx, by, 0, bx, by, br);
    badgeGrad.addColorStop(0, "#a855f7");
    badgeGrad.addColorStop(1, "#7c3aed");
    ctx.beginPath();
    ctx.arc(bx, by, br, 0, Math.PI * 2);
    ctx.fillStyle = badgeGrad;
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.6)";
    ctx.lineWidth = 0.8;
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = `bold ${Math.max(6, br * 0.85)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`${level}`, bx, by);
  }

  // Kill count
  if (kills > 0 && !isGhost) {
    ctx.fillStyle = "#fbbf24";
    ctx.font = "bold 9px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(`☠${kills}`, x, y + radius + 11);
  }

  // "YOU" label
  if (isPlayer) {
    const youPulse = 0.8 + Math.sin((now % 1500) / 1500 * Math.PI * 2) * 0.2;
    ctx.globalAlpha = youPulse;
    ctx.fillStyle = "#a855f7";
    ctx.font = `bold ${Math.max(10, radius / 2.8)}px system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("⭐ YOU", x, y + radius + (kills > 0 ? 22 : 13));
    ctx.globalAlpha = 1;
  }
}

function drawTargetingLine(
  ctx: CanvasRenderingContext2D,
  sx: number, sy: number,
  tx: number, ty: number,
  color: string,
  curveDir: number
) {
  const dx = tx - sx;
  const dy = ty - sy;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / d;
  const py = dx / d;
  const mx = (sx + tx) / 2 + px * 25 * curveDir;
  const my = (sy + ty) / 2 + py * 25 * curveDir;

  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.quadraticCurveTo(mx, my, tx, ty);

  const grad = ctx.createLinearGradient(sx, sy, tx, ty);
  grad.addColorStop(0, `${color}55`);
  grad.addColorStop(0.5, `${color}25`);
  grad.addColorStop(1, `${color}08`);
  ctx.strokeStyle = grad;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 3]);
  ctx.stroke();
  ctx.setLineDash([]);
}

function drawBulletTrail(ctx: CanvasRenderingContext2D, b: MiniBullet) {
  const shooterColor = b.shooterColor;

  // Trail
  const trailPoints = 8;
  const dx = b.targetX - b.startX;
  const dy = b.targetY - b.startY;
  const d = Math.sqrt(dx * dx + dy * dy) || 1;
  const px = -dy / d;
  const py = dx / d;
  const ctrlX = (b.startX + b.targetX) / 2 + px * b.curveStr * b.curveDir;
  const ctrlY = (b.startY + b.targetY) / 2 + py * b.curveStr * b.curveDir;

  for (let i = 0; i < trailPoints; i++) {
    const tp = Math.max(0, b.progress - i * 0.03);
    if (tp <= 0) break;
    const u = 1 - tp;
    const tx = u * u * b.startX + 2 * u * tp * ctrlX + tp * tp * b.targetX;
    const ty = u * u * b.startY + 2 * u * tp * ctrlY + tp * tp * b.targetY;
    const alpha = 1 - i / trailPoints;
    const size = 2 + (trailPoints - i) * 0.3;
    ctx.beginPath();
    ctx.arc(tx, ty, size, 0, Math.PI * 2);
    ctx.fillStyle = `${shooterColor}${Math.floor(alpha * 90).toString(16).padStart(2, "0")}`;
    ctx.fill();
  }

  // Glow
  const glow = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 9);
  glow.addColorStop(0, `${shooterColor}bb`);
  glow.addColorStop(0.5, `${shooterColor}55`);
  glow.addColorStop(1, `${shooterColor}00`);
  ctx.beginPath();
  ctx.arc(b.x, b.y, 9, 0, Math.PI * 2);
  ctx.fillStyle = glow;
  ctx.fill();

  // White core
  ctx.beginPath();
  ctx.arc(b.x, b.y, 3.5, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();

  // Colored inner
  ctx.beginPath();
  ctx.arc(b.x, b.y, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = shooterColor;
  ctx.fill();

  // Crit glow
  if (b.isCrit) {
    ctx.globalAlpha = 0.5;
    const critGlow = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, 14);
    critGlow.addColorStop(0, "#facc15cc");
    critGlow.addColorStop(1, "#facc1500");
    ctx.beginPath();
    ctx.arc(b.x, b.y, 14, 0, Math.PI * 2);
    ctx.fillStyle = critGlow;
    ctx.fill();
    ctx.globalAlpha = 1;
  }
}

// ─── Component ──────────────────────────────────────────────────────────

export function MiniGame() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<MiniGameState | null>(null);
  const animRef = useRef<number>(0);
  const [phase, setPhase] = useState<"pick" | "playing" | "dead">("pick");
  const [selectedAbilities, setSelectedAbilities] = useState<Set<string>>(new Set());
  const [kills, setKills] = useState(0);
  const [wave, setWave] = useState(1);

  const toggleAbility = useCallback((id: string) => {
    setSelectedAbilities((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else if (next.size < MAX_PICKS) next.add(id);
      return next;
    });
  }, []);

  const initGame = useCallback(() => {
    const startAngle = Math.random() * Math.PI * 2;
    const startSpeed = PHYSICS.minSpeed + Math.random() * 0.5;
    const state: MiniGameState = {
      playerX: CANVAS_SIZE / 2,
      playerY: CANVAS_SIZE / 2,
      playerVx: Math.cos(startAngle) * startSpeed,
      playerVy: Math.sin(startAngle) * startSpeed,
      playerRadius: PLAYER_RADIUS,
      playerHealth: 100,
      playerMaxHealth: 100,
      playerColor: "#a78bfa",
      playerLevel: 1,
      playerKills: 0,
      playerLastNudge: Date.now() - Math.random() * PHYSICS.nudgeInterval,
      enemies: [],
      bullets: [],
      dmgNumbers: [],
      sparks: [],
      explosions: [],
      fireRate: 350,
      bulletDamage: 8,
      lastShot: 0,
      critChance: 0,
      ricochetChance: 0,
      lifestealPct: 0,
      multiShotChance: 0,
      armorPct: 0,
      executePct: 0,
      wave: 1,
      lastTickTime: 0,

      nextBulletId: 0,
      nextEnemyId: 100,
    };

    for (const id of selectedAbilities) {
      const ab = ABILITIES.find((a) => a.id === id);
      ab?.effect(state);
    }

    for (let i = 0; i < 5; i++) {
      state.enemies.push(createEnemy(state.nextEnemyId++, 1));
    }

    stateRef.current = state;
    setKills(0);
    setWave(1);
    setPhase("playing");
  }, [selectedAbilities]);

  const restart = useCallback(() => {
    cancelAnimationFrame(animRef.current);
    stateRef.current = null;
    setPhase("pick");
    setSelectedAbilities(new Set());
  }, []);

  // ─── Game loop ──────────────────────────────────────────────────────

  useEffect(() => {
    if (phase !== "playing") return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    canvas.width = CANVAS_SIZE * dpr;
    canvas.height = CANVAS_SIZE * dpr;

    const enemyShootTimers = new Map<number, number>();

    const loop = () => {
      const s = stateRef.current;
      if (!s) return;
      const now = Date.now();

      // ── Remove dead enemies ──
      s.enemies = s.enemies.filter((e) => e.health > -900);
      const aliveEnemies = s.enemies.filter((e) => !e.isGhost);

      // ── Delta time (normalized to 1.0 at ~60fps) ──
      const dt = s.lastTickTime ? Math.min((now - s.lastTickTime) / (1000 / 60), 3) : 1;
      s.lastTickTime = now;

      // ── Helper: apply movement physics to a single bubble ──
      const moveBubble = (x: number, y: number, vx: number, vy: number, radius: number, lastNudge: number) => {
        // 1. Apply velocity
        x += vx * dt;
        y += vy * dt;

        // 2. Velocity decay
        vx *= PHYSICS.velocityDecay;
        vy *= PHYSICS.velocityDecay;

        // 3. Wall bounce
        const margin = radius + 10;
        if (x < margin) { x = margin; vx = Math.abs(vx) * PHYSICS.wallBounce; }
        if (x > CANVAS_SIZE - margin) { x = CANVAS_SIZE - margin; vx = -Math.abs(vx) * PHYSICS.wallBounce; }
        if (y < margin) { y = margin; vy = Math.abs(vy) * PHYSICS.wallBounce; }
        if (y > CANVAS_SIZE - margin) { y = CANVAS_SIZE - margin; vy = -Math.abs(vy) * PHYSICS.wallBounce; }

        // 4. Enforce min speed (bubbles never stop)
        const speed = Math.sqrt(vx * vx + vy * vy);
        if (speed < PHYSICS.minSpeed && speed > 0) {
          const scale = PHYSICS.minSpeed / speed;
          vx *= scale;
          vy *= scale;
        } else if (speed === 0) {
          const a = Math.random() * Math.PI * 2;
          vx = Math.cos(a) * PHYSICS.minSpeed;
          vy = Math.sin(a) * PHYSICS.minSpeed;
        }

        // 5. Enforce max speed
        if (speed > PHYSICS.maxSpeed) {
          const scale = PHYSICS.maxSpeed / speed;
          vx *= scale;
          vy *= scale;
        }

        // 6. Random nudge every ~3 seconds to break patterns
        let newNudge = lastNudge;
        if (now - lastNudge > PHYSICS.nudgeInterval) {
          newNudge = now;
          const a = Math.random() * Math.PI * 2;
          vx += Math.cos(a) * PHYSICS.nudgeStrength;
          vy += Math.sin(a) * PHYSICS.nudgeStrength;
        }

        return { x, y, vx, vy, lastNudge: newNudge };
      };

      // ── Move player ──
      const pResult = moveBubble(s.playerX, s.playerY, s.playerVx, s.playerVy, s.playerRadius, s.playerLastNudge);
      s.playerX = pResult.x;
      s.playerY = pResult.y;
      s.playerVx = pResult.vx;
      s.playerVy = pResult.vy;
      s.playerLastNudge = pResult.lastNudge;

      // ── Move enemies (same physics, no special targeting) ──
      for (const e of s.enemies) {
        if (e.isGhost) continue;
        const r = moveBubble(e.x, e.y, e.vx, e.vy, e.radius, e._lastNudge);
        e.x = r.x;
        e.y = r.y;
        e.vx = r.vx;
        e.vy = r.vy;
        e._lastNudge = r.lastNudge;
      }

      // ── Bubble collisions + soft repulsion (matching server) ──
      const allBodies: { x: number; y: number; vx: number; vy: number; r: number; isPlayer: boolean; enemyRef?: MiniEnemy }[] = [];
      allBodies.push({ x: s.playerX, y: s.playerY, vx: s.playerVx, vy: s.playerVy, r: s.playerRadius, isPlayer: true });
      for (const e of s.enemies) {
        if (e.isGhost) continue;
        allBodies.push({ x: e.x, y: e.y, vx: e.vx, vy: e.vy, r: e.radius, isPlayer: false, enemyRef: e });
      }

      for (let i = 0; i < allBodies.length; i++) {
        for (let j = i + 1; j < allBodies.length; j++) {
          const a = allBodies[i];
          const b = allBodies[j];
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d === 0) continue;

          const nx = dx / d;
          const ny = dy / d;
          const minDist = a.r + b.r + PHYSICS.collisionPadding;

          if (d < minDist) {
            // Hard collision: push apart + elastic bounce
            const overlap = minDist - d;
            const separation = overlap / 2 + 1;
            a.x -= nx * separation;
            a.y -= ny * separation;
            b.x += nx * separation;
            b.y += ny * separation;

            const relVelX = b.vx - a.vx;
            const relVelY = b.vy - a.vy;
            const relVelDotN = relVelX * nx + relVelY * ny;

            if (relVelDotN < 0) {
              const massA = a.r * a.r;
              const massB = b.r * b.r;
              const totalMass = massA + massB;
              const impulse = (2 * relVelDotN) / totalMass;
              a.vx += impulse * massB * nx * 0.8;
              a.vy += impulse * massB * ny * 0.8;
              b.vx -= impulse * massA * nx * 0.8;
              b.vy -= impulse * massA * ny * 0.8;
            }
          } else if (d < minDist + PHYSICS.repulsionRange) {
            // Soft repulsion: push bubbles apart before they collide
            const gap = d - minDist;
            const t = 1 - gap / PHYSICS.repulsionRange;
            const force = t * t * PHYSICS.repulsionStrength;
            a.vx -= nx * force;
            a.vy -= ny * force;
            b.vx += nx * force;
            b.vy += ny * force;
          }
        }
      }

      // Write back positions and velocities
      for (const body of allBodies) {
        if (body.isPlayer) {
          s.playerX = body.x;
          s.playerY = body.y;
          s.playerVx = body.vx;
          s.playerVy = body.vy;
        } else if (body.enemyRef) {
          body.enemyRef.x = body.x;
          body.enemyRef.y = body.y;
          body.enemyRef.vx = body.vx;
          body.enemyRef.vy = body.vy;
        }
      }

      // ── Enemy shoots at player ──
      for (const e of aliveEnemies) {
        const last = enemyShootTimers.get(e.id) || 0;
        if (now - last > ENEMY_FIRE_RATE + Math.random() * 400) {
          enemyShootTimers.set(e.id, now);
          s.bullets.push({
            id: s.nextBulletId++,
            shooterIsPlayer: false,
            shooterColor: e.color,
            x: e.x, y: e.y,
            startX: e.x, startY: e.y,
            targetX: s.playerX, targetY: s.playerY,
            progress: 0,
            curveDir: Math.random() > 0.5 ? 1 : -1,
            curveStr: 8 + Math.random() * 15,
            damage: 2 + s.wave * 0.5,
            isCrit: false,
            isRicochet: false,
          });
        }
      }

      // ── Player shoots at closest alive enemy ──
      if (now - s.lastShot > s.fireRate && aliveEnemies.length > 0) {
        s.lastShot = now;
        let closest: MiniEnemy | null = null;
        let closestD = Infinity;
        for (const e of aliveEnemies) {
          const d = dist(s.playerX, s.playerY, e.x, e.y);
          if (d < closestD) { closestD = d; closest = e; }
        }
        if (closest) {
          const isCrit = Math.random() < s.critChance;
          const dmg = isCrit ? s.bulletDamage * 3 : s.bulletDamage;
          s.bullets.push({
            id: s.nextBulletId++,
            shooterIsPlayer: true,
            shooterColor: s.playerColor,
            x: s.playerX, y: s.playerY,
            startX: s.playerX, startY: s.playerY,
            targetX: closest.x, targetY: closest.y,
            progress: 0,
            curveDir: Math.random() > 0.5 ? 1 : -1,
            curveStr: 15 + Math.random() * 25,
            damage: dmg,
            isCrit,
            isRicochet: false,
          });

          if (Math.random() < s.multiShotChance && aliveEnemies.length > 1) {
            const others = aliveEnemies.filter((e) => e.id !== closest!.id);
            const second = others[Math.floor(Math.random() * others.length)];
            if (second) {
              s.bullets.push({
                id: s.nextBulletId++,
                shooterIsPlayer: true,
                shooterColor: s.playerColor,
                x: s.playerX, y: s.playerY,
                startX: s.playerX, startY: s.playerY,
                targetX: second.x, targetY: second.y,
                progress: 0,
                curveDir: Math.random() > 0.5 ? 1 : -1,
                curveStr: 15 + Math.random() * 20,
                damage: dmg * 0.5,
                isCrit: false,
                isRicochet: false,
              });
            }
          }
        }
      }

      // ── Update bullets ──
      const removeIds = new Set<number>();
      const newBullets: MiniBullet[] = [];

      for (const b of s.bullets) {
        b.progress += BULLET_SPEED;
        const pos = bezierPos(b);
        b.x = pos.x;
        b.y = pos.y;

        if (b.progress >= 1.05 || b.x < -30 || b.x > CANVAS_SIZE + 30 || b.y < -30 || b.y > CANVAS_SIZE + 30) {
          removeIds.add(b.id);
          continue;
        }

        if (b.shooterIsPlayer) {
          for (const e of s.enemies) {
            if (e.isGhost) continue;
            if (dist(b.x, b.y, e.x, e.y) < e.radius + 3) {
              let finalDmg = b.damage;
              const isExecuteActive = s.executePct > 0 && (e.health / e.maxHealth) <= 0.5;
              if (isExecuteActive) finalDmg *= (1 + s.executePct);

              e.health -= finalDmg;
              removeIds.add(b.id);

              if (s.lifestealPct > 0) {
                s.playerHealth = Math.min(s.playerMaxHealth, s.playerHealth + finalDmg * s.lifestealPct);
              }

              // Damage number
              const dmgText = b.isCrit ? `-${Math.round(finalDmg)}!` : `-${Math.round(finalDmg)}`;
              s.dmgNumbers.push({
                x: e.x + (Math.random() - 0.5) * 16,
                y: e.y - e.radius - 4,
                text: isExecuteActive && !b.isCrit ? `${dmgText} ☠` : dmgText,
                color: b.isCrit ? "#facc15" : isExecuteActive ? "#c084fc" : "#ff4444",
                alpha: 1,
                vy: -1.2,
                fontSize: b.isCrit ? 14 : 11,
              });

              // Hit sparks
              const sparkCount = 3 + Math.floor(Math.random() * 4);
              for (let i = 0; i < sparkCount; i++) {
                const angle = Math.random() * Math.PI * 2;
                const speed = 0.8 + Math.random() * 2;
                s.sparks.push({
                  x: b.x, y: b.y,
                  vx: Math.cos(angle) * speed,
                  vy: Math.sin(angle) * speed,
                  life: 1,
                  maxLife: 0.6 + Math.random() * 0.4,
                  color: Math.random() > 0.4 ? "#fbbf24" : (Math.random() > 0.5 ? "#ff6b6b" : "#ffffff"),
                  size: 1 + Math.random() * 2,
                });
              }

              // Kill — remove enemy, spawn replacement
              if (e.health <= 0) {
                s.playerKills++;
                s.playerLevel = 1 + Math.floor(s.playerKills / 3);
                setKills(s.playerKills);

                // Death explosion
                for (let p = 0; p < 14; p++) {
                  const angle = (Math.PI * 2 * p) / 14;
                  const speed = 1.5 + Math.random() * 2.5;
                  s.explosions.push({
                    x: e.x, y: e.y,
                    vx: Math.cos(angle) * speed,
                    vy: Math.sin(angle) * speed,
                    radius: 2 + Math.random() * 3,
                    alpha: 1,
                    color: e.color,
                  });
                }

                // Every 5 kills = new wave (enemies get stronger)
                if (s.playerKills % 5 === 0) {
                  s.wave++;
                  setWave(s.wave);
                }

                // Mark for removal and spawn a fresh replacement at current wave strength
                e.health = -999;
                s.enemies.push(createEnemy(s.nextEnemyId++, s.wave));
              }

              // Ricochet
              if (!b.isRicochet && Math.random() < s.ricochetChance) {
                const nearby = s.enemies
                  .filter((ne) => ne.id !== e.id && !ne.isGhost)
                  .sort((a, bb2) => dist(e.x, e.y, a.x, a.y) - dist(e.x, e.y, bb2.x, bb2.y));
                if (nearby.length > 0) {
                  const nb: MiniBullet = {
                    id: s.nextBulletId++,
                    shooterIsPlayer: true,
                    shooterColor: "#60a5fa",
                    x: e.x, y: e.y,
                    startX: e.x, startY: e.y,
                    targetX: nearby[0].x, targetY: nearby[0].y,
                    progress: 0,
                    curveDir: Math.random() > 0.5 ? 1 : -1,
                    curveStr: 10 + Math.random() * 20,
                    damage: b.damage * 0.7,
                    isCrit: false,
                    isRicochet: true,
                  };
                  newBullets.push(nb);
                }
              }
              break;
            }
          }
        } else {
          // Enemy bullet hits player
          if (dist(b.x, b.y, s.playerX, s.playerY) < s.playerRadius + 2) {
            const reducedDmg = b.damage * (1 - s.armorPct);
            s.playerHealth -= reducedDmg;
            removeIds.add(b.id);
            s.dmgNumbers.push({
              x: s.playerX + (Math.random() - 0.5) * 16,
              y: s.playerY - s.playerRadius - 4,
              text: `-${Math.round(reducedDmg)}`,
              color: "#ef4444",
              alpha: 1,
              vy: -1,
              fontSize: 11,
            });
            const sc = 2 + Math.floor(Math.random() * 3);
            for (let i = 0; i < sc; i++) {
              const angle = Math.random() * Math.PI * 2;
              s.sparks.push({
                x: b.x, y: b.y,
                vx: Math.cos(angle) * (1 + Math.random()),
                vy: Math.sin(angle) * (1 + Math.random()),
                life: 1, maxLife: 0.5 + Math.random() * 0.3,
                color: "#ff6b6b", size: 1 + Math.random(),
              });
            }
          }
        }
      }

      s.bullets = s.bullets.filter((b) => !removeIds.has(b.id));
      s.bullets.push(...newBullets);

      // ── Update particles ──
      s.dmgNumbers = s.dmgNumbers.filter((d) => {
        d.y += d.vy;
        d.alpha -= 0.018;
        return d.alpha > 0;
      });

      s.sparks = s.sparks.filter((sp) => {
        sp.x += sp.vx;
        sp.y += sp.vy;
        sp.vy += 0.04;
        sp.vx *= 0.97;
        sp.life -= 0.04;
        return sp.life > 0;
      });

      s.explosions = s.explosions.filter((p) => {
        p.x += p.vx;
        p.y += p.vy;
        p.alpha -= 0.025;
        p.radius *= 0.97;
        return p.alpha > 0;
      });

      // ── Check player death ──
      if (s.playerHealth <= 0) {
        setPhase("dead");
        return;
      }

      // ── DRAW ──
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.scale(dpr, dpr);

      // Background
      drawGrid(ctx, CANVAS_SIZE);

      // World border
      ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
      ctx.lineWidth = 2;
      ctx.strokeRect(4, 4, CANVAS_SIZE - 8, CANVAS_SIZE - 8);
      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.strokeRect(1, 1, CANVAS_SIZE - 2, CANVAS_SIZE - 2);

      // Explosion particles (under bubbles)
      for (const p of s.explosions) {
        ctx.globalAlpha = p.alpha;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Targeting lines
      if (aliveEnemies.length > 0) {
        let closest: MiniEnemy | null = null;
        let closestD = Infinity;
        for (const e of aliveEnemies) {
          const d = dist(s.playerX, s.playerY, e.x, e.y);
          if (d < closestD) { closestD = d; closest = e; }
        }
        if (closest) {
          drawTargetingLine(ctx, s.playerX, s.playerY, closest.x, closest.y, s.playerColor, 1);
        }
        for (const e of aliveEnemies) {
          drawTargetingLine(ctx, e.x, e.y, s.playerX, s.playerY, e.color, e.id % 2 === 0 ? 1 : -1);
        }
      }

      // Bullets
      for (const b of s.bullets) {
        drawBulletTrail(ctx, b);
      }

      // Enemies
      for (const e of s.enemies) {
        drawBubble(ctx, e.x, e.y, e.radius, e.color, e.isGhost, e.ghostUntil, now, e.level, e.kills, false, e.health, e.maxHealth);
      }

      // Player
      drawBubble(ctx, s.playerX, s.playerY, s.playerRadius, s.playerColor, false, 0, now, s.playerLevel, s.playerKills, true, s.playerHealth, s.playerMaxHealth);

      // Hit sparks
      for (const sp of s.sparks) {
        const alpha = sp.life / sp.maxLife;
        const r = sp.size * alpha;
        ctx.globalAlpha = alpha * 0.9;
        ctx.beginPath();
        ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
        ctx.fillStyle = sp.color;
        ctx.fill();
      }
      ctx.globalAlpha = 1;

      // Damage numbers
      for (const d of s.dmgNumbers) {
        ctx.globalAlpha = d.alpha;
        ctx.fillStyle = d.color;
        ctx.font = `bold ${d.fontSize}px system-ui, sans-serif`;
        ctx.textAlign = "center";
        ctx.fillText(d.text, d.x, d.y);
      }
      ctx.globalAlpha = 1;

      animRef.current = requestAnimationFrame(loop);
    };

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [phase]);

  return (
    <div className="relative w-full max-w-[500px] mx-auto">
      <div
        className="relative rounded-2xl overflow-hidden"
        style={{
          boxShadow: "0 0 60px rgba(167, 139, 250, 0.12), 0 0 120px rgba(167, 139, 250, 0.04)",
          border: "1px solid rgba(167, 139, 250, 0.2)",
        }}
      >
        {/* Top glow */}
        <div className="absolute top-0 left-0 right-0 h-[2px] z-10 pointer-events-none" style={{
          background: "linear-gradient(90deg, transparent, rgba(255,0,255,0.4), rgba(0,255,255,0.4), transparent)",
        }} />

        <canvas
          ref={canvasRef}
          width={CANVAS_SIZE}
          height={CANVAS_SIZE}
          className="w-full aspect-square"
          style={{ background: "linear-gradient(135deg, #050010 0%, #0a0020 50%, #050015 100%)" }}
        />

        {/* ── Ability picker ── */}
        <AnimatePresence>
          {phase === "pick" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-4 z-20"
              style={{ background: "rgba(5, 0, 15, 0.85)", backdropFilter: "blur(8px)" }}
            >
              {/* Grid overlay */}
              <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{
                backgroundImage: "linear-gradient(rgba(255,0,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,0,255,0.5) 1px, transparent 1px)",
                backgroundSize: "40px 40px",
              }} />

              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.1 }}
                className="relative text-center mb-5"
              >
                <h3
                  className="text-xl sm:text-2xl font-black tracking-wider mb-1"
                  style={{
                    background: "linear-gradient(90deg, #ff00ff, #00ffff, #ff00ff)",
                    backgroundSize: "200% auto",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    animation: "shimmer 3s linear infinite",
                  }}
                >
                  CHOOSE YOUR POWERS
                </h3>
                <p className="text-xs text-slate-400">
                  Pick up to {MAX_PICKS} abilities, then enter the fight
                </p>
              </motion.div>

              <div className="relative grid grid-cols-2 gap-2 w-full max-w-sm mb-5">
                {ABILITIES.map((ab, i) => {
                  const isSelected = selectedAbilities.has(ab.id);
                  const isDisabled = !isSelected && selectedAbilities.size >= MAX_PICKS;
                  return (
                    <motion.button
                      key={ab.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: 0.12 + i * 0.04 }}
                      onClick={() => toggleAbility(ab.id)}
                      disabled={isDisabled}
                      className={`relative rounded-xl p-2.5 text-left transition-all border overflow-hidden ${
                        isSelected
                          ? "bg-white/10 border-white/30 scale-[1.02]"
                          : isDisabled
                            ? "bg-white/[0.02] border-white/[0.04] opacity-25"
                            : "bg-white/[0.03] border-white/10 hover:bg-white/[0.06] hover:border-white/20"
                      }`}
                    >
                      {isSelected && (
                        <div
                          className="absolute inset-0 opacity-15"
                          style={{ background: `radial-gradient(circle at center, ${ab.color}, transparent 70%)` }}
                        />
                      )}
                      <div className="relative flex items-start gap-2">
                        <span className="text-lg leading-none shrink-0">{ab.icon}</span>
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-white truncate">{ab.name}</div>
                          <div className="text-[9px] text-slate-400 leading-tight">{ab.desc}</div>
                        </div>
                      </div>
                    </motion.button>
                  );
                })}
              </div>

              <motion.button
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.5 }}
                onClick={initGame}
                disabled={selectedAbilities.size === 0}
                className="relative flex items-center gap-2 px-7 py-2.5 rounded-xl font-bold text-sm tracking-wide transition-all hover:scale-105 active:scale-95 disabled:opacity-25 disabled:hover:scale-100"
                style={{
                  background: selectedAbilities.size > 0
                    ? "linear-gradient(135deg, rgba(255,0,255,0.2), rgba(0,255,255,0.2))"
                    : "rgba(255,255,255,0.04)",
                  border: `1px solid ${selectedAbilities.size > 0 ? "rgba(255,0,255,0.4)" : "rgba(255,255,255,0.1)"}`,
                  color: "#fff",
                  boxShadow: selectedAbilities.size > 0 ? "0 0 20px rgba(255,0,255,0.1)" : "none",
                }}
              >
                <Play className="w-4 h-4" />
                Start Battle ({selectedAbilities.size}/{MAX_PICKS})
              </motion.button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── Death screen ── */}
        <AnimatePresence>
          {phase === "dead" && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 flex flex-col items-center justify-center p-4 z-20"
              style={{ background: "rgba(5, 0, 10, 0.85)", backdropFilter: "blur(8px)" }}
            >
              <motion.div
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ type: "spring", damping: 15 }}
                className="text-center"
              >
                <h3
                  className="text-3xl font-black tracking-wider mb-3"
                  style={{ color: "#ef4444", textShadow: "0 0 40px rgba(239,68,68,0.5)" }}
                >
                  DEFEATED
                </h3>
                <div className="flex items-center justify-center gap-5 mb-2">
                  <span className="text-lg text-yellow-400 font-bold">☠️ {kills} kills</span>
                  <span className="text-lg text-blue-400 font-bold">🌊 Wave {wave}</span>
                </div>
                <p className="text-xs text-slate-500 mb-6 max-w-xs">
                  The real game has 35+ talents, 7 full trees, seasonal leaderboards, and on-chain verification. Ready?
                </p>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={restart}
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm tracking-wide transition-all hover:scale-105 active:scale-95"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,0,255,0.2), rgba(0,255,255,0.2))",
                      border: "1px solid rgba(255,0,255,0.3)",
                      color: "#fff",
                    }}
                  >
                    <RotateCcw className="w-4 h-4" />
                    Try Again
                  </button>
                  <a
                    href="/arena"
                    className="flex items-center gap-2 px-5 py-2.5 rounded-xl font-bold text-sm tracking-wide transition-all hover:scale-105 active:scale-95"
                    style={{
                      background: "linear-gradient(135deg, rgba(255,0,255,0.35), rgba(0,255,255,0.35))",
                      border: "1px solid rgba(255,0,255,0.5)",
                      color: "#fff",
                      boxShadow: "0 0 20px rgba(255,0,255,0.15)",
                    }}
                  >
                    Enter the Real Arena →
                  </a>
                </div>
              </motion.div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ── In-game HUD ── */}
        {phase === "playing" && (
          <div className="absolute top-2 left-2 right-2 flex items-center justify-between pointer-events-none z-10">
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold text-yellow-400 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-full border border-yellow-500/20">
                ☠️ {kills}
              </span>
              <span className="text-[10px] font-bold text-blue-400 bg-black/60 backdrop-blur-sm px-2 py-0.5 rounded-full border border-blue-500/20">
                Wave {wave}
              </span>
            </div>
            <div className="flex items-center gap-1">
              {Array.from(selectedAbilities).map((id) => {
                const ab = ABILITIES.find((a) => a.id === id);
                return ab ? (
                  <span
                    key={id}
                    className="text-xs bg-black/60 backdrop-blur-sm rounded-full w-6 h-6 flex items-center justify-center border border-white/10"
                    title={ab.name}
                  >
                    {ab.icon}
                  </span>
                ) : null;
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
