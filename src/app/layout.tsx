import type { Metadata, Viewport } from "next";
import { WalletProvider } from "@/components/WalletProvider";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "$WARZ - Token Holder Battle Royale",
  description: "Real-time battle royale where Solana token holders fight. Hold the token, level up, dominate.",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950/50 to-slate-950 antialiased overflow-hidden touch-manipulation">
        <WalletProvider>
          {children}
          <Toaster
            position="top-center"
            theme="dark"
            toastOptions={{
              style: {
                background: "rgba(15, 23, 42, 0.95)",
                border: "1px solid rgba(148, 163, 184, 0.2)",
                color: "#e2e8f0",
              },
            }}
          />
        </WalletProvider>
      </body>
    </html>
  );
}
