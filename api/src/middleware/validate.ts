import { Request, Response, NextFunction } from "express";
import { ApiError } from "./errorHandler";

type FieldSpec = { name: string; type?: "string" | "number" | "address" | "bytes32" };

export function requireFields(...fields: (string | FieldSpec)[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    for (const f of fields) {
      const spec = typeof f === "string" ? { name: f } : f;
      const val = req.body[spec.name];

      if (val === undefined || val === null || val === "") {
        throw new ApiError(400, `Missing required field: ${spec.name}`);
      }

      if (spec.type === "address" && !/^0x[0-9a-fA-F]{40}$/.test(val)) {
        throw new ApiError(400, `Invalid address for field: ${spec.name}`);
      }

      if (spec.type === "bytes32" && !/^0x[0-9a-fA-F]{64}$/.test(val)) {
        throw new ApiError(400, `Invalid bytes32 for field: ${spec.name}`);
      }

      if (spec.type === "number" && (typeof val !== "number" || isNaN(val))) {
        throw new ApiError(400, `Field ${spec.name} must be a number`);
      }
    }
    next();
  };
}

export function requirePrivateKey(req: Request, _res: Response, next: NextFunction) {
  if (!req.body.privateKey && !process.env.SIGNER_PRIVATE_KEY) {
    throw new ApiError(400, "Missing privateKey in body (or SIGNER_PRIVATE_KEY env var)");
  }
  next();
}
