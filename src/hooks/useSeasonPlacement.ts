"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Connection } from "@solana/web3.js";

const COMBAT_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_COMBAT_PROGRAM_ID || "7aeBk4C2MhuivHdBiNS44feYjwiPsg6Aiq9SEUP99TDi"
);
const DEVNET_RPC = "https://api.devnet.solana.com";
const LEADERBOARD_SEED = Buffer.from("leaderboard");

export interface PlacementEntry {
  wallet: string;
  kills: number;
  level: number;
  place: number;
  seasonNumber: number;
}

export interface SeasonPlacementInfo {
  seasonNumber: number;
  myEntry: PlacementEntry | null;
  isLoading: boolean;
  error: string | null;
  dismissed: boolean;
  dismiss: () => void;
}

function getLeaderboardPda(seasonNumber: number): PublicKey {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(seasonNumber);
  const [pda] = PublicKey.findProgramAddressSync(
    [LEADERBOARD_SEED, buf],
    COMBAT_PROGRAM_ID
  );
  return pda;
}

function parseLeaderboardEntries(
  data: Buffer,
  seasonNumber: number
): PlacementEntry[] {
  if (data.length < 21) return [];

  let offset = 8; // discriminator
  offset += 4; // season_number
  offset += 8; // finalized_at
  const entryCount = data[offset]; offset += 1;

  const entries: PlacementEntry[] = [];
  for (let i = 0; i < entryCount && i < 10; i++) {
    const wallet = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    const kills = Number(data.readBigUInt64LE(offset));
    offset += 8;
    const level = data[offset];
    offset += 1;
    const place = data[offset];
    offset += 1;
    entries.push({ wallet, kills, level, place, seasonNumber });
  }

  return entries;
}

/**
 * Checks recent devnet SeasonLeaderboard PDAs to see if the connected wallet
 * placed in the top 10. Used for the congratulations popup on the game page.
 */
export function useSeasonPlacement(currentSeasonNumber: number | undefined): SeasonPlacementInfo {
  const { publicKey } = useWallet();
  const [myEntry, setMyEntry] = useState<PlacementEntry | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const walletAddress = publicKey?.toBase58() ?? null;

  const fetchMyPlacement = useCallback(async () => {
    if (!currentSeasonNumber || currentSeasonNumber <= 1 || !walletAddress) return;

    setIsLoading(true);
    setError(null);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");

      const seasonsToCheck = [currentSeasonNumber - 1, currentSeasonNumber - 2].filter(n => n > 0);

      for (const sn of seasonsToCheck) {
        try {
          const pda = getLeaderboardPda(sn);
          const info = await connection.getAccountInfo(pda);
          if (!info || !info.data) continue;

          const entries = parseLeaderboardEntries(info.data as Buffer, sn);
          const found = entries.find(e => e.wallet === walletAddress);
          if (found) {
            setMyEntry(found);
            setDismissed(false);
            return;
          }
        } catch {
          // PDA doesn't exist — skip
        }
      }

      setMyEntry(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check placement");
    } finally {
      setIsLoading(false);
    }
  }, [currentSeasonNumber, walletAddress]);

  useEffect(() => {
    fetchMyPlacement();
  }, [fetchMyPlacement]);

  return {
    seasonNumber: currentSeasonNumber ?? 0,
    myEntry,
    isLoading,
    error,
    dismissed,
    dismiss: () => setDismissed(true),
  };
}
