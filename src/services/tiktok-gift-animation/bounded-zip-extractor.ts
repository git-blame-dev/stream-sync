import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, open, rm, type FileHandle } from 'node:fs/promises';
import { join, resolve, sep } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInflateRaw } from 'node:zlib';
import { fromRandomAccessReaderPromise, RandomAccessReader, type Entry, type ZipFile } from 'yauzl';

export interface ZipExtractionLimits {
    archiveBytes: number;
    entries: number;
    fileBytes: number;
    totalBytes: number;
    filenameBytes: number;
}

/** Generous asset budgets, independent of caller transport/deadline budgets. */
export const DEFAULT_ZIP_EXTRACTION_LIMITS: Readonly<ZipExtractionLimits> = Object.freeze({
    archiveBytes: 128 * 1024 * 1024,
    entries: 2048,
    fileBytes: 256 * 1024 * 1024,
    totalBytes: 512 * 1024 * 1024,
    filenameBytes: 1024
});

function rejected(): Error {
    return Object.assign(new Error('ZIP extraction rejected'), { code: 'ERR_BOUNDED_ZIP' });
}

function checkSignal(signal?: AbortSignal): void {
    if (signal?.aborted) throw rejected();
}

/** Every yauzl metadata/data read uses this one FD and its captured size. */
class BoundedFileReader extends RandomAccessReader {
    private readonly reads = new Set<Promise<void>>();
    private readonly streams = new Map<Readable, Promise<void>>();
    private retirement?: Promise<void>;

    constructor(private readonly file: FileHandle, private readonly size: number) {
        super();
        // Also observe close errors before a ZipFile exists (failed OPEN metadata).
        this.on('error', () => undefined);
    }

    private validRange(start: number, end: number): boolean {
        return !this.retirement && Number.isSafeInteger(start) && Number.isSafeInteger(end) &&
            start >= 0 && end >= start && end <= this.size;
    }

    private async readExact(buffer: Buffer, offset: number, length: number, position: number): Promise<void> {
        if (!this.validRange(position, position + length) || !Number.isSafeInteger(offset) ||
            !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > buffer.length) throw rejected();
        let consumed = 0;
        while (consumed < length) {
            // Async method catches synchronous argument errors too. Zero bytes is
            // truncation, never permission to consume bytes outside the FD size.
            const { bytesRead } = await this.file.read(buffer, offset + consumed, length - consumed, position + consumed);
            if (!bytesRead) throw rejected();
            consumed += bytesRead;
        }
    }

    override read(buffer: Buffer, offset: number, length: number, position: number, callback: (error: Error | null) => void): void {
        const read = this.readExact(buffer, offset, length, position);
        this.reads.add(read);
        void read.then(() => { this.reads.delete(read); callback(null); }, () => {
            this.reads.delete(read);
            callback(rejected());
        });
    }

    private failedStream(): Readable {
        return new Readable({ read() { this.destroy(rejected()); } });
    }

    override createReadStream(options: { start: number; end: number }): Readable {
        // Validate even the base reader's special empty-range shortcut.
        if (!this.validRange(options.start, options.end)) return this.failedStream();
        return super.createReadStream(options);
    }

    override _readStreamForRange(start: number, end: number): Readable {
        if (!this.validRange(start, end) || start === end) return this.failedStream();
        try {
            const stream = createReadStream('', {
                fd: this.file.fd, autoClose: false, start, end: end - 1,
                fs: {
                    read: (_fd, buffer, offset, length, position, callback) => {
                        this.read(buffer, offset, length, position, error => callback(error, error ? 0 : length, buffer));
                    },
                    // destroy() normally closes even autoClose:false streams.
                    // Only dispose owns this borrowed FD, including on abort.
                    close: (_fd, callback) => callback(null)
                }
            });
            const closed = new Promise<void>(done => stream.once('close', () => {
                this.streams.delete(stream);
                done();
            }));
            this.streams.set(stream, closed);
            return stream;
        } catch {
            return this.failedStream();
        }
    }

    dispose(): Promise<void> {
        if (!this.retirement) {
            this.retirement = Promise.resolve().then(async () => {
                const streams = [...this.streams];
                for (const [stream] of streams) stream.destroy();
                await Promise.allSettled([...this.reads, ...streams.map(([, closed]) => closed)]);
                await this.file.close();
            });
        }
        return this.retirement;
    }

    override close(callback: (error: Error | null) => void): void {
        void this.dispose().then(() => callback(null), () => callback(rejected()));
    }
}

