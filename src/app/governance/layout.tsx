import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "$WARZ Governance — Token Holder DAO",
  description: "Vote on game parameters, season resets, and balance changes. Your $WARZ holdings are your voting power.",
};

export default function GovernanceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div
      className="min-h-screen overflow-y-auto"
      style={{ position: "relative" }}
    >
      {children}
    </div>
  );
}
