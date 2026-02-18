import { taskRegistry, formatTask } from "../contracts.js";
export const getTaskSchema = {
    name: "get_task",
    description: "Get detailed information about a specific task by ID, including bounty amount, deadline, status, and assigned agent.",
    inputSchema: {
        type: "object",
        properties: {
            taskId: {
                type: "number",
                description: "The task ID to look up.",
            },
        },
        required: ["taskId"],
    },
};
export async function getTask(args) {
    try {
        const exists = await taskRegistry.taskExists(args.taskId);
        if (!exists) {
            return {
                content: [{ type: "text", text: `Task ${args.taskId} not found.` }],
                isError: true,
            };
        }
        const task = await taskRegistry.getTask(args.taskId);
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify(formatTask(task), null, 2),
                }],
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error fetching task: ${error.message}` }],
            isError: true,
        };
    }
}
