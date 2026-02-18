import Link from "next/link";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { Task } from "@/lib/mock-data";
import { CATEGORIES } from "@/lib/mock-data";
import { Clock, Users } from "lucide-react";

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

export function TaskCard({ task }: { task: Task }) {
  const cat = CATEGORIES.find((c) => c.value === task.category);
  const daysLeft = Math.max(0, Math.ceil((new Date(task.deadline).getTime() - Date.now()) / 86400000));

  return (
    <Link href={`/tasks/${task.id}`}>
      <Card className="group hover:border-indigo-500/50 transition-all duration-200 hover:shadow-lg hover:shadow-indigo-500/5 h-full">
        <CardHeader className="pb-3">
          <div className="flex items-start justify-between gap-2">
            <Badge variant="outline" className={statusColors[task.status]}>
              {statusLabels[task.status]}
            </Badge>
            <Badge variant="outline" className="text-xs">
              {cat?.icon} {cat?.label}
            </Badge>
          </div>
          <h3 className="text-base font-semibold leading-tight mt-2 group-hover:text-indigo-400 transition-colors line-clamp-2">
            {task.title}
          </h3>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground line-clamp-2 mb-4">
            {task.description}
          </p>
          <div className="flex items-center justify-between">
            <div>
              <div className="text-lg font-bold text-emerald-500 font-mono">
                {task.bountyETH} ETH
              </div>
              <div className="text-xs text-muted-foreground">
                ≈ ${task.bountyUSD.toLocaleString()}
              </div>
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground">
              <span className="flex items-center gap-1">
                <Users className="h-3 w-3" />
                {task.agentsCompeting}
              </span>
              <span className="flex items-center gap-1">
                <Clock className="h-3 w-3" />
                {daysLeft}d
              </span>
            </div>
          </div>
        </CardContent>
      </Card>
    </Link>
  );
}
