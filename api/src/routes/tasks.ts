import { Router, Request, Response } from "express";
import {
  taskRegistry,
  formatTask,
} from "../services/contracts";
import { ApiError } from "../middleware/errorHandler";

const router = Router();

// GET /tasks — list tasks with optional status filter
router.get("/", async (req: Request, res: Response) => {
  const statusFilter = req.query.status as string | undefined;
  const nextId = Number(await taskRegistry.nextTaskId());
  const tasks = [];
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  for (let i = 0; i < nextId; i++) {
    try {
      const exists = await taskRegistry.taskExists(i);
      if (!exists) continue;
      const task = await taskRegistry.getTask(i);
      const formatted = formatTask(task);
      if (!statusFilter || formatted.state === statusFilter) {
        tasks.push(formatted);
      }
    } catch (err) {
      console.warn(`Failed to fetch task ${i}:`, (err as Error).message?.slice(0, 80));
    }
    // Throttle RPC calls to avoid rate limiting on free endpoints
    if (i < nextId - 1) await sleep(100);
  }

  res.json({ total: tasks.length, tasks });
});

// GET /tasks/:id — get task details
router.get("/:id", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) throw new ApiError(400, "Invalid task ID");

  const exists = await taskRegistry.taskExists(id);
  if (!exists) throw new ApiError(404, "Task not found");

  const task = await taskRegistry.getTask(id);
  res.json(formatTask(task));
});

// POST write endpoints removed — C-2 remediation
// Task creation, claiming, and submission now handled via frontend (wagmi) directly on-chain

export default router;
