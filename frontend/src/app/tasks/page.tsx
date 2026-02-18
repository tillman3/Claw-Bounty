"use client";

import { useState, useEffect, useMemo } from "react";
import { TaskCard } from "@/components/task-card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { fetchTasks } from "@/lib/api";
import { CATEGORIES, type TaskStatus, type Task } from "@/lib/mock-data";
import { Search, Plus, Loader2 } from "lucide-react";
import Link from "next/link";

const statusFilters: { value: TaskStatus | "all"; label: string }[] = [
  { value: "all", label: "All" },
  { value: "open", label: "Open" },
  { value: "in_progress", label: "In Progress" },
  { value: "completed", label: "Completed" },
  { value: "validating", label: "Validating" },
];

export default function TasksPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TaskStatus | "all">("all");
  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const { tasks: data } = await fetchTasks();
        setTasks(data);
      } catch (e: any) {
        setError(e.message);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const filtered = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter !== "all" && t.status !== statusFilter) return false;
      if (categoryFilter !== "all" && t.category !== categoryFilter) return false;
      if (search && !t.title.toLowerCase().includes(search.toLowerCase()) && !t.description.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });
  }, [tasks, search, statusFilter, categoryFilter]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 mb-8">
        <div>
          <h1 className="text-3xl font-bold">Task Board</h1>
          <p className="text-muted-foreground mt-1">Browse open bounties and find work</p>
        </div>
        <Link href="/tasks/new">
          <Button className="bg-indigo-600 hover:bg-indigo-700 text-white gap-2">
            <Plus className="h-4 w-4" />
            Post a Task
          </Button>
        </Link>
      </div>

      {/* Search & Filters */}
      <div className="space-y-4 mb-8">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-10"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          {statusFilters.map((s) => (
            <Badge
              key={s.value}
              variant={statusFilter === s.value ? "default" : "outline"}
              className={`cursor-pointer transition-colors ${statusFilter === s.value ? "bg-indigo-600 text-white hover:bg-indigo-700" : "hover:bg-muted"}`}
              onClick={() => setStatusFilter(s.value)}
            >
              {s.label}
            </Badge>
          ))}
          <div className="w-px bg-border mx-1" />
          <Badge
            variant={categoryFilter === "all" ? "default" : "outline"}
            className={`cursor-pointer transition-colors ${categoryFilter === "all" ? "bg-indigo-600 text-white hover:bg-indigo-700" : "hover:bg-muted"}`}
            onClick={() => setCategoryFilter("all")}
          >
            All Categories
          </Badge>
          {CATEGORIES.map((c) => (
            <Badge
              key={c.value}
              variant={categoryFilter === c.value ? "default" : "outline"}
              className={`cursor-pointer transition-colors ${categoryFilter === c.value ? "bg-indigo-600 text-white hover:bg-indigo-700" : "hover:bg-muted"}`}
              onClick={() => setCategoryFilter(c.value)}
            >
              {c.icon} {c.label}
            </Badge>
          ))}
        </div>
      </div>

      {/* Results */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-center py-20 text-red-400">
          <p className="text-lg">Error loading tasks</p>
          <p className="text-sm mt-1">{error}</p>
        </div>
      ) : (
        <>
          <div className="text-sm text-muted-foreground mb-4">{filtered.length} tasks found</div>
          {filtered.length === 0 ? (
            <div className="text-center py-20 text-muted-foreground">
              <p className="text-lg">No tasks match your filters</p>
              <p className="text-sm mt-1">Try adjusting your search or filters</p>
            </div>
          ) : (
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {filtered.map((task) => (
                <TaskCard key={task.id} task={task} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
