"use client";

import { useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Swords, Zap, TrendingDown, Target, Repeat, Rocket, Ghost, Copy, Bomb, Flame, Crosshair } from "lucide-react";

const STORAGE_KEY_DISMISSED_SEASON = "hodlwarz-changelog-dismissed-season";
const STORAGE_KEY_EVER_SEEN = "hodlwarz-changelog-ever-seen";

interface ChangelogModalProps {
  seasonId: number;
  isOpen: boolean;
  onClose: () => void;
}

const CHANGELOG_ITEMS = [
  { icon: Copy, color: "#22d3ee", title: "Echo Tree (was Sapper)", desc: "Full decoy-oriented rework — mines retired, the tree is now all about clones" },
  { icon: Ghost, color: "#a855f7", title: "Death Mirage (T2)", desc: "When you die, leave a fighting decoy behind + reduced respawn time" },
  { icon: Rocket, color: "#ff6600", title: "Decoy Barrage (T3)", desc: "Periodically launch a decoy toward the nearest enemy — it flies in and starts shooting" },
  { icon: Bomb, color: "#ff3366", title: "Volatile Decoy (T4)", desc: "All decoys now explode on death for up to 6% max HP AoE damage" },
  { icon: Target, color: "#cc44ff", title: "Singularity Rework (T5)", desc: "33% chance any decoy explosion becomes a black hole — pull, DoT, then detonate" },
  { icon: Flame, color: "#ff4400", title: "Infernal Lance", desc: "Nova replaced with Infernal Lance — piercing beam dealing 222-666% ATK, triggers all modifiers" },
  { icon: Repeat, color: "#00ffaa", title: "Ricochet Rebalance", desc: "Ricochet chance now scales evenly: 11/18/25/33/40% per rank" },
  { icon: TrendingDown, color: "#00ccff", title: "Damage Tuning", desc: "Volatile Decoy and Singularity damage spread evenly to 6% cap for healthier balance" },
];

export function ChangelogModal({ seasonId, isOpen, onClose }: ChangelogModalProps) {
  const handleClose = useCallback(() => {
    try {
      localStorage.setItem(STORAGE_KEY_EVER_SEEN, "1");
      localStorage.setItem(STORAGE_KEY_DISMISSED_SEASON, seasonId && seasonId > 0 ? String(seasonId) : "init");
    } catch {}
    onClose();
  }, [seasonId, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-[70] flex items-center justify-center p-4"
          onClick={handleClose}
        >
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg rounded-2xl max-h-[90vh] flex flex-col overflow-hidden"
            style={{
              background: "linear-gradient(135deg, #0a0015 0%, #1a0030 30%, #0d001a 60%, #0a0020 100%)",
            }}
          >
            <div
              className="absolute inset-0 opacity-10 pointer-events-none"
              style={{
                backgroundImage: `
                  linear-gradient(rgba(255,0,255,0.3) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(255,0,255,0.3) 1px, transparent 1px)
                `,
                backgroundSize: "40px 40px",
                maskImage: "linear-gradient(180deg, transparent 0%, black 30%, black 70%, transparent 100%)",
                WebkitMaskImage: "linear-gradient(180deg, transparent 0%, black 30%, black 70%, transparent 100%)",
              }}
            />

            <div
              className="absolute top-0 left-0 right-0 h-[2px]"
              style={{
                background: "linear-gradient(90deg, transparent, #ff00ff, #00ffff, #ff00ff, transparent)",
              }}
            />

            <button
              onClick={handleClose}
              className="absolute top-3 right-3 z-30 w-9 h-9 flex items-center justify-center rounded-full bg-black/60 hover:bg-white/10 border border-white/20 transition-colors"
            >
              <X className="w-5 h-5 text-white" />
            </button>

            <div className="relative z-10 px-5 py-6 sm:px-8 sm:py-8 overflow-y-auto">
              <div className="text-center mb-6">
                <motion.h1
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-2xl sm:text-3xl font-black tracking-wider mb-1"
                  style={{
                    background: "linear-gradient(90deg, #ff00ff, #00ffff, #ff00ff)",
                    backgroundSize: "200% auto",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                  }}
                >
                  Patch Notes
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-sm text-slate-400 tracking-widest uppercase"
                >
                  Phantom Decoy Patch
                </motion.p>
              </div>

              <div
                className="h-[1px] mb-6"
                style={{
                  background: "linear-gradient(90deg, transparent, rgba(255,0,255,0.4), rgba(0,255,255,0.4), transparent)",
                }}
              />

              <div className="space-y-4">
                {CHANGELOG_ITEMS.map((item, i) => (
                  <motion.div
                    key={item.title}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.1 + i * 0.05 }}
                    className="flex gap-3 p-3 rounded-xl bg-white/5 border border-white/10"
                  >
                    <div
                      className="flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center"
                      style={{ backgroundColor: `${item.color}20` }}
                    >
                      <item.icon className="w-5 h-5" style={{ color: item.color }} />
                    </div>
                    <div>
                      <div className="font-semibold text-white" style={{ color: item.color }}>{item.title}</div>
                      <div className="text-sm text-slate-400 mt-0.5">{item.desc}</div>
                    </div>
                  </motion.div>
                ))}
              </div>

              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                onClick={handleClose}
                className="w-full mt-6 py-3 rounded-xl font-bold text-sm tracking-widest uppercase transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "linear-gradient(90deg, rgba(255,0,255,0.2), rgba(0,255,255,0.2))",
                  border: "1px solid rgba(255,0,255,0.3)",
                  color: "#fff",
                  boxShadow: "0 0 20px rgba(255,0,255,0.15)",
                }}
              >
                Got it
              </motion.button>
            </div>

            <div
              className="absolute bottom-0 left-0 right-0 h-[2px]"
              style={{
                background: "linear-gradient(90deg, transparent, #00ffff, #ff00ff, #00ffff, transparent)",
              }}
            />
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Show changelog on first load (ever), then again only after season reset.
 * - First load: everSeen is false → show (even before seasonId from server).
 * - After close: everSeen = true, dismissedSeason = seasonId or "init".
 * - Next load same season: don't show.
 * - After season reset: new seasonId !== dismissedSeason → show again.
 */
export function shouldShowChangelog(seasonId: number | undefined): boolean {
  try {
    const everSeen = localStorage.getItem(STORAGE_KEY_EVER_SEEN);
    if (!everSeen) return true; // first load: always show (even without seasonId yet)
    const dismissed = localStorage.getItem(STORAGE_KEY_DISMISSED_SEASON);
    if (dismissed === "init" && seasonId && seasonId > 0) return false; // already showed first-load popup before seasonId arrived
    if (!seasonId) return false;
    return dismissed !== String(seasonId); // new season → show again
  } catch {
    return true;
  }
}
