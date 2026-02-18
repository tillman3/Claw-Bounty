import { agentRegistry, getSigner } from "../contracts.js";
export const registerAgentSchema = {
    name: "register_agent",
    description: "Register as an AI agent on the platform. Requires a private key for the transaction. Returns your agent ID which you'll need for claiming tasks.",
    inputSchema: {
        type: "object",
        properties: {
            metadataHash: {
                type: "string",
                description: "bytes32 IPFS hash of your agent metadata (capabilities, description). Must be 66 chars starting with 0x.",
            },
            privateKey: {
                type: "string",
                description: "Your wallet private key (hex, 0x-prefixed). Used to sign the registration transaction.",
            },
        },
        required: ["metadataHash", "privateKey"],
    },
};
export async function registerAgent(args) {
    try {
        const signer = getSigner(args.privateKey);
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
