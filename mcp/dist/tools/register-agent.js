import { agentRegistry, getEnvSigner } from "../contracts.js";
export async function registerAgent(args) {
    try {
        const signer = getEnvSigner();
        const writable = agentRegistry.connect(signer);
        const tx = await writable.registerAgent(args.metadataHash);
        const receipt = await tx.wait();
        // Parse event for agent ID
        let agentId = null;
        for (const log of receipt.logs) {
            try {
                const parsed = agentRegistry.interface.parseLog({ topics: log.topics, data: log.data });
                if (parsed?.name === "AgentRegistered") {
                    agentId = Number(parsed.args.agentId);
                }
            }
            catch { /* not our event */ }
        }
        return {
            content: [{
                    type: "text",
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
    }
    catch (error) {
        return {
            content: [{ type: "text", text: `Error registering agent: ${error.message}` }],
            isError: true,
        };
    }
}
