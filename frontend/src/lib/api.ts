/**
 * Centralized API client for AgentEcon REST API.
 * Falls back to mock data when the API is unreachable.
 */

import {
  mockTasks,
  mockAgents,
  platformStats,
  type Task,
  type Agent,
} from "./mock-data";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// ---------- low-level helpers ----------

let _demoMode: boolean | null = null;
const _demoListeners = new Set<(v: boolean) => void>();

export function onDemoModeChange(cb: (v: boolean) => void) {
  _demoListeners.add(cb);
  return () => { _demoListeners.delete(cb); };
}

function setDemoMode(v: boolean) {
  if (_demoMode !== v) {
    _demoMode = v;
    _demoListeners.forEach((cb) => cb(v));
  }
}

export function isDemoMode() {
  return _demoMode === true;
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`API ${res.status}: ${body}`);
  }
  setDemoMode(false);
  return res.json() as Promise<T>;
}

// ---------- API response types (from REST API) ----------

export interface ApiTask {
  id: number;
  poster: string;
  descriptionHash: string;
  bountyAmount: string;      // ETH string
  bountyAmountWei: string;
  paymentToken: string;
  deadline: number;           // unix timestamp
  state: string;
  stateNum: number;
  assignedAgent: number;
  submissionHash: string;
  createdAt: number;
  claimedAt: number;
  submittedAt: number;
}

export interface ApiAgent {
  id: number;
  operator: string;
  metadataHash: string;
  reputationScore: number;
  tasksCompleted: number;
  tasksFailed: number;
  totalEarned: string;        // ETH string
  registeredAt: number;
  active: boolean;
}

export interface HealthResponse {
  status: string;
  timestamp: string;
  rpc: { url: string; connected: boolean; blockNumber: number | null };
}

export interface ContractsResponse {
  abbCore: string;
  agentRegistry: string;
  taskRegistry: string;
  validatorPool: string;
  bountyEscrow: string;
}

// ---------- mappers (API shape → frontend shape) ----------

const stateToStatus: Record<string, Task["status"]> = {
  open: "open",
  claimed: "in_progress",
  submitted: "validating",
  in_review: "validating",
  completed: "completed",
  disputed: "validating",
  resolved: "completed",
  cancelled: "completed",
};

function apiTaskToTask(t: ApiTask): Task {
  const bountyETH = parseFloat(t.bountyAmount) || 0;
  return {
    id: t.id,
    title: `Task #${t.id}`,
    description: `On-chain task (hash: ${t.descriptionHash.slice(0, 18)}…)`,
    category: "other",
    status: stateToStatus[t.state] ?? "open",
    bountyETH,
    bountyUSD: Math.round(bountyETH * 2500),
    deadline: new Date(t.deadline * 1000).toISOString().slice(0, 10),
    createdAt: new Date(t.createdAt * 1000).toISOString().slice(0, 10),
    poster: t.poster,
    agentsCompeting: t.assignedAgent > 0 ? 1 : 0,
  };
}

const badgeTiers: Array<Agent["badge"]> = [undefined, "bronze", "silver", "gold", "diamond"];

function apiAgentToAgent(a: ApiAgent): Agent {
  const earned = parseFloat(a.totalEarned) || 0;
  const total = a.tasksCompleted + a.tasksFailed;
  const rate = total > 0 ? Math.round((a.tasksCompleted / total) * 100) : 100;
  const badgeIdx = a.reputationScore >= 95 ? 4 : a.reputationScore >= 85 ? 3 : a.reputationScore >= 70 ? 2 : a.reputationScore >= 50 ? 1 : 0;
  return {
    id: a.id,
    name: `Agent #${a.id}`,
    address: a.operator,
    avatar: "🤖",
    tasksCompleted: a.tasksCompleted,
    successRate: rate,
    totalEarnings: earned,
    reputation: a.reputationScore,
    capabilities: [],
    registeredAt: new Date(a.registeredAt * 1000).toISOString().slice(0, 10),
    streak: 0,
    badge: badgeTiers[badgeIdx],
  };
}

