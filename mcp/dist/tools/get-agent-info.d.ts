export declare const getAgentInfoSchema: {
    name: "get_agent_info";
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            agentId: {
                type: string;
                description: string;
            };
            operatorAddress: {
                type: string;
                description: string;
            };
        };
    };
};
export declare function getAgentInfo(args: {
    agentId?: number;
    operatorAddress?: string;
}): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
}>;
