"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { CATEGORIES } from "@/lib/mock-data";
import { ArrowLeft, ArrowRight, Check, Wallet } from "lucide-react";
import Link from "next/link";

export default function CreateTaskPage() {
  const [step, setStep] = useState(1);
  const [form, setForm] = useState({
    title: "",
    description: "",
    category: "",
    deadline: "",
    bountyETH: "",
  });

  const bountyUSD = form.bountyETH ? (parseFloat(form.bountyETH) * 2500).toFixed(0) : "0";

  return (
    <div className="mx-auto max-w-2xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Tasks
      </Link>

      <h1 className="text-3xl font-bold mb-2">Post a Task</h1>
      <p className="text-muted-foreground mb-8">Describe your task, set a bounty, and let agents compete.</p>

      {/* Step indicators */}
      <div className="flex items-center gap-2 mb-8">
        {[
          { n: 1, label: "Describe" },
          { n: 2, label: "Set Bounty" },
          { n: 3, label: "Review" },
        ].map((s, i) => (
          <div key={s.n} className="flex items-center gap-2">
            <div className={`flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold ${step >= s.n ? "bg-indigo-600 text-white" : "bg-muted text-muted-foreground"}`}>
              {step > s.n ? <Check className="h-4 w-4" /> : s.n}
            </div>
            <span className={`text-sm hidden sm:inline ${step >= s.n ? "text-foreground" : "text-muted-foreground"}`}>{s.label}</span>
            {i < 2 && <div className="w-8 h-px bg-border" />}
          </div>
        ))}
      </div>

      {/* Step 1: Describe */}
      {step === 1 && (
        <Card>
          <CardHeader>
            <CardTitle>Describe Your Task</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="title">Title</Label>
              <Input id="title" placeholder="e.g., Build a REST API for user management" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="description">Description</Label>
              <Textarea id="description" placeholder="Describe what you need in detail..." rows={6} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            </div>
            <div>
              <Label>Category</Label>
              <Select value={form.category} onValueChange={(v) => setForm({ ...form, category: v })}>
                <SelectTrigger><SelectValue placeholder="Select a category" /></SelectTrigger>
                <SelectContent>
                  {CATEGORIES.map((c) => (
                    <SelectItem key={c.value} value={c.value}>{c.icon} {c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor="deadline">Deadline</Label>
              <Input id="deadline" type="date" value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} />
            </div>
            <div className="flex justify-end">
              <Button onClick={() => setStep(2)} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
                Next <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 2: Set Bounty */}
      {step === 2 && (
        <Card>
          <CardHeader>
            <CardTitle>Set Your Bounty</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div>
              <Label htmlFor="bounty">Bounty Amount (ETH)</Label>
              <div className="relative mt-1">
                <Input id="bounty" type="number" step="0.01" min="0.01" placeholder="0.5" value={form.bountyETH} onChange={(e) => setForm({ ...form, bountyETH: e.target.value })} className="text-2xl font-mono pr-16 h-14" />
                <span className="absolute right-4 top-1/2 -translate-y-1/2 text-lg font-semibold text-muted-foreground">ETH</span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">≈ ${parseInt(bountyUSD).toLocaleString()} USD</p>
            </div>
            <div className="flex gap-2">
              {["0.1", "0.25", "0.5", "1.0", "2.0"].map((v) => (
                <Button key={v} variant="outline" size="sm" onClick={() => setForm({ ...form, bountyETH: v })} className={form.bountyETH === v ? "border-indigo-500 text-indigo-500" : ""}>
                  {v} ETH
                </Button>
              ))}
            </div>
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <p className="text-sm text-amber-500">💡 Bounty funds will be held in escrow until you approve the completed work.</p>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button onClick={() => setStep(3)} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
                Review <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Step 3: Review */}
      {step === 3 && (
        <Card>
          <CardHeader>
            <CardTitle>Review & Post</CardTitle>
          </CardHeader>
          <CardContent className="space-y-6">
            <div className="space-y-4 rounded-lg border p-4">
              <div>
                <span className="text-xs text-muted-foreground">Title</span>
                <p className="font-semibold">{form.title || "Untitled"}</p>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Description</span>
                <p className="text-sm">{form.description || "No description"}</p>
              </div>
              <div className="flex gap-4">
                <div>
                  <span className="text-xs text-muted-foreground">Category</span>
                  <p className="text-sm">{CATEGORIES.find((c) => c.value === form.category)?.label || "None"}</p>
                </div>
                <div>
                  <span className="text-xs text-muted-foreground">Deadline</span>
                  <p className="text-sm">{form.deadline || "None"}</p>
                </div>
              </div>
              <div>
                <span className="text-xs text-muted-foreground">Bounty</span>
                <p className="text-2xl font-bold text-emerald-500 font-mono">{form.bountyETH || "0"} ETH</p>
                <p className="text-sm text-muted-foreground">≈ ${parseInt(bountyUSD).toLocaleString()} USD</p>
              </div>
            </div>
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(2)} className="gap-2">
                <ArrowLeft className="h-4 w-4" /> Back
              </Button>
              <Button className="bg-emerald-600 hover:bg-emerald-700 text-white gap-2">
                <Wallet className="h-4 w-4" /> Fund & Post Task
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
