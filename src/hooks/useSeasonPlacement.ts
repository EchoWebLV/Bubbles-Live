"use client";

import { useEffect, useState, useCallback } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Connection } from "@solana/web3.js";

const COMBAT_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_COMBAT_PROGRAM_ID || "AyQ8ZnxYyFxYiHmxjFXs3ptgPvrSKi4WWfxhfLqccFsw"
);
const DEVNET_RPC = "https://api.devnet.solana.com";
const LEADERBOARD_SEED = Buffer.from("leaderboard");
const SEASON_SEED = Buffer.from("season");

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

function getSeasonStatePda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEASON_SEED],
    COMBAT_PROGRAM_ID
  );
  return pda;
}

async function fetchCurrentSeasonNumber(connection: Connection): Promise<number | null> {
  try {
    const pda = getSeasonStatePda();
    const info = await connection.getAccountInfo(pda);
    if (!info || !info.data || info.data.length < 44) return null;
    const data = info.data as Buffer;
    return data.readUInt32LE(40);
  } catch {
    return null;
  }
}

function parseLeaderboardEntries(
  data: Buffer,
  seasonNumber: number
): PlacementEntry[] {
  if (data.length < 21) return [];

  let offset = 8;
  offset += 4; // season_number
  offset += 8; // finalized_at
  const entryCount = data[offset]; offset += 1;

  const entries: PlacementEntry[] = [];
  for (let i = 0; i < entryCount && i < 10; i++) {
    const walletBytes = data.subarray(offset, offset + 32);
    const isZero = walletBytes.every((b: number) => b === 0);
    offset += 32;
    const kills = Number(data.readBigUInt64LE(offset)); offset += 8;
    const level = data[offset]; offset += 1;
    const place = data[offset]; offset += 1;
    if (isZero) continue;
    entries.push({ wallet: new PublicKey(walletBytes).toBase58(), kills, level, place, seasonNumber });
  }

  return entries;
}

/**
 * Checks recent devnet SeasonLeaderboard PDAs to see if the connected wallet
 * placed in the top 10. Used for the congratulations popup on the game page.
 * Auto-discovers the current season if not provided.
 */
export function useSeasonPlacement(currentSeasonNumber: number | undefined): SeasonPlacementInfo {
  const { publicKey } = useWallet();
  const [myEntry, setMyEntry] = useState<PlacementEntry | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);

  const walletAddress = publicKey?.toBase58() ?? null;

  const fetchMyPlacement = useCallback(async () => {
    if (!walletAddress) return;

    setIsLoading(true);
    setError(null);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");

      let season = currentSeasonNumber;
      if (!season || season <= 0) {
        season = await fetchCurrentSeasonNumber(connection) ?? undefined;
      }
      if (!season || season <= 1) {
        setMyEntry(null);
        return;
      }

      const seasonsToCheck = [season - 1, season - 2].filter(n => n > 0);

      const pdas = seasonsToCheck.map(sn => getLeaderboardPda(sn));
      const accounts = await connection.getMultipleAccountsInfo(pdas);

      for (let i = 0; i < accounts.length; i++) {
        const info = accounts[i];
        if (!info || !info.data) continue;
        const entries = parseLeaderboardEntries(info.data as Buffer, seasonsToCheck[i]);
        const found = entries.find(e => e.wallet === walletAddress);
        if (found) {
          setMyEntry(found);
          setDismissed(false);
          return;
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
