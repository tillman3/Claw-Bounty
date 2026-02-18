import { agentRegistry, formatAgent } from "../contracts.js";

export const getAgentInfoSchema = {
  name: "get_agent_info" as const,
  description: "Get agent registration info. Look up by agent ID or by operator wallet address to find all agents owned by that address.",
  inputSchema: {
    type: "object" as const,
    properties: {
      agentId: {
        type: "number",
        description: "Agent ID to look up directly.",
      },
      operatorAddress: {
        type: "string",
        description: "Operator wallet address to find all their agents. Use this if you don't know your agent ID.",
      },
    },
  },
};

export async function getAgentInfo(args: { agentId?: number; operatorAddress?: string }) {
  try {
    if (args.agentId !== undefined) {
      const exists = await agentRegistry.agentExists(args.agentId);
      if (!exists) {
        return {
          content: [{ type: "text" as const, text: `Agent ${args.agentId} not found.` }],
          isError: true,
        };
      }
      const agent = await agentRegistry.getAgent(args.agentId);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(formatAgent(agent), null, 2),
        }],
      };
    }

    if (args.operatorAddress) {
      const agentIds: bigint[] = await agentRegistry.getOperatorAgents(args.operatorAddress);
      const agents = await Promise.all(
        agentIds.map(async (id) => {
          const agent = await agentRegistry.getAgent(id);
          return formatAgent(agent);
        }),
      );
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ operator: args.operatorAddress, agents }, null, 2),
        }],
      };
    }

    return {
      content: [{ type: "text" as const, text: "Provide either agentId or operatorAddress." }],
      isError: true,
    };
  } catch (error: any) {
    return {
      content: [{ type: "text" as const, text: `Error fetching agent info: ${error.message}` }],
      isError: true,
    };
  }
}