// ---------- public API functions ----------

export async function fetchTasks(status?: string): Promise<{ tasks: Task[]; demo: boolean }> {
  try {
    const qs = status && status !== "all" ? `?status=${status}` : "";
    const data = await apiFetch<{ total: number; tasks: ApiTask[] }>(`/tasks${qs}`);
    return { tasks: data.tasks.map(apiTaskToTask), demo: false };
  } catch {
    setDemoMode(true);
    const filtered = status && status !== "all" ? mockTasks.filter((t) => t.status === status) : mockTasks;
    return { tasks: filtered, demo: true };
  }
}

export async function fetchTask(id: number): Promise<{ task: Task | null; demo: boolean }> {
  try {
    const data = await apiFetch<ApiTask>(`/tasks/${id}`);
    return { task: apiTaskToTask(data), demo: false };
  } catch {
    setDemoMode(true);
    return { task: mockTasks.find((t) => t.id === id) ?? null, demo: true };
  }
}

/** @deprecated Use wagmi useWriteContract with ABBCore.createTaskETH() instead */
export async function createTask(body: {
  descriptionHash: string;
  deadline: number;
  value: string;
}): Promise<{ txHash: string; taskId: number | null }> {
  return apiFetch("/tasks", { method: "POST", body: JSON.stringify(body) });
}

export async function fetchAgents(): Promise<{ agents: Agent[]; demo: boolean }> {
  try {
    const data = await apiFetch<{ total: number; agents: ApiAgent[] }>("/agents");
    return { agents: data.agents.map(apiAgentToAgent), demo: false };
  } catch {
    setDemoMode(true);
    return { agents: mockAgents, demo: true };
  }
}

export async function fetchAgentsByAddress(address: string): Promise<{ agents: Agent[]; demo: boolean }> {
  try {
    const data = await apiFetch<{ operator: string; agents: ApiAgent[] }>(`/agents/${address}`);
    return { agents: data.agents.map(apiAgentToAgent), demo: false };
  } catch {
    setDemoMode(true);
    return { agents: [], demo: true };
  }
}

/** @deprecated Use wagmi useWriteContract with AgentRegistry.registerAgent() instead */
export async function registerAgent(body: {
  metadataHash: string;
}): Promise<{ txHash: string; agentId: number | null; operator: string }> {
  return apiFetch("/agents/register", { method: "POST", body: JSON.stringify(body) });
}

export async function fetchHealth(): Promise<{ health: HealthResponse | null; demo: boolean }> {
  try {
    const data = await apiFetch<HealthResponse>("/health");
    return { health: data, demo: false };
  } catch {
    setDemoMode(true);
    return { health: null, demo: true };
  }
}

export async function fetchContracts(): Promise<{ contracts: ContractsResponse | null; demo: boolean }> {
  try {
    const data = await apiFetch<ContractsResponse>("/contracts");
    return { contracts: data, demo: false };
  } catch {
    setDemoMode(true);
    return { contracts: null, demo: true };
  }
}

export async function fetchPlatformStats(): Promise<{
  stats: typeof platformStats;
  demo: boolean;
}> {
  try {
    const [tasksData, agentsData] = await Promise.all([
      apiFetch<{ total: number; tasks: ApiTask[] }>("/tasks"),
      apiFetch<{ total: number; agents: ApiAgent[] }>("/agents"),
    ]);
    const completed = tasksData.tasks.filter((t) => t.state === "completed").length;
    const active = tasksData.tasks.filter((t) => t.state === "open" || t.state === "claimed").length;
    const totalPaid = tasksData.tasks
      .filter((t) => t.state === "completed")
      .reduce((sum, t) => sum + (parseFloat(t.bountyAmount) || 0), 0);
    return {
      stats: {
        tasksCompleted: completed,
        agentsRegistered: agentsData.total,
        ethPaidOut: Math.round(totalPaid * 100) / 100,
        activeTasksNow: active,
      },
      demo: false,
    };
  } catch {
    setDemoMode(true);
    return { stats: platformStats, demo: true };
  }
}
