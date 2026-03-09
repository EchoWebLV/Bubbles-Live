"use client";

import { useEffect, useState, useCallback } from "react";
import { PublicKey, Connection } from "@solana/web3.js";

const COMBAT_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_COMBAT_PROGRAM_ID || "AyQ8ZnxYyFxYiHmxjFXs3ptgPvrSKi4WWfxhfLqccFsw"
);
const DEVNET_RPC = "https://api.devnet.solana.com";
const LEADERBOARD_SEED = Buffer.from("leaderboard");
const SEASON_SEED = Buffer.from("season");

export interface LeaderboardEntry {
  wallet: string;
  kills: number;
  level: number;
  place: number;
}

export interface SeasonRecord {
  seasonNumber: number;
  finalizedAt: number;
  entryCount: number;
  entries: LeaderboardEntry[];
}

function getSeasonStatePda(): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [SEASON_SEED],
    COMBAT_PROGRAM_ID
  );
  return pda;
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

/**
 * SeasonState layout (from IDL):
 *   8  discriminator
 *  32  authority (pubkey)
 *   4  season_number (u32 LE)
 *   8  started_at (i64 LE)
 *   8  duration_secs (i64 LE)
 *   1  is_finalized (bool)
 */
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

function parseLeaderboard(data: Buffer): SeasonRecord | null {
  if (data.length < 21) return null;

  let offset = 8;
  const seasonNumber = data.readUInt32LE(offset); offset += 4;
  const finalizedAt = Number(data.readBigInt64LE(offset)); offset += 8;
  const entryCount = data[offset]; offset += 1;

  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < entryCount && i < 10; i++) {
    const walletBytes = data.subarray(offset, offset + 32);
    const isZero = walletBytes.every((b: number) => b === 0);
    offset += 32;
    const kills = Number(data.readBigUInt64LE(offset)); offset += 8;
    const level = data[offset]; offset += 1;
    const place = data[offset]; offset += 1;
    if (isZero) continue;
    entries.push({ wallet: new PublicKey(walletBytes).toBase58(), kills, level, place });
  }

  return { seasonNumber, finalizedAt, entryCount, entries };
}

/**
 * Fetches on-chain SeasonLeaderboard PDAs from devnet.
 * If `currentSeasonNumber` is omitted, auto-discovers it from the SeasonState PDA.
 */
export function useSeasonHistory(currentSeasonNumber?: number | undefined, maxSeasons = 10) {
  const [seasons, setSeasons] = useState<SeasonRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discoveredSeason, setDiscoveredSeason] = useState<number | null>(null);

  const effectiveSeason = currentSeasonNumber ?? discoveredSeason;

  const fetchHistory = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");

      let season = currentSeasonNumber;
      if (!season || season <= 0) {
        season = (await fetchCurrentSeasonNumber(connection)) ?? undefined;
        if (season) setDiscoveredSeason(season);
      }

      if (!season || season < 1) {
        setSeasons([]);
        return;
      }

      const startSeason = season;
      const endSeason = Math.max(1, season - maxSeasons + 1);

      const pdas: PublicKey[] = [];
      const seasonNums: number[] = [];
      for (let sn = startSeason; sn >= endSeason; sn--) {
        seasonNums.push(sn);
        pdas.push(getLeaderboardPda(sn));
      }

      const accounts = await connection.getMultipleAccountsInfo(pdas);

      const results: SeasonRecord[] = [];
      for (let i = 0; i < accounts.length; i++) {
        const info = accounts[i];
        if (!info || !info.data) continue;
        const record = parseLeaderboard(info.data as Buffer);
        if (record && record.entries.length > 0) results.push(record);
      }

      setSeasons(results);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch season history");
    } finally {
      setIsLoading(false);
    }
  }, [currentSeasonNumber, maxSeasons]);

  useEffect(() => {
    fetchHistory();
  }, [fetchHistory]);

  return { seasons, isLoading, error, refetch: fetchHistory, currentSeason: effectiveSeason };
}
