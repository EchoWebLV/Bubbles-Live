"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useWallet } from "@solana/wallet-adapter-react";

const STREAMFLOW_API = "https://api-public.streamflow.finance/v2/api/airdrops";
const WARZ_MINT = process.env.NEXT_PUBLIC_TOKEN_ADDRESS || "";
const POLL_INTERVAL_MS = 5 * 60 * 1000;

export interface AirdropClaim {
  chain: string;
  distributorAddress: string;
  address: string;
  amountUnlocked: string;
  amountLocked: string;
  amountClaimed?: string;
}

interface DistributorInfo {
  address: string;
  mint: string;
  name: string;
  isActive: boolean;
}

export interface AirdropInfo {
  claims: AirdropClaim[];
  totalUnclaimed: number;
  isLoading: boolean;
  error: string | null;
  dismiss: () => void;
  dismissed: boolean;
  refetch: () => void;
}

async function checkEligibility(walletAddress: string): Promise<AirdropClaim[]> {
  const res = await fetch(`${STREAMFLOW_API}/check-eligibility`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ claimantAddresses: [walletAddress] }),
  });

  if (!res.ok) {
    if (res.status === 404) return [];
    throw new Error(`Streamflow API error: ${res.status}`);
  }

  return res.json();
}

async function fetchDistributors(addresses: string[]): Promise<Map<string, DistributorInfo>> {
  if (addresses.length === 0) return new Map();

  const res = await fetch(`${STREAMFLOW_API}/?addresses=${addresses.join(",")}`);
  if (!res.ok) return new Map();

  const data: DistributorInfo[] = await res.json();
  const map = new Map<string, DistributorInfo>();
  for (const d of data) map.set(d.address, d);
  return map;
}

function filterWarzClaims(
  claims: AirdropClaim[],
  distributors: Map<string, DistributorInfo>
): AirdropClaim[] {
  return claims.filter((c) => {
    const dist = distributors.get(c.distributorAddress);
    if (!dist || dist.mint !== WARZ_MINT) return false;
    const total = BigInt(c.amountUnlocked) + BigInt(c.amountLocked);
    const claimed = BigInt(c.amountClaimed ?? "0");
    return total - claimed > BigInt(0);
  });
}

function computeUnclaimed(claims: AirdropClaim[]): number {
  return claims.reduce((sum, c) => {
    const total = BigInt(c.amountUnlocked) + BigInt(c.amountLocked);
    const claimed = BigInt(c.amountClaimed ?? "0");
    return sum + Number(total - claimed);
  }, 0);
}

export function useAirdropChecker(): AirdropInfo {
  const { publicKey } = useWallet();
  const [claims, setClaims] = useState<AirdropClaim[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const walletAddress = publicKey?.toBase58() ?? null;

  const fetchClaims = useCallback(async () => {
    if (!walletAddress || !WARZ_MINT) return;
    setIsLoading(true);
    setError(null);
    try {
      const allClaims = await checkEligibility(walletAddress);
      const uniqueDistAddrs = [...new Set(allClaims.map((c) => c.distributorAddress))];
      const distributors = await fetchDistributors(uniqueDistAddrs);
      const warzClaims = filterWarzClaims(allClaims, distributors);
      setClaims(warzClaims);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to check airdrops");
      setClaims([]);
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    if (!walletAddress) {
      setClaims([]);
      setDismissed(false);
      return;
    }

    setDismissed(false);
    fetchClaims();

    intervalRef.current = setInterval(fetchClaims, POLL_INTERVAL_MS);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [walletAddress, fetchClaims]);

  return {
    claims,
    totalUnclaimed: computeUnclaimed(claims),
    isLoading,
    error,
    dismiss: () => setDismissed(true),
    dismissed,
    refetch: fetchClaims,
  };
}

/**
 * Check eligibility for a batch of wallet addresses (for leaderboard indicators).
 * Returns a Set of addresses that have unclaimed WARZ airdrops.
 */
export async function checkBatchEligibility(addresses: string[]): Promise<Set<string>> {
  if (addresses.length === 0 || !WARZ_MINT) return new Set();

  const batch = addresses.slice(0, 100);
  try {
    const res = await fetch(`${STREAMFLOW_API}/check-eligibility`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ claimantAddresses: batch }),
    });
    if (!res.ok) return new Set();

    const data: AirdropClaim[] = await res.json();
    if (data.length === 0) return new Set();

    const uniqueDistAddrs = [...new Set(data.map((c) => c.distributorAddress))];
    const distributors = await fetchDistributors(uniqueDistAddrs);

    const eligible = new Set<string>();
    for (const c of data) {
      const dist = distributors.get(c.distributorAddress);
      if (!dist || dist.mint !== WARZ_MINT) continue;
      const total = BigInt(c.amountUnlocked) + BigInt(c.amountLocked);
      const claimed = BigInt(c.amountClaimed ?? "0");
      if (total - claimed > BigInt(0)) {
        eligible.add(c.address);
      }
    }
    return eligible;
  } catch {
    return new Set();
  }
}
