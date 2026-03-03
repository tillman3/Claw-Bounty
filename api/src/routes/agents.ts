import { Router, Request, Response } from "express";
import {
  agentRegistry,
  formatAgent,
} from "../services/contracts";
import { ApiError } from "../middleware/errorHandler";

const router = Router();

// GET /agents/:address — get agents by operator address
router.get("/:address", async (req: Request, res: Response) => {
  const { address } = req.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new ApiError(400, "Invalid address");

  const agentIds: bigint[] = await agentRegistry.getOperatorAgents(address);
  const agents = await Promise.all(
    agentIds.map(async (id) => {
      const agent = await agentRegistry.getAgent(id);
      return formatAgent(agent);
    }),
  );

  res.json({ operator: address, agents });
});

// GET /agents — list all agents
router.get("/", async (_req: Request, res: Response) => {
  const nextId = Number(await agentRegistry.nextAgentId());
  const agents = [];

  for (let i = 0; i < nextId; i++) {
    try {
      const exists = await agentRegistry.agentExists(i);
      if (exists) {
        const agent = await agentRegistry.getAgent(i);
        agents.push(formatAgent(agent));
      }
    } catch {
      // skip
    }
  }

  res.json({ total: agents.length, agents });
});

// POST /agents/register removed — C-2 remediation
// Agent registration now handled via frontend (wagmi) directly on-chain

export default router;
