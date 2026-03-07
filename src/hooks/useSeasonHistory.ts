"use client";

import { useEffect, useState, useCallback } from "react";
import { PublicKey, Connection } from "@solana/web3.js";

const COMBAT_PROGRAM_ID = new PublicKey(
  process.env.NEXT_PUBLIC_COMBAT_PROGRAM_ID || "7aeBk4C2MhuivHdBiNS44feYjwiPsg6Aiq9SEUP99TDi"
);
const DEVNET_RPC = "https://api.devnet.solana.com";
const LEADERBOARD_SEED = Buffer.from("leaderboard");

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

function getLeaderboardPda(seasonNumber: number): PublicKey {
  const buf = Buffer.alloc(4);
  buf.writeUInt32LE(seasonNumber);
  const [pda] = PublicKey.findProgramAddressSync(
    [LEADERBOARD_SEED, buf],
    COMBAT_PROGRAM_ID
  );
  return pda;
}

function parseLeaderboard(data: Buffer): SeasonRecord | null {
  if (data.length < 21) return null;

  let offset = 8; // skip discriminator
  const seasonNumber = data.readUInt32LE(offset); offset += 4;
  const finalizedAt = Number(data.readBigInt64LE(offset)); offset += 8;
  const entryCount = data[offset]; offset += 1;

  const entries: LeaderboardEntry[] = [];
  for (let i = 0; i < entryCount && i < 10; i++) {
    const wallet = new PublicKey(data.subarray(offset, offset + 32)).toBase58();
    offset += 32;
    const kills = Number(data.readBigUInt64LE(offset));
    offset += 8;
    const level = data[offset];
    offset += 1;
    const place = data[offset];
    offset += 1;
    entries.push({ wallet, kills, level, place });
  }

  return { seasonNumber, finalizedAt, entryCount, entries };
}

export function useSeasonHistory(currentSeasonNumber: number | undefined, maxSeasons = 10) {
  const [seasons, setSeasons] = useState<SeasonRecord[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchHistory = useCallback(async () => {
    if (!currentSeasonNumber || currentSeasonNumber <= 1) return;

    setIsLoading(true);
    setError(null);

    try {
      const connection = new Connection(DEVNET_RPC, "confirmed");
      const results: SeasonRecord[] = [];

      const startSeason = currentSeasonNumber - 1;
      const endSeason = Math.max(1, currentSeasonNumber - maxSeasons);

      for (let sn = startSeason; sn >= endSeason; sn--) {
        try {
          const pda = getLeaderboardPda(sn);
          const info = await connection.getAccountInfo(pda);
          if (!info || !info.data) continue;

          const record = parseLeaderboard(info.data as Buffer);
          if (record) results.push(record);
        } catch {
          // PDA doesn't exist for this season — skip
        }
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

  return { seasons, isLoading, error, refetch: fetchHistory };
}
