import { LOG_TEXT_SPAN_SOURCE } from './web-url-pattern';
import { isCredentialLogKey } from './credential-policy';

const RAW_PROVIDER_PAYLOAD_KEY_PATTERN = /^(?:payload|rawPayload|rawData|originalData|eventData|providerPayload)$/i;
const SENSITIVE_URL_KEY_PATTERN = /(?:url|uri|endpoint|reconnect)/i;
const URL_TEXT_PATTERN = new RegExp(LOG_TEXT_SPAN_SOURCE, 'gi');
const JSON_STRING_ASSIGNMENT_PATTERN = /("([a-z_-]+)"\s*:\s*")(?:[^"\\]*\\[\s\S])*[^"\\]*"/gi;
// Quote-started values consume escaped quotes; bare values retain embedded quotes.
const SECRET_TEXT_VALUE_PATTERN = String.raw`(?:"(?:[^"\\]*\\[\s\S])*[^"\\]*(?:"|\\?$)|'(?:[^'\\]*\\[\s\S])*[^'\\]*(?:'|\\?$)|[^\s,;&"'][^\s,;&]*)`;
const FREE_TEXT_SECRET_PATTERNS: readonly RegExp[] = [
    new RegExp(String.raw`\b(authorization\s*[:=]\s*(?:bearer|basic|oauth)\s+)${SECRET_TEXT_VALUE_PATTERN}`, 'gi'),
    new RegExp(String.raw`\b(bearer\s+)${SECRET_TEXT_VALUE_PATTERN}`, 'gi'),
    /\b((?:cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi,
];
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

const CREDENTIAL_ASSIGNMENT_LABEL_PATTERN = /(?<![a-z0-9_-])(?:"([a-z][a-z0-9_-]*)"|'([a-z][a-z0-9_-]*)'|([a-z][a-z0-9_-]*))(\s*[:=]\s*)/gi;
const CREDENTIAL_VALUE_PATTERN = new RegExp(String.raw`((?:(?:bearer|basic|oauth)\s+)?)${SECRET_TEXT_VALUE_PATTERN}`, 'iy');

function redactCredentialAssignments(value: string): string {
    if (!value.includes(':') && !value.includes('=')) return value;
    // A label is scanned once. The boundary prevents restarting inside long
    // hyphenated labels such as malformed signed-URL header names.
    const labels = CREDENTIAL_ASSIGNMENT_LABEL_PATTERN;
    const credentialValue = CREDENTIAL_VALUE_PATTERN;
    labels.lastIndex = 0;
    let result = '';
    let cursor = 0;
    let label: RegExpExecArray | null;
    while ((label = labels.exec(value))) {
        if (!isCredentialLogKey(label[1] ?? label[2] ?? label[3]!)) continue;
        credentialValue.lastIndex = labels.lastIndex;
        const secret = credentialValue.exec(value);
        if (!secret) continue;
        const quote = value[labels.lastIndex + secret[1]!.length];
        const preserveQuotes = (label[1] !== undefined || label[2] !== undefined) && (quote === '"' || quote === "'");
        const marker = preserveQuotes ? quote + '[REDACTED]' + quote : '[REDACTED]';
        result += value.slice(cursor, labels.lastIndex) + secret[1] + marker;
        cursor = credentialValue.lastIndex;
        labels.lastIndex = cursor;
    }
    return result + value.slice(cursor);
}

function sanitizeLogText(value: string): string {
    const withoutJsonSecrets = value.replace(JSON_STRING_ASSIGNMENT_PATTERN, (assignment, prefix: string, key: string) =>
        isCredentialLogKey(key) ? `${prefix}[REDACTED]"` : assignment,
    );
    const withoutUrlSecrets = sanitizeUrlText(withoutJsonSecrets);
    return redactCredentialAssignments(FREE_TEXT_SECRET_PATTERNS.reduce(
        (sanitized, pattern) => sanitized.replace(pattern, '$1[REDACTED]'),
        withoutUrlSecrets,
    ));
}

type SanitizationBudget = { nodes: number; stringChars: number };
function sanitizeLogValue(value: unknown, key = '', depth = 0, ancestors: WeakSet<object> = new WeakSet(), maxDepth = 3, budget?: SanitizationBudget): unknown {
    if (budget && budget.nodes-- <= 0) return '[Traversal budget exceeded]';
    if (isCredentialLogKey(key)) {
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
