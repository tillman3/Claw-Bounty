import { Router, Request, Response } from "express";
import { config } from "../config";
import { provider } from "../services/contracts";

const router = Router();

router.get("/health", async (_req: Request, res: Response) => {
  let blockNumber = null;
  let rpcOk = false;
  try {
    blockNumber = await provider.getBlockNumber();
    rpcOk = true;
  } catch { /* ignore */ }

  res.json({
    status: rpcOk ? "ok" : "degraded",
    timestamp: new Date().toISOString(),
    rpc: { url: config.rpcUrl, connected: rpcOk, blockNumber },
  });
});

router.get("/contracts", (_req: Request, res: Response) => {
  res.json(config.contracts);
});

export default router;
