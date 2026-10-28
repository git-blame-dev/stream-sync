import { lookup as nativeLookup } from 'node:dns/promises';
import type { LookupAddress } from 'node:dns';
import { createWriteStream } from 'node:fs';
import { rm } from 'node:fs/promises';
import { request as nativeRequest, type RequestOptions } from 'node:https';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { BlockList, isIP, type LookupFunction } from 'node:net';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

export type ArchiveDownloadFailureReason = 'destination' | 'dns' | 'redirect' | 'status' | 'encoding' |
    'length' | 'limit' | 'network' | 'io' | 'aborted' | 'timeout' | 'options';

export class GiftArchiveDownloadError extends Error {
    readonly code = 'ERR_GIFT_ARCHIVE_DOWNLOAD';
    constructor(readonly reason: ArchiveDownloadFailureReason) {
        super('Gift archive download failed');
        this.name = 'GiftArchiveDownloadError';
    }
}

export interface ArchiveDownloaderDependencies {
    /** Trusted composition only; additional names are exact hosts, not suffixes. */
    additionalHostnames?: readonly string[];
    /** External DNS/HTTPS boundaries, not policy bypasses. Defaults are native. */
    lookup?: (hostname: string, options: { all: true; verbatim: true }) => Promise<readonly LookupAddress[]>;
    request?: (url: URL, options: RequestOptions, receive: (response: IncomingMessage) => void) => ClientRequest;
}

const PROVIDER_SUFFIXES = ['tiktokcdn.com', 'tiktokcdn-us.com', 'tiktokcdn-eu.com', 'ibytedtos.com', 'byteoversea.com'];
const DEFAULT_MAX_BYTES = 128 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 30000;
const MAX_REDIRECTS = 3;
const ipv4Excluded = new BlockList();
for (const [address, prefix] of [
    ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16],
    ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.88.99.0', 24], ['192.168.0.0', 16],
    ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]
] as const) ipv4Excluded.addSubnet(address, prefix, 'ipv4');
const ipv6Global = new BlockList();
ipv6Global.addSubnet('2000::', 3, 'ipv6');
const ipv6Excluded = new BlockList();
for (const [address, prefix] of [['2001::', 23], ['2001:db8::', 32], ['2002::', 16], ['3fff::', 20]] as const) {
    ipv6Excluded.addSubnet(address, prefix, 'ipv6');
}

function failure(reason: ArchiveDownloadFailureReason): GiftArchiveDownloadError {
    return new GiftArchiveDownloadError(reason);
}

function publicRecord(record: LookupAddress): boolean {
    if (!record || typeof record.address !== 'string' || record.address.includes('%')) return false;
    const family = isIP(record.address);
    if (!family || family !== record.family) return false;
    return family === 4 ? !ipv4Excluded.check(record.address, 'ipv4') :
        ipv6Global.check(record.address, 'ipv6') && !ipv6Excluded.check(record.address, 'ipv6');
}

/**
 * A new operation owns each request/response/file and one DNS-to-file-close
 * budget. Native HTTPS is direct (no environment proxies or auto-redirects),
 * with identity encoding and unchanged certificate/hostname verification.
 * Caller supplies a trusted output path in its private directory and owns the
 * successful file's later lifecycle; existing files are never overwritten.
 * DNS cannot be physically cancelled; a stopped lookup is observed but fenced
 * from starting a late request or write. No provider compatibility is implied.
 */
