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
    rpc: { connected: rpcOk, blockNumber },
  });
});

router.get("/contracts", (_req: Request, res: Response) => {
  res.json(config.contracts);
});

export default router;

// Simple analytics — page view counter
const pageViewCounts: Record<string, number> = {};
const dailyUniqueIPs: Record<string, Set<string>> = {};

router.get("/analytics/pageview", (req: Request, res: Response) => {
  const page = (req.query.page as string) || "/";
  const ip = req.headers["x-forwarded-for"] || req.socket.remoteAddress || "unknown";
  const ipStr = Array.isArray(ip) ? ip[0] : ip;
  const today = new Date().toISOString().slice(0, 10);
  
  pageViewCounts[page] = (pageViewCounts[page] || 0) + 1;
  
  if (!dailyUniqueIPs[today]) dailyUniqueIPs[today] = new Set();
  dailyUniqueIPs[today].add(ipStr);
  
  res.json({ ok: true });
});

router.get("/analytics/summary", (_req: Request, res: Response) => {
  const today = new Date().toISOString().slice(0, 10);
  res.json({
    pageViews: pageViewCounts,
    uniqueVisitorsToday: dailyUniqueIPs[today]?.size || 0,
    totalPageViews: Object.values(pageViewCounts).reduce((a, b) => a + b, 0),
  });
});
