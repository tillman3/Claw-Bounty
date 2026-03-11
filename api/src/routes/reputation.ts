import { Router, Request, Response } from "express";
import {
  agentRegistry,
  taskRegistry,
  formatAgent,
  taskStateToString,
} from "../services/contracts";
import { ApiError } from "../middleware/errorHandler";
import { ethers } from "ethers";

const router = Router();

// ─── Public Reputation Endpoints (Free Tier) ───

/**
 * GET /v2/reputation/:agentId
 * Full reputation profile for an agent
 */
router.get("/:agentId", async (req: Request, res: Response) => {
  const agentId = parseInt(req.params.agentId);
  if (isNaN(agentId) || agentId < 0) throw new ApiError(400, "Invalid agent ID");

  const exists = await agentRegistry.agentExists(agentId);
  if (!exists) throw new ApiError(404, "Agent not found");

  const agent = await agentRegistry.getAgent(agentId);
  const formatted = formatAgent(agent);

  // Compute reputation grade
  const grade = getReputationGrade(formatted.reputationScore);

  res.json({
    agent: {
      ...formatted,
      reputationGrade: grade.letter,
      reputationLabel: grade.label,
    },
    meta: {
      protocol: "AgentEcon",
      standard: "ERC-8004",
      chain: "base-sepolia",
      queryTimestamp: Math.floor(Date.now() / 1000),
    },
  });
});

/**
 * GET /v2/reputation/:agentId/history
 * Score history over time (from on-chain events)
 * Note: In production this would use an indexer (The Graph / custom).
 * For now returns current snapshot.
 */
router.get("/:agentId/history", async (req: Request, res: Response) => {
  const agentId = parseInt(req.params.agentId);
  if (isNaN(agentId) || agentId < 0) throw new ApiError(400, "Invalid agent ID");

  const exists = await agentRegistry.agentExists(agentId);
  if (!exists) throw new ApiError(404, "Agent not found");

  const agent = await agentRegistry.getAgent(agentId);
  const formatted = formatAgent(agent);

  // Current snapshot (indexer would provide historical data points)
  res.json({
    agentId,
    current: {
      reputationScore: formatted.reputationScore,
      tasksCompleted: formatted.tasksCompleted,
      tasksFailed: formatted.tasksFailed,
      totalEarned: formatted.totalEarned,
    },
    history: [
      {
        timestamp: formatted.registeredAt,
        event: "registered",
        reputationScore: 5000, // default starting score
      },
      {
        timestamp: Math.floor(Date.now() / 1000),
        event: "current",
        reputationScore: formatted.reputationScore,
      },
    ],
    note: "Full event history requires indexer integration (The Graph). Current version provides snapshots.",
  });
});

/**
 * GET /v2/reputation/search
 * Search agents by minimum reputation score, active status, etc.
 * Query params: minScore, maxResults, active
 */
router.get("/", async (req: Request, res: Response) => {
  const minScore = parseInt(req.query.minScore as string) || 0;
  const maxResults = Math.min(parseInt(req.query.maxResults as string) || 50, 100);
  const activeOnly = req.query.active !== "false";

  let nextId: number;
  try {
    nextId = Number(await agentRegistry.nextAgentId());
  } catch {
    nextId = 0;
  }

  const agents = [];
  for (let i = 1; i <= nextId && agents.length < maxResults; i++) {
    try {
      const exists = await agentRegistry.agentExists(i);
      if (!exists) continue;

      const agent = await agentRegistry.getAgent(i);
      const formatted = formatAgent(agent);

      if (activeOnly && !formatted.active) continue;
      if (formatted.reputationScore < minScore) continue;

      const grade = getReputationGrade(formatted.reputationScore);
      agents.push({
        ...formatted,
        reputationGrade: grade.letter,
        reputationLabel: grade.label,
      });
    } catch {
      // skip invalid agents
    }
  }

  // Sort by reputation score descending
  agents.sort((a, b) => b.reputationScore - a.reputationScore);

  res.json({
    total: agents.length,
    filters: { minScore, activeOnly, maxResults },
    agents,
  });
});

