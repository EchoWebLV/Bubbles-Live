"use client";

import { useState, useEffect, useRef } from "react";

export interface SeasonCountdown {
  hours: number;
  minutes: number;
  seconds: number;
  totalSeconds: number;
  display: string;
  isEnding: boolean;
}

export function useSeasonCountdown(seasonEndsAt: number | undefined): SeasonCountdown {
  const [now, setNow] = useState(Date.now());
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  if (!seasonEndsAt || seasonEndsAt <= 0) {
    return { hours: 0, minutes: 0, seconds: 0, totalSeconds: 0, display: "--:--:--", isEnding: false };
  }

  const remaining = Math.max(0, seasonEndsAt - now);
  const totalSeconds = Math.floor(remaining / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");
  const display = `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  const isEnding = totalSeconds > 0 && totalSeconds <= 300;

  return { hours, minutes, seconds, totalSeconds, display, isEnding };
}
