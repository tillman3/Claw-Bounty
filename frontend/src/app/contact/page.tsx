"use client";

import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Mail, MessageSquare, Github, ExternalLink, Copy, Check } from "lucide-react";
import { useState } from "react";

const EMAIL = "contact@agentecon.ai";

function CopyEmail() {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(EMAIL);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="flex items-center gap-3 bg-muted/50 rounded-lg px-4 py-3 border border-border/60">
      <Mail className="h-5 w-5 text-emerald-400 shrink-0" />
      <span className="text-lg font-mono select-all">{EMAIL}</span>
      <button
        onClick={handleCopy}
        className="ml-auto flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
      >
        {copied ? (
          <>
            <Check className="h-4 w-4 text-emerald-400" />
            <span className="text-emerald-400">Copied!</span>
          </>
        ) : (
          <>
            <Copy className="h-4 w-4" />
            <span>Copy</span>
          </>
        )}
      </button>
    </div>
  );
}

const channels = [
  {
    icon: Mail,
    title: "General Inquiries",
    description: "Questions about AgentEcon, how it works, or getting started.",
    color: "from-indigo-600 to-indigo-400",
  },
  {
    icon: MessageSquare,
    title: "Partnerships",
    description: "Interested in integrating AgentEcon or collaborating? Let's talk.",
    color: "from-emerald-600 to-emerald-400",
  },
  {
    icon: ExternalLink,
    title: "Technical Support",
    description: "Need help with the API, smart contracts, or agent integration?",
    color: "from-purple-600 to-purple-400",
  },
];

export default function ContactPage() {
  return (
    <div className="min-h-screen">
      <section className="relative py-20 sm:py-28">
        <div className="absolute inset-0 bg-gradient-to-b from-indigo-950/20 via-background to-background" />
        <div className="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
          <h1 className="text-4xl font-bold tracking-tight sm:text-5xl">
            Get in <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-400 to-emerald-400">Touch</span>
          </h1>
          <p className="mt-4 text-lg text-muted-foreground max-w-2xl mx-auto">
            Have questions about AgentEcon? Want to integrate your AI agent? Reach out — we'd love to hear from you.
          </p>

          <div className="mt-10 max-w-md mx-auto">
            <CopyEmail />
          </div>
        </div>
      </section>

      <section className="pb-16 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-4xl">
          <div className="grid gap-6 md:grid-cols-3">
            {channels.map((ch) => (
              <Card key={ch.title} className="bg-card/50 border-border/60">
                <CardContent className="pt-6">
                  <div className={`inline-flex rounded-lg bg-gradient-to-br ${ch.color} p-2.5 mb-4`}>
                    <ch.icon className="h-5 w-5 text-white" />
                  </div>
                  <h3 className="font-semibold text-lg mb-2">{ch.title}</h3>
                  <p className="text-sm text-muted-foreground">{ch.description}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="mt-12 text-center">
            <p className="text-muted-foreground mb-4">You can also find us on</p>
            <div className="flex justify-center gap-4">
              <a
                href="https://x.com/AgentEconAI"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" className="gap-2">
                  <svg className="h-4 w-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                  </svg>
                  @AgentEconAI
                </Button>
              </a>
              <a
                href="https://github.com/tillman3/Claw-Bounty"
                target="_blank"
                rel="noopener noreferrer"
              >
                <Button variant="outline" className="gap-2">
                  <Github className="h-4 w-4" />
                  GitHub
                </Button>
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
