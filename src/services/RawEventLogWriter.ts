import { promises as fs } from 'node:fs';
import path from 'node:path';
import { types } from 'node:util';

import { ensureLogDirectory } from '../utils/log-directory';
import { getSystemTimestampISO } from '../utils/timestamp';
import { LOG_TEXT_SPAN_SOURCE, WEB_URL_SPAN_SOURCE } from '../core/logger/web-url-pattern';

const RAW_PLATFORMS = new Set(['youtube', 'twitch', 'tiktok', 'streamelements']);
const REDACTED = '[REDACTED]';
const LIMITED = '[Capture limit]';
const BEARER_TOKEN = /\bBearer\s+[^\s,;]+/gi;
const WEB_URL_SPAN = new RegExp(WEB_URL_SPAN_SOURCE, 'gi');
const RAW_TEXT_SPAN = new RegExp(LOG_TEXT_SPAN_SOURCE, 'gi');
const SECRET_KEY = /^(?:authorization|proxyauthorization|accessToken|refreshToken|idToken|authToken|jwtToken|sessionToken|token|clientSecret|secret|password|passwd|cookie|setCookie|sessionId|apiKey|xApiKey|accessKeyId|awsAccessKeyId|privateKey|signingKey|signature|sig|credential|credentials|keyPairId|policy|xAmz.*|xGoog.*)$/i;

function isSecretKey(key: string): boolean {
    return SECRET_KEY.test(key.replace(/[^a-z0-9]/gi, ''));
}

