"use client";

import { useRef, useCallback } from "react";
import type { Holder } from "@/components/bubble-map/types";

export interface HolderChange {
  type: "new_buyer" | "seller" | "whale_move" | "increased" | "decreased";
  address: string;
  holder: Holder;
  previousBalance?: number;
  newBalance: number;
  percentChange?: number;
}

interface UseHolderChangesOptions {
  whaleThreshold?: number; // Percentage to be considered a whale
  significantChangeThreshold?: number; // Percentage change to trigger alert
}

export function useHolderChanges(options: UseHolderChangesOptions = {}) {
  const { 
    whaleThreshold = 1, // 1% = whale
    significantChangeThreshold = 10 // 10% balance change = significant
  } = options;
  
  const previousHoldersRef = useRef<Map<string, Holder>>(new Map());
  
  const detectChanges = useCallback((currentHolders: Holder[]): HolderChange[] => {
    const changes: HolderChange[] = [];
    const previousHolders = previousHoldersRef.current;
    const currentMap = new Map(currentHolders.map(h => [h.address, h]));
    
    // Check each current holder
    currentHolders.forEach(holder => {
      const previous = previousHolders.get(holder.address);
      
      if (!previous) {
        // New buyer!
        changes.push({
          type: "new_buyer",
          address: holder.address,
          holder,
          newBalance: holder.balance,
        });
      } else if (holder.balance > previous.balance) {
        // Increased holdings
        const percentChange = ((holder.balance - previous.balance) / previous.balance) * 100;
        
        if (percentChange >= significantChangeThreshold) {
          // Check if whale
          if (holder.percentage >= whaleThreshold) {
            changes.push({
              type: "whale_move",
              address: holder.address,
              holder,
              previousBalance: previous.balance,
              newBalance: holder.balance,
              percentChange,
            });
          } else {
            changes.push({
              type: "increased",
              address: holder.address,
              holder,
              previousBalance: previous.balance,
              newBalance: holder.balance,
              percentChange,
            });
          }
        }
      } else if (holder.balance < previous.balance) {
        // Decreased holdings (sold some)
        const percentChange = ((previous.balance - holder.balance) / previous.balance) * 100;
        
        if (percentChange >= significantChangeThreshold) {
          if (previous.percentage >= whaleThreshold) {
            // Whale sold
            changes.push({
              type: "whale_move",
              address: holder.address,
              holder,
              previousBalance: previous.balance,
              newBalance: holder.balance,
              percentChange: -percentChange,
            });
          } else {
            changes.push({
              type: "seller",
              address: holder.address,
              holder,
              previousBalance: previous.balance,
              newBalance: holder.balance,
              percentChange: -percentChange,
            });
          }
        }
      }
    });
    
    // Check for holders who completely sold (no longer in list)
    previousHolders.forEach((previous, address) => {
      if (!currentMap.has(address)) {
        // Completely sold out
        changes.push({
          type: "seller",
          address,
          holder: previous,
          previousBalance: previous.balance,
          newBalance: 0,
          percentChange: -100,
        });
      }
    });
    
    // Update previous holders for next comparison
    previousHoldersRef.current = currentMap;
    
    return changes;
  }, [whaleThreshold, significantChangeThreshold]);
  
  const reset = useCallback(() => {
    previousHoldersRef.current = new Map();
  }, []);
  
  return { detectChanges, reset };
}
