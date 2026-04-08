export interface YouTubeiCurrencyParserDependencies {
    logger?: unknown;
}

export interface YouTubeiCurrencyParseResult {
    success: boolean;
    amount: number;
    currency: string;
    symbol: string;
    originalString: string;
    reason?: string;
}

declare class YouTubeiCurrencyParser {
    constructor(dependencies?: YouTubeiCurrencyParserDependencies);
    parse(displayString: unknown): YouTubeiCurrencyParseResult;
}

export { YouTubeiCurrencyParser };
