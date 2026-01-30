"use client";

import { useState, useEffect, useRef, useCallback } from "react";

interface PriceData {
  price: number;
  priceChange24h: number;
  priceChange1h: number;
  volume24h: number;
  marketCap: number;
  lastUpdated: string;
}

interface PriceEvent {
  type: "pump" | "dump" | "stable";
  changePercent: number;
  price: number;
}

interface UsePriceTrackerOptions {
  tokenAddress: string;
  pollInterval?: number; // ms
  pumpThreshold?: number; // Percentage change to trigger pump
  dumpThreshold?: number; // Percentage change to trigger dump
}

export function usePriceTracker({
  tokenAddress,
  pollInterval = 10000, // 10 seconds
  pumpThreshold = 2, // 2% increase
  dumpThreshold = -2, // 2% decrease
}: UsePriceTrackerOptions) {
  const [priceData, setPriceData] = useState<PriceData | null>(null);
  const [priceEvent, setPriceEvent] = useState<PriceEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const previousPriceRef = useRef<number | null>(null);
  
  const fetchPrice = useCallback(async () => {
    try {
      const response = await fetch(`/api/price?token=${tokenAddress}`);
      if (!response.ok) return;
      
      const data: PriceData = await response.json();
      setPriceData(data);
      
      // Compare with previous price to detect pump/dump
      if (previousPriceRef.current !== null && data.price > 0) {
        const changePercent = ((data.price - previousPriceRef.current) / previousPriceRef.current) * 100;
        
        if (changePercent >= pumpThreshold) {
          setPriceEvent({
            type: "pump",
            changePercent,
            price: data.price,
          });
          // Clear event after animation
          setTimeout(() => setPriceEvent(null), 3000);
        } else if (changePercent <= dumpThreshold) {
          setPriceEvent({
            type: "dump",
            changePercent,
            price: data.price,
          });
          setTimeout(() => setPriceEvent(null), 3000);
        }
      }
      
      previousPriceRef.current = data.price;
      setLoading(false);
    } catch (error) {
      console.error("Error fetching price:", error);
    }
  }, [tokenAddress, pumpThreshold, dumpThreshold]);
  
  // Initial fetch and polling
  useEffect(() => {
    fetchPrice();
    
    const interval = setInterval(fetchPrice, pollInterval);
    return () => clearInterval(interval);
  }, [fetchPrice, pollInterval]);
  
  // Manual trigger for testing
  const triggerPump = useCallback(() => {
    setPriceEvent({
      type: "pump",
      changePercent: 5,
      price: priceData?.price || 0,
    });
    setTimeout(() => setPriceEvent(null), 3000);
  }, [priceData]);
  
  const triggerDump = useCallback(() => {
    setPriceEvent({
      type: "dump",
      changePercent: -5,
      price: priceData?.price || 0,
    });
    setTimeout(() => setPriceEvent(null), 3000);
  }, [priceData]);
  
  return {
    priceData,
    priceEvent,
    loading,
    triggerPump,
    triggerDump,
  };
}
