import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { errorHandler } from "./middleware/errorHandler";
import agentRoutes from "./routes/agents";
import taskRoutes from "./routes/tasks";
import validatorRoutes from "./routes/validators";
import healthRoutes from "./routes/health";

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Rate limiting
const readLimiter = rateLimit({
  windowMs: 1 * 60 * 1000, // 1 minute
  max: 100,                  // 100 requests per minute for reads
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, please try again later" },
});

const writeLimiter = rateLimit({
  windowMs: 1 * 60 * 1000,
  max: 10,                   // 10 writes per minute
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many write requests, please try again later" },
});

app.use("/health", readLimiter);
app.use("/contracts", readLimiter);

// Routes (with rate limiting)
app.use("/", healthRoutes);
app.use("/agents", readLimiter, agentRoutes);
app.use("/tasks", readLimiter, taskRoutes);
app.use("/validators", readLimiter, validatorRoutes);

// Error handler (must be last)
app.use(errorHandler);

// Start
app.listen(config.port, () => {
  console.log(`🏴‍☠️ Agent Bounty Board API running on port ${config.port}`);
  console.log(`   RPC: ${config.rpcUrl}`);
  console.log(`   Contracts:`);
  Object.entries(config.contracts).forEach(([k, v]) => {
    console.log(`     ${k}: ${v}`);
  });
});

export default app;
