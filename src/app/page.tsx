"use client";

import { motion } from "framer-motion";
import { BubbleMapClient } from "@/components/bubble-map/BubbleMapClient";

export default function Home() {
  return (
    <main className="relative min-h-screen overflow-hidden">
      {/* Animated background */}
      <div className="fixed inset-0 bg-gradient-to-br from-slate-950 via-purple-950/30 to-slate-950 animated-gradient" />
      
      {/* Floating orbs background */}
      <div className="fixed inset-0 overflow-hidden pointer-events-none">
        <motion.div
          animate={{
            x: [0, 100, 0],
            y: [0, -50, 0],
          }}
          transition={{
            duration: 20,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500/10 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, -80, 0],
            y: [0, 60, 0],
          }}
          transition={{
            duration: 25,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute bottom-1/4 right-1/4 w-80 h-80 bg-blue-500/10 rounded-full blur-3xl"
        />
        <motion.div
          animate={{
            x: [0, 50, 0],
            y: [0, 80, 0],
          }}
          transition={{
            duration: 30,
            repeat: Infinity,
            ease: "easeInOut",
          }}
          className="absolute top-1/2 right-1/3 w-64 h-64 bg-indigo-500/10 rounded-full blur-3xl"
        />
      </div>

      {/* Content - Synchronized Battle Map */}
      <div className="relative z-10 h-screen">
        <BubbleMapClient />
      </div>
    </main>
  );
}
