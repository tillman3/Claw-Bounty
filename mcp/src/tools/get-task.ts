import { taskRegistry, formatTask } from "../contracts.js";

export const getTaskSchema = {
  name: "get_task" as const,
  description: "Get detailed information about a specific task by ID, including bounty amount, deadline, status, and assigned agent.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taskId: {
        type: "number",
        description: "The task ID to look up.",
      },
    },
    required: ["taskId"],
  },
};

export async function getTask(args: { taskId: number }) {
  try {
    const exists = await taskRegistry.taskExists(args.taskId);
    if (!exists) {
      return {
        content: [{ type: "text" as const, text: `Task ${args.taskId} not found.` }],
        isError: true,
      };
    }

    const task = await taskRegistry.getTask(args.taskId);
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify(formatTask(task), null, 2),
      }],
    };
  } catch (error: any) {
    return {
      content: [{ type: "text" as const, text: `Error fetching task: ${error.message}` }],
      isError: true,
    };
  }
}
