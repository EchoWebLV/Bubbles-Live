"use client";

import { motion } from "framer-motion";
import { ExternalLink, Copy, Check, Wallet, TrendingUp, Percent, Swords, Star } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Holder, TokenInfo } from "./types";
import type { BattleBubble } from "./battle";
import { shortenAddress, formatNumber, formatPercentage } from "@/lib/utils";

const TALENT_TREES = {
  tank: {
    name: 'Tank',
    color: 'green',
    icon: '\u{1F6E1}\u{FE0F}',
    talents: [
      { id: 'armor', name: 'Armor', desc: '-4/8/12/16/24% incoming dmg', maxRank: 5 },
      { id: 'ironSkin', name: 'Iron Skin', desc: '+10/15/20/25/30% max HP', maxRank: 5 },
      { id: 'regeneration', name: 'Regeneration', desc: '+0.3/0.6/0.9/1.2/1.5 HP/sec', maxRank: 5 },
      { id: 'lifesteal', name: 'Lifesteal', desc: 'Heal 5/10/15/20/25% of dmg dealt', maxRank: 5 },
      { id: 'vitalityStrike', name: 'Vitality Strike', desc: '+0.2/0.35/0.5% max HP as bullet dmg', maxRank: 3 },
    ],
  },
  firepower: {
    name: 'Firepower',
    color: 'red',
    icon: '\u{1F3AF}',
    talents: [
      { id: 'heavyHitter', name: 'Heavy Hitter', desc: '+4/8/12/16/24% bullet dmg', maxRank: 5 },
      { id: 'rapidFire', name: 'Rapid Fire', desc: '-6/12/18/24/30% fire cooldown', maxRank: 5 },
      { id: 'criticalStrike', name: 'Critical Strike', desc: '7/14/21/28/35% crit (2/2.2/2.6/2.8/3x dmg)', maxRank: 5 },
      { id: 'multiShot', name: 'Multi Shot', desc: '12/24/36/48/60% chance 2nd bullet (75% dmg)', maxRank: 5 },
      { id: 'dualCannon', name: 'Homing Cannon', desc: 'Every 16/13/10th shot: homing bullet targeting lowest HP enemy, 150% dmg', maxRank: 3 },
    ],
  },
  brawler: {
    name: 'Brawler',
    color: 'blue',
    icon: '\u{1F4A8}',
    talents: [
      { id: 'dash', name: 'Dash', desc: 'Burst dash every 12/10/8/6/4s', maxRank: 5 },
      { id: 'bodySlam', name: 'Body Slam', desc: 'Contact deals 1.5/2.5/3.5/4.5/5.5% max HP dmg (1.5s cd)', maxRank: 5 },
      { id: 'relentless', name: 'Relentless', desc: 'Body Slam hit reduces Dash CD by 0.5/1/1.5/2/2.5s', maxRank: 5 },
      { id: 'orbit', name: 'Orbit', desc: '2 orbs circle you, dealing 0.5/0.75/1/1.25/1.5% max HP on contact', maxRank: 5 },
      { id: 'shockwave', name: 'Shockwave', desc: 'Body hit AoE 3/5/7% max HP', maxRank: 3 },
    ],
  },
  massDamage: {
    name: 'Mass Damage',
    color: 'yellow',
    icon: '\u{1F4A5}',
    talents: [
      { id: 'ricochet', name: 'Ricochet', desc: '11/19/26/34/49% chance to bounce', maxRank: 5 },
      { id: 'counterAttack', name: 'Counter Attack', desc: '8/16/24/32/40% chance to fire back', maxRank: 5 },
      { id: 'focusFire', name: 'Focus Fire', desc: '+3/6/9/12/15% dmg per hit on same target, max 3 stacks', maxRank: 5 },
      { id: 'nova', name: 'Nova', desc: 'Spiral 5/8/11/14/18 bullets every 1s', maxRank: 5 },
      { id: 'chainLightning', name: 'Chain Lightning', desc: '5/10/15% chance: lightning to 2/3/4 enemies (400% dmg, -50% per jump)', maxRank: 3 },
    ],
  },
  bloodThirst: {
    name: 'Blood Thirst',
    color: 'purple',
    icon: '\u{1FA78}',
    talents: [
      { id: 'experience', name: 'Experience', desc: '+10/17/24/32/40% XP gained', maxRank: 5 },
      { id: 'execute', name: 'Execute', desc: '+8/16/24/32/48% dmg vs \u226450% HP', maxRank: 5 },
      { id: 'killRush', name: 'Kill Rush', desc: 'On kill: +20/40/60/80/100% fire rate for 4s', maxRank: 5 },
      { id: 'reaperArc', name: "Reaper's Arc", desc: 'Every 15th hit: 360° sweep. 0.75/1.5/2.25/3/3.75% max HP dmg, costs 0.4/0.75/1.2/1.5/2% HP', maxRank: 5 },
      { id: 'berserker', name: 'Berserker', desc: 'Below 33% HP: +25/40/55% atk speed & dmg. +1.5/2.5/3.5 HP/s regen', maxRank: 3 },
    ],
  },
} as const;

