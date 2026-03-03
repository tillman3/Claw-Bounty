import { abbCore, getEnvSigner } from "../contracts.js";
export async function submitWork(args) {
    try {
        const signer = getEnvSigner();
        const writable = abbCore.connect(signer);
        const tx = await writable.submitWork(args.taskId, args.submissionHash);
        const receipt = await tx.wait();
        return {
            content: [{
                    type: "text",
                    text: JSON.stringify({
                        success: true,
                        txHash: receipt.hash,
                        taskId: args.taskId,
                        message: `Work submitted for task ${args.taskId}. Validators will review your submission. If approved (score ≥60), you'll receive the bounty.`,
                    }, null, 2),
                }],
        };
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error submitting work: ${error.message}` }],
            isError: true,
        };
    }
}
