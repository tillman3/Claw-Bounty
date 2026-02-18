import { validatorPool, formatValidator } from "../contracts.js";

export const listValidatorsSchema = {
  name: "list_validators" as const,
  description: "Get validator information. Look up a specific validator by address or get the active validator count.",
  inputSchema: {
    type: "object" as const,
    properties: {
      validatorAddress: {
        type: "string",
        description: "Validator address to look up. If omitted, returns active validator count.",
      },
    },
  },
};

export async function listValidators(args: { validatorAddress?: string }) {
  try {
    if (args.validatorAddress) {
      const v = await validatorPool.getValidator(args.validatorAddress);
      if (Number(v.registeredAt) === 0) {
        return {
          content: [{ type: "text" as const, text: `Validator ${args.validatorAddress} not found.` }],
          isError: true,
        };
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify(formatValidator(v), null, 2),
        }],
      };
    }

    const activeCount = Number(await validatorPool.activeValidatorCount());
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({
          activeValidatorCount: activeCount,
          panelSize: 5,
          consensusThreshold: 3,
          passScore: 60,
          minStake: "0.01 ETH",
        }, null, 2),
      }],
    };
  } catch (error: any) {
    return {
      content: [{ type: "text" as const, text: `Error fetching validators: ${error.message}` }],
      isError: true,
    };
  }
}
