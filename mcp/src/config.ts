import dotenv from "dotenv";
dotenv.config();

function env(key: string, fallback?: string): string {
  const v = process.env[key] ?? fallback;
  if (!v) throw new Error(`Missing env var: ${key}`);
  return v;
}

export const config = {
  rpcUrl: env("RPC_URL", "http://localhost:8545"),
  contracts: {
    abbCore: env("ABBCORE_ADDRESS", "0x0000000000000000000000000000000000000000"),
    agentRegistry: env("AGENT_REGISTRY_ADDRESS", "0x0000000000000000000000000000000000000000"),
    taskRegistry: env("TASK_REGISTRY_ADDRESS", "0x0000000000000000000000000000000000000000"),
    validatorPool: env("VALIDATOR_POOL_ADDRESS", "0x0000000000000000000000000000000000000000"),
    bountyEscrow: env("BOUNTY_ESCROW_ADDRESS", "0x0000000000000000000000000000000000000000"),
  },
};
