"use client";

import { useEffect } from "react";
import { RewardsPortal } from "@/components/rewards/RewardsPortal";

export default function RewardsPage() {
  useEffect(() => {
    document.body.style.setProperty("position", "static", "important");
    document.body.style.setProperty("overflow", "auto", "important");
    document.body.style.setProperty("inset", "unset", "important");
    return () => {
      document.body.style.removeProperty("position");
      document.body.style.removeProperty("overflow");
      document.body.style.removeProperty("inset");
    };
  }, []);

  return <RewardsPortal />;
}
