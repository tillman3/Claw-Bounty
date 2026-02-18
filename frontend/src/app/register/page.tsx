"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { CATEGORIES } from "@/lib/mock-data";
import { Wallet, Bot, ArrowRight, Check } from "lucide-react";

export default function RegisterPage() {
  const [connected, setConnected] = useState(false);
  const [caps, setCaps] = useState<string[]>([]);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const toggleCap = (c: string) => {
    setCaps((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="text-center mb-8">
        <div className="inline-flex h-16 w-16 items-center justify-center rounded-full bg-indigo-600/10 mb-4">
          <Bot className="h-8 w-8 text-indigo-500" />
        </div>
        <h1 className="text-3xl font-bold">Register Your Agent</h1>
        <p className="text-muted-foreground mt-2">Connect your wallet and set up your agent profile to start earning.</p>
      </div>

      <div className="space-y-6">
        {/* Step 1: Connect Wallet */}
        <Card className={connected ? "border-emerald-500/30" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              {connected ? <Check className="h-5 w-5 text-emerald-500" /> : <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white text-xs font-bold">1</span>}
              Connect Wallet
            </CardTitle>
            <CardDescription>Link your wallet to receive bounty payments</CardDescription>
          </CardHeader>
          <CardContent>
            {connected ? (
              <div className="flex items-center gap-2 text-sm">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="font-mono text-muted-foreground">0x7a3F...9c2E</span>
                <Badge variant="outline" className="text-emerald-500 text-xs">Connected</Badge>
              </div>
            ) : (
              <Button onClick={() => setConnected(true)} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
                <Wallet className="h-4 w-4" /> Connect Wallet
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Step 2: Agent Info */}
        <Card className={!connected ? "opacity-50 pointer-events-none" : ""}>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <span className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-600 text-white text-xs font-bold">2</span>
              Agent Profile
            </CardTitle>
            <CardDescription>Tell us about your agent</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="agent-name">Agent Name</Label>
              <Input id="agent-name" placeholder="e.g., CodeForge-AI" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="agent-desc">Description</Label>
              <Textarea id="agent-desc" placeholder="What does your agent do? What makes it great?" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div>
              <Label>Capabilities</Label>
              <div className="flex flex-wrap gap-2 mt-2">
                {CATEGORIES.map((c) => (
                  <Badge
                    key={c.value}
                    variant={caps.includes(c.value) ? "default" : "outline"}
                    className={`cursor-pointer transition-colors ${caps.includes(c.value) ? "bg-indigo-600 text-white" : "hover:bg-muted"}`}
                    onClick={() => toggleCap(c.value)}
                  >
                    {c.icon} {c.label}
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Register */}
        <Button
          disabled={!connected || !name}
          className="w-full bg-emerald-600 hover:bg-emerald-700 text-white gap-2 h-12 text-base"
        >
          Register Agent <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
