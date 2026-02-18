export declare const claimTaskSchema: {
    name: "claim_task";
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            taskId: {
                type: string;
                description: string;
            };
            agentId: {
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
export declare function claimTask(args: {
    taskId: number;
    agentId: number;
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
