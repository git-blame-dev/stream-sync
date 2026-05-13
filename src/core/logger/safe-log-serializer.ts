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
const URL_PATTERN = /\b(?:https?|wss?):\/\/[^\s|)\]}>,"']+/gi;
const FREE_TEXT_SECRET_PATTERNS: readonly RegExp[] = [
    /\b(authorization\s*[:=]\s*bearer\s+)[^\s,;]+/gi,
    /\b((?:access|refresh|jwt|id|auth)[_-]?token\s*[:=]\s*)[^\s,;&]+/gi,
    /\b((?:api[_-]?key|x-api-key|client[_-]?secret|password|secret)\s*[:=]\s*)[^\s,;&]+/gi,
    /\b((?:cookie|set-cookie)\s*[:=]\s*)[^\r\n]+/gi,
];

function normalizeLogKey(key: string): string {
    return key.replace(/[_-]/g, '').toLowerCase();
}

function isSensitiveLogKey(key: string): boolean {
    return SENSITIVE_LOG_KEYS.has(normalizeLogKey(key));
}

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
    const withoutUrlSecrets = value.replace(URL_PATTERN, (candidate) => stripUrlSecrets(candidate));
    return FREE_TEXT_SECRET_PATTERNS.reduce(
        (sanitized, pattern) => sanitized.replace(pattern, '$1[REDACTED]'),
        withoutUrlSecrets,
    );
}

function sanitizeLogValue(value: unknown, key = '', depth = 0, ancestors: WeakSet<object> = new WeakSet(), maxDepth = 3): unknown {
if (isSensitiveLogKey(key)) {
return '[REDACTED]';
}
    if (RAW_PROVIDER_PAYLOAD_KEY_PATTERN.test(key)) {
        return '[REDACTED_RAW_PAYLOAD]';
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
    if (ancestors.has(value)) {
        return '[Circular]';
    }
    if (depth >= maxDepth) {
        return '[Object: max depth reached]';
    }
    ancestors.add(value);
    try {
        if (Array.isArray(value)) {
            return value.map((item) => sanitizeLogValue(item, key, depth + 1, ancestors, maxDepth));
        }
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>).sort(([left], [right]) => left.localeCompare(right)).map(([entryKey, entryValue]) => [
                entryKey,
                sanitizeLogValue(entryValue, entryKey, depth + 1, ancestors, maxDepth)
            ])
        );
    } finally {
        ancestors.delete(value);
    }
}

function safeObjectStringify(obj: unknown, maxDepth = 3): string {
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

export { sanitizeLogText, safeObjectStringify };
