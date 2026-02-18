import { Request, Response, NextFunction } from "express";

export class ApiError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void {
  console.error(`[ERROR] ${err.message}`, err.stack?.split("\n")[1]?.trim());

  if (err instanceof ApiError) {
    res.status(err.statusCode).json({ error: err.message });
    return;
  }

  // ethers.js contract errors
  if (err.message?.includes("execution reverted")) {
    const reason = err.message.match(/reason="([^"]+)"/)?.[1]
      ?? err.message.match(/reverted with reason string '([^']+)'/)?.[1]
      ?? "Transaction reverted";
    res.status(400).json({ error: reason });
    return;
  }

  res.status(500).json({ error: "Internal server error" });
}
