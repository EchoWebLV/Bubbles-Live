"use client";

import { useState, useEffect, useCallback } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  createAssociatedTokenAccountIdempotentInstruction,
  getAccount,
  TOKEN_2022_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Button } from "@/components/ui/button";
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Wallet, ArrowLeft, Loader2, ExternalLink, Trophy, Gift, CheckCircle2, ChevronDown, ChevronUp } from "lucide-react";
import { useSeasonHistory, type SeasonRecord } from "@/hooks/useSeasonHistory";

const WARZ_MINT = new PublicKey(
  process.env.NEXT_PUBLIC_TOKEN_ADDRESS || "11111111111111111111111111111111"
);
const COMBAT_PROGRAM_ID = process.env.NEXT_PUBLIC_COMBAT_PROGRAM_ID || "7aeBk4C2MhuivHdBiNS44feYjwiPsg6Aiq9SEUP99TDi";
const TOKEN_DECIMALS = 9;

const FALLBACK_VAULT_TOKEN_ACCOUNT = process.env.NEXT_PUBLIC_REWARD_VAULT_TOKEN_ACCOUNT || "";
const FALLBACK_VAULT_OWNER = process.env.NEXT_PUBLIC_REWARD_VAULT_OWNER || "";

function formatTokens(raw: number): string {
  return (raw / 10 ** TOKEN_DECIMALS).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

function formatDate(unixSecs: number): string {
  if (!unixSecs) return "—";
  return new Date(unixSecs * 1000).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

const PLACE_EMOJI = ["🥇", "🥈", "🥉", "4th", "5th", "6th", "7th", "8th", "9th", "10th"];
const PLACE_COLORS = [
  "text-yellow-400", "text-slate-300", "text-amber-600",
  "text-slate-400", "text-slate-400",
  "text-slate-500", "text-slate-500", "text-slate-500", "text-slate-500", "text-slate-500",
];

function SeasonCard({ season, connectedWallet }: { season: SeasonRecord; connectedWallet: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const preview = season.entries.slice(0, 3);
  const rest = season.entries.slice(3);

  return (
    <div className="bg-slate-800/40 rounded-lg border border-slate-700/40 overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-3 flex items-center justify-between border-b border-slate-700/30 hover:bg-slate-800/60 transition-colors"
      >
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white">Season {season.seasonNumber}</span>
          <span className="text-xs text-slate-500">{formatDate(season.finalizedAt)}</span>
          <span className="text-xs text-slate-400">{season.entryCount} players</span>
        </div>
        {expanded ? (
          <ChevronUp className="w-4 h-4 text-slate-500" />
        ) : (
          <ChevronDown className="w-4 h-4 text-slate-500" />
        )}
      </button>

      {/* Always show top 3 */}
      <div className="divide-y divide-slate-700/20">
        {preview.map((entry, i) => {
          const isMe = connectedWallet && entry.wallet === connectedWallet;
          return (
            <div
              key={entry.wallet}
              className={`flex items-center gap-3 px-4 py-2 text-sm ${isMe ? "bg-purple-500/10" : ""}`}
            >
              <span className={`w-8 font-bold text-right ${PLACE_COLORS[i]}`}>
                {PLACE_EMOJI[i]}
              </span>
              <span className="font-mono text-slate-300 truncate flex-1">
                {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                {isMe && <span className="ml-1 text-purple-400 text-xs">(you)</span>}
              </span>
              <span className="text-xs text-slate-400 tabular-nums w-12 text-right">Lv.{entry.level}</span>
              <span className="text-xs text-yellow-400 tabular-nums w-16 text-right">{entry.kills} kills</span>
            </div>
          );
        })}

        {/* Expanded: show 4th–10th */}
        {expanded && rest.map((entry, i) => {
          const idx = i + 3;
          const isMe = connectedWallet && entry.wallet === connectedWallet;
          return (
            <div
              key={entry.wallet}
              className={`flex items-center gap-3 px-4 py-2 text-sm ${isMe ? "bg-purple-500/10" : ""}`}
            >
              <span className={`w-8 font-bold text-right ${PLACE_COLORS[idx] || "text-slate-500"}`}>
                {PLACE_EMOJI[idx]}
              </span>
              <span className="font-mono text-slate-300 truncate flex-1">
                {entry.wallet.slice(0, 6)}...{entry.wallet.slice(-4)}
                {isMe && <span className="ml-1 text-purple-400 text-xs">(you)</span>}
              </span>
              <span className="text-xs text-slate-400 tabular-nums w-12 text-right">Lv.{entry.level}</span>
              <span className="text-xs text-yellow-400 tabular-nums w-16 text-right">{entry.kills} kills</span>
            </div>
          );
        })}
      </div>

      {!expanded && rest.length > 0 && (
        <button
          onClick={() => setExpanded(true)}
          className="w-full text-center text-xs text-slate-500 hover:text-slate-400 py-2 transition-colors"
        >
          +{rest.length} more
        </button>
      )}
    </div>
  );
}

export function RewardsPortal() {
  const { publicKey, sendTransaction, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const { connection } = useConnection();

  const [vaultBalance, setVaultBalance] = useState<number | null>(null);
  const [vaultTokenAccount, setVaultTokenAccount] = useState<PublicKey | null>(null);
  const [depositAmount, setDepositAmount] = useState("");
  const [isDepositing, setIsDepositing] = useState(false);
  const [depositTx, setDepositTx] = useState<string | null>(null);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Read season history from devnet on-chain leaderboard PDAs
  // Pass a high season number to scan backwards; the hook handles missing PDAs gracefully
  const { seasons, isLoading: isLoadingSeasons } = useSeasonHistory(200, 10);

  const connectedWallet = publicKey?.toBase58() ?? null;

  const fetchVaultInfo = useCallback(async () => {
    try {
      let vtaPubkey: PublicKey | null = null;

      if (FALLBACK_VAULT_TOKEN_ACCOUNT) {
        try {
          vtaPubkey = new PublicKey(FALLBACK_VAULT_TOKEN_ACCOUNT);
        } catch { /* invalid pubkey */ }
      }

      if (!vtaPubkey) {
        setVaultBalance(null);
        setVaultTokenAccount(null);
        return;
      }

      setVaultTokenAccount(vtaPubkey);

      try {
        const tokenAcct = await getAccount(connection, vtaPubkey, "confirmed", TOKEN_2022_PROGRAM_ID);
        setVaultBalance(Number(tokenAcct.amount));
      } catch {
        setVaultBalance(0);
      }
    } catch {
      setVaultBalance(null);
    }
  }, [connection]);

  const fetchWalletBalance = useCallback(async () => {
    if (!publicKey) { setWalletBalance(null); return; }
    try {
      const ata = await getAssociatedTokenAddress(WARZ_MINT, publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
      const acct = await getAccount(connection, ata, "confirmed", TOKEN_2022_PROGRAM_ID);
      setWalletBalance(Number(acct.amount));
    } catch {
      setWalletBalance(0);
    }
  }, [publicKey, connection]);

  useEffect(() => {
    fetchVaultInfo();
    const iv = setInterval(fetchVaultInfo, 30000);
    return () => clearInterval(iv);
  }, [fetchVaultInfo]);

  useEffect(() => {
    if (connected) fetchWalletBalance();
  }, [connected, fetchWalletBalance]);

  const handleDeposit = async () => {
    if (!publicKey || !sendTransaction || !vaultTokenAccount) return;
    const amount = parseFloat(depositAmount);
    if (!amount || amount <= 0) { setError("Enter a valid amount"); return; }

    const rawAmount = BigInt(Math.floor(amount * 10 ** TOKEN_DECIMALS));

    setIsDepositing(true);
    setError(null);
    setDepositTx(null);

    try {
      const senderAta = await getAssociatedTokenAddress(WARZ_MINT, publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

      const tx = new Transaction();

      const vaultOwner = FALLBACK_VAULT_OWNER
        ? new PublicKey(FALLBACK_VAULT_OWNER)
        : null;
      if (vaultOwner) {
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            publicKey,
            vaultTokenAccount,
            vaultOwner,
            WARZ_MINT,
            TOKEN_2022_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID,
          )
        );
      }

      tx.add(
        createTransferInstruction(
          senderAta,
          vaultTokenAccount,
          publicKey,
          rawAmount,
          [],
          TOKEN_2022_PROGRAM_ID
        )
      );
      const sig = await sendTransaction(tx, connection);
      await connection.confirmTransaction(sig, "confirmed");

      setDepositTx(sig);
      setDepositAmount("");
      fetchVaultInfo();
      fetchWalletBalance();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Deposit failed");
    } finally {
      setIsDepositing(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950/30 to-slate-950">
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Header */}
        <div className="flex items-center gap-4">
          <a href="/" className="text-slate-400 hover:text-white transition-colors">
            <ArrowLeft className="w-5 h-5" />
          </a>
          <div>
            <h1 className="text-2xl font-bold text-white">$WARZ Season Records</h1>
            <p className="text-sm text-slate-400">On-chain leaderboard history & prize pool</p>
          </div>
        </div>

        {/* Wallet Connect */}
        {!connected && (
          <Card>
            <CardContent className="pt-6 flex flex-col items-center gap-4">
              <Wallet className="w-10 h-10 text-purple-400" />
              <p className="text-slate-300 text-sm text-center">Connect your wallet to deposit WARZ into the prize pool</p>
              <Button onClick={() => setVisible(true)} className="gap-2">
                <Wallet className="w-4 h-4" /> Connect Wallet
              </Button>
            </CardContent>
          </Card>
        )}

        {/* Vault Status */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Gift className="w-5 h-5 text-emerald-400" /> Prize Pool
            </CardTitle>
            <CardDescription>
              Prize pool for top 10 killers each season. Anyone can deposit WARZ to grow the pot.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                <div className="text-xs text-slate-400 mb-1">Vault Balance</div>
                <div className="text-xl font-bold text-emerald-400">
                  {vaultBalance !== null ? formatTokens(vaultBalance) : "—"} <span className="text-sm text-slate-400">WARZ</span>
                </div>
              </div>
              {connected && (
                <div className="bg-slate-800/50 rounded-lg p-4 border border-slate-700/50">
                  <div className="text-xs text-slate-400 mb-1">Your Balance</div>
                  <div className="text-xl font-bold text-white">
                    {walletBalance !== null ? formatTokens(walletBalance) : "—"} <span className="text-sm text-slate-400">WARZ</span>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* How it works */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">How It Works</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-sm">
              <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/30">
                <div className="text-yellow-400 font-bold mb-1">Top 5</div>
                <div className="text-slate-400 text-xs">Scaled by placement — 1st gets the most</div>
                <div className="text-slate-300 mt-2 text-xs space-y-0.5">
                  <div>1st — <span className="text-yellow-400">30%</span></div>
                  <div>2nd — <span className="text-slate-300">20%</span></div>
                  <div>3rd — <span className="text-amber-600">15%</span></div>
                  <div>4th — <span className="text-slate-400">10%</span></div>
                  <div>5th — <span className="text-slate-400">5%</span></div>
                </div>
              </div>
              <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/30">
                <div className="text-blue-400 font-bold mb-1">6th — 10th</div>
                <div className="text-slate-400 text-xs">Bottom 5 split equally</div>
                <div className="text-slate-300 mt-2 text-xs">
                  <div>4% each — <span className="text-blue-400">20% total</span></div>
                </div>
              </div>
              <div className="bg-slate-800/40 rounded-lg p-3 border border-slate-700/30">
                <div className="text-emerald-400 font-bold mb-1">Every 24 hours</div>
                <div className="text-slate-400 text-xs">Season auto-resets, top 10 winners are permanently recorded on-chain (Solana devnet)</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Deposit */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Deposit WARZ</CardTitle>
            <CardDescription>Add to the prize pool — the more in the vault, the bigger the rewards for top killers</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!connected ? (
              <div className="text-center py-2">
                <Button variant="outline" onClick={() => setVisible(true)} className="gap-2">
                  <Wallet className="w-4 h-4" /> Connect Wallet to Deposit
                </Button>
              </div>
            ) : !vaultTokenAccount ? (
              <p className="text-sm text-slate-400 text-center py-3">
                Vault not configured yet.
              </p>
            ) : (
              <>
                <div className="flex gap-3">
                  <div className="flex-1 relative">
                    <Input
                      type="number"
                      placeholder="Amount (e.g. 500000)"
                      value={depositAmount}
                      onChange={(e) => setDepositAmount(e.target.value)}
                      min={0}
                      step="any"
                    />
                    {walletBalance !== null && walletBalance > 0 && (
                      <button
                        onClick={() => setDepositAmount(String(walletBalance / 10 ** TOKEN_DECIMALS))}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-purple-400 hover:text-purple-300 font-medium"
                      >
                        MAX
                      </button>
                    )}
                  </div>
                  <Button
                    onClick={handleDeposit}
                    disabled={isDepositing || !depositAmount}
                    className="gap-2 min-w-[120px]"
                  >
                    {isDepositing ? (
                      <><Loader2 className="w-4 h-4 animate-spin" /> Sending...</>
                    ) : (
                      "Deposit"
                    )}
                  </Button>
                </div>
                {depositTx && (
                  <div className="flex items-center gap-2 text-sm text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                    <span className="truncate">Deposited!</span>
                    <a
                      href={`https://solscan.io/tx/${depositTx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto shrink-0 hover:text-emerald-300"
                    >
                      <ExternalLink className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}
                {error && (
                  <p className="text-sm text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
                )}
              </>
            )}
          </CardContent>
        </Card>

        {/* Season History — on-chain devnet records */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg flex items-center gap-2">
              <Trophy className="w-5 h-5 text-yellow-400" /> Season History
            </CardTitle>
            <CardDescription>
              {isLoadingSeasons
                ? "Loading on-chain records..."
                : `${seasons.length} season${seasons.length !== 1 ? "s" : ""} recorded on Solana devnet`}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {seasons.length === 0 && !isLoadingSeasons && (
              <p className="text-sm text-slate-500 text-center py-4">No seasons finalized yet</p>
            )}
            {isLoadingSeasons && (
              <div className="flex items-center justify-center gap-2 py-6 text-slate-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span className="text-sm">Reading on-chain leaderboards...</span>
              </div>
            )}
            {seasons.map((s) => (
              <SeasonCard key={s.seasonNumber} season={s} connectedWallet={connectedWallet} />
            ))}
          </CardContent>
        </Card>

        {/* Footer */}
        <div className="text-center text-xs text-slate-600 pb-8">
          Combat Program: {COMBAT_PROGRAM_ID.slice(0, 12)}... (devnet) &middot; Mint: {WARZ_MINT.toBase58().slice(0, 12)}...
        </div>
      </div>
    </div>
  );
}
