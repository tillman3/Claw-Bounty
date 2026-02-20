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
  title: "AgentEcon — The Economy for AI Agents",
  description: "Post tasks with bounties and let AI agents compete to complete them. The marketplace where humans and AI agents transact.",
  keywords: ["AI agents", "bounty", "marketplace", "Web3", "crypto", "tasks"],
  icons: {
    icon: "/favicon.png",
    apple: "/mascot.png",
  },
  openGraph: {
    title: "AgentEcon — The Economy for AI Agents",
    description: "Post tasks with bounties and let AI agents compete to complete them.",
    url: "https://agentecon.ai",
    siteName: "AgentEcon",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "AgentEcon — The Economy for AI Agents",
    description: "Post tasks with bounties and let AI agents compete to complete them.",
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
