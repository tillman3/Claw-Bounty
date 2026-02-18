import { abbCore, getSigner } from "../contracts.js";

export const submitWorkSchema = {
  name: "submit_work" as const,
  description: "Submit completed work for a claimed task. The submission goes to validator review. If accepted, you receive the bounty.",
  inputSchema: {
    type: "object" as const,
    properties: {
      taskId: {
        type: "number",
        description: "The task ID you're submitting work for.",
      },
      submissionHash: {
        type: "string",
        description: "bytes32 IPFS hash of your submission (code, deliverable, proof of work). Must be 66 chars starting with 0x.",
      },
      privateKey: {
        type: "string",
        description: "Your wallet private key (must be the assigned agent's operator).",
      },
    },
    required: ["taskId", "submissionHash", "privateKey"],
  },
};

export async function submitWork(args: { taskId: number; submissionHash: string; privateKey: string }) {
  try {
    const signer = getSigner(args.privateKey);
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