// RAW capture deliberately retains chat/provider content and non-secret URL parameters.
// Oversized strings are omitted whole, rather than exposing a credential cut at a boundary.
function rawText(value: string, depth = 0): string {
    if (value.length > 4096 || depth >= 12) return LIMITED;
    // Decode a complete primitive before assignment scanning can interpret its
    // escaped contents as unquoted diagnostic text.
    if (value.startsWith('"')) {
        try {
            const decoded: unknown = JSON.parse(value);
            if (typeof decoded === 'string') {
                const safe = rawText(decoded, depth + 1);
                return safe === decoded ? value : JSON.stringify(safe);
            }
        } catch { /* Embedded and non-JSON strings are handled below. */ }
    }
    // Scan complete whitespace-delimited candidates: commas and parentheses are
    // legal inside URL credentials. Never sanitize a prefix and retain its suffix.
    const redactUrl = (candidate: string, original = candidate): string => {
        try {
            const url = new URL(candidate);
            const secretKeys = [...url.searchParams.keys()].filter(isSecretKey);
            const fragment = new URLSearchParams(url.hash.slice(1));
            const fragmentSecretKeys = [...fragment.keys()].filter(isSecretKey);
            if (!url.username && !url.password && secretKeys.length === 0 && fragmentSecretKeys.length === 0) return candidate;
            // Punctuation may belong to the URL or enclosing diagnostic syntax.
            // For credential-bearing candidates, omit the entire ambiguous span.
            if (/[()[\]{},;|"'<>]/.test(original)) return '[Credential URL omitted]';
            url.username = '';
            url.password = '';
            for (const key of secretKeys) url.searchParams.set(key, REDACTED);
            if (fragmentSecretKeys.length) {
                for (const key of fragmentSecretKeys) fragment.set(key, REDACTED);
                url.hash = fragment.toString();
            }
            return url.toString();
        } catch { return '[Invalid URL omitted]'; }
    };
    // URL parsing accepts protocol tabs/newlines and spaces in query values.
    // Test the complete decoded primitive before scanning diagnostic fragments.
    let wholeWebUrl = false;
    try {
        wholeWebUrl = /^(?:https?|wss?):$/.test(new URL(value).protocol);
    } catch { /* Diagnostic text may contain an embedded URL instead. */ }
    const redactQuoted = (candidate: string): string => {
        const quote = candidate[0]!;
        if (quote === '"') {
            try {
                const decoded = JSON.parse(candidate) as string;
                const safe = rawText(decoded, depth + 1);
                return safe === decoded ? candidate : JSON.stringify(safe);
            } catch { /* Preserve non-JSON diagnostic quoting. */ }
        }
        return quote + rawText(candidate.slice(1, -1), depth + 1) + quote;
    };
    // Recognize assignment boundaries once, using the same key policy for quoted
    // and bare values. Non-secret enclosing values cannot hide inner assignments.
    const redactAssignments = (text: string, depth = 0, standaloneOnly = false): string => {
        const labels = /("(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b[a-z][a-z0-9_-]*)(\s*[:=]\s*)/gi;
        const urlSpans = [...text.matchAll(new RegExp(WEB_URL_SPAN_SOURCE, 'gi'))];
        let result = '';
        let cursor = 0;
        let match: RegExpExecArray | null;
        while ((match = labels.exec(text))) {
            // A whole URL owns its query keys; independently introduced diagnostic
            // assignments still need filtering before URL serialization escapes spaces.
            if (standaloneOnly && (match.index === 0 || !/\s/.test(text[match.index - 1]!))) continue;
            const label = match[1]!;
            if (!label.startsWith('"') && !label.startsWith("'")
                && !/\s/.test(text[match.index - 1] ?? '')
                && urlSpans.some(span => span.index !== undefined
                    && match!.index >= span.index && match!.index < span.index + span[0].length)) continue;
            let key: string;
            // Decode only a bounded primitive label, never provider objects.
            try { key = label.startsWith('"') ? JSON.parse(label) as string : label.startsWith("'") ? label.slice(1, -1) : label; }
            catch { continue; }
            const start = labels.lastIndex;
            const quote = text[start] === '"' || text[start] === "'" ? text[start] : '';
            // Bare non-secret values need no transformation. Keep scanning the
            // original remainder so they cannot split a following quoted secret.
            if (!quote && !isSecretKey(key)) {
                result += text.slice(cursor, start);
                cursor = start;
                continue;
            }
            let end = start;
            let closed = false;
            if (quote) {
                end++;
                while (end < text.length) {
                    if (text[end] === '\\') { end = Math.min(end + 2, text.length); continue; }
                    if (text[end++] === quote) { closed = true; break; }
                }
            } else {
                const header = /^(?:authorization|proxyAuthorization|cookie|setCookie)$/i.test(key.replace(/[^a-z0-9]/gi, ''));
                let innerQuote = '';
                while (end < text.length) {
                    const character = text[end]!;
                    if (innerQuote) {
                        if (character === '\\') { end = Math.min(end + 2, text.length); continue; }
                        if (character === innerQuote) innerQuote = '';
                    } else {
                        if ((header ? /[\r\n]/ : /\s/).test(character)) break;
                        if (character === '"' || character === "'") innerQuote = character;
                    }
                    end++;
                }
            }
            if (!isSecretKey(key) && quote && closed) {
                result += text.slice(cursor, start) + redactQuoted(text.slice(start, end));
                cursor = end;
                labels.lastIndex = end;
                continue;
            }
            const content = isSecretKey(key) ? REDACTED : depth >= 12 ? LIMITED
                : redactAssignments(text.slice(start + (quote ? 1 : 0), end - (closed ? 1 : 0)), depth + 1);
            result += text.slice(cursor, start) + quote + content + (closed ? quote : '');
            cursor = end;
            labels.lastIndex = end;
        }
        return result + text.slice(cursor);
    };
    if (wholeWebUrl) {
        const independent = redactAssignments(value, 0, true).replace(BEARER_TOKEN, `Bearer ${REDACTED}`);
        // A parser-valid URL can also contain another URL in diagnostic text.
        // Inspect those spans before whole-value serialization hides their boundary.
        const embedded = independent.replace(WEB_URL_SPAN, candidate => redactUrl(candidate));
        return redactUrl(embedded, value);
    }
    const assignments = redactAssignments(value);
    // Respect complete quoted strings so URL omission cannot erase the label or
    // opening quote of an adjacent field. Bare URL candidates remain conservative.
    return assignments.replace(RAW_TEXT_SPAN, candidate => {
        const quote = candidate[0];
        if (quote === '"' || quote === "'") {
            return redactQuoted(candidate);
        }
        return redactUrl(candidate);
    }).replace(BEARER_TOKEN, `Bearer ${REDACTED}`);
}

function captureRaw(value: unknown): unknown {
    let nodes = 1000;
    let bytes = 48_000;
    const ancestors = new WeakSet<object>();
    const text = (input: string): string => {
        const safe = rawText(input);
        bytes -= Buffer.byteLength(JSON.stringify(safe));
        return bytes < 0 ? LIMITED : safe;
    };
    const visit = (input: unknown, depth: number): unknown => {
        if (--nodes < 0 || bytes <= 0 || depth >= 12) return LIMITED;
        if (typeof input === 'string') return text(input);
        if (input === null || typeof input === 'boolean' || typeof input === 'number') return input;
        // Provider payloads contain bigint IDs; do not execute custom conversion hooks.
        if (typeof input === 'bigint') return input > 2n ** 256n || input < -(2n ** 256n) ? LIMITED : text(String(input));
        if (typeof input !== 'object') return '[Unsupported value]';
        if (types.isProxy(input)) return '[Proxy omitted]';
        if (ancestors.has(input)) return '[Circular]';
        ancestors.add(input);
        try {
            const result: Record<string, unknown> = Object.create(null);
            const array: unknown[] | undefined = Array.isArray(input) ? [] : undefined;
            let count = 0;
            // Own-key discovery itself is native and not interruptible; traversal and
            // retained output are bounded. Reject proxies before any reflective calls.
            for (const key of Object.keys(input)) {
                const descriptor = Object.getOwnPropertyDescriptor(input, key);
                if (!descriptor?.enumerable) continue;
                if (++count > 100 || nodes <= 0 || bytes <= 0) {
                    if (array) array.push(LIMITED);
                    else result['[Capture truncated]'] = LIMITED;
                    break;
                }
                const safeKey = text(key);
                bytes -= 8;
                const captured = key.length > 4096 ? LIMITED : isSecretKey(key) ? REDACTED
                    : !('value' in descriptor) ? '[Accessor omitted]'
                        : visit(descriptor.value, depth + 1);
                if (array) array.push(captured);
                else result[safeKey] = captured;
            }
            return array ?? result;
        } catch { return '[Unreadable object]'; }
        finally { ancestors.delete(input); }
    };
    return visit(value, 0);
}

type RawEventLogWriterOptions = {
    dataLoggingPath: string;
    platform: string;
    eventType: string;
    payload: unknown;
};

type RawEventLogWriteResult = {
    filePath: string;
    fileName: string;
};

class RawEventLogWriter {
    async writeRawEvent(options: RawEventLogWriterOptions): Promise<RawEventLogWriteResult> {
        const fileName = this.resolveLogFileName(options.platform, options.eventType);
        const filePath = path.join(options.dataLoggingPath, fileName);
        const logEntry = {
            ingestTimestamp: getSystemTimestampISO(),
            platform: options.platform,
            eventType: rawText(options.eventType),
            payload: captureRaw(options.payload)
        };

        let serialized = JSON.stringify(logEntry);
        // Include wrapper, escaped text and newline in the hard per-entry byte ceiling.
        if (Buffer.byteLength(serialized) >= 65_536) {
            serialized = JSON.stringify({ ...logEntry, payload: LIMITED });
        }

        try {
            await ensureLogDirectory(options.dataLoggingPath);
            await fs.appendFile(filePath, `${serialized}\n`, { encoding: 'utf8', mode: 0o600 });
        } catch {
            // Direct callers must not accidentally forward filesystem/provider details.
            throw new Error('Raw event capture write failed');
        }

        return { filePath, fileName };
    }

    resolveLogFileName(platform: string, eventType: string): string {
        if (!RAW_PLATFORMS.has(platform)) throw new Error('Unsupported raw logging platform');
        if (platform === 'youtube' && eventType === 'unknown-renderer') {
            return 'youtube-unknown-renderer-log.ndjson';
        }

        return `${platform}-data-log.ndjson`;
    }
}

export { RawEventLogWriter, type RawEventLogWriteResult, type RawEventLogWriterOptions };
