import "./globals.css";
import type { Metadata } from "next";
import { Space_Grotesk, Sora } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import { WalletProvider } from "@/components/wallet-provider";

const display = Space_Grotesk({ subsets: ["latin"], variable: "--font-display" });
const body = Sora({ subsets: ["latin"], variable: "--font-body" });

export const metadata: Metadata = {
  title: "Circles Commons",
  description: "Spend locally and fund shared projects with CRC."
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body className="min-h-screen"><WalletProvider>{children}</WalletProvider><Analytics /></body>
    </html>
  );
}
