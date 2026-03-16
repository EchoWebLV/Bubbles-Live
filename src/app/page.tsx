"use client";

import { motion, useScroll, useTransform } from "framer-motion";
import { useRef } from "react";
import Link from "next/link";
import {
  Swords,
  Heart,
  Zap,
  TrendingUp,
  Diamond,
  Shield,
  Crosshair,
  Users,
  Trophy,
  ChevronDown,
  Flame,
} from "lucide-react";
import { MiniGame } from "@/components/MiniGame";

const TALENT_TREES = [
  { icon: "🛡️", name: "Tank", desc: "Armor, Regeneration, Lifesteal", color: "#22c55e" },
  { icon: "🎯", name: "Firepower", desc: "Critical Strikes, Multi Shot, Homing", color: "#ef4444" },
  { icon: "💨", name: "Brawler", desc: "Dash, Body Slam, Shockwave", color: "#3b82f6" },
  { icon: "💥", name: "Mass Damage", desc: "Ricochet, Rockets, Chain Lightning", color: "#eab308" },
  { icon: "🩸", name: "Blood Thirst", desc: "Execute, Reaper's Arc, Berserker", color: "#a855f7" },
  { icon: "👻", name: "Echo", desc: "Decoys, Volatile Explosions, Singularity", color: "#14b8a6" },
  { icon: "⚡", name: "Swift", desc: "Quickfire, Velocity Rounds, Bullet Storm", color: "#f97316" },
];

const RULES = [
  {
    icon: <Swords className="w-5 h-5" />,
    color: "#ff00ff",
    title: "Auto-Battle",
    desc: "Every token holder becomes a bubble on the battlefield. Bubbles automatically target and shoot the nearest enemy.",
  },
  {
    icon: <Heart className="w-5 h-5" />,
    color: "#ff3366",
    title: "Health & Respawn",
    desc: "When HP hits 0, you become a ghost. Wait out the timer, then respawn with full health to fight again.",
  },
  {
    icon: <TrendingUp className="w-5 h-5" />,
    color: "#00ffaa",
    title: "Level Up & XP",
    desc: "Earn XP from kills, transactions, and holding the token. Higher level means more HP, more damage, and more talent points.",
  },
  {
    icon: <Zap className="w-5 h-5" />,
    color: "#ffcc00",
    title: "7 Talent Trees",
    desc: "Spend talent points across 7 unique trees. Build tank, go full DPS, or create hybrid builds. Choose 2 ultimate capstones.",
  },
  {
    icon: <Diamond className="w-5 h-5" />,
    color: "#00ccff",
    title: "On-Chain Verified",
    desc: "All combat is verified on Solana via MagicBlock ephemeral rollups. Damage, kills, and XP are computed on-chain.",
  },
  {
    icon: <Trophy className="w-5 h-5" />,
    color: "#f59e0b",
    title: "Seasonal Leaderboard",
    desc: "Compete for the top killer spot each season. Leaderboard resets periodically — prove yourself every season.",
  },
];

function FloatingOrb({ className, delay = 0 }: { className: string; delay?: number }) {
  return (
    <motion.div
      animate={{
        y: [0, -30, 0],
        x: [0, 15, 0],
        scale: [1, 1.1, 1],
      }}
      transition={{
        duration: 8 + delay * 2,
        repeat: Infinity,
        ease: "easeInOut",
        delay,
      }}
      className={className}
    />
  );
}

