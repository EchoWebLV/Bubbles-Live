"use client";

import { useState, useCallback } from "react";
import { X, Loader2, Send } from "lucide-react";
import type { GovernanceStatus } from "@/hooks/useGovernance";

interface CreateProposalModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (name: string, metadata: { type: string; key: string; value: number; description?: string }) => Promise<boolean>;
  configurableKeys: Record<string, string[]>;
  submitting: boolean;
}

const TYPE_LABELS: Record<string, string> = {
  battle_config: "Battle Config",
  physics_config: "Physics Config",
  progression: "Progression",
};

const KEY_DESCRIPTIONS: Record<string, string> = {
  maxHealth: "Base HP for all bubbles",
  bulletDamage: "Base damage per bullet",
  fireRate: "Milliseconds between shots (lower = faster)",
  bulletSpeed: "Bullet travel speed",
  ghostBaseMs: "Base ghost duration in ms (respawn timer)",
  ghostPerLevelMs: "Extra ghost ms per level",
  minSpeed: "Minimum bubble movement speed",
  maxSpeed: "Maximum bubble movement speed",
  velocityDecay: "Movement friction (0.99 = low friction)",
  wallBounce: "Bounce strength off walls",
  repulsionRange: "Distance at which bubbles push apart",
  repulsionStrength: "How hard bubbles push apart",
  nudgeInterval: "Ms between random direction changes",
  nudgeStrength: "Strength of random direction nudges",
  xpPerKillBase: "Base XP earned per kill",
  xpPerKillPerLevel: "Bonus XP per victim level",
  xpPerDeath: "XP earned when dying",
  healthPerLevel: "HP gained per level",
  damagePerLevel: "Damage gained per level",
  baseHealth: "Starting HP at level 1",
  baseDamage: "Starting damage at level 1",
};

export function CreateProposalModal({ isOpen, onClose, onSubmit, configurableKeys, submitting }: CreateProposalModalProps) {
  const [configType, setConfigType] = useState("battle_config");
  const [configKey, setConfigKey] = useState("");
  const [configValue, setConfigValue] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState("");

  const availableKeys = configurableKeys[configType] || [];

  const handleSubmit = useCallback(async () => {
    setError("");

    if (!configKey) {
      setError("Select a parameter to change");
      return;
    }

    const numValue = parseFloat(configValue);
    if (isNaN(numValue)) {
      setError("Value must be a number");
      return;
    }

    const proposalName = `Change ${configKey} to ${numValue}`;
    const success = await onSubmit(proposalName, {
      type: configType,
      key: configKey,
      value: numValue,
      description: description || undefined,
    });

    if (success) {
      setConfigKey("");
      setConfigValue("");
      setDescription("");
      onClose();
    } else {
      setError("Failed to create proposal. Make sure you have deposited tokens.");
    }
  }, [configType, configKey, configValue, description, onSubmit, onClose]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" />

      <div
        className="relative w-full max-w-lg bg-slate-950 rounded-2xl border border-purple-500/30 overflow-hidden"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Create Proposal</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-4">
          {/* Config Type */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Config Category</label>
            <div className="flex gap-2">
              {Object.entries(TYPE_LABELS).map(([key, label]) => (
                <button
                  key={key}
                  onClick={() => { setConfigType(key); setConfigKey(""); }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors ${
                    configType === key
                      ? "bg-purple-500/20 border-purple-500/40 text-purple-300"
                      : "bg-slate-800/50 border-slate-700/30 text-slate-400 hover:border-slate-600/50"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          {/* Config Key */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Parameter</label>
            <select
              value={configKey}
              onChange={e => setConfigKey(e.target.value)}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white focus:outline-none focus:border-purple-500/50"
            >
              <option value="">Select parameter...</option>
              {availableKeys.map(key => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
            {configKey && KEY_DESCRIPTIONS[configKey] && (
              <p className="mt-1 text-[11px] text-slate-500">{KEY_DESCRIPTIONS[configKey]}</p>
            )}
          </div>

          {/* Config Value */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">New Value</label>
            <input
              type="number"
              step="any"
              value={configValue}
              onChange={e => setConfigValue(e.target.value)}
              placeholder="Enter new value..."
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-xs font-medium text-slate-400 mb-1.5">Reason (optional)</label>
            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="Why should the community approve this change?"
              rows={3}
              className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-600 focus:outline-none focus:border-purple-500/50 resize-none"
            />
          </div>

          {error && (
            <div className="text-xs text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
              {error}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-end gap-3">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded-lg text-sm text-slate-400 hover:text-white transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting || !configKey || !configValue}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium bg-purple-600 hover:bg-purple-500 text-white transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
            Submit Proposal
          </button>
        </div>
      </div>
    </div>
  );
}
