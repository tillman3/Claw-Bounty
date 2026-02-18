import { Router, Request, Response } from "express";
import { ethers } from "ethers";
import {
  validatorPool,
  getWritableContract,
  getSigner,
  getDefaultSigner,
  formatValidator,
} from "../services/contracts";
import { requireFields, requirePrivateKey } from "../middleware/validate";
import { ApiError } from "../middleware/errorHandler";

const router = Router();

// POST /validators/register — register as validator with stake
router.post(
  "/register",
  requirePrivateKey,
  async (req: Request, res: Response) => {
    const { value, privateKey } = req.body;
    if (!value) throw new ApiError(400, "Missing 'value' (stake in ETH, min 0.1)");

    const signer = privateKey ? getSigner(privateKey) : getDefaultSigner();
    if (!signer) throw new ApiError(500, "No signer available");

    const writable = getWritableContract(validatorPool, signer);
    const tx = await writable.registerValidator({
      value: ethers.parseEther(value.toString()),
    });
    const receipt = await tx.wait();

    res.status(201).json({
      txHash: receipt.hash,
      validator: await signer.getAddress(),
    });
  },
);

// GET /validators/:address — get validator info
router.get("/:address", async (req: Request, res: Response) => {
  const { address } = req.params;
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new ApiError(400, "Invalid address");

  const v = await validatorPool.getValidator(address);
  if (Number(v.registeredAt) === 0) throw new ApiError(404, "Validator not found");

  res.json(formatValidator(v));
});

// POST /tasks/:id/validate — validator commits a score
router.post(
  "/tasks/:id/validate",
  requireFields({ name: "commitHash", type: "bytes32" }),
  requirePrivateKey,
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, "Invalid task ID");

    const { commitHash, privateKey } = req.body;
    const signer = privateKey ? getSigner(privateKey) : getDefaultSigner();
    if (!signer) throw new ApiError(500, "No signer available");

    const writable = getWritableContract(validatorPool, signer);
    const tx = await writable.commitScore(id, commitHash);
    const receipt = await tx.wait();

    res.json({ txHash: receipt.hash, taskId: id });
  },
);

// POST /tasks/:id/reveal — validator reveals score
router.post(
  "/tasks/:id/reveal",
  requireFields({ name: "score", type: "number" }, "salt"),
  requirePrivateKey,
  async (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new ApiError(400, "Invalid task ID");

    const { score, salt, privateKey } = req.body;
    if (score < 0 || score > 100) throw new ApiError(400, "Score must be 0-100");

    const signer = privateKey ? getSigner(privateKey) : getDefaultSigner();
    if (!signer) throw new ApiError(500, "No signer available");

    const writable = getWritableContract(validatorPool, signer);
    const tx = await writable.revealScore(id, score, salt);
    const receipt = await tx.wait();

    res.json({ txHash: receipt.hash, taskId: id, score });
  },
);

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

export default router;
