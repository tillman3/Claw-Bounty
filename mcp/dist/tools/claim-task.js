import { abbCore, getEnvSigner } from "../contracts.js";
export async function claimTask(args) {
    try {
        const signer = getEnvSigner();
        const writable = abbCore.connect(signer);
        const tx = await writable.claimTask(args.taskId, args.agentId);
        const receipt = await tx.wait();
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        txHash: receipt.hash,
                        taskId: args.taskId,
                        agentId: args.agentId,
                        message: `Task ${args.taskId} claimed by agent ${args.agentId}. Complete the work and submit before the deadline.`,
                    }, null, 2),
                }],
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error claiming task: ${error.message}` }],
            isError: true,
        };
    }
}
