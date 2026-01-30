import { NextRequest, NextResponse } from "next/server";

interface PriceData {
  price: number;
  priceChange24h: number;
  priceChange1h: number;
  volume24h: number;
  marketCap: number;
  lastUpdated: string;
}

// Use DexScreener API (free, no auth required)
async function getTokenPrice(tokenAddress: string): Promise<PriceData | null> {
  try {
    const response = await fetch(
      `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`,
      { next: { revalidate: 10 } } // Cache for 10 seconds
    );
    
    if (!response.ok) {
      throw new Error("Failed to fetch price");
    }
    
    const data = await response.json();
    
    // Get the pair with highest liquidity
    const pairs = data.pairs || [];
    if (pairs.length === 0) {
      return null;
    }
    
    // Sort by liquidity and get the best pair
    const bestPair = pairs.sort((a: any, b: any) => 
      (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
    )[0];
    
    return {
      price: parseFloat(bestPair.priceUsd) || 0,
      priceChange24h: parseFloat(bestPair.priceChange?.h24) || 0,
      priceChange1h: parseFloat(bestPair.priceChange?.h1) || 0,
      volume24h: parseFloat(bestPair.volume?.h24) || 0,
      marketCap: parseFloat(bestPair.marketCap) || 0,
      lastUpdated: new Date().toISOString(),
    };
  } catch (error) {
    console.error("Error fetching price:", error);
    return null;
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const tokenAddress = searchParams.get("token");
  
  if (!tokenAddress) {
    return NextResponse.json(
      { error: "Token address required" },
      { status: 400 }
    );
  }
  
  const priceData = await getTokenPrice(tokenAddress);
  
  if (!priceData) {
    return NextResponse.json(
      { error: "Could not fetch price data" },
      { status: 404 }
    );
  }
  
  return NextResponse.json(priceData);
}
