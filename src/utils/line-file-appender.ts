import { promises as asyncFs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { archiveIdentity, pruneLogArchives, type LogRetention } from './log-retention';
import { FILE_LOG_LIMITS, OPERATIONAL_RETENTION } from '../core/logger/file-policy';
import { getSystemTimestampISO } from './timestamp';

export type LineFileAppenderConfig = {
    logDir?: string;
    filename?: string;
    maxBytes?: number;
    maxQueueBytes?: number;
    archiveMaxBytes?: number;
    archiveMaxAgeDays?: number;
    archiveFilenames?: readonly string[];
};
type WriterDependencies = {
    appendFile?: (file: string, data: string) => Promise<void>;
    rename?: typeof asyncFs.rename;
    now?: () => number;
};
type Destination = LogRetention & { logDir: string; filename: string; maxBytes: number; maxQueueBytes: number; archiveFilenames: readonly string[] };
type Completion = { promise: Promise<void>; resolve: () => void; reject: (error: Error) => void };
type Batch = { configuration: Destination; destination: Destination; day: string; lines: string[]; bytes: number; completion?: Completion };
const MAX_ENTRY_BYTES = 64 * 1024;

function report(message: string): void {
    try { process.stderr.write(message); }
    catch { /* Emergency output failure must not reject background writes. */ }
}

function safeFilename(filename: string): boolean {
    return !!filename && filename !== '.' && filename !== '..'
        && !/[\\/\x00-\x1f<>:"|?*]/.test(filename) && !/[. ]$/.test(filename)
        && !/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?: *\.|$)/i.test(filename);
}
function resolve(config: LineFileAppenderConfig): Destination {
    if (!config.logDir) throw new Error('logDir is required for LineFileAppender');
    const positive = (value: number | undefined, fallback: number) => {
        if (value === undefined) return fallback;
        if (!Number.isSafeInteger(value) || value < 1) throw new Error('Log byte limits must be positive safe integers');
        return value;
    };
    return { logDir: config.logDir, filename: config.filename ?? 'runtime.log',
        maxBytes: positive(config.maxBytes, FILE_LOG_LIMITS.maxBytes), maxQueueBytes: positive(config.maxQueueBytes, FILE_LOG_LIMITS.maxQueueBytes),
        archiveMaxBytes: positive(config.archiveMaxBytes, OPERATIONAL_RETENTION.archiveMaxBytes),
        archiveMaxAgeDays: positive(config.archiveMaxAgeDays, OPERATIONAL_RETENTION.archiveMaxAgeDays),
        archiveFilenames: config.archiveFilenames ?? [config.filename ?? 'runtime.log'] };
}

/** One serialized, bounded writer across destination changes, with optional append confirmation. */
export class LineFileAppender {
    private destination: Destination;
    private queue: Batch[] = [];
    private queuedBytes = 0;
    private running: Promise<void> | null = null;
    private dropped = 0;
    private lastDropReport = -Infinity;
    private readonly appendFile: (file: string, data: string) => Promise<void>;
    private readonly rename: typeof asyncFs.rename;
    private readonly now: () => number;
    private writeFailureReported = false;
    private readonly maintained = new WeakSet<Destination>();
    private retentionFailureReported = false;
    private current: { file: string; bytes: number; day: string } | null = null;

    constructor(config: LineFileAppenderConfig = {}, dependencies: WriterDependencies = {}) {
        this.destination = resolve(config);
        this.appendFile = dependencies.appendFile ?? ((file, data) => asyncFs.appendFile(file, data, { mode: 0o600 }));
        this.rename = dependencies.rename ?? asyncFs.rename;
        this.now = dependencies.now ?? (() => performance.now());
    }

    reconfigure(config: LineFileAppenderConfig): void { this.destination = resolve(config); }

    write(filename: string, content: string): boolean { return this.enqueue(filename, content) !== null; }

    writeConfirmed(filename: string, content: string): Promise<void> {
        const batch = this.enqueue(filename, content);
        if (!batch) return Promise.reject(new Error('Log entry not admitted'));
        if (!batch.completion) {
            let resolve!: () => void;
            let reject!: (error: Error) => void;
            const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
            batch.completion = { promise, resolve, reject };
        }
        return batch.completion.promise;
    }

    private enqueue(filename: string, content: string): Batch | null {
        if (!safeFilename(filename)) {
            report('[LineFileAppender] Rejected unsafe log filename\n');
            return null;
        }
        const destination = filename === this.destination.filename ? this.destination : { ...this.destination, filename };
        const text = `${content}\n`;
        const bytes = Buffer.byteLength(text);
        // Reject whole entries: truncating serialized JSON or a UTF-8 sequence would corrupt records.
        if (bytes > Math.min(MAX_ENTRY_BYTES, destination.maxBytes) || this.queuedBytes + bytes > destination.maxQueueBytes) {
            this.dropped++;
            this.reportDrops();
            this.start();
            return null;
        }
        const day = getSystemTimestampISO().slice(0, 10);
        const tail = this.queue.at(-1);
        if (tail && tail.configuration === this.destination && tail.destination.filename === filename && tail.day === day && tail.bytes + bytes <= Math.min(MAX_ENTRY_BYTES, destination.maxBytes)) {
            tail.lines.push(text); tail.bytes += bytes;
        } else this.queue.push({ configuration: this.destination, destination, day, lines: [text], bytes });
        this.queuedBytes += bytes;
        this.start();
        return this.queue.at(-1)!;
    }

    log(content: string): boolean { return this.write(this.destination.filename, content); }

    async flush(): Promise<void> {
        while (this.running) await this.running;
    }

    private start(): void {
        if (this.running) return;
        // Defer I/O so entries emitted in the same turn share a bounded batch.
        this.running = Promise.resolve().then(() => this.drain()).finally(() => { this.running = null; if (this.queue.length || this.dropped) this.start(); });
    }

    private async drain(): Promise<void> {
        while (this.queue.length) {
            const batch = this.queue.shift()!;
            try {
                await this.append(batch);
                this.writeFailureReported = false;
                batch.completion?.resolve();
            } catch {
                batch.completion?.reject(new Error('Log append failed'));
                this.current = null;
                if (!this.writeFailureReported) {
                    report('[LineFileAppender] File write failed; entries in this batch were not confirmed written\n');
                    this.writeFailureReported = true;
                }
            } finally { this.queuedBytes -= batch.bytes; }
            this.reportDrops();
        }
        this.reportDrops(true);
    }

    private reportDrops(force = false): void {
        if (!this.dropped || (!force && this.now() - this.lastDropReport < 1000)) return;
        report(`[LineFileAppender] dropped ${this.dropped} log entries (entry or queue byte limit)\n`);
        this.dropped = 0;
        this.lastDropReport = this.now();
    }

    private async append(batch: Batch): Promise<void> {
        const { logDir, filename, maxBytes } = batch.destination;
        const file = path.join(logDir, filename);
        if (this.current?.file !== file) {
            await asyncFs.mkdir(logDir, { recursive: true });
            try {
                const stat = await asyncFs.stat(file);
                this.current = { file, bytes: stat.size, day: stat.mtime.toISOString().slice(0, 10) };
            } catch (error) {
                if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
                this.current = { file, bytes: 0, day: batch.day };
            }
        }
        if (!this.maintained.has(batch.configuration)) {
            await this.maintain(batch.destination);
            this.maintained.add(batch.configuration);
        }
        const current = this.current!;
        if (current.bytes > 0 && (current.day !== batch.day || current.bytes + batch.bytes > maxBytes)) {
            await this.rotate(file, current.bytes > maxBytes);
            await this.maintain(batch.destination);
            current.bytes = 0;
        }
        current.day = batch.day;
        await this.appendFile(file, batch.lines.join(''));
        current.bytes += batch.bytes;
    }

    private async maintain(destination: Destination): Promise<void> {
        try {
            await pruneLogArchives(destination.logDir, destination.archiveFilenames, destination);
            this.retentionFailureReported = false;
        } catch {
            if (!this.retentionFailureReported) report('[LineFileAppender] Archive retention failed; storage budget is not enforced\n');
            this.retentionFailureReported = true;
        }
    }

    private async rotate(file: string, preserve: boolean): Promise<void> {
        const prefix = preserve ? 'preserved' : 'archive';
        const archive = path.join(path.dirname(file), `${prefix}-${archiveIdentity(path.basename(file))}.${Date.parse(getSystemTimestampISO())}.${randomUUID()}.log`);
        await this.rename(file, archive);
        if (preserve) report('[LineFileAppender] Preserved oversized existing log outside managed retention\n');
    }
}
