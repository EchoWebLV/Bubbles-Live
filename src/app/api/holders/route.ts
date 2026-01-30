import { NextRequest, NextResponse } from "next/server";
import { calculateRadius, getHolderColor, type Holder, type HoldersResponse, type TokenInfo } from "@/components/bubble-map/types";

const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
const MAX_HOLDERS = parseInt(process.env.MAX_HOLDERS_DISPLAY || "100", 10);

interface HeliusTokenAccount {
  address: string;
  mint: string;
  owner: string;
  amount: number;
  delegatedAmount: number;
  frozen: boolean;
}

interface HeliusAsset {
  id: string;
  content?: {
    metadata?: {
      name?: string;
      symbol?: string;
    };
    links?: {
      image?: string;
    };
  };
  token_info?: {
    decimals?: number;
    supply?: number;
  };
}

async function getTokenMetadata(mintAddress: string): Promise<TokenInfo> {
  if (!HELIUS_API_KEY) {
    // Return mock data if no API key
    return {
      address: mintAddress,
      name: "Unknown Token",
      symbol: "???",
      decimals: 9,
      totalSupply: 1000000000,
    };
  }

  try {
    const response = await fetch(
      `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "token-metadata",
          method: "getAsset",
          params: { id: mintAddress },
        }),
      }
    );

    const data = await response.json();
    const asset = data.result as HeliusAsset;

    return {
      address: mintAddress,
      name: asset?.content?.metadata?.name || "Unknown Token",
      symbol: asset?.content?.metadata?.symbol || "???",
      decimals: asset?.token_info?.decimals || 9,
      totalSupply: asset?.token_info?.supply || 0,
      logoUri: asset?.content?.links?.image,
    };
  } catch (error) {
    console.error("Error fetching token metadata:", error);
    return {
      address: mintAddress,
      name: "Unknown Token",
      symbol: "???",
      decimals: 9,
      totalSupply: 0,
    };
  }
}

async function getTokenHolders(mintAddress: string, limit: number = MAX_HOLDERS): Promise<HeliusTokenAccount[]> {
  if (!HELIUS_API_KEY) {
    // Return mock data for development/demo
    return generateMockHolders(limit);
  }

  try {
    const allHolders: HeliusTokenAccount[] = [];
    let cursor: string | undefined = undefined;
    const pageSize = 1000; // Max page size for Helius
    
    // Fetch multiple pages to get more holders
    while (allHolders.length < limit * 2) { // Fetch extra to sort properly
      const response = await fetch(
        `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0",
            id: "token-accounts",
            method: "getTokenAccounts",
            params: {
              mint: mintAddress,
              limit: pageSize,
              cursor: cursor,
              options: {
                showZeroBalance: false,
              },
            },
          }),
        }
      );

      const data = await response.json();
      
      if (data.error) {
        console.error("Helius API error:", data.error);
        break;
      }

      const accounts = data.result?.token_accounts || [];
      if (accounts.length === 0) break;
      
      allHolders.push(...accounts);
      cursor = data.result?.cursor;
      
      // Stop if no more pages
      if (!cursor) break;
    }
    
    // Sort by amount descending to get top holders
    allHolders.sort((a, b) => b.amount - a.amount);
    
    // Return top holders
    return allHolders.slice(0, limit);
  } catch (error) {
    console.error("Error fetching token holders:", error);
    return generateMockHolders(limit);
  }
}

function generateMockHolders(count: number): HeliusTokenAccount[] {
  const holders: HeliusTokenAccount[] = [];
  
  // Limit to reasonable count for demo
  const actualCount = Math.min(count, 50);
  
  // Generate realistic distribution: few whales, more medium, many small holders
  const distributions = [
    { count: Math.ceil(actualCount * 0.08), minPct: 8, maxPct: 15 },    // Whales
    { count: Math.ceil(actualCount * 0.15), minPct: 2, maxPct: 8 },     // Large
    { count: Math.ceil(actualCount * 0.35), minPct: 0.5, maxPct: 2 },   // Medium
    { count: Math.ceil(actualCount * 0.42), minPct: 0.1, maxPct: 0.5 }, // Small
  ];

  let totalSupply = 1000000000; // 1 billion tokens
  let idx = 0;

  for (const dist of distributions) {
    for (let i = 0; i < dist.count && idx < actualCount; i++) {
      const pct = dist.minPct + Math.random() * (dist.maxPct - dist.minPct);
      const amount = Math.floor((pct / 100) * totalSupply);
      
      holders.push({
        address: `TokenAccount${idx}`,
        mint: "MockMint",
        owner: generateRandomAddress(),
        amount: amount,
        delegatedAmount: 0,
        frozen: false,
      });
      idx++;
    }
  }

  // Sort by amount descending
  return holders.sort((a, b) => b.amount - a.amount).slice(0, actualCount);
}

function generateRandomAddress(): string {
  const chars = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let result = "";
  for (let i = 0; i < 44; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const tokenAddress = searchParams.get("token") || process.env.DEFAULT_TOKEN_ADDRESS;

  if (!tokenAddress) {
    return NextResponse.json(
      { error: "Token address is required. Provide ?token=<address> or set DEFAULT_TOKEN_ADDRESS" },
      { status: 400 }
    );
  }

  try {
    // Fetch token metadata and holders in parallel
    const [tokenInfo, rawHolders] = await Promise.all([
      getTokenMetadata(tokenAddress),
      getTokenHolders(tokenAddress, MAX_HOLDERS),
    ]);

    // Calculate total supply from holders if not available
    const totalFromHolders = rawHolders.reduce((sum, h) => sum + h.amount, 0);
    const totalSupply = tokenInfo.totalSupply || totalFromHolders;

    // Process holders with percentages and visual properties
    const holders: Holder[] = rawHolders.map((h) => {
      const percentage = totalSupply > 0 ? (h.amount / totalSupply) * 100 : 0;
      return {
        address: h.owner,
        balance: h.amount,
        percentage,
        radius: calculateRadius(percentage),
        color: getHolderColor(percentage, h.owner),
      };
    });

    const response: HoldersResponse = {
      token: {
        ...tokenInfo,
        totalSupply,
      },
      holders,
      totalHolders: holders.length,
      lastUpdated: new Date().toISOString(),
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error in holders API:", error);
    return NextResponse.json(
      { error: "Failed to fetch holder data" },
      { status: 500 }
    );
  }
}
