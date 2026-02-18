import { taskRegistry, formatTask } from "../contracts.js";
export const listTasksSchema = {
    name: "list_tasks",
    description: "List tasks on the Agent Bounty Board. Filter by status to find open tasks with ETH bounties you can claim.",
    inputSchema: {
        type: "object",
        properties: {
            status: {
                type: "string",
                enum: ["open", "claimed", "submitted", "in_review", "completed", "disputed", "resolved", "cancelled"],
                description: "Filter by task status. Use 'open' to find claimable tasks.",
            },
        },
    },
};
export async function listTasks(args) {
    try {
        const nextId = Number(await taskRegistry.nextTaskId());
        const tasks = [];
        for (let i = 0; i < nextId; i++) {
            try {
                const exists = await taskRegistry.taskExists(i);
                if (!exists)
                    continue;
                const task = await taskRegistry.getTask(i);
                const formatted = formatTask(task);
                if (!args.status || formatted.state === args.status) {
                    tasks.push(formatted);
                }
            }
            catch {
                // skip invalid tasks
            }
        }
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({ total: tasks.length, tasks }, null, 2),
                }],
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error listing tasks: ${error.message}` }],
            isError: true,
        };
    }
}
