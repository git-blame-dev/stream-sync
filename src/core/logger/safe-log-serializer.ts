import { LOG_TEXT_SPAN_SOURCE } from './web-url-pattern';

const SENSITIVE_LOG_KEYS = new Set([
    'accesstoken',
    'refreshtoken',
    'clientsecret',
    'authorization',
    'cookie',
    'password',
    'secret',
    'token',
    'sessionid',
    'apikey',
    'xapikey',
    'jwttoken',
]);
const RAW_PROVIDER_PAYLOAD_KEY_PATTERN = /^(?:payload|rawPayload|rawData|originalData|eventData|providerPayload)$/i;
const SENSITIVE_URL_KEY_PATTERN = /(?:url|uri|endpoint|reconnect)/i;
const URL_TEXT_PATTERN = new RegExp(LOG_TEXT_SPAN_SOURCE, 'gi');
const JSON_STRING_ASSIGNMENT_PATTERN = /("([a-z_-]+)"\s*:\s*")(?:[^"\\]*\\[\s\S])*[^"\\]*"/gi;
// Quote-started values consume escaped quotes; bare values retain embedded quotes.
const SECRET_TEXT_VALUE_PATTERN = String.raw`(?:"(?:[^"\\]*\\[\s\S])*[^"\\]*"|'(?:[^'\\]*\\[\s\S])*[^'\\]*'|[^\s,;&"'][^\s,;&]*)`;
const FREE_TEXT_SECRET_PATTERNS: readonly RegExp[] = [
    new RegExp(String.raw`\b(authorization\s*[:=]\s*(?:bearer|basic)\s+)${SECRET_TEXT_VALUE_PATTERN}`, 'gi'),
    new RegExp(String.raw`\b(bearer\s+)${SECRET_TEXT_VALUE_PATTERN}`, 'gi'),
    new RegExp(String.raw`\b((?:access|refresh|jwt|id|auth)[_-]?token\s*[:=]\s*)${SECRET_TEXT_VALUE_PATTERN}`, 'gi'),
    new RegExp(String.raw`\b((?:api[_-]?key|x-api-key|client[_-]?secret|password|secret)\s*[:=]\s*)${SECRET_TEXT_VALUE_PATTERN}`, 'gi'),
    /\b((?:cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi,
];
const MAX_ENTRIES = 100;
const MAX_STRING_LENGTH = 4096;
const MAX_TOTAL_NODES = 1000;
const MAX_TOTAL_STRING_CHARS = 100_000;
const TRUNCATION_MARKER = '...';

function normalizeLogKey(key: string): string {
    return key.replace(/[_-]/g, '').toLowerCase();
}

function isSensitiveLogKey(key: string): boolean {
    return SENSITIVE_LOG_KEYS.has(normalizeLogKey(key));
}

function stripUrlSecrets(value: string, webOnly = false): string | null {
    try {
        const parsed = new URL(value);
        if (webOnly && !/^(?:https?|wss?):$/.test(parsed.protocol)) return null;
        parsed.username = '';
        parsed.password = '';
        parsed.search = '';
        parsed.hash = '';
        return parsed.toString();
    } catch {
        return null;
    }
}

function sanitizeUrlText(value: string, depth = 0): string {
    return value.replace(URL_TEXT_PATTERN, candidate => {
        const quote = candidate[0];
        if (quote === '"' || quote === "'") {
            if (depth >= 12) return `${quote}[URL omitted]${quote}`;
            if (quote === '"') {
                try {
                    const decoded = JSON.parse(candidate) as string;
                    const safe = stripUrlSecrets(decoded, true) ?? sanitizeUrlText(decoded, depth + 1);
                    return safe === decoded ? candidate : JSON.stringify(safe);
                } catch {
                    // Non-JSON quoted diagnostics still retain their enclosing boundary.
                }
            }
            const content = candidate.slice(1, -1);
            const safe = stripUrlSecrets(content, true) ?? sanitizeUrlText(content, depth + 1);
            return quote + safe + quote;
        }
        // A malformed complete span must not expose credentials from its suffix.
        return stripUrlSecrets(candidate, true) ?? '[Invalid URL omitted]';
    });
}

function sanitizeLogText(value: string): string {
    const withoutJsonSecrets = value.replace(JSON_STRING_ASSIGNMENT_PATTERN, (assignment, prefix: string, key: string) =>
        isSensitiveLogKey(key) ? `${prefix}[REDACTED]"` : assignment,
    );
    const withoutUrlSecrets = sanitizeUrlText(withoutJsonSecrets);
    return FREE_TEXT_SECRET_PATTERNS.reduce(
        (sanitized, pattern) => sanitized.replace(pattern, '$1[REDACTED]'),
        withoutUrlSecrets,
    );
}

type SanitizationBudget = { nodes: number; stringChars: number };
function sanitizeLogValue(value: unknown, key = '', depth = 0, ancestors: WeakSet<object> = new WeakSet(), maxDepth = 3, budget?: SanitizationBudget): unknown {
    if (budget && budget.nodes-- <= 0) return '[Traversal budget exceeded]';
if (isSensitiveLogKey(key)) {
return '[REDACTED]';
}
    if (RAW_PROVIDER_PAYLOAD_KEY_PATTERN.test(key)) {
        return '[REDACTED_RAW_PAYLOAD]';
    }
    if (value instanceof Error) {
        return {
            name: sanitizeLogValue(value.name, 'name', depth + 1, ancestors, maxDepth, budget),
            message: sanitizeLogValue(value.message, 'message', depth + 1, ancestors, maxDepth, budget),
        };
    }
    if (value === null || value === undefined) {
        return value;
    }
    if (typeof value === 'string') {
        const sanitized = SENSITIVE_URL_KEY_PATTERN.test(key)
            ? sanitizeLogText(stripUrlSecrets(value) ?? value)
            : sanitizeLogText(value);
        const limited = sanitized.length > MAX_STRING_LENGTH ? `${sanitized.slice(0, MAX_STRING_LENGTH)}${TRUNCATION_MARKER}` : sanitized;
        if (!budget) return limited;
        const available = Math.max(0, budget.stringChars);
        budget.stringChars -= limited.length;
        return limited.length > available ? `${limited.slice(0, available)}${TRUNCATION_MARKER}` : limited;
    }
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : String(value);
    }
    if (typeof value === 'bigint') return `${value}n`;
    if (typeof value === 'symbol') return String(value);
    if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
    if (typeof value === 'boolean') return value;
    if (typeof value !== 'object') return String(value);
    if (ancestors.has(value)) {
        return '[Circular]';
    }
    if (depth >= maxDepth) {
        return '[Object: max depth reached]';
    }
    ancestors.add(value);
    try {
        if (value instanceof Date) return Number.isNaN(value.getTime()) ? '[Invalid Date]' : value.toISOString();
        if (value instanceof Map) {
            const entries: unknown[] = [];
            let count = 0;
            for (const [mapKey, mapValue] of value) {
                if (count++ >= MAX_ENTRIES) break;
                const displayedKey = sanitizeLogValue(mapKey, '', depth + 1, ancestors, maxDepth, budget);
                const valueKey = typeof mapKey === 'string' ? mapKey : '';
                entries.push([displayedKey, sanitizeLogValue(mapValue, valueKey, depth + 1, ancestors, maxDepth, budget)]);
            }
            return { type: 'Map', size: value.size, entries };
        }
        if (value instanceof Set) {
            const entries: unknown[] = [];
            let count = 0;
            for (const item of value) {
                if (count++ >= MAX_ENTRIES) break;
                entries.push(sanitizeLogValue(item, '', depth + 1, ancestors, maxDepth, budget));
            }
            return { type: 'Set', size: value.size, values: entries };
        }
        if (Array.isArray(value)) {
            const result: unknown[] = [];
            for (let index = 0; index < Math.min(value.length, MAX_ENTRIES); index++) {
                try { result.push(sanitizeLogValue(value[index], key, depth + 1, ancestors, maxDepth, budget)); }
                catch { result.push('[Un readable]'); }
            }
            if (value.length > MAX_ENTRIES) result.push(`[${value.length - MAX_ENTRIES} more items]`);
            return result;
        }
        const result: Record<string, unknown> = {};
        let keys: string[];
        try { keys = Object.keys(value as object).sort(); } catch { return '[Un readable object]'; }
        for (const entryKey of keys.slice(0, MAX_ENTRIES)) {
            try { result[entryKey] = sanitizeLogValue((value as Record<string, unknown>)[entryKey], entryKey, depth + 1, ancestors, maxDepth, budget); }
            catch { result[entryKey] = '[Unreadable]'; }
        }
        if (keys.length > MAX_ENTRIES) result.__more = keys.length - MAX_ENTRIES;
        return result;
    } finally {
        ancestors.delete(value);
    }
}

function safeObjectStringify(obj: unknown, maxDepth = 3): string {
    const budget = { nodes: MAX_TOTAL_NODES, stringChars: MAX_TOTAL_STRING_CHARS };
    const sanitized = sanitizeLogValue(obj, '', 0, new WeakSet(), maxDepth, budget);
    if (obj === null) return 'null';
    if (obj === undefined) return 'undefined';
    if (typeof sanitized === 'string') return sanitized;
    if (typeof sanitized === 'number' || typeof sanitized === 'boolean') return String(sanitized);

    try {
        return JSON.stringify(sanitized);
    } catch (_err) {
        const constructorName = typeof obj === 'object' && obj !== null && 'constructor' in obj && typeof (obj as { constructor?: { name?: unknown } }).constructor?.name === 'string'
            ? (obj as { constructor: { name: string } }).constructor.name
            : 'Unknown';
        return `[Object: ${constructorName} - stringify failed]`;
    }
}

function sanitizeLogData(value: unknown, maxDepth = 3): unknown {
    const budget = { nodes: MAX_TOTAL_NODES, stringChars: MAX_TOTAL_STRING_CHARS };
    try { return sanitizeLogValue(value, '', 0, new WeakSet(), maxDepth, budget); }
    catch { return '[Unserializable]'; }
}

export { sanitizeLogText, safeObjectStringify, sanitizeLogData };
