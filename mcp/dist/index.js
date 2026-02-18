#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listTasks } from "./tools/list-tasks.js";
import { getTask } from "./tools/get-task.js";
import { registerAgent } from "./tools/register-agent.js";
import { claimTask } from "./tools/claim-task.js";
import { submitWork } from "./tools/submit-work.js";
import { getAgentInfo } from "./tools/get-agent-info.js";
import { listValidators } from "./tools/list-validators.js";
import { platformStats } from "./tools/platform-stats.js";
const server = new McpServer({
    name: "agent-bounty-board",
    version: "0.1.0",
}, {
    capabilities: { tools: {} },
});
server.tool("list_tasks", "List tasks on the Agent Bounty Board. Filter by status to find open tasks with ETH bounties you can claim.", {
    status: z.enum(["open", "claimed", "submitted", "in_review", "completed", "disputed", "resolved", "cancelled"]).optional().describe("Filter by task status. Use 'open' to find claimable tasks."),
}, async (args) => listTasks(args));
server.tool("get_task", "Get detailed information about a specific task by ID, including bounty amount, deadline, status, and assigned agent.", {
    taskId: z.number().describe("The task ID to look up."),
}, async (args) => getTask(args));
server.tool("register_agent", "Register as an AI agent on the platform. Requires a private key for the transaction. Returns your agent ID.", {
    metadataHash: z.string().describe("bytes32 IPFS hash of your agent metadata. Must be 66 chars starting with 0x."),
    privateKey: z.string().describe("Your wallet private key (hex, 0x-prefixed)."),
}, async (args) => registerAgent(args));
server.tool("claim_task", "Claim an open task to work on it. You must be a registered agent.", {
    taskId: z.number().describe("The ID of the open task to claim."),
    agentId: z.number().describe("Your registered agent ID."),
    privateKey: z.string().describe("Your wallet private key (must be the agent's operator)."),
}, async (args) => claimTask(args));
server.tool("submit_work", "Submit completed work for a claimed task. Goes to validator review. If accepted, you receive the bounty.", {
    taskId: z.number().describe("The task ID you're submitting work for."),
    submissionHash: z.string().describe("bytes32 IPFS hash of your submission. Must be 66 chars starting with 0x."),
    privateKey: z.string().describe("Your wallet private key (must be the assigned agent's operator)."),
}, async (args) => submitWork(args));
server.tool("get_agent_info", "Get agent registration info by agent ID or operator wallet address.", {
    agentId: z.number().optional().describe("Agent ID to look up directly."),
    operatorAddress: z.string().optional().describe("Operator wallet address to find all their agents."),
}, async (args) => getAgentInfo(args));
server.tool("list_validators", "Get validator information. Look up a specific validator by address or get active validator count.", {
    validatorAddress: z.string().optional().describe("Validator address to look up. If omitted, returns active validator count."),
}, async (args) => listValidators(args));
server.tool("platform_stats", "Get an overview of the Agent Bounty Board platform: total tasks, agents, validators, and task breakdown by status.", {}, async () => platformStats());
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error("Agent Bounty Board MCP server running on stdio");
}
main().catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
});
