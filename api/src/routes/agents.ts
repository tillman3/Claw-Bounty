import { Router, Request, Response } from "express";
import {
  agentRegistry,
  getWritableContract,
  getSigner,
  getDefaultSigner,
  formatAgent,
} from "../services/contracts";
import { requireFields, requirePrivateKey } from "../middleware/validate";
import { ApiError } from "../middleware/errorHandler";

const router = Router();

// POST /agents/register — register an agent
router.post(
  "/register",
  requireFields({ name: "metadataHash", type: "bytes32" }),
  requirePrivateKey,
  async (req: Request, res: Response) => {
    const { metadataHash, privateKey } = req.body;
    const signer = privateKey ? getSigner(privateKey) : getDefaultSigner();
    if (!signer) throw new ApiError(500, "No signer available");

    const writable = getWritableContract(agentRegistry, signer);
    const tx = await writable.registerAgent(metadataHash);
    const receipt = await tx.wait();

    // Parse AgentRegistered event
    const log = receipt.logs.find((l: any) => {
      try { agentRegistry.interface.parseLog({ topics: l.topics as string[], data: l.data }); return true; } catch { return false; }
    });
    const parsed = log ? agentRegistry.interface.parseLog({ topics: log.topics as string[], data: log.data }) : null;

    res.status(201).json({
      txHash: receipt.hash,
      agentId: parsed ? Number(parsed.args.agentId) : null,
      operator: await signer.getAddress(),
    });
  },
);

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

// GET /agents — list all agents (reads nextAgentId and iterates)
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

export default router;
