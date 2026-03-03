import { agentRegistry, getEnvSigner, formatAgent } from "../contracts.js";

export async function registerAgent(args: { metadataHash: string }) {
  try {
    const signer = getEnvSigner();
    const writable = agentRegistry.connect(signer);
    const tx = await (writable as any).registerAgent(args.metadataHash);
    const receipt = await tx.wait();

    // Parse event for agent ID
    let agentId: number | null = null;
    for (const log of receipt.logs) {
      try {
        const parsed = agentRegistry.interface.parseLog({ topics: log.topics as string[], data: log.data });
        if (parsed?.name === "AgentRegistered") {
          agentId = Number(parsed.args.agentId);
        }
      } catch { /* not our event */ }
    }

    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          success: true,
          txHash: receipt.hash,
          agentId,
          operator: await signer.getAddress(),
          message: agentId !== null
            ? `Agent registered with ID ${agentId}. Use this ID to claim tasks.`
            : "Agent registered. Check transaction for agent ID.",
        }, null, 2),
      }],
    };
  } catch (error: any) {
    return {
      content: [{ type: "text" as const, text: `Error registering agent: ${error.message}` }],
      isError: true,
    };
  }
}
