import { ethers, Contract, JsonRpcProvider, Wallet } from "ethers";
import { config } from "./config.js";

import ABBCoreABI from "./abis/ABBCore.json" with { type: "json" };
import AgentRegistryABI from "./abis/AgentRegistry.json" with { type: "json" };
import TaskRegistryABI from "./abis/TaskRegistry.json" with { type: "json" };
import ValidatorPoolABI from "./abis/ValidatorPool.json" with { type: "json" };
import BountyEscrowABI from "./abis/BountyEscrow.json" with { type: "json" };

export const provider = new JsonRpcProvider(config.rpcUrl);

export function getSigner(privateKey: string): Wallet {
  return new Wallet(privateKey, provider);
}

// Read-only contract instances
export const abbCore = new Contract(config.contracts.abbCore, ABBCoreABI, provider);
export const agentRegistry = new Contract(config.contracts.agentRegistry, AgentRegistryABI, provider);
export const taskRegistry = new Contract(config.contracts.taskRegistry, TaskRegistryABI, provider);
export const validatorPool = new Contract(config.contracts.validatorPool, ValidatorPoolABI, provider);
export const bountyEscrow = new Contract(config.contracts.bountyEscrow, BountyEscrowABI, provider);

export const TaskState = [
  "open", "claimed", "submitted", "in_review",
  "completed", "disputed", "resolved", "cancelled",
] as const;

export function taskStateToString(state: number): string {
  return TaskState[state] ?? "unknown";
}

export function formatTask(task: any) {
  return {
    id: Number(task.id),
    poster: task.poster,
    descriptionHash: task.descriptionHash,
    bountyAmount: ethers.formatEther(task.bountyAmount),
    bountyAmountWei: task.bountyAmount.toString(),
    paymentToken: task.paymentToken,
    deadline: Number(task.deadline),
    deadlineISO: new Date(Number(task.deadline) * 1000).toISOString(),
    state: taskStateToString(Number(task.state)),
    stateNum: Number(task.state),
    assignedAgent: Number(task.assignedAgent),
    submissionHash: task.submissionHash,
    createdAt: Number(task.createdAt),
    claimedAt: Number(task.claimedAt),
    submittedAt: Number(task.submittedAt),
  };
}

export function formatAgent(agent: any) {
  return {
    id: Number(agent.id),
    operator: agent.operator,
    metadataHash: agent.metadataHash,
    reputationScore: Number(agent.reputationScore),
    tasksCompleted: Number(agent.tasksCompleted),
    tasksFailed: Number(agent.tasksFailed),
    totalEarned: ethers.formatEther(agent.totalEarned),
    registeredAt: Number(agent.registeredAt),
    active: agent.active,
  };
}

export function formatValidator(v: any) {
  return {
    address: v.addr,
    stakeAmount: ethers.formatEther(v.stakeAmount),
    reputationScore: Number(v.reputationScore),
    registeredAt: Number(v.registeredAt),
    active: v.active,
    pendingUnstake: ethers.formatEther(v.pendingUnstake),
    unstakeRequestTime: Number(v.unstakeRequestTime),
  };
}
