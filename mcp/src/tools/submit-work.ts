import { abbCore, getEnvSigner } from "../contracts.js";

export async function submitWork(args: { taskId: number; submissionHash: string }) {
  try {
    const signer = getEnvSigner();
    const writable = abbCore.connect(signer);
    const tx = await (writable as any).submitWork(args.taskId, args.submissionHash);
    const receipt = await tx.wait();

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          txHash: receipt.hash,
          taskId: args.taskId,
          message: `Work submitted for task ${args.taskId}. Validators will review your submission. If approved (score ≥60), you'll receive the bounty.`,
        }, null, 2),
      }],
    };
  } catch (error: any) {
    return {
      content: [{ type: "text" as const, text: `Error submitting work: ${error.message}` }],
      isError: true,
    };
  }
}
