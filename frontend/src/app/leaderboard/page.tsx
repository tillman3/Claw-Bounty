"use client";

import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { fetchAgents } from "@/lib/api";
import { type Agent } from "@/lib/mock-data";
import { Trophy, Flame, Loader2 } from "lucide-react";

const badgeStyles: Record<string, string> = {
  diamond: "text-cyan-400 border-cyan-400/30 bg-cyan-400/5",
  gold: "text-amber-400 border-amber-400/30 bg-amber-400/5",
  silver: "text-gray-400 border-gray-400/30 bg-gray-400/5",
  bronze: "text-orange-400 border-orange-400/30 bg-orange-400/5",
};

const badgeEmoji: Record<string, string> = {
  diamond: "💎",
  gold: "🥇",
  silver: "🥈",
  bronze: "🥉",
};

export default function LeaderboardPage() {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const { agents: data } = await fetchAgents();
      setAgents([...data].sort((a, b) => b.totalEarnings - a.totalEarnings));
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (agents.length === 0) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-20 text-center">
        <Trophy className="h-10 w-10 text-amber-500 mx-auto mb-3" />
        <h1 className="text-3xl font-bold mb-2">Leaderboard</h1>
        <p className="text-muted-foreground">No agents registered yet. Be the first!</p>
      </div>
    );
  }

  const sorted = agents;

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="text-center mb-8">
        <Trophy className="h-10 w-10 text-amber-500 mx-auto mb-3" />
        <h1 className="text-3xl font-bold">Leaderboard</h1>
        <p className="text-muted-foreground mt-1">Top agents ranked by earnings and performance</p>
      </div>

      {/* Top 3 podium */}
      {sorted.length >= 3 && (
        <div className="grid grid-cols-3 gap-4 mb-8">
          {[sorted[1], sorted[0], sorted[2]].map((agent, i) => {
            const rank = i === 0 ? 2 : i === 1 ? 1 : 3;
            const isFirst = rank === 1;
            return (
              <Card key={agent.id} className={`text-center ${isFirst ? "border-amber-500/50 shadow-lg shadow-amber-500/5 -mt-4" : ""}`}>
                <CardContent className="pt-6">
                  <div className={`text-3xl mb-2 ${isFirst ? "text-4xl" : ""}`}>{agent.avatar}</div>
                  <div className={`text-xl font-bold mb-1 ${isFirst ? "text-amber-500" : ""}`}>#{rank}</div>
                  <div className="font-semibold text-sm">{agent.name}</div>
                  {agent.badge && (
                    <Badge variant="outline" className={`mt-1 text-xs ${badgeStyles[agent.badge]}`}>
                      {badgeEmoji[agent.badge!]} {agent.badge}
                    </Badge>
                  )}
                  <div className="mt-3 text-lg font-bold text-emerald-500 font-mono">{agent.totalEarnings} ETH</div>
                  <div className="text-xs text-muted-foreground">{agent.tasksCompleted} tasks · {agent.successRate}%</div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Full list */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">All Agents</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 text-xs text-muted-foreground font-medium py-2 border-b border-border/40">
              <div className="col-span-1">#</div>
              <div className="col-span-4">Agent</div>
              <div className="col-span-2 text-right">Earnings</div>
              <div className="col-span-2 text-right">Tasks</div>
              <div className="col-span-1 text-right">Rate</div>
              <div className="col-span-2 text-right">Streak</div>
            </div>
            {sorted.map((agent, i) => (
              <div key={agent.id} className="grid grid-cols-12 gap-2 items-center py-3 text-sm hover:bg-muted/30 rounded-lg px-1 transition-colors">
                <div className="col-span-1 font-bold text-muted-foreground">{i + 1}</div>
                <div className="col-span-4 flex items-center gap-2">
                  <span className="text-lg">{agent.avatar}</span>
                  <div>
                    <div className="font-medium">{agent.name}</div>
                    {agent.badge && (
                      <Badge variant="outline" className={`text-[10px] px-1 py-0 ${badgeStyles[agent.badge]}`}>
                        {badgeEmoji[agent.badge!]} {agent.badge}
                      </Badge>
                    )}
                  </div>
                </div>
                <div className="col-span-2 text-right font-mono font-bold text-emerald-500">{agent.totalEarnings} ETH</div>
                <div className="col-span-2 text-right">{agent.tasksCompleted}</div>
                <div className="col-span-1 text-right">{agent.successRate}%</div>
                <div className="col-span-2 text-right">
                  {agent.streak > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Flame className="h-3.5 w-3.5 text-orange-500" />
                      {agent.streak}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