export function createArchiveDownloader(dependencies: ArchiveDownloaderDependencies = {}) {
    const lookup: NonNullable<ArchiveDownloaderDependencies['lookup']> = dependencies.lookup ?? ((hostname, options) => nativeLookup(hostname, options));
    const request = dependencies.request ?? nativeRequest;
    const additional = new Set(dependencies.additionalHostnames ?? []);
    for (const hostname of additional) {
        if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/u.test(hostname) ||
            hostname.length > 253 || isIP(hostname)) throw failure('options');
    }

    function destination(value: string, base?: URL): URL {
        try {
            // Reject syntax that URL normalization could otherwise hide (empty
            // userinfo, empty fragments, backslashes and stripped controls).
            const authority = /^(?:[a-z][a-z0-9+.-]*:)?\/\/([^/?#]*)/iu.exec(value)?.[1];
            if (/[\x00-\x20\x7f\\#]/u.test(value) || authority === '' || authority?.includes('@') ||
                (/^[a-z][a-z0-9+.-]*:/iu.test(value) && authority === undefined)) throw failure('destination');
            const url = new URL(value, base);
            if (url.protocol !== 'https:' || (url.port && url.port !== '443') || url.username || url.password || url.hash ||
                isIP(url.hostname) || !(
                    additional.has(url.hostname) || PROVIDER_SUFFIXES.some(suffix => url.hostname === suffix || url.hostname.endsWith(`.${suffix}`))
                )) throw failure('destination');
            return url;
        } catch {
            throw failure('destination');
        }
    }

    return async function downloadArchive(
        archiveUrl: string,
        outputPath: string,
        options: { signal?: AbortSignal; maxBytes?: number; timeoutMs?: number } = {}
    ): Promise<{ bytes: number }> {
        const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
        const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        if (!Number.isSafeInteger(maxBytes) || maxBytes < 0 || !Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 0x7fffffff) {
            throw failure('options');
        }
        const budget = AbortSignal.timeout(timeoutMs);
        const signal = options.signal ? AbortSignal.any([options.signal, budget]) : budget;
        let stopError: GiftArchiveDownloadError | undefined;
        const stopped = () => stopError ?? failure(options.signal?.aborted ? 'aborted' : 'timeout');
        const rememberStop = () => { stopError ??= stopped(); };
        // Keep an observer across stage transitions. Bun 1.3.13 cancels a native
        // timeout if its last listener is removed, even if one is added later.
        signal.addEventListener('abort', rememberStop, { once: true });
        const checkStopped = () => { if (signal.aborted) throw stopped(); };

        async function resolvePublic(hostname: string): Promise<LookupAddress> {
            checkStopped();
            // Only DNS admission is interruptible without joining its underlying
            // work. Both late settlement branches remain observed; neither can
            // acquire a socket after this operation has stopped.
            const records = await new Promise<readonly LookupAddress[]>((resolveRecords, rejectRecords) => {
                const abort = () => rejectRecords(stopped());
                signal.addEventListener('abort', abort, { once: true });
                Promise.resolve().then(() => {
                    checkStopped();
                    return lookup(hostname, { all: true, verbatim: true });
                }).then(result => {
                    signal.removeEventListener('abort', abort);
                    if (signal.aborted) rejectRecords(stopped());
                    else resolveRecords(result);
                }, () => {
                    signal.removeEventListener('abort', abort);
                    rejectRecords(signal.aborted ? stopped() : failure('dns'));
                });
                if (signal.aborted) abort();
            });
            checkStopped();
            if (!Array.isArray(records) || !records.length) throw failure('dns');
            for (const record of records) if (!publicRecord(record)) throw failure('dns');
            return { ...records[0]! };
        }

        async function transfer(url: URL, address: LookupAddress): Promise<{ location: string } | { bytes: number }> {
            let outgoing: ClientRequest | undefined;
            let incoming: IncomingMessage | undefined;
            let output: ReturnType<typeof createWriteStream> | undefined;
            let requestClosed: Promise<void> | undefined;
            let responseClosed: Promise<void> | undefined;
            let outputClosed: Promise<void> | undefined;
            let rejectHeaders: ((error: Error) => void) | undefined;
            let ownedOutput = false;
            let success = false;
            let responseFailed = false;
            let requestFailed = false;
            let outputFailed = false;
            const abort = () => {
                rejectHeaders?.(stopped());
                incoming?.destroy();
                outgoing?.destroy();
                output?.destroy();
            };
            const pinnedLookup: LookupFunction = (hostname, lookupOptions, callback) => {
                if (signal.aborted || hostname !== url.hostname) {
                    callback(failure('dns'), '', 0);
                } else if (lookupOptions.all) callback(null, [{ ...address }]);
                else callback(null, address.address, address.family);
            };
            try {
                checkStopped();
                const response = await new Promise<IncomingMessage>((resolveHeaders, reject) => {
                    rejectHeaders = reject;
                    outgoing = request(url, {
                        method: 'GET', hostname: url.hostname, port: 443, servername: url.hostname,
                        rejectUnauthorized: true, agent: false, lookup: pinnedLookup, signal,
                        headers: { 'Accept-Encoding': 'identity' }
                    }, message => {
                        incoming = message;
                        responseClosed = new Promise<void>(done => message.once('close', done));
                        message.on('error', () => { responseFailed = true; });
                        message.once('aborted', () => { responseFailed = true; message.destroy(); });
                        if (signal.aborted) { message.destroy(); reject(stopped()); }
                        else resolveHeaders(message);
                    });
                    requestClosed = new Promise<void>(done => outgoing!.once('close', () => {
                        done();
                        if (!incoming) reject(signal.aborted ? stopped() : failure('network'));
                    }));
                    outgoing.on('error', () => {
                        requestFailed = true;
                        reject(signal.aborted ? stopped() : failure('network'));
                    });
                    signal.addEventListener('abort', abort, { once: true });
                    checkStopped();
                    outgoing.end();
                });
                checkStopped();
                if ([301, 302, 303, 307, 308].includes(response.statusCode ?? 0)) {
                    const location = response.headers.location;
                    if (typeof location !== 'string' || !location) throw failure('redirect');
                    return { location };
                }
                if (response.statusCode !== 200) throw failure('status');
                const encoding = response.headers['content-encoding'];
                if (encoding !== undefined && (typeof encoding !== 'string' || encoding.toLowerCase().trim() !== 'identity')) throw failure('encoding');
                const length = response.headers['content-length'];
                let declared: number | undefined;
                if (length !== undefined) {
                    if (typeof length !== 'string' || !/^\d+$/u.test(length) || !Number.isSafeInteger(Number(length))) throw failure('length');
                    declared = Number(length);
                    if (declared > maxBytes) throw failure('limit');
                }
                if (responseFailed || requestFailed) throw failure('network');
                let bytes = 0;
                const bound = new Transform({ transform(chunk: Buffer, _encoding, done) {
                    bytes += chunk.length;
                    if (bytes > maxBytes) done(failure('limit'));
                    else if (declared !== undefined && bytes > declared) done(failure('length'));
                    else done(null, chunk);
                } });
                output = createWriteStream(outputPath, { flags: 'wx', mode: 0o600 });
                output.once('open', () => { ownedOutput = true; });
                output.on('error', () => { outputFailed = true; });
                outputClosed = new Promise<void>(done => output!.once('close', done));
                try {
                    await pipeline(response, bound, output, { signal });
                } catch (error) {
                    if (signal.aborted) throw stopped();
                    if (error instanceof GiftArchiveDownloadError) throw error;
                    throw failure(responseFailed || requestFailed ? 'network' : outputFailed ? 'io' : 'network');
                }
                checkStopped();
                if (responseFailed || requestFailed) throw failure('network');
                if (declared !== undefined && bytes !== declared) throw failure('length');
                success = true;
                return { bytes };
            } finally {
                signal.removeEventListener('abort', abort);
                incoming?.destroy();
                outgoing?.destroy();
                output?.destroy();
                // No acknowledgement races: native close events retire actual
                // streams before redirect admission, file removal or settlement.
                await Promise.all([requestClosed, responseClosed, outputClosed]);
                if (ownedOutput && (!success || signal.aborted)) await rm(outputPath, { force: true });
                if (success && signal.aborted) throw stopped();
            }
        }

        try {
            let url = destination(archiveUrl);
            for (let redirects = 0; ; redirects++) {
                const address = await resolvePublic(url.hostname);
                const result = await transfer(url, address);
                if ('bytes' in result) return result;
                if (redirects >= MAX_REDIRECTS) throw failure('redirect');
                url = destination(result.location, url);
            }
        } catch (error) {
            if (error instanceof GiftArchiveDownloadError) throw error;
            throw signal.aborted ? stopped() : failure('io');
        } finally {
            signal.removeEventListener('abort', rememberStop);
        }
    };
}
