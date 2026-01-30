"use client";

import { useEffect, useRef, useState, useCallback } from "react";

interface TransactionEvent {
  type: "buy" | "sell" | "transfer";
  signature: string;
  timestamp: number;
}

interface UseHolderWebSocketOptions {
  tokenAddress: string;
  heliusApiKey: string;
  onTransaction?: (event: TransactionEvent) => void;
  enabled?: boolean;
}

export function useHolderWebSocket({
  tokenAddress,
  heliusApiKey,
  onTransaction,
  enabled = true,
}: UseHolderWebSocketOptions) {
  const [connected, setConnected] = useState(false);
  const [transactionCount, setTransactionCount] = useState(0);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const onTransactionRef = useRef(onTransaction);
  const lastSignatureRef = useRef<string | null>(null);
  
  // Keep callback ref updated
  useEffect(() => {
    onTransactionRef.current = onTransaction;
  }, [onTransaction]);

  const connect = useCallback(() => {
    if (!heliusApiKey || !tokenAddress || !enabled) return;

    // Close existing connection
    if (wsRef.current) {
      wsRef.current.close();
    }

    const wsUrl = `wss://mainnet.helius-rpc.com/?api-key=${heliusApiKey}`;
    
    try {
      const ws = new WebSocket(wsUrl);

      ws.onopen = () => {
        console.log("WebSocket connected to Helius");
        setConnected(true);

        // Use logsSubscribe to listen for token activity
        const subscribeMessage = {
          jsonrpc: "2.0",
          id: 1,
          method: "logsSubscribe",
          params: [
            { mentions: [tokenAddress] },
            { commitment: "confirmed" }
          ],
        };

        ws.send(JSON.stringify(subscribeMessage));
        console.log("Subscribed to token logs:", tokenAddress);
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          
          // Handle subscription confirmation
          if (data.result !== undefined && !data.method) {
            console.log("Subscription confirmed, ID:", data.result);
            return;
          }

          // Handle log notification
          if (data.method === "logsNotification") {
            const signature = data.params?.result?.value?.signature;
            const logs = data.params?.result?.value?.logs || [];
            
            // Avoid duplicate processing
            if (signature && signature !== lastSignatureRef.current) {
              lastSignatureRef.current = signature;
              setTransactionCount(prev => prev + 1);
              
              // Determine if it's likely a buy or sell based on logs
              // This is a simplified heuristic
              const logsText = logs.join(" ").toLowerCase();
              let type: "buy" | "sell" | "transfer" = "transfer";
              
              // Common DEX program patterns
              if (logsText.includes("swap") || logsText.includes("raydium") || logsText.includes("jupiter")) {
                // Check if it's more likely a buy or sell based on order of operations
                // This is approximate - for accurate detection you'd need to parse the actual transfers
                type = Math.random() > 0.5 ? "buy" : "sell"; // Simplified for demo
              }
              
              const txEvent: TransactionEvent = {
                type,
                signature,
                timestamp: Date.now(),
              };
              
              onTransactionRef.current?.(txEvent);
            }
          }
        } catch (err) {
          console.error("WebSocket message parse error:", err);
        }
      };

      ws.onerror = (error) => {
        console.error("WebSocket error:", error);
        setConnected(false);
      };

      ws.onclose = () => {
        console.log("WebSocket disconnected");
        setConnected(false);

        // Reconnect after 5 seconds
        if (enabled) {
          reconnectTimeoutRef.current = setTimeout(() => {
            console.log("Reconnecting WebSocket...");
            connect();
          }, 5000);
        }
      };

      wsRef.current = ws;
    } catch (err) {
      console.error("Failed to create WebSocket:", err);
      setConnected(false);
    }
  }, [heliusApiKey, tokenAddress, enabled]);

  // Connect on mount
  useEffect(() => {
    if (enabled && heliusApiKey && tokenAddress) {
      // Small delay to ensure component is mounted
      const timeout = setTimeout(connect, 500);
      return () => clearTimeout(timeout);
    }
  }, [connect, enabled, heliusApiKey, tokenAddress]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) {
        wsRef.current.close();
      }
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
    };
  }, []);

  const disconnect = useCallback(() => {
    if (wsRef.current) {
      wsRef.current.close();
    }
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
  }, []);

  return {
    connected,
    transactionCount,
    disconnect,
    reconnect: connect,
  };
}
