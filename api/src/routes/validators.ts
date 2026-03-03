import { Router, Request, Response } from "express";
import {
  validatorPool,
  formatValidator,
} from "../services/contracts";
import { ApiError } from "../middleware/errorHandler";

const router = Router();

// GET /validators/:address — get validator info
router.get("/:address", async (req: Request, res: Response) => {
  const { address } = req.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new ApiError(400, "Invalid address");

  const v = await validatorPool.getValidator(address);
  if (Number(v.registeredAt) === 0) throw new ApiError(404, "Validator not found");

  res.json(formatValidator(v));
});

// GET /tasks/:id/validations — get validation results
router.get("/tasks/:id/validations", async (req: Request, res: Response) => {
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) throw new ApiError(400, "Invalid task ID");

  const finalized = await validatorPool.isRoundFinalized(id);
  let result = null;
  if (finalized) {
    const [accepted, medianScore] = await validatorPool.getRoundResult(id);
    result = { accepted, medianScore: Number(medianScore) };
  }

  res.json({ taskId: id, finalized, result });
});

// POST write endpoints removed — C-2 remediation
// Validator registration, commit, and reveal now handled via frontend (wagmi) directly on-chain

export default router;
