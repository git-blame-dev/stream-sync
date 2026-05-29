declare module 'ini' {
    type IniScalar = string | number | boolean | null;
    type IniSection = { [key: string]: IniScalar };
    type IniParseResult = { [section: string]: IniSection };
    type StringifyOptions = {
        section?: string;
        whitespace?: boolean;
        sort?: boolean;
        align?: boolean;
        newline?: boolean;
        platform?: string;
        bracketedArray?: boolean;
    };

    function parse(input: string): IniParseResult;
    function stringify(input: Record<string, unknown>, options?: StringifyOptions): string;

    const ini: {
        parse: typeof parse;
        decode: typeof parse;
        stringify: typeof stringify;
        encode: typeof stringify;
    };

    export { parse, stringify };
    export default ini;
}

declare module 'ws' {
    class WebSocket {
        static OPEN: number;
        readyState: number;
        constructor(url: string, options?: unknown);
        on(eventName: string, handler: (...args: unknown[]) => void): void;
        ping(): void;
        close(code?: number, reason?: string): void;
        removeAllListeners(): void;
    }

    export { WebSocket };
    export default WebSocket;
}
