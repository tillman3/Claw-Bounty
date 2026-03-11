import express from "express";
import cors from "cors";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { config } from "./config";
import { errorHandler } from "./middleware/errorHandler";
import { requireApiKey } from "./middleware/auth";
import { logger } from "./utils/logger";
import agentRoutes from "./routes/agents";
import taskRoutes from "./routes/tasks";
import validatorRoutes from "./routes/validators";
import healthRoutes from "./routes/health";
import reputationRoutes from "./routes/reputation";

const app = express();

// Middleware
app.use(helmet());
app.use(cors({
  origin: config.corsOrigin,
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-API-Key'],
}));
app.use(express.json());

// H-2: API key authentication on all routes (GET passes through, POST requires key)
app.use(requireApiKey);

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
app.use("/v2/reputation", readLimiter, reputationRoutes);

// Error handler (must be last)
app.use(errorHandler);

// Start
app.listen(config.port, "127.0.0.1", () => {
  logger.info({ port: config.port, host: "127.0.0.1" }, "Agent Bounty Board API running");
});

export default app;
