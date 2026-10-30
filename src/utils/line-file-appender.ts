import fs, { promises as asyncFs } from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { getSystemTimestampISO } from './timestamp';

export type LineFileAppenderConfig = {
    logDir?: string;
    filename?: string;
    maxBytes?: number;
    maxQueueBytes?: number;
};
type WriterDependencies = {
    appendFile?: (file: string, data: string) => Promise<void>;
    rename?: typeof asyncFs.rename;
    now?: () => number;
};
type Destination = { logDir: string; filename: string; maxBytes: number; maxQueueBytes: number };
type Batch = { destination: Destination; day: string; lines: string[]; bytes: number };
const MAX_ENTRY_BYTES = 64 * 1024;

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
        maxBytes: positive(config.maxBytes, 20 * 1024 * 1024), maxQueueBytes: positive(config.maxQueueBytes, 2 * 1024 * 1024) };
}

/** One serialized, bounded writer across destination changes. Archives are never expired. */
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
    private current: { file: string; bytes: number; day: string } | null = null;

    constructor(config: LineFileAppenderConfig = {}, dependencies: WriterDependencies = {}) {
        this.destination = resolve(config);
        this.appendFile = dependencies.appendFile ?? ((file, data) => asyncFs.appendFile(file, data, { mode: 0o600 }));
        this.rename = dependencies.rename ?? asyncFs.rename;
        this.now = dependencies.now ?? (() => performance.now());
    }

    reconfigure(config: LineFileAppenderConfig): void { this.destination = resolve(config); }

    write(filename: string, content: string): boolean {
        if (!safeFilename(filename)) {
            process.stderr.write('[LineFileAppender] Rejected unsafe log filename\n');
            return false;
        }
        const destination = filename === this.destination.filename ? this.destination : { ...this.destination, filename };
        const text = `${content}\n`;
        const bytes = Buffer.byteLength(text);
        // Reject whole entries: truncating serialized JSON or a UTF-8 sequence would corrupt records.
        if (bytes > Math.min(MAX_ENTRY_BYTES, destination.maxBytes) || this.queuedBytes + bytes > destination.maxQueueBytes) {
            this.dropped++;
            this.reportDrops();
            this.start();
            return false;
        }
        const day = getSystemTimestampISO().slice(0, 10);
        const tail = this.queue.at(-1);
        if (tail && tail.destination === destination && tail.day === day && tail.bytes + bytes <= Math.min(MAX_ENTRY_BYTES, destination.maxBytes)) {
            tail.lines.push(text); tail.bytes += bytes;
        } else this.queue.push({ destination, day, lines: [text], bytes });
        this.queuedBytes += bytes;
        this.start();
        return true;
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
            } catch {
                this.current = null;
                if (!this.writeFailureReported) {
                    process.stderr.write('[LineFileAppender] File write failed; entries in this batch were not confirmed written\n');
                    this.writeFailureReported = true;
                }
            } finally { this.queuedBytes -= batch.bytes; }
            this.reportDrops();
        }
        this.reportDrops(true);
    }

    private reportDrops(force = false): void {
        if (!this.dropped || (!force && this.now() - this.lastDropReport < 1000)) return;
        process.stderr.write(`[LineFileAppender] dropped ${this.dropped} log entries (entry or queue byte limit)\n`);
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
        const current = this.current!;
        if (current.bytes > 0 && (current.day !== batch.day || current.bytes + batch.bytes > maxBytes)) {
            await this.rotate(file, current.day);
            current.bytes = 0;
        }
        current.day = batch.day;
        await this.appendFile(file, batch.lines.join(''));
        current.bytes += batch.bytes;
    }

    private async rotate(file: string, day: string): Promise<void> {
        const identity = createHash('sha256').update(path.basename(file)).digest('hex').slice(0, 12);
        const archive = path.join(path.dirname(file), `log-${identity}.${day}.${randomUUID()}`);
        await this.rename(file, archive);
        try {
            await pipeline(fs.createReadStream(archive), createGzip({ level: 1 }), fs.createWriteStream(`${archive}.gz.partial`, { flags: 'wx', mode: 0o600 }));
            await this.rename(`${archive}.gz.partial`, `${archive}.gz`);
            await asyncFs.unlink(archive);
        } catch {
            // The renamed original remains recoverable if compression fails.
            process.stderr.write('[LineFileAppender] Archive compression failed; original archive preserved\n');
        }
    }
}
