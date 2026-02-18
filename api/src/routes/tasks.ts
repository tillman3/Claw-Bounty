import { Router, Request, Response } from "express";
import { ethers } from "ethers";
import {
  abbCore,
  taskRegistry,
  getWritableContract,
  getSigner,
  getDefaultSigner,
  formatTask,
  taskStateToString,
} from "../services/contracts";
import { requireFields, requirePrivateKey } from "../middleware/validate";
import { ApiError } from "../middleware/errorHandler";

const router = Router();

// POST /tasks — create a task with ETH bounty
router.post(
  "/",
  requireFields({ name: "descriptionHash", type: "bytes32" }, { name: "deadline", type: "number" }),
  requirePrivateKey,
  async (req: Request, res: Response) => {
    const { descriptionHash, deadline, value, privateKey } = req.body;
    if (!value) throw new ApiError(400, "Missing 'value' (ETH amount in ether, e.g. \"0.5\")");

    const signer = privateKey ? getSigner(privateKey) : getDefaultSigner();
    if (!signer) throw new ApiError(500, "No signer available");

    const writable = getWritableContract(abbCore, signer);
    const tx = await writable.createTaskETH(descriptionHash, deadline, {
      value: ethers.parseEther(value.toString()),
    });
    const receipt = await tx.wait();

    // Parse TaskCreatedAndFunded event
    const log = receipt.logs.find((l: any) => {
      try { abbCore.interface.parseLog({ topics: l.topics as string[], data: l.data }); return true; } catch { return false; }
    });
    const parsed = log ? abbCore.interface.parseLog({ topics: log.topics as string[], data: log.data }) : null;

    res.status(201).json({
      txHash: receipt.hash,
      taskId: parsed ? Number(parsed.args.taskId) : null,
    });
  },
);

// GET /tasks — list tasks with optional status filter
router.get("/", async (req: Request, res: Response) => {
  const statusFilter = req.query.status as string | undefined;
  const nextId = Number(await taskRegistry.nextTaskId());
  const tasks = [];

  for (let i = 0; i < nextId; i++) {
    try {
      const exists = await taskRegistry.taskExists(i);
      if (!exists) continue;
      const task = await taskRegistry.getTask(i);
      const formatted = formatTask(task);
      if (!statusFilter || formatted.state === statusFilter) {
        tasks.push(formatted);
      }
    } catch {
      // skip
    }
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

// POST /tasks/:id/submit — agent submits work
router.post(
  "/:id/submit",
  requireFields({ name: "submissionHash", type: "bytes32" }),
  requirePrivateKey,
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, "Invalid task ID");

    const { submissionHash, privateKey } = req.body;
    const signer = privateKey ? getSigner(privateKey) : getDefaultSigner();
    if (!signer) throw new ApiError(500, "No signer available");

    const writable = getWritableContract(abbCore, signer);
    const tx = await writable.submitWork(id, submissionHash);
    const receipt = await tx.wait();

    res.json({ txHash: receipt.hash, taskId: id });
  },
);

// POST /tasks/:id/claim — agent claims a task
router.post(
  "/:id/claim",
  requireFields({ name: "agentId", type: "number" }),
  requirePrivateKey,
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, "Invalid task ID");

    const { agentId, privateKey } = req.body;
    const signer = privateKey ? getSigner(privateKey) : getDefaultSigner();
    if (!signer) throw new ApiError(500, "No signer available");

    const writable = getWritableContract(abbCore, signer);
    const tx = await writable.claimTask(id, agentId);
    const receipt = await tx.wait();

    res.json({ txHash: receipt.hash, taskId: id, agentId });
  },
);

export default router;
