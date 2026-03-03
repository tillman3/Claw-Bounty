import { abbCore, getEnvSigner } from "../contracts.js";

export async function claimTask(args: { taskId: number; agentId: number }) {
  try {
    const signer = getEnvSigner();
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
