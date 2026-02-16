"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Swords, Heart, Zap, TrendingUp, Diamond, Volume2 } from "lucide-react";

const STORAGE_KEY = "hodlwarz-welcome-seen";

interface WelcomeModalProps {
  forceOpen?: boolean;
  onClose?: () => void;
}

export function WelcomeModal({ forceOpen, onClose }: WelcomeModalProps) {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (forceOpen) {
      setIsOpen(true);
      return;
    }
    // Show on first visit only
    const seen = localStorage.getItem(STORAGE_KEY);
    if (!seen) {
      setIsOpen(true);
    }
  }, [forceOpen]);

  const handleClose = useCallback(() => {
    setIsOpen(false);
    localStorage.setItem(STORAGE_KEY, "true");
    onClose?.();
  }, [onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.3 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          onClick={handleClose}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/80 backdrop-blur-sm" />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.9, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 10 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-lg overflow-hidden rounded-2xl"
            style={{
              background: "linear-gradient(135deg, #0a0015 0%, #1a0030 30%, #0d001a 60%, #0a0020 100%)",
            }}
          >
            {/* Synthwave grid overlay */}
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

            {/* Top glow bar */}
            <div
              className="absolute top-0 left-0 right-0 h-[2px]"
              style={{
                background: "linear-gradient(90deg, transparent, #ff00ff, #00ffff, #ff00ff, transparent)",
              }}
            />

            {/* Side glow lines */}
            <div
              className="absolute top-0 left-0 bottom-0 w-[1px]"
              style={{
                background: "linear-gradient(180deg, transparent, rgba(255,0,255,0.4), transparent)",
              }}
            />
            <div
              className="absolute top-0 right-0 bottom-0 w-[1px]"
              style={{
                background: "linear-gradient(180deg, transparent, rgba(0,255,255,0.4), transparent)",
              }}
            />

            {/* Close button */}
            <button
              onClick={handleClose}
              className="absolute top-4 right-4 z-10 w-8 h-8 flex items-center justify-center rounded-full bg-white/5 hover:bg-white/10 border border-white/10 transition-colors"
            >
              <X className="w-4 h-4 text-slate-400" />
            </button>

            {/* Content */}
            <div className="relative z-10 px-8 py-8">
              {/* Title */}
              <div className="text-center mb-6">
                <motion.h1
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-3xl font-black tracking-wider mb-1"
                  style={{
                    background: "linear-gradient(90deg, #ff00ff, #00ffff, #ff00ff)",
                    backgroundSize: "200% auto",
                    WebkitBackgroundClip: "text",
                    WebkitTextFillColor: "transparent",
                    backgroundClip: "text",
                    animation: "shimmer 4s linear infinite",
                    textShadow: "0 0 40px rgba(255,0,255,0.5)",
                  }}
                >
                  HODLWARZ
                </motion.h1>
                <motion.p
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: 0.2 }}
                  className="text-sm text-slate-400 tracking-widest uppercase"
                >
                  Token Holder Battle Royale on Solana
                </motion.p>
              </div>

              {/* Divider */}
              <div
                className="h-[1px] mb-6"
                style={{
                  background: "linear-gradient(90deg, transparent, rgba(255,0,255,0.4), rgba(0,255,255,0.4), transparent)",
                }}
              />

              {/* Rules */}
              <div className="space-y-3">
                <RuleItem
                  icon={<Swords className="w-4 h-4" />}
                  color="#ff00ff"
                  title="Auto-Battle"
                  description="Every token holder is a bubble. Bubbles automatically shoot at the nearest enemy."
                  delay={0.25}
                />
                <RuleItem
                  icon={<Heart className="w-4 h-4" />}
                  color="#ff3366"
                  title="Health & Death"
                  description="When HP hits 0, bubbles become ghosts for 60 seconds, then respawn."
                  delay={0.3}
                />
                <RuleItem
                  icon={<TrendingUp className="w-4 h-4" />}
                  color="#00ffaa"
                  title="Level Up"
                  description="Earn XP from kills, transactions, and holding the token. Higher level = more HP & damage."
                  delay={0.35}
                />
                <RuleItem
                  icon={<Diamond className="w-4 h-4" />}
                  color="#00ccff"
                  title="Diamond Hands"
                  description="Hold the token for consecutive days to earn bonus XP and grow stronger."
                  delay={0.4}
                />
                <RuleItem
                  icon={<Zap className="w-4 h-4" />}
                  color="#ffcc00"
                  title="Live & Real"
                  description="All data is real. Bubbles appear/disappear as wallets buy and sell on-chain."
                  delay={0.45}
                />
              </div>

              {/* Divider */}
              <div
                className="h-[1px] mt-6 mb-5"
                style={{
                  background: "linear-gradient(90deg, transparent, rgba(0,255,255,0.3), rgba(255,0,255,0.3), transparent)",
                }}
              />

              {/* Enter button */}
              <motion.button
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.5 }}
                onClick={handleClose}
                className="w-full py-3 rounded-xl font-bold text-sm tracking-widest uppercase transition-all duration-300 hover:scale-[1.02] active:scale-[0.98]"
                style={{
                  background: "linear-gradient(90deg, rgba(255,0,255,0.2), rgba(0,255,255,0.2))",
                  border: "1px solid rgba(255,0,255,0.3)",
                  color: "#fff",
                  boxShadow: "0 0 20px rgba(255,0,255,0.15), inset 0 1px 0 rgba(255,255,255,0.1)",
                }}
              >
                Enter the Arena
              </motion.button>

              <motion.p
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.6 }}
                className="text-center text-[10px] text-slate-500 mt-3 flex items-center justify-center gap-1"
              >
                <Volume2 className="w-3 h-3" />
                Tip: Enable music for the full experience
              </motion.p>
            </div>

            {/* Bottom glow bar */}
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

// ─── Rule item component ────────────────────────────────────────

function RuleItem({
  icon,
  color,
  title,
  description,
  delay,
}: {
  icon: React.ReactNode;
  color: string;
  title: string;
  description: string;
  delay: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, x: -10 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ delay }}
      className="flex items-start gap-3 group"
    >
      <div
        className="flex-shrink-0 w-8 h-8 rounded-lg flex items-center justify-center mt-0.5"
        style={{
          background: `${color}15`,
          border: `1px solid ${color}30`,
          color: color,
          boxShadow: `0 0 12px ${color}15`,
        }}
      >
        {icon}
      </div>
      <div>
        <div className="text-sm font-semibold text-white">{title}</div>
        <div className="text-xs text-slate-400 leading-relaxed">{description}</div>
      </div>
    </motion.div>
  );
}