interface HolderModalProps {
  holder: Holder | null;
  token: TokenInfo | null;
  battleBubble?: BattleBubble | null;
  onClose: () => void;
}

export function HolderModal({ holder, token, battleBubble, onClose }: HolderModalProps) {
  const [copied, setCopied] = useState(false);
  const [tab, setTab] = useState<'stats' | 'talents'>('stats');

  if (!holder) return null;

  const handleCopyAddress = async () => {
    await navigator.clipboard.writeText(holder.address);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const solscanUrl = `https://solscan.io/account/${holder.address}`;
  const solanaFmUrl = `https://solana.fm/address/${holder.address}`;

  const talents = battleBubble?.talents || {};
  const totalSpent = Object.values(talents).reduce((s, v) => s + (v || 0), 0);

  const treeColorMap: Record<string, { bg: string; border: string; text: string; rankBg: string; rankFill: string }> = {
    green:  { bg: 'bg-green-900/20',  border: 'border-green-500/30',  text: 'text-green-400',  rankBg: 'bg-green-900/30',  rankFill: 'bg-green-500' },
    blue:   { bg: 'bg-blue-900/20',   border: 'border-blue-500/30',   text: 'text-blue-400',   rankBg: 'bg-blue-900/30',   rankFill: 'bg-blue-500' },
    red:    { bg: 'bg-red-900/20',    border: 'border-red-500/30',    text: 'text-red-400',    rankBg: 'bg-red-900/30',    rankFill: 'bg-red-500' },
    yellow: { bg: 'bg-yellow-900/20', border: 'border-yellow-500/30', text: 'text-yellow-400', rankBg: 'bg-yellow-900/30', rankFill: 'bg-yellow-500' },
    purple: { bg: 'bg-purple-900/20', border: 'border-purple-500/30', text: 'text-purple-400', rankBg: 'bg-purple-900/30', rankFill: 'bg-purple-500' },
  };

  return (
    <Dialog open={!!holder} onOpenChange={() => { setTab('stats'); onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-3">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              className="w-12 h-12 rounded-full flex items-center justify-center"
              style={{ backgroundColor: holder.color }}
            >
              <Wallet className="w-6 h-6 text-white" />
            </motion.div>
            <div>
              <div className="font-mono text-lg">{shortenAddress(holder.address, 6)}</div>
              <DialogDescription className="text-sm">
                {token ? `${token.symbol} Holder` : "Token Holder"}
                {battleBubble && (
                  <span className="ml-2 text-purple-400 font-bold">Lv.{battleBubble.level ?? 1}</span>
                )}
              </DialogDescription>
            </div>
          </DialogTitle>
        </DialogHeader>

        {/* Tabs */}
        <div className="flex gap-1 mt-2 bg-slate-800/50 rounded-lg p-1">
          <button
            onClick={() => setTab('stats')}
            className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors ${
              tab === 'stats'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Stats
          </button>
          <button
            onClick={() => setTab('talents')}
            className={`flex-1 text-xs font-medium py-1.5 rounded-md transition-colors flex items-center justify-center gap-1.5 ${
              tab === 'talents'
                ? 'bg-slate-700 text-white'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            Talents
            {totalSpent > 0 && (
              <span className="text-[9px] bg-amber-500/20 text-amber-400 px-1.5 py-0.5 rounded-full font-bold">
                {totalSpent}
              </span>
            )}
          </button>
        </div>

        {/* Stats Tab */}
        {tab === 'stats' && (
          <div className="mt-3 space-y-4">
            {/* Battle Stats */}
            {battleBubble && (
              <div className="grid grid-cols-4 gap-2">
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.05 }}
                  className="bg-slate-800/50 rounded-lg p-2.5 border border-slate-700 text-center"
                >
                  <div className="text-[10px] text-slate-400">Level</div>
                  <div className="text-lg font-bold text-purple-400">{battleBubble.level ?? 1}</div>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="bg-slate-800/50 rounded-lg p-2.5 border border-slate-700 text-center"
                >
                  <div className="text-[10px] text-slate-400">Kills</div>
                  <div className="text-lg font-bold text-green-400">{battleBubble.kills}</div>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.15 }}
                  className="bg-slate-800/50 rounded-lg p-2.5 border border-slate-700 text-center"
                >
                  <div className="text-[10px] text-slate-400">Deaths</div>
                  <div className="text-lg font-bold text-red-400">{battleBubble.deaths}</div>
                </motion.div>
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.2 }}
                  className="bg-slate-800/50 rounded-lg p-2.5 border border-slate-700 text-center"
                >
                  <div className="text-[10px] text-slate-400">K/D</div>
                  <div className="text-lg font-bold text-amber-400">
                    {battleBubble.deaths > 0 ? (battleBubble.kills / battleBubble.deaths).toFixed(1) : battleBubble.kills.toFixed(0)}
                  </div>
                </motion.div>
              </div>
            )}

            {/* Holder Stats */}
            <div className="grid grid-cols-2 gap-3">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.1 }}
                className="bg-slate-800/50 rounded-xl p-3 border border-slate-700"
              >
                <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                  <Percent className="w-4 h-4" />
                  Ownership
                </div>
                <div className="text-xl font-bold text-white">
                  {formatPercentage(holder.percentage)}
                </div>
              </motion.div>

              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.15 }}
                className="bg-slate-800/50 rounded-xl p-3 border border-slate-700"
              >
                <div className="flex items-center gap-2 text-slate-400 text-sm mb-1">
                  <TrendingUp className="w-4 h-4" />
                  Balance
                </div>
                <div className="text-xl font-bold text-white">
                  {formatNumber(holder.balance / Math.pow(10, token?.decimals || 9))}
                </div>
                {token && (
                  <div className="text-xs text-slate-500 mt-0.5">{token.symbol}</div>
                )}
              </motion.div>
            </div>

            {/* Holder Category */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.2 }}
              className="bg-gradient-to-r from-purple-500/10 to-blue-500/10 rounded-xl p-3 border border-purple-500/20"
            >
              <div className="text-sm text-slate-400 mb-1">Holder Category</div>
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: holder.color }}
                />
                <span className="font-medium text-white">
                  {getHolderCategory(holder.percentage)}
                </span>
              </div>
            </motion.div>

            {/* Full Address */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.25 }}
              className="bg-slate-800/50 rounded-xl p-3 border border-slate-700"
            >
              <div className="text-sm text-slate-400 mb-2">Wallet Address</div>
              <div className="flex items-center gap-2">
                <code className="text-xs text-slate-300 bg-slate-900 px-2 py-1 rounded flex-1 overflow-hidden text-ellipsis">
                  {holder.address}
                </code>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-8 w-8 shrink-0"
                  onClick={handleCopyAddress}
                >
                  {copied ? (
                    <Check className="h-4 w-4 text-green-500" />
                  ) : (
                    <Copy className="h-4 w-4" />
                  )}
                </Button>
              </div>
            </motion.div>

            {/* External Links */}
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.3 }}
              className="flex gap-3"
            >
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.open(solscanUrl, "_blank")}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Solscan
              </Button>
              <Button
                variant="outline"
                className="flex-1"
                onClick={() => window.open(solanaFmUrl, "_blank")}
              >
                <ExternalLink className="w-4 h-4 mr-2" />
                Solana FM
              </Button>
            </motion.div>
          </div>
        )}

        {/* Talents Tab */}
        {tab === 'talents' && (
          <div className="mt-3 max-h-[55vh] overflow-y-auto space-y-2 pr-1">
            {totalSpent === 0 && (
              <div className="text-center text-xs text-slate-500 py-4">
                No talents allocated yet
              </div>
            )}

            {Object.entries(TALENT_TREES).map(([treeKey, tree]) => {
              const colors = treeColorMap[tree.color];
              const treePoints = tree.talents.reduce((s, t) => s + (talents[t.id] || 0), 0);
              const hasPoints = treePoints > 0;

              return (
                <div
                  key={treeKey}
                  className={`rounded-xl border ${colors.border} ${colors.bg} p-2.5 ${!hasPoints && totalSpent > 0 ? 'opacity-40' : ''}`}
                >
                  <div className={`text-xs font-bold ${colors.text} flex items-center justify-between`}>
                    <div className="flex items-center gap-2">
                      <span>{tree.icon}</span>
                      {tree.name}
                    </div>
                    {hasPoints && (
                      <span className="text-[9px] opacity-60">{treePoints} pts</span>
                    )}
                  </div>
                  <div className="mt-1.5 space-y-1">
                    {tree.talents.map(talent => {
                      const rank = talents[talent.id] || 0;
                      return (
                        <div key={talent.id} className="flex items-center justify-between gap-1">
                          <div className="flex items-center gap-1.5 min-w-0 flex-1">
                            <span className={`text-[10px] font-medium truncate ${rank > 0 ? 'text-white' : 'text-slate-500'}`}>
                              {talent.name}
                            </span>
                            {rank > 0 && (
                              <span className="text-[8px] text-slate-500 truncate hidden sm:inline">{talent.desc}</span>
                            )}
                          </div>
                          <div className="flex gap-0.5 shrink-0">
                            {Array.from({ length: talent.maxRank }).map((_, i) => (
                              <div
                                key={i}
                                className={`w-2 h-2 rounded-sm ${i < rank ? colors.rankFill : colors.rankBg}`}
                              />
                            ))}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}

            {totalSpent > 0 && (
              <div className="text-center text-[10px] text-slate-500 pt-1">
                {totalSpent} talent point{totalSpent !== 1 ? 's' : ''} allocated
                {battleBubble?.manualBuild && ' (manual build)'}
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function getHolderCategory(percentage: number): string {
  if (percentage >= 10) return "Mega Whale";
  if (percentage >= 5) return "Whale";
  if (percentage >= 1) return "Large Holder";
  if (percentage >= 0.1) return "Medium Holder";
  if (percentage >= 0.01) return "Small Holder";
  return "Micro Holder";
}