export default function LandingPage() {
  const heroRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll();
  const heroOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.15], [1, 0.95]);

  return (
    <div className="relative min-h-screen overflow-x-hidden">
      {/* Fixed background */}
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-purple-950/30 to-slate-950 animated-gradient -z-20" />
      <div className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
        <FloatingOrb
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"
          delay={0}
        />
        <FloatingOrb
          className="absolute bottom-1/3 right-1/4 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl"
          delay={2}
        />
        <FloatingOrb
          className="absolute top-2/3 left-1/2 w-64 h-64 bg-indigo-500/8 rounded-full blur-3xl"
          delay={4}
        />
        <FloatingOrb
          className="absolute top-10 right-10 w-48 h-48 bg-pink-500/8 rounded-full blur-3xl"
          delay={1}
        />
      </div>

      {/* Synthwave grid (faint) */}
      <div
        className="fixed inset-0 -z-10 opacity-[0.03] pointer-events-none"
        style={{
          backgroundImage: `
            linear-gradient(rgba(255,0,255,0.5) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,0,255,0.5) 1px, transparent 1px)
          `,
          backgroundSize: "60px 60px",
        }}
      />

      {/* ─── HERO SECTION ─── */}
      <motion.section
        ref={heroRef}
        style={{ opacity: heroOpacity, scale: heroScale }}
        className="relative min-h-screen flex flex-col items-center justify-center text-center px-4"
      >
        {/* Live arena iframe background */}
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <iframe
            src="/preview"
            title="Live Arena"
            className="absolute inset-0 w-full h-full border-0 scale-110"
            style={{ opacity: 0.35, filter: "saturate(1.4)" }}
            tabIndex={-1}
            loading="lazy"
          />
          {/* Dark gradient overlay to keep text readable */}
          <div
            className="absolute inset-0"
            style={{
              background: "radial-gradient(ellipse at center, rgba(5,0,20,0.15) 0%, rgba(5,0,20,0.5) 70%, rgba(5,0,20,0.8) 100%)",
            }}
          />
        </div>

        {/* Glowing ring behind title */}
        <div className="absolute w-[500px] h-[500px] rounded-full opacity-20 pointer-events-none"
          style={{
            background: "radial-gradient(circle, rgba(167,139,250,0.3) 0%, transparent 70%)",
          }}
        />

        <motion.div
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.8, ease: "easeOut" }}
        >
          {/* Badge */}
          <motion.div
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.3 }}
            className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full mb-6"
            style={{
              background: "rgba(167,139,250,0.1)",
              border: "1px solid rgba(167,139,250,0.25)",
            }}
          >
            <Flame className="w-3.5 h-3.5 text-purple-400" />
            <span className="text-xs font-medium text-purple-300 tracking-wide">LIVE ON SOLANA</span>
          </motion.div>

          {/* Title */}
          <h1
            className="text-5xl sm:text-7xl md:text-8xl font-black tracking-wider mb-4"
            style={{
              background: "linear-gradient(90deg, #ff00ff, #00ffff, #ff00ff)",
              backgroundSize: "200% auto",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              animation: "shimmer 4s linear infinite",
              filter: "drop-shadow(0 0 40px rgba(255,0,255,0.3))",
            }}
          >
            $WARZ
          </h1>

          <p className="text-lg sm:text-xl text-white max-w-xl mx-auto mb-2 font-medium" style={{ textShadow: "0 2px 12px rgba(0,0,0,0.8)" }}>
            Token Holder Battle Royale
          </p>
          <p className="text-sm sm:text-base text-slate-200 max-w-lg mx-auto mb-8" style={{ textShadow: "0 2px 12px rgba(0,0,0,0.8)" }}>
            Hold the token. Become a bubble. Auto-battle other holders in real-time.
            Level up, spec into talent trees, and dominate the arena.
          </p>

          {/* CTA Buttons */}
          <div className="flex items-center justify-center gap-3 mb-4">
            <Link
              href="/arena"
              className="group relative inline-flex items-center gap-2 px-8 py-3.5 rounded-xl font-bold text-sm tracking-widest uppercase transition-all duration-300 hover:scale-[1.03] active:scale-[0.98]"
              style={{
                background: "linear-gradient(135deg, rgba(255,0,255,0.25), rgba(0,255,255,0.25))",
                border: "1px solid rgba(255,0,255,0.4)",
                color: "#fff",
                boxShadow: "0 0 30px rgba(255,0,255,0.15), inset 0 1px 0 rgba(255,255,255,0.1)",
              }}
            >
              <Swords className="w-4 h-4" />
              Enter the Arena
              <div className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity" style={{
                background: "linear-gradient(135deg, rgba(255,0,255,0.1), rgba(0,255,255,0.1))",
              }} />
            </Link>
          </div>

          <p className="text-[11px] text-slate-300" style={{ textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}>
            Connect your wallet or try as a guest
          </p>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          animate={{ y: [0, 8, 0] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
        >
          <ChevronDown className="w-6 h-6 text-slate-500" />
        </motion.div>
      </motion.section>

      {/* ─── MINI GAME DEMO ─── */}
      <section className="relative py-16 sm:py-24 px-4">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="text-center mb-10"
          >
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-3 tracking-wide">
              Try It Out
            </h2>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Pick your abilities and fight dummy enemies. No wallet needed — just a taste of the action.
            </p>
            <div className="h-[2px] w-24 mx-auto mt-4" style={{
              background: "linear-gradient(90deg, transparent, #ff00ff, #00ffff, transparent)",
            }} />
          </motion.div>

          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-50px" }}
            transition={{ duration: 0.6, delay: 0.2 }}
          >
            <MiniGame />
          </motion.div>

          <motion.p
            initial={{ opacity: 0 }}
            whileInView={{ opacity: 1 }}
            viewport={{ once: true }}
            transition={{ delay: 0.5 }}
            className="text-center text-xs text-slate-500 mt-6"
          >
            The real game has 35+ talents, leveling, seasonal leaderboards, and on-chain verification.
          </motion.p>
        </div>
      </section>

      {/* ─── HOW IT WORKS ─── */}
      <section className="relative py-24 sm:py-32 px-4">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="text-center mb-16"
          >
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-3 tracking-wide">
              How It Works
            </h2>
            <div className="h-[2px] w-24 mx-auto" style={{
              background: "linear-gradient(90deg, transparent, #ff00ff, #00ffff, transparent)",
            }} />
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {RULES.map((rule, i) => (
              <motion.div
                key={rule.title}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-50px" }}
                transition={{ delay: i * 0.08, duration: 0.5 }}
                className="group relative rounded-2xl p-5 transition-all duration-300 hover:translate-y-[-2px]"
                style={{
                  background: "rgba(15, 23, 42, 0.6)",
                  border: "1px solid rgba(148, 163, 184, 0.1)",
                  backdropFilter: "blur(12px)",
                }}
              >
                <div
                  className="absolute inset-0 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity duration-300"
                  style={{
                    background: `radial-gradient(circle at top left, ${rule.color}08, transparent 60%)`,
                  }}
                />
                <div className="relative">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center mb-3"
                    style={{
                      background: `${rule.color}12`,
                      border: `1px solid ${rule.color}25`,
                      color: rule.color,
                    }}
                  >
                    {rule.icon}
                  </div>
                  <h3 className="text-sm font-bold text-white mb-1.5">{rule.title}</h3>
                  <p className="text-xs text-slate-400 leading-relaxed">{rule.desc}</p>
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── TALENT TREES SHOWCASE ─── */}
      <section className="relative py-24 sm:py-32 px-4">
        <div className="max-w-4xl mx-auto">
          <motion.div
            initial={{ opacity: 0, y: 30 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true, margin: "-100px" }}
            transition={{ duration: 0.6 }}
            className="text-center mb-14"
          >
            <h2 className="text-3xl sm:text-4xl font-black text-white mb-3 tracking-wide">
              7 Talent Trees
            </h2>
            <p className="text-sm text-slate-400 max-w-md mx-auto">
              Every level earns you talent points. Build a tanky bruiser, glass-cannon sniper,
              or devious decoy master — your call.
            </p>
            <div className="h-[2px] w-24 mx-auto mt-4" style={{
              background: "linear-gradient(90deg, transparent, #ff00ff, #00ffff, transparent)",
            }} />
          </motion.div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {TALENT_TREES.map((tree, i) => (
              <motion.div
                key={tree.name}
                initial={{ opacity: 0, scale: 0.9 }}
                whileInView={{ opacity: 1, scale: 1 }}
                viewport={{ once: true, margin: "-30px" }}
                transition={{ delay: i * 0.06, duration: 0.4 }}
                className="rounded-xl p-4 text-center transition-all duration-300 hover:translate-y-[-2px] group"
                style={{
                  background: "rgba(15, 23, 42, 0.5)",
                  border: `1px solid ${tree.color}20`,
                  backdropFilter: "blur(8px)",
                }}
              >
                <div
                  className="absolute inset-0 rounded-xl opacity-0 group-hover:opacity-100 transition-opacity"
                  style={{ background: `radial-gradient(circle at center, ${tree.color}08, transparent 70%)` }}
                />
                <span className="text-2xl mb-2 block">{tree.icon}</span>
                <h4 className="text-sm font-bold text-white mb-1">{tree.name}</h4>
                <p className="text-[10px] text-slate-500 leading-tight">{tree.desc}</p>
              </motion.div>
            ))}
            {/* +2 capstone slot */}
            <motion.div
              initial={{ opacity: 0, scale: 0.9 }}
              whileInView={{ opacity: 1, scale: 1 }}
              viewport={{ once: true, margin: "-30px" }}
              transition={{ delay: 0.5, duration: 0.4 }}
              className="rounded-xl p-4 text-center flex flex-col items-center justify-center"
              style={{
                background: "rgba(15, 23, 42, 0.3)",
                border: "1px dashed rgba(148, 163, 184, 0.15)",
              }}
            >
              <span className="text-2xl mb-1">⭐</span>
              <h4 className="text-xs font-bold text-slate-400">2 Ultimates</h4>
              <p className="text-[10px] text-slate-600 leading-tight">Choose any 2 capstone abilities</p>
            </motion.div>
          </div>
        </div>
      </section>

      {/* ─── FINAL CTA ─── */}
      <section className="relative py-24 sm:py-32 px-4">
        <motion.div
          initial={{ opacity: 0, y: 30 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-100px" }}
          transition={{ duration: 0.6 }}
          className="max-w-2xl mx-auto text-center"
        >
          <h2
            className="text-4xl sm:text-5xl font-black tracking-wider mb-4"
            style={{
              background: "linear-gradient(90deg, #ff00ff, #00ffff, #ff00ff)",
              backgroundSize: "200% auto",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
              backgroundClip: "text",
              animation: "shimmer 4s linear infinite",
            }}
          >
            Ready to Fight?
          </h2>
          <p className="text-sm text-slate-400 mb-8 max-w-md mx-auto">
            The arena is live. Connect your wallet, hold the token, and join
            the battle royale. Your bubble is waiting.
          </p>

          <Link
            href="/arena"
            className="group relative inline-flex items-center gap-2.5 px-10 py-4 rounded-xl font-bold text-base tracking-widest uppercase transition-all duration-300 hover:scale-[1.03] active:scale-[0.98]"
            style={{
              background: "linear-gradient(135deg, rgba(255,0,255,0.3), rgba(0,255,255,0.3))",
              border: "1px solid rgba(255,0,255,0.5)",
              color: "#fff",
              boxShadow: "0 0 40px rgba(255,0,255,0.2), 0 0 80px rgba(255,0,255,0.1), inset 0 1px 0 rgba(255,255,255,0.1)",
            }}
          >
            <Swords className="w-5 h-5" />
            Enter the Arena
          </Link>

          <div className="flex items-center justify-center gap-6 mt-8 text-[11px] text-slate-300" style={{ textShadow: "0 1px 8px rgba(0,0,0,0.8)" }}>
            <span className="flex items-center gap-1.5">
              <Users className="w-3.5 h-3.5" /> Real-time multiplayer
            </span>
            <span className="flex items-center gap-1.5">
              <Shield className="w-3.5 h-3.5" /> On-chain verified
            </span>
            <span className="flex items-center gap-1.5">
              <Crosshair className="w-3.5 h-3.5" /> Auto-battle
            </span>
          </div>
        </motion.div>
      </section>

      {/* Footer */}
      <footer className="relative py-8 px-4 border-t border-slate-800/50">
        <div className="max-w-4xl mx-auto flex items-center justify-between text-[11px] text-slate-300">
          <span
            className="font-bold tracking-wider"
            style={{
              background: "linear-gradient(90deg, #a78bfa, #60a5fa)",
              WebkitBackgroundClip: "text",
              WebkitTextFillColor: "transparent",
            }}
          >
            $WARZ
          </span>
          <span>Token Holder Battle Royale on Solana</span>
        </div>
      </footer>
    </div>
  );
}
