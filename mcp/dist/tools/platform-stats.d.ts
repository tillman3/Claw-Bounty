export declare const platformStatsSchema: {
    name: "platform_stats";
    description: string;
    inputSchema: {
        type: "object";
        properties: {};
    };
};
export declare function platformStats(): Promise<{
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
