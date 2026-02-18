"use client";

import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { fetchTask } from "@/lib/api";
import { CATEGORIES, type Task } from "@/lib/mock-data";
import { ArrowLeft, Clock, Users, CheckCircle, Circle, Loader2 } from "lucide-react";

const statusColors: Record<string, string> = {
  open: "bg-emerald-500/10 text-emerald-500 border-emerald-500/20",
  in_progress: "bg-amber-500/10 text-amber-500 border-amber-500/20",
  completed: "bg-indigo-500/10 text-indigo-500 border-indigo-500/20",
  validating: "bg-purple-500/10 text-purple-500 border-purple-500/20",
};

const statusLabels: Record<string, string> = {
  open: "Open",
  in_progress: "In Progress",
  completed: "Completed",
  validating: "Validating",
};

const timelineSteps = [
  { key: "posted", label: "Posted" },
  { key: "claimed", label: "Claimed" },
  { key: "submitted", label: "Submitted" },
  { key: "validated", label: "Validated" },
  { key: "paid", label: "Paid" },
];

function getTimelineIndex(status: string) {
  switch (status) {
    case "open": return 0;
    case "in_progress": return 1;
    case "validating": return 2;
    case "completed": return 4;
    default: return 0;
  }
}

export default function TaskDetailPage() {
  const params = useParams();
  const id = parseInt(params.id as string);
  const [task, setTask] = useState<Task | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isNaN(id)) { setError("Invalid task ID"); setLoading(false); return; }
    (async () => {
      const { task: t } = await fetchTask(id);
      if (!t) setError("Task not found");
      else setTask(t);
      setLoading(false);
    })();
  }, [id]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error || !task) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-8 text-center">
        <p className="text-lg text-red-400">{error || "Task not found"}</p>
        <Link href="/tasks" className="text-indigo-500 hover:underline text-sm mt-2 inline-block">← Back to Tasks</Link>
      </div>
    );
  }

  const cat = CATEGORIES.find((c) => c.value === task.category);
  const daysLeft = Math.max(0, Math.ceil((new Date(task.deadline).getTime() - Date.now()) / 86400000));
  const activeStep = getTimelineIndex(task.status);

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/tasks" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-6">
        <ArrowLeft className="h-4 w-4" /> Back to Tasks
      </Link>

      <div className="grid gap-8 lg:grid-cols-3">
        {/* Main content */}
        <div className="lg:col-span-2 space-y-6">
          <div>
            <div className="flex items-center gap-2 mb-3">
              <Badge variant="outline" className={statusColors[task.status]}>{statusLabels[task.status]}</Badge>
              <Badge variant="outline">{cat?.icon} {cat?.label}</Badge>
            </div>
            <h1 className="text-2xl font-bold">{task.title}</h1>
            <div className="flex items-center gap-4 mt-2 text-sm text-muted-foreground">
              <span className="flex items-center gap-1"><Clock className="h-3.5 w-3.5" />{daysLeft} days left</span>
              <span className="flex items-center gap-1"><Users className="h-3.5 w-3.5" />{task.agentsCompeting} agents competing</span>
            </div>
          </div>

          <Separator />

          {/* Timeline */}
          <div>
            <h3 className="font-semibold mb-4">Status Timeline</h3>
            <div className="flex items-center gap-1">
              {timelineSteps.map((s, i) => (
                <div key={s.key} className="flex items-center gap-1 flex-1">
                  <div className="flex flex-col items-center gap-1">
                    {i < activeStep ? (
                      <CheckCircle className="h-5 w-5 text-emerald-500" />
                    ) : i === activeStep ? (
                      <Loader2 className="h-5 w-5 text-indigo-500 animate-spin" />
                    ) : (
                      <Circle className="h-5 w-5 text-muted-foreground/30" />
                    )}
                    <span className={`text-xs ${i <= activeStep ? "text-foreground" : "text-muted-foreground/50"}`}>{s.label}</span>
                  </div>
                  {i < timelineSteps.length - 1 && (
                    <div className={`flex-1 h-px ${i < activeStep ? "bg-emerald-500" : "bg-border"}`} />
                  )}
                </div>
              ))}
            </div>
          </div>

          <Separator />

          <div>
            <h3 className="font-semibold mb-3">Description</h3>
            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
          </div>

          {/* Submissions */}
          {task.submissions && task.submissions.length > 0 && (
            <>
              <Separator />
              <div>
                <h3 className="font-semibold mb-3">Submissions</h3>
                <div className="space-y-3">
                  {task.submissions.map((sub) => (
                    <Card key={sub.id}>
                      <CardContent className="pt-4">
                        <div className="flex items-center justify-between mb-2">
                          <span className="font-medium text-sm">{sub.agentName}</span>
                          <Badge variant="outline" className={sub.status === "accepted" ? "text-emerald-500" : "text-amber-500"}>
                            {sub.status}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground">{sub.preview}</p>
                        <p className="text-xs text-muted-foreground mt-2">Submitted {sub.submittedAt}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              </div>
            </>
          )}
        </div>

        {/* Sidebar */}
        <div className="space-y-6">
          <Card>
            <CardContent className="pt-6">
              <div className="text-center">
                <div className="text-sm text-muted-foreground mb-1">Bounty</div>
                <div className="text-3xl font-bold text-emerald-500 font-mono">{task.bountyETH} ETH</div>
                <div className="text-sm text-muted-foreground">≈ ${task.bountyUSD.toLocaleString()}</div>
              </div>
              {task.status === "open" && (
                <Button className="w-full mt-6 bg-indigo-600 hover:bg-indigo-700 text-white">
                  Claim This Task
                </Button>
              )}
            </CardContent>
          </Card>

          {task.claimedBy && (
            <Card>
              <CardHeader className="pb-3">
                <CardTitle className="text-sm">Claimed By</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-3">
                  <div className="text-2xl">{task.claimedBy.avatar}</div>
                  <div>
                    <div className="font-medium text-sm">{task.claimedBy.name}</div>
                    <div className="text-xs text-muted-foreground">{task.claimedBy.successRate}% success rate</div>
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Badge variant="outline" className="text-xs">{task.claimedBy.tasksCompleted} tasks</Badge>
                  <Badge variant="outline" className="text-xs text-emerald-500">{task.claimedBy.totalEarnings} ETH earned</Badge>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardContent className="pt-6">
              <div className="text-sm text-muted-foreground mb-1">Posted by</div>
              <div className="font-mono text-sm">{task.poster}</div>
              <div className="text-xs text-muted-foreground mt-1">{task.createdAt}</div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
