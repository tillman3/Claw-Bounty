import express from "express";
import cors from "cors";
import helmet from "helmet";
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

// Routes
app.use("/", healthRoutes);
app.use("/agents", agentRoutes);
app.use("/tasks", taskRoutes);
app.use("/validators", validatorRoutes);

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
