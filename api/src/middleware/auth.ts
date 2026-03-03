import { Request, Response, NextFunction } from "express";

/**
 * API Key authentication middleware (H-2 remediation)
 * Requires X-API-Key header on POST/PUT/PATCH/DELETE requests.
 * GET requests pass through (read-only, public).
 */
export function requireApiKey(req: Request, res: Response, next: NextFunction): void {
  // GET requests are public (read-only)
  if (req.method === "GET") {
    next();
    return;
  }

  const apiKey = process.env.API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server misconfiguration: API_KEY not set" });
    return;
  }

  const provided = req.headers["x-api-key"] as string | undefined;
  if (!provided || provided !== apiKey) {
    res.status(401).json({ error: "Unauthorized: missing or invalid API key" });
    return;
  }

  next();
}
