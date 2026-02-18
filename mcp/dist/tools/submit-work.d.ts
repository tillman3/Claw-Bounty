export declare const submitWorkSchema: {
    name: "submit_work";
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            taskId: {
                type: string;
                description: string;
            };
            submissionHash: {
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
export declare function submitWork(args: {
    taskId: number;
    submissionHash: string;
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