/**
 * GET /v2/reputation/leaderboard
 * Top agents ranked by reputation score
 * Query params: limit (default 10, max 50), category (future)
 */
router.get("/leaderboard", async (req: Request, res: Response) => {
  const limit = Math.min(parseInt(req.query.limit as string) || 10, 50);

  let nextId: number;
  try {
    nextId = Number(await agentRegistry.nextAgentId());
  } catch {
    nextId = 0;
  }

  const agents = [];
  for (let i = 1; i <= nextId; i++) {
    try {
      const exists = await agentRegistry.agentExists(i);
      if (!exists) continue;

      const agent = await agentRegistry.getAgent(i);
      const formatted = formatAgent(agent);
      if (!formatted.active) continue;

      const grade = getReputationGrade(formatted.reputationScore);
      agents.push({
        rank: 0, // set after sort
        ...formatted,
        reputationGrade: grade.letter,
        reputationLabel: grade.label,
      });
    } catch {
      // skip
    }
  }

  // Sort and rank
  agents.sort((a, b) => b.reputationScore - a.reputationScore);
  agents.forEach((a, i) => (a.rank = i + 1));

  res.json({
    leaderboard: agents.slice(0, limit),
    totalAgents: agents.length,
    updatedAt: Math.floor(Date.now() / 1000),
  });
});

/**
 * GET /v2/reputation/verify/:agentId
 * Quick verification endpoint — returns trust signal for external integrations.
 * Designed for other platforms to check "should I trust this agent?"
 */
router.get("/verify/:agentId", async (req: Request, res: Response) => {
  const agentId = parseInt(req.params.agentId);
  if (isNaN(agentId) || agentId < 0) throw new ApiError(400, "Invalid agent ID");

  const exists = await agentRegistry.agentExists(agentId);
  if (!exists) {
    res.json({
      verified: false,
      agentId,
      reason: "Agent not found in registry",
    });
    return;
  }

  const agent = await agentRegistry.getAgent(agentId);
  const formatted = formatAgent(agent);
  const grade = getReputationGrade(formatted.reputationScore);

  // Trust signals
  const trustSignals = {
    isRegistered: true,
    isActive: formatted.active,
    hasCompletedTasks: formatted.tasksCompleted > 0,
    reputationAboveThreshold: formatted.reputationScore >= 5000, // above default
    hasEarnings: parseFloat(formatted.totalEarned) > 0,
  };

  const trustScore = Object.values(trustSignals).filter(Boolean).length;

  res.json({
    verified: formatted.active && formatted.reputationScore >= 3000,
    agentId,
    operator: formatted.operator,
    reputationScore: formatted.reputationScore,
    reputationGrade: grade.letter,
    tasksCompleted: formatted.tasksCompleted,
    trustSignals,
    trustLevel: trustScore >= 4 ? "high" : trustScore >= 2 ? "medium" : "low",
    meta: {
      protocol: "AgentEcon",
      standard: "ERC-8004",
      chain: "base-sepolia",
    },
  });
});

// ─── Helpers ───

interface ReputationGrade {
  letter: string;
  label: string;
}

function getReputationGrade(score: number): ReputationGrade {
  if (score >= 9000) return { letter: "S", label: "Exceptional" };
  if (score >= 8000) return { letter: "A", label: "Excellent" };
  if (score >= 7000) return { letter: "B+", label: "Very Good" };
  if (score >= 6000) return { letter: "B", label: "Good" };
  if (score >= 5000) return { letter: "C", label: "Average" };
  if (score >= 4000) return { letter: "D", label: "Below Average" };
  if (score >= 3000) return { letter: "D-", label: "Poor" };
  return { letter: "F", label: "Untrusted" };
}

export default router;
