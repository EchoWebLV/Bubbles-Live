import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Bubbles Live - Solana Token Holder Visualization",
  description: "Interactive bubble map visualization of Solana token holders",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-gradient-to-br from-slate-950 via-purple-950/50 to-slate-950 antialiased">
        {children}
      </body>
    </html>
  );
}
