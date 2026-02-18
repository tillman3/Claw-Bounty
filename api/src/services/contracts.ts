import { ethers, Contract, JsonRpcProvider, Wallet, Signer } from "ethers";
import { config } from "../config";

import ABBCoreABI from "../abis/ABBCore.json";
import AgentRegistryABI from "../abis/AgentRegistry.json";
import TaskRegistryABI from "../abis/TaskRegistry.json";
import ValidatorPoolABI from "../abis/ValidatorPool.json";
import BountyEscrowABI from "../abis/BountyEscrow.json";

// Provider
export const provider = new JsonRpcProvider(config.rpcUrl);

// Default signer (testnet convenience)
export function getDefaultSigner(): Wallet | null {
  if (!config.signerKey) return null;
  return new Wallet(config.signerKey, provider);
}

// Get signer from private key
export function getSigner(privateKey: string): Wallet {
  return new Wallet(privateKey, provider);
}

// Read-only contracts
export const abbCore = new Contract(config.contracts.abbCore, ABBCoreABI, provider);
export const agentRegistry = new Contract(config.contracts.agentRegistry, AgentRegistryABI, provider);
export const taskRegistry = new Contract(config.contracts.taskRegistry, TaskRegistryABI, provider);
export const validatorPool = new Contract(config.contracts.validatorPool, ValidatorPoolABI, provider);
export const bountyEscrow = new Contract(config.contracts.bountyEscrow, BountyEscrowABI, provider);

// Get writable contract instance
export function getWritableContract(contract: Contract, signer: Signer): Contract {
  return contract.connect(signer) as Contract;
}

// Task state enum mapping
export const TaskState = [
  "open",
  "claimed",
  "submitted",
  "in_review",
  "completed",
  "disputed",
  "resolved",
  "cancelled",
] as const;

export function taskStateToString(state: number): string {
  return TaskState[state] ?? "unknown";
}

// Format agent struct from contract response
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

// Format task struct
export function formatTask(task: any) {
  return {
    id: Number(task.id),
    poster: task.poster,
    descriptionHash: task.descriptionHash,
    bountyAmount: ethers.formatEther(task.bountyAmount),
    bountyAmountWei: task.bountyAmount.toString(),
    paymentToken: task.paymentToken,
    deadline: Number(task.deadline),
    state: taskStateToString(Number(task.state)),
    stateNum: Number(task.state),
    assignedAgent: Number(task.assignedAgent),
    submissionHash: task.submissionHash,
    createdAt: Number(task.createdAt),
    claimedAt: Number(task.claimedAt),
    submittedAt: Number(task.submittedAt),
  };
}

// Format validator struct
export function formatValidator(v: any) {
  return {
    address: v.addr,
    stakeAmount: ethers.formatEther(v.stakeAmount),
    stakeAmountWei: v.stakeAmount.toString(),
    reputationScore: Number(v.reputationScore),
    registeredAt: Number(v.registeredAt),
    active: v.active,
    pendingUnstake: ethers.formatEther(v.pendingUnstake),
    unstakeRequestTime: Number(v.unstakeRequestTime),
  };
}
