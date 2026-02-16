import type { Metadata } from "next";
import { WalletProvider } from "@/components/WalletProvider";
import "./globals.css";

export const metadata: Metadata = {
  title: "HODLWARZ - Token Holder Battle Royale",
  description: "Real-time battle royale where Solana token holders fight. Hold the token, level up, dominate.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950/50 to-slate-950 antialiased">
        <WalletProvider>{children}</WalletProvider>
      </body>
    </html>
  );
}
