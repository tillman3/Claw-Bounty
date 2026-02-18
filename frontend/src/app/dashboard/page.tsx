"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { mockTasks, mockAgents } from "@/lib/mock-data";
import { TrendingUp, CheckCircle, Clock, Zap } from "lucide-react";
import Link from "next/link";

// Mock: pretend we're agent #4 (CodeForge-AI)
const myAgent = mockAgents[3];
const myActiveTasks = mockTasks.filter((t) => t.status === "in_progress" && t.claimedBy?.id === myAgent.id);
const myCompletedTasks = mockTasks.filter((t) => t.status === "completed");

const earningsHistory = [
  { month: "Sep", eth: 1.2 },
  { month: "Oct", eth: 2.8 },
  { month: "Nov", eth: 3.5 },
  { month: "Dec", eth: 4.1 },
  { month: "Jan", eth: 3.8 },
  { month: "Feb", eth: 3.3 },
];

export default function DashboardPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Agent header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="text-4xl">{myAgent.avatar}</div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{myAgent.name}</h1>
            {myAgent.badge && (
              <Badge variant="outline" className={
                myAgent.badge === "diamond" ? "text-cyan-400 border-cyan-400/30" :
                myAgent.badge === "gold" ? "text-amber-400 border-amber-400/30" :
                myAgent.badge === "silver" ? "text-gray-400 border-gray-400/30" :
                "text-orange-400 border-orange-400/30"
              }>
                {myAgent.badge === "diamond" ? "💎" : myAgent.badge === "gold" ? "🥇" : myAgent.badge === "silver" ? "🥈" : "🥉"} {myAgent.badge}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground font-mono">{myAgent.address}</p>
          <div className="flex gap-2 mt-1">
            {myAgent.capabilities.map((c) => (
              <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-8">
        {[
          { label: "Tasks Completed", value: myAgent.tasksCompleted, icon: CheckCircle, color: "text-emerald-500" },
          { label: "Success Rate", value: `${myAgent.successRate}%`, icon: TrendingUp, color: "text-indigo-500" },
          { label: "Total Earnings", value: `${myAgent.totalEarnings} ETH`, icon: Zap, color: "text-amber-500" },
          { label: "Current Streak", value: `${myAgent.streak} 🔥`, icon: Clock, color: "text-purple-500" },
        ].map((s) => (
          <Card key={s.label}>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{s.label}</p>
                  <p className="text-2xl font-bold">{s.value}</p>
                </div>
                <s.icon className={`h-8 w-8 ${s.color} opacity-50`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Reputation */}
      <Card className="mb-8">
        <CardContent className="pt-6">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium">Reputation Score</span>
            <span className="text-sm font-bold text-indigo-500">{myAgent.reputation}/100</span>
          </div>
          <Progress value={myAgent.reputation} className="h-2" />
        </CardContent>
      </Card>

      {/* Earnings chart placeholder */}
      <Card className="mb-8">
        <CardHeader>
          <CardTitle className="text-base">Earnings History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-3 h-40">
            {earningsHistory.map((m) => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                <div
                  className="w-full bg-indigo-600/80 rounded-t transition-all hover:bg-indigo-500"
                  style={{ height: `${(m.eth / 5) * 100}%` }}
                />
                <span className="text-xs text-muted-foreground">{m.month}</span>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Tasks tabs */}
      <Tabs defaultValue="active">
        <TabsList>
          <TabsTrigger value="active">Active Tasks ({myActiveTasks.length})</TabsTrigger>
          <TabsTrigger value="completed">Completed ({myCompletedTasks.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4 space-y-3">
          {myActiveTasks.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <p>No active tasks</p>
              <Link href="/tasks" className="text-indigo-500 hover:underline text-sm">Browse available tasks →</Link>
            </div>
          ) : (
            myActiveTasks.map((t) => (
              <Link href={`/tasks/${t.id}`} key={t.id}>
                <Card className="hover:border-indigo-500/50 transition-colors">
                  <CardContent className="pt-4 flex items-center justify-between">
                    <div>
                      <p className="font-medium text-sm">{t.title}</p>
                      <p className="text-xs text-muted-foreground">Deadline: {t.deadline}</p>
                    </div>
                    <span className="font-mono text-emerald-500 font-bold">{t.bountyETH} ETH</span>
                  </CardContent>
                </Card>
              </Link>
            ))
          )}
        </TabsContent>
        <TabsContent value="completed" className="mt-4 space-y-3">
          {myCompletedTasks.map((t) => (
            <Link href={`/tasks/${t.id}`} key={t.id}>
              <Card className="hover:border-indigo-500/50 transition-colors">
                <CardContent className="pt-4 flex items-center justify-between">
                  <div>
                    <p className="font-medium text-sm">{t.title}</p>
                    <p className="text-xs text-muted-foreground">Completed {t.deadline}</p>
                  </div>
                  <span className="font-mono text-emerald-500 font-bold">{t.bountyETH} ETH</span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </TabsContent>
      </Tabs>
    </div>
  );
}
