import path from 'node:path';
import { realpathSync, promises as fs } from 'node:fs';
import { RAW_RETENTION } from '../core/logger/file-policy';
import { types } from 'node:util';

import { LineFileAppender } from '../utils/line-file-appender';
import { getSystemTimestampISO } from '../utils/timestamp';
import { mapQuotedLogText, replaceWebUrls } from '../core/logger/web-url-pattern';
import { isCredentialKey as isSecretKey, redactCredentialText } from '../core/logger/credential-policy';
import { classifyLogWriteError, LogWriteError } from '../core/logger/log-write-error';

const RAW_PLATFORMS = new Set(['youtube', 'twitch', 'tiktok', 'streamelements']);
const REDACTED = '[REDACTED]';
const LIMITED = '[Capture limit]';

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
    if (wholeWebUrl) {
        const independent = redactCredentialText(value, redactQuoted, true);
        // A parser-valid URL can also contain another URL in diagnostic text.
        // Inspect those spans before whole-value serialization hides their boundary.
        const embedded = replaceWebUrls(independent, (candidate, closed) => closed ? redactUrl(candidate) : '[Invalid URL omitted]');
        return redactUrl(embedded, value);
    }
    const assignments = redactCredentialText(value, redactQuoted);
    // Respect complete quoted strings so URL omission cannot erase the label or
    // opening quote of an adjacent field. Bare URL candidates remain conservative.
    return mapQuotedLogText(assignments, (candidate, closed) => {
        if (!closed) return LIMITED;
        const quote = candidate[0];
        if (quote === '"' || quote === "'") {
            return redactQuoted(candidate);
        }
        return candidate;
    }, plain => replaceWebUrls(plain, (candidate, closed) => closed ? redactUrl(candidate) : '[Invalid URL omitted]'));
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

const RAW_FILENAMES = [...RAW_PLATFORMS].map(platform => `${platform}-data-log.ndjson`).concat('youtube-unknown-renderer-log.ndjson');
type RawCaptureConfig = { directories: readonly string[]; archiveMaxBytes?: number; archiveMaxAgeDays?: number };

// Resolve existing ancestors once at composition, including aliases to not-yet-created roots.
function canonicalDirectory(directory: string): string {
    try { return realpathSync(directory); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(directory) === directory) throw error;
        return path.join(canonicalDirectory(path.dirname(directory)), path.basename(directory));
    }
}

async function recoverDirectory(directory: string): Promise<string> {
    try { return await fs.realpath(directory); }
    catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || path.dirname(directory) === directory) throw error;
        return path.join(await recoverDirectory(path.dirname(directory)), path.basename(directory));
    }
}

class RawEventLogWriter {
    private readonly writers = new Map<string, LineFileAppender | null>();
    private readonly owners = new Map<string, LineFileAppender>();
    private readonly recovering = new Map<string, Promise<LineFileAppender>>();
    private readonly retention: { archiveMaxBytes: number; archiveMaxAgeDays: number };
    private closed = false;

    constructor(config: RawCaptureConfig) {
        this.retention = { archiveMaxBytes: config.archiveMaxBytes ?? RAW_RETENTION.archiveMaxBytes,
            archiveMaxAgeDays: config.archiveMaxAgeDays ?? RAW_RETENTION.archiveMaxAgeDays };
        for (const directory of config.directories) {
            const configuredRoot = path.resolve(directory);
            this.writers.set(configuredRoot, null);
            let root: string;
            try { root = canonicalDirectory(configuredRoot); }
            catch { continue; } // Optional capture failures are reported at the capture boundary.
            this.writers.set(configuredRoot, this.owner(root));
        }
    }

    private owner(root: string): LineFileAppender {
        let writer = this.owners.get(root);
        if (!writer) {
            writer = new LineFileAppender({ logDir: root, archiveFilenames: RAW_FILENAMES, ...this.retention });
            this.owners.set(root, writer);
        }
        return writer;
    }

    private recover(configuredRoot: string): Promise<LineFileAppender> {
        // Only one caller can probe a broken root; other events fail promptly rather than queueing payloads.
        if (this.recovering.has(configuredRoot)) return Promise.reject(new LogWriteError('unavailable'));
        const pending = recoverDirectory(configuredRoot).then(root => {
            if (this.closed) throw new Error('Raw capture is closed');
            const writer = this.owner(root);
            this.writers.set(configuredRoot, writer);
            return writer;
        }).finally(() => { this.recovering.delete(configuredRoot); });
        this.recovering.set(configuredRoot, pending);
        return pending;
    }

    async close(): Promise<void> {
        this.closed = true;
        await Promise.allSettled(this.recovering.values());
        await Promise.all([...this.owners.values()].map(writer => writer.flush()));
    }

    async writeRawEvent(options: RawEventLogWriterOptions): Promise<RawEventLogWriteResult> {
        const fileName = this.resolveLogFileName(options.platform, options.eventType);
        const filePath = path.join(options.dataLoggingPath, fileName);
        try {
            const configuredRoot = path.resolve(options.dataLoggingPath);
            let writer = this.writers.get(configuredRoot);
            if (this.closed || writer === undefined) throw new LogWriteError('configuration');
            writer ??= await this.recover(configuredRoot);
            if (this.closed) throw new LogWriteError('configuration');
            const logEntry = {
                ingestTimestamp: getSystemTimestampISO(),
                platform: options.platform,
                eventType: rawText(options.eventType),
                payload: captureRaw(options.payload)
            };
            let serialized = JSON.stringify(logEntry);
            // Include wrapper, escaped text and newline in the hard per-entry byte ceiling.
            if (Buffer.byteLength(serialized) >= 65_536) serialized = JSON.stringify({ ...logEntry, payload: LIMITED });
            await writer.writeConfirmed(fileName, serialized);
        } catch (error) {
            // Direct callers must not accidentally forward filesystem/provider details.
            const { failure, code } = classifyLogWriteError(error);
            throw new LogWriteError(failure, code, 'Raw event capture write failed');
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
