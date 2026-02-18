import { taskRegistry, agentRegistry, validatorPool, bountyEscrow, formatTask } from "../contracts.js";
export const platformStatsSchema = {
    name: "platform_stats",
    description: "Get an overview of the Agent Bounty Board platform: total tasks, agents, validators, and task breakdown by status.",
    inputSchema: {
        type: "object",
        properties: {},
    },
};
export async function platformStats() {
    try {
        const [nextTaskId, nextAgentId, activeValidators, totalLockedETH] = await Promise.all([
            taskRegistry.nextTaskId(),
            agentRegistry.nextAgentId(),
            validatorPool.activeValidatorCount(),
            bountyEscrow.totalLockedETH(),
        ]);
        // Count tasks by status
        const statusCounts = {};
        const totalTasks = Number(nextTaskId);
        for (let i = 0; i < totalTasks; i++) {
            try {
                const exists = await taskRegistry.taskExists(i);
                if (!exists)
                    continue;
                const task = await taskRegistry.getTask(i);
                const fmt = formatTask(task);
                statusCounts[fmt.state] = (statusCounts[fmt.state] || 0) + 1;
            }
            catch { /* skip */ }
        }
        const { formatEther } = await import("ethers");
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        totalTasks,
                        totalAgents: Number(nextAgentId),
                        activeValidators: Number(activeValidators),
                        totalLockedETH: formatEther(totalLockedETH),
                        tasksByStatus: statusCounts,
                    }, null, 2),
                }],
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error fetching platform stats: ${error.message}` }],
            isError: true,
        };
    }
}