function portableName(entry: Entry, limit: number): { name: string; directory: boolean } {
    const raw = entry.fileName;
    const directory = raw.endsWith('/');
    const name = directory ? raw.slice(0, -1) : raw;
    if (!name || entry.fileNameLength > limit || Buffer.byteLength(raw) > limit ||
        /[\\:<>"|?*\p{Cc}]/u.test(raw) || raw.startsWith('/')) throw rejected();
    for (const component of name.split('/')) {
        if (!component || component === '.' || component === '..' || /[. ]$/u.test(component) ||
            /^(?:con|prn|aux|nul|conin\$|conout\$|com[1-9¹²³]|lpt[1-9¹²³])(?:[. ]|$)/iu.test(component)) throw rejected();
    }
    const type = (entry.externalFileAttributes >>> 16) & 0xf000;
    if (type !== 0 && type !== (directory ? 0x4000 : 0x8000)) throw rejected();
    if (!directory && (entry.externalFileAttributes & 0x10)) throw rejected();
    if (entry.isEncrypted() || (entry.generalPurposeBitFlag & 0x40) ||
        ![0, 8].includes(entry.compressionMethod) || (directory && entry.uncompressedSize !== 0)) throw rejected();
    return { name, directory };
}

/**
 * Caller supplies trusted archive and parent paths. Returns a new private staging
 * directory; caller owns successful cleanup/publication. Never restores metadata.
 * All central entries are validated before staging exists. Serial raw streams use
 * our owned inflater and pipeline (not yauzl's internal decompressor). No CRC32 or
 * media authenticity validation is provided; the resolver must validate content.
 */
export async function extractBoundedZip(
    archivePath: string,
    trustedParent: string,
    options: { signal?: AbortSignal; limits?: Partial<ZipExtractionLimits> } = {}
): Promise<{ directory: string; files: string[] }> {
    const limits = { ...DEFAULT_ZIP_EXTRACTION_LIMITS, ...options.limits };
    let zip: ZipFile | undefined;
    let file: FileHandle | undefined;
    let reader: BoundedFileReader | undefined;
    let directory: string | undefined;
    let closed: Promise<void> | undefined;
    let zipError = false;
    try {
        checkSignal(options.signal);
        if (Object.values(limits).some(value => !Number.isSafeInteger(value) || value < 0)) throw rejected();
        file = await open(archivePath, 'r');
        const info = await file.stat();
        if (!info.isFile() || info.size > limits.archiveBytes) throw rejected();
        reader = new BoundedFileReader(file, info.size);
        zip = await fromRandomAccessReaderPromise(reader, info.size, { autoClose: false, strictFileNames: true });
        // Retain an error listener through close: yauzl may emit outside entry iteration.
        zip.on('error', () => { zipError = true; });
        closed = new Promise<void>(resolveClosed => zip!.once('close', resolveClosed));
        if (zip.fileSize > limits.archiveBytes || zip.entryCount > limits.entries) throw rejected();
        const manifest: { entry: Entry; name: string; directory: boolean }[] = [];
        const paths = new Map<string, boolean>();
        const spellings = new Map<string, string>();
        const parents = new Set<string>();
        let declared = 0;
        for await (const entry of zip.eachEntry()) {
            checkSignal(options.signal);
            if (manifest.length >= limits.entries) throw rejected();
            const item = portableName(entry, limits.filenameBytes);
            // Conservatively coalesce Unicode case expansions and final sigma too.
            const canonical = item.name.normalize('NFC').toUpperCase().toLowerCase().normalize('NFC');
            if (paths.has(canonical) || (!item.directory && parents.has(canonical))) throw rejected();
            const components = canonical.split('/');
            const originalComponents = item.name.split('/');
            for (let index = 1; index <= components.length; index++) {
                const key = components.slice(0, index).join('/');
                const spelling = originalComponents.slice(0, index).join('/');
                if (spellings.has(key) && spellings.get(key) !== spelling) throw rejected();
                spellings.set(key, spelling);
            }
            for (let index = 1; index < components.length; index++) {
                const parent = components.slice(0, index).join('/');
                if (paths.get(parent) === false) throw rejected();
                parents.add(parent);
            }
            paths.set(canonical, item.directory);
            if (!Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 0 ||
                entry.uncompressedSize > limits.fileBytes) throw rejected();
            declared += entry.uncompressedSize;
            if (!Number.isSafeInteger(declared) || declared > limits.totalBytes) throw rejected();
            manifest.push({ entry, ...item });
        }
        checkSignal(options.signal);
        directory = await mkdtemp(join(trustedParent, 'gift-zip-'));
        let total = 0;
        const files: string[] = [];
        for (const item of manifest) {
            checkSignal(options.signal);
            const target = resolve(directory, item.name);
            if (!target.startsWith(resolve(directory) + sep)) throw rejected();
            if (item.directory) {
                await mkdir(target, { recursive: true, mode: 0o700 });
                continue;
            }
            await mkdir(resolve(target, '..'), { recursive: true, mode: 0o700 });
            checkSignal(options.signal);
            const raw = await zip.openReadStreamPromise(item.entry, { decodeFileData: false });
            let emitted = 0;
            const bound = new Transform({
                transform(chunk: Buffer, _encoding, callback) {
                    emitted += chunk.length;
                    total += chunk.length;
                    if (emitted > item.entry.uncompressedSize || emitted > limits.fileBytes || total > limits.totalBytes) {
                        callback(rejected());
                    } else callback(null, chunk);
                },
                flush(callback) { callback(emitted === item.entry.uncompressedSize ? null : rejected()); }
            });
            const output = createWriteStream(target, { flags: 'wx', mode: 0o600 });
            const outputClosed = new Promise<void>(done => output.once('close', done));
            const inflater = item.entry.compressionMethod === 8 ? createInflateRaw() : undefined;
            const inflaterClosed = inflater && new Promise<void>(done => inflater.once('close', done));
            try {
                if (inflater) {
                    await pipeline(raw, inflater, bound, output, { signal: options.signal });
                } else {
                    await pipeline(raw, bound, output, { signal: options.signal });
                }
            } finally {
                // Join native close events explicitly, independent of pipeline's
                // settlement semantics, before removing staging or returning.
                raw.destroy();
                inflater?.destroy();
                output.destroy();
                await Promise.all([outputClosed, inflaterClosed]);
            }
            files.push(item.name);
        }
        checkSignal(options.signal);
        if (zipError) throw rejected();
        zip.close();
        await closed;
        checkSignal(options.signal);
        return { directory, files };
    } catch {
        try {
            if (directory) await rm(directory, { recursive: true, force: true });
        } finally {
            // Cleanup failures must not expose archive or filesystem paths either.
            throw rejected();
        }
    } finally {
        zip?.close();
        await closed;
        // fromRandomAccessReader retains a ref even when OPEN fails. The owner
        // retires that same reader explicitly; never close a borrowed FD twice.
        if (reader) await reader.dispose();
        else await file?.close();
    }
}
