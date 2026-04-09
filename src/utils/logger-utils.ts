import { createRequire } from 'node:module';

const nodeRequire = createRequire(import.meta.url);

type LoggerModule = {
    logger: unknown;
    getUnifiedLogger: () => unknown;
};

function getLoggingModule(): LoggerModule {
    return nodeRequire('../core/logging') as LoggerModule;
}

function isDebugModeEnabled() {
    return process.argv.includes('--debug') || process.env.EMERGENCY_DEBUG === '1';
}

let _unifiedLogger: unknown = null;
let _logger: unknown = null;

const getLazyLogger = () => {
    if (!_logger) {
        _logger = getLoggingModule().logger;
    }
    return _logger;
};

const getLazyUnifiedLogger = () => {
    if (!_unifiedLogger) {
        _unifiedLogger = getLoggingModule().getUnifiedLogger();
    }
    return _unifiedLogger;
};

function safeObjectStringify(obj: unknown, maxDepth = 3) {
    if (obj instanceof Error) {
        return JSON.stringify({ message: obj.message, stack: obj.stack, name: obj.name }, null, 2);
    }
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    if (typeof obj === 'string') return obj;
    if (typeof obj === 'number' || typeof obj === 'boolean') return String(obj);
    
    try {
        return JSON.stringify(obj, (key, value) => {
            if (typeof value === 'object' && value !== null) {
                const stack = new Error().stack;
                const depth = (stack?.match(/safeObjectStringify/g) || []).length;
                if (depth > maxDepth) {
                    return '[Object: max depth reached]';
                }
            }
            return value;
        });
    } catch (err) {
        if (err instanceof Error && err.message.includes('circular')) {
            return '[Object: circular reference detected]';
        }
        const constructorName = typeof obj === 'object' && obj !== null && 'constructor' in obj && typeof (obj as { constructor?: { name?: unknown } }).constructor?.name === 'string'
            ? (obj as { constructor: { name: string } }).constructor.name
            : 'Unknown';
        return `[Object: ${constructorName} - stringify failed${err instanceof Error ? `: ${err.message}` : ''}]`;
    }
}

export {
    isDebugModeEnabled,
    getLazyLogger,
    getLazyUnifiedLogger,
    safeObjectStringify
};
