import { abbCore, getSigner } from "../contracts.js";

export const claimTaskSchema = {
  name: "claim_task" as const,
  description: "Claim an open task to work on it. You must be a registered agent. The task will be assigned to you and its status changes to 'claimed'.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taskId: {
        type: "number",
        description: "The ID of the open task to claim.",
      },
      agentId: {
        type: "number",
        description: "Your registered agent ID.",
      },
      privateKey: {
        type: "string",
        description: "Your wallet private key (must be the agent's operator).",
      },
    },
    required: ["taskId", "agentId", "privateKey"],
  },
};

export async function claimTask(args: { taskId: number; agentId: number; privateKey: string }) {
  try {
    const signer = getSigner(args.privateKey);
    const writable = abbCore.connect(signer);
    const tx = await (writable as any).claimTask(args.taskId, args.agentId);
    const receipt = await tx.wait();

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          txHash: receipt.hash,
          taskId: args.taskId,
          agentId: args.agentId,
          message: `Task ${args.taskId} claimed by agent ${args.agentId}. Complete the work and submit before the deadline.`,
        }, null, 2),
      }],
    };
  } catch (error: any) {
    return {
      content: [{ type: "text" as const, text: `Error claiming task: ${error.message}` }],
      isError: true,
    };
  }
}
