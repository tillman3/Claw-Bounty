"use client";

import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { fetchAgentsByAddress, fetchTasks } from "@/lib/api";
import { mockTasks, mockAgents, type Agent, type Task } from "@/lib/mock-data";
import { TrendingUp, CheckCircle, Clock, Zap, Wallet, Loader2 } from "lucide-react";
import Link from "next/link";

export default function DashboardPage() {
  const { address, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [agent, setAgent] = useState<Agent | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [demo, setDemo] = useState(false);

  useEffect(() => {
    (async () => {
      if (isConnected && address) {
        const [agentsRes, tasksRes] = await Promise.all([
          fetchAgentsByAddress(address),
          fetchTasks(),
        ]);
        setDemo(agentsRes.demo);
        if (agentsRes.agents.length > 0) {
          setAgent(agentsRes.agents[0]);
        }
        setTasks(tasksRes.tasks);
      } else {
        // Show mock data in demo mode
        setDemo(true);
        setAgent(mockAgents[3]);
        setTasks(mockTasks);
      }
      setLoading(false);
    })();
  }, [address, isConnected]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!isConnected) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <Wallet className="h-12 w-12 text-indigo-500 mx-auto mb-4" />
        <h1 className="text-2xl font-bold mb-2">Connect Your Wallet</h1>
        <p className="text-muted-foreground mb-6">Connect your wallet to view your agent dashboard and task history.</p>
        <Button onClick={openConnectModal} className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
          <Wallet className="h-4 w-4" /> Connect Wallet
        </Button>
        <p className="text-xs text-muted-foreground mt-4">Showing demo data below</p>
      </div>
    );
  }

  if (!agent) {
    return (
      <div className="mx-auto max-w-xl px-4 py-20 text-center">
        <h1 className="text-2xl font-bold mb-2">No Agent Found</h1>
        <p className="text-muted-foreground mb-6">No agent is registered for wallet {address?.slice(0, 6)}...{address?.slice(-4)}.</p>
        <Link href="/register">
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
            Register Your Agent
          </Button>
        </Link>
      </div>
    );
  }

  const myActiveTasks = tasks.filter((t) => t.status === "in_progress");
  const myCompletedTasks = tasks.filter((t) => t.status === "completed");

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      {/* Agent header */}
      <div className="flex items-center gap-4 mb-8">
        <div className="text-4xl">{agent.avatar}</div>
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{agent.name}</h1>
            {agent.badge && (
              <Badge variant="outline" className={
                agent.badge === "diamond" ? "text-cyan-400 border-cyan-400/30" :
                agent.badge === "gold" ? "text-amber-400 border-amber-400/30" :
                agent.badge === "silver" ? "text-gray-400 border-gray-400/30" :
                "text-orange-400 border-orange-400/30"
              }>
                {agent.badge === "diamond" ? "💎" : agent.badge === "gold" ? "🥇" : agent.badge === "silver" ? "🥈" : "🥉"} {agent.badge}
              </Badge>
            )}
          </div>
          <p className="text-sm text-muted-foreground font-mono">{agent.address}</p>
          <div className="flex gap-2 mt-1">
            {agent.capabilities.map((c) => (
              <Badge key={c} variant="outline" className="text-xs">{c}</Badge>
            ))}
          </div>
        </div>
      </div>

      {/* Stats cards */}
      <div className="grid gap-4 md:grid-cols-4 mb-8">
        {[
          { label: "Tasks Completed", value: agent.tasksCompleted, icon: CheckCircle, color: "text-emerald-500" },
          { label: "Success Rate", value: `${agent.successRate}%`, icon: TrendingUp, color: "text-indigo-500" },
          { label: "Total Earnings", value: `${agent.totalEarnings} ETH`, icon: Zap, color: "text-amber-500" },
          { label: "Current Streak", value: `${agent.streak} 🔥`, icon: Clock, color: "text-purple-500" },
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
            <span className="text-sm font-bold text-indigo-500">{agent.reputation}/100</span>
          </div>
          <Progress value={agent.reputation} className="h-2" />
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
          {myCompletedTasks.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground">
              <p>No completed tasks yet</p>
            </div>
          ) : (
            myCompletedTasks.map((t) => (
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
            ))
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
