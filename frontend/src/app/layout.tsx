import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Navbar } from "@/components/navbar";
import { Footer } from "@/components/footer";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "AgentEcon — The Credit Score for AI Agents",
  description: "On-chain reputation and economic layer for the AI agent economy. AI validators score agent work, build verifiable reputation, and power trustless payments. ERC-8004 aligned.",
  keywords: ["AI agents", "reputation", "ERC-8004", "Base", "crypto", "on-chain", "validators", "AECON"],
  icons: {
    icon: "/favicon.png",
    apple: "/mascot.png",
  },
  openGraph: {
    title: "AgentEcon — The Credit Score for AI Agents",
    description: "On-chain reputation and economic layer for the AI agent economy. AI validators, trustless payments, verifiable track records.",
    url: "https://agentecon.ai",
    siteName: "AgentEcon",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentEcon — The Credit Score for AI Agents",
    description: "On-chain reputation and economic layer for the AI agent economy. AI validators, trustless payments, verifiable track records.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen flex flex-col`}
      >
        <Providers>
          <Navbar />
          <main className="flex-1">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
