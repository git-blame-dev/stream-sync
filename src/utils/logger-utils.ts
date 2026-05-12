import * as loggingModule from '../core/logging';

type LoggerModule = {
    logger: unknown;
    getUnifiedLogger: () => unknown;
};

function getLoggingModule(): LoggerModule {
    return loggingModule as LoggerModule;
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

const SENSITIVE_KEY_PATTERN = /^(?:access[_-]?token|accessToken|refresh[_-]?token|refreshToken|client[_-]?secret|clientSecret|authorization|cookie|password|secret|token|session[_-]?id|sessionId)$/i;
const SENSITIVE_URL_KEY_PATTERN = /(?:url|uri|endpoint|reconnect)/i;
const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s|)\]}>,"']+/gi;

function stripUrlSecrets(value: string): string {
    try {
        const parsed = new URL(value);
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return value;
    }
}

function sanitizeLogText(value: string): string {
    return value.replace(URL_PATTERN, (candidate) => stripUrlSecrets(candidate));
}

function sanitizeLogValue(value: unknown, key = '', depth = 0, seen: WeakSet<object> = new WeakSet(), maxDepth = 3): unknown {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
        return '[REDACTED]';
    }
    if (value instanceof Error) {
        return { name: value.name, message: sanitizeLogText(value.message) };
    }
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value === 'string') {
        return SENSITIVE_URL_KEY_PATTERN.test(key) ? stripUrlSecrets(value) : sanitizeLogText(value);
    }
    if (typeof value !== 'object') {
        return value;
    }
    if (seen.has(value)) {
        return '[Circular]';
    }
    if (depth >= maxDepth) {
        return '[Object: max depth reached]';
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return value.map((item) => sanitizeLogValue(item, key, depth + 1, seen, maxDepth));
    }
    return Object.fromEntries(
        Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
            entryKey,
            sanitizeLogValue(entryValue, entryKey, depth + 1, seen, maxDepth)
        ])
    );
}

function safeObjectStringify(obj: unknown, maxDepth = 3) {
    const sanitized = sanitizeLogValue(obj, '', 0, new WeakSet(), maxDepth);
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    if (typeof sanitized === 'string') return sanitized;
    if (typeof sanitized === 'number' || typeof sanitized === 'boolean') return String(sanitized);
    
    try {
        return JSON.stringify(sanitized);
    } catch (err) {
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
    sanitizeLogText,
    safeObjectStringify
};
