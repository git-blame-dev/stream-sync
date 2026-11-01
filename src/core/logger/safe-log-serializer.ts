import { replaceWebUrls, mapQuotedLogText } from './web-url-pattern';
import { isCredentialKey, redactCredentialText } from './credential-policy';

const RAW_PROVIDER_PAYLOAD_KEY_PATTERN = /^(?:payload|rawPayload|rawData|originalData|eventData|providerPayload)$/i;
const SENSITIVE_URL_KEY_PATTERN = /(?:url|uri|endpoint|reconnect)/i;
const MAX_ENTRIES = 100;
const MAX_STRING_LENGTH = 4096;
const MAX_TOTAL_NODES = 1000;
const MAX_TOTAL_STRING_CHARS = 100_000;
const TRUNCATION_MARKER = '...';

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
    return mapQuotedLogText(value, (candidate, closed) => {
        if (!closed) return `${candidate[0]}[Unterminated quoted text omitted]${candidate[0]}`;
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
        return candidate;
    }, plain => replaceWebUrls(plain, (candidate, closed) => closed ? stripUrlSecrets(candidate, true) ?? '[Invalid URL omitted]' : '[Invalid URL omitted]'));
}

function sanitizeLogText(value: string): string {
    return sanitizeUrlText(redactCredentialText(value));
}

type SanitizationBudget = { nodes: number; stringChars: number };
function sanitizeLogValue(value: unknown, key = '', depth = 0, ancestors: WeakSet<object> = new WeakSet(), maxDepth = 3, budget?: SanitizationBudget): unknown {
    if (budget && budget.nodes-- <= 0) return '[Traversal budget exceeded]';
    if (isCredentialKey(key)) {
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
            const safeKey = String(sanitizeLogValue(entryKey, '', depth + 1, ancestors, maxDepth, budget));
            let entryValue: unknown;
            try { entryValue = sanitizeLogValue((value as Record<string, unknown>)[entryKey], entryKey, depth + 1, ancestors, maxDepth, budget); }
            catch { entryValue = '[Unreadable]'; }
            Object.defineProperty(result, safeKey, { value: entryValue, enumerable: true, configurable: true, writable: true });
        }
        if (keys.length > MAX_ENTRIES) result.__more = keys.length - MAX_ENTRIES;
        return result;
    } finally {
        ancestors.delete(value);
    }
}

function safeObjectStringify(obj: unknown, maxDepth = 3): string {
    const sanitized = sanitizeLogData(obj, maxDepth);
    if (sanitized === null || sanitized === undefined) return String(sanitized);
    if (typeof sanitized === 'string') return sanitized;
    return JSON.stringify(sanitized);
}

function sanitizeLogData(value: unknown, maxDepth = 3): unknown {
    const budget = { nodes: MAX_TOTAL_NODES, stringChars: MAX_TOTAL_STRING_CHARS };
    try { return sanitizeLogValue(value, '', 0, new WeakSet(), maxDepth, budget); }
    catch { return '[Unserializable]'; }
}

export { sanitizeLogText, safeObjectStringify, sanitizeLogData };
