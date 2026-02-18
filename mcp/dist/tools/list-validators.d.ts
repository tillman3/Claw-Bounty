export declare const listValidatorsSchema: {
    name: "list_validators";
    description: string;
    inputSchema: {
        type: "object";
        properties: {
            validatorAddress: {
                type: string;
                description: string;
            };
        };
    };
};
export declare function listValidators(args: {
    validatorAddress?: string;
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
