export type LoggerMethod = (message: unknown, source?: string, data?: unknown) => void;

export type ResolvedLogger = {
    debug: LoggerMethod;
    info: LoggerMethod;
    warn: LoggerMethod;
    error: LoggerMethod;
    console?: LoggerMethod;
};

export function normalizeLoggerMethods<T extends object>(logger: T, moduleName?: string): T & ResolvedLogger;

export function resolveLogger(candidate?: unknown, moduleName?: string): ResolvedLogger;
