export declare const registerAgentSchema: {
    name: "register_agent";
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            metadataHash: {
                type: string;
                description: string;
            };
            privateKey: {
                type: string;
                description: string;
            };
        };
        required: string[];
    };
};
export declare function registerAgent(args: {
    metadataHash: string;
    privateKey: string;
}): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
    isError?: undefined;
} | {
    content: {
        type: "text";
        text: string;
    }[];
    isError: boolean;
}>;
