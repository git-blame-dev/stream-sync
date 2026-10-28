import crypto from 'node:crypto';
import { constants } from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { logger } from '../../core/logging';
import type { AppLogger } from '../../core/logger/types';
import { createPlatformErrorHandler } from '../../utils/platform-error-handler';
import { createArchiveDownloader } from './archive-downloader';
import { DEFAULT_ZIP_EXTRACTION_LIMITS, extractBoundedZip } from './bounded-zip-extractor';

const GIFT_ANIMATION_CACHE_DIR = path.join(os.tmpdir(), 'stream-sync-tiktok-gift-animation');
const JSON_BYTES = 256 * 1024;
const TREE_NODES = 32768;
const ENTRY_NODES = 4096;
const MAX_DURATION_MS = 120000;

type ResolverLogger = Pick<AppLogger, 'warn' | 'error'> & Partial<Pick<AppLogger, 'debug'>>;
type ResolverOptions = {
    logger?: ResolverLogger;
    cacheDirectory?: string;
    maxEntries?: number;
    maxCacheBytes?: number;
    maxConcurrent?: number;
    timeoutMs?: number;
    /** Trusted external download boundary only; extraction/validation are never injected. */
    downloadArchive?: ReturnType<typeof createArchiveDownloader>;
};
type AnimationConfig = {
    profileName: string;
    sourceWidth: number;
    sourceHeight: number;
    renderWidth: number;
    renderHeight: number;
    rgbFrame: number[];
    aFrame: number[] | null;
};
type ResolvedGiftAnimation = {
    mediaFilePath: string;
    mediaContentType: string;
    durationMs: number;
    animationConfig: AnimationConfig;
};
type Candidate = { url: string; score: number };
type Tree = { bytes: number; files: Map<string, number> };

function record(value: unknown): Record<string, unknown> | null {
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
function unavailable(): Error {
    return Object.assign(new Error('Gift animation asset unavailable'), { code: 'ERR_GIFT_ANIMATION_RESOLVE' });
}
function check(signal: AbortSignal): void {
    if (signal.aborted) throw unavailable();
}
function within(root: string, candidate: string): boolean {
    return candidate.startsWith(root + path.sep);
}
function positiveInteger(value: unknown, maximum: number): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= maximum;
}
function frame(value: unknown, width: number, height: number): number[] | null {
    if (!Array.isArray(value) || value.length !== 4 || !value.every(part => Number.isSafeInteger(part) && part >= 0)) return null;
    const [x, y, w, h] = value as [number, number, number, number];
    return w > 0 && h > 0 && x + w <= width && y + h <= height ? [x, y, w, h] : null;
}
function duration(profile: Record<string, unknown>): number {
    for (const [key, scale] of [['f', 1000 / 30], ['durationMs', 1], ['duration', 1000]] as const) {
        const value = profile[key];
        if (value === undefined || value === null || value === 0) continue;
        if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 ||
            (key !== 'duration' && !Number.isSafeInteger(value))) return 0;
        const result = Math.round(value * scale);
        return result > 0 && result <= MAX_DURATION_MS ? result : 0;
    }
    return 0;
}
function profileFor(config: unknown): { profile: Record<string, unknown>; animationConfig: AnimationConfig; durationMs: number } {
    const object = record(config);
    if (!object) throw unavailable();
    const keys = Object.keys(object);
    if (keys.length > 64 || keys.some(key => key.length > 128)) throw unavailable();
    const profiles: [string, unknown][] = [['portrait', object.portrait], ...keys.filter(key => key !== 'portrait').map(key => [key, object[key]] as [string, unknown])];
    if (typeof object.path === 'string' && object.path) profiles.push(['default', object]);
    for (const [profileName, value] of profiles) {
        const profile = record(value);
        if (!profile) continue;
        const { videoW, videoH, w, h } = profile;
        if (!positiveInteger(videoW, 4096) || !positiveInteger(videoH, 4096) || !positiveInteger(w, 4096) || !positiveInteger(h, 4096) ||
            videoW * videoH > 16000000 || w * h > 16000000) continue;
        const rgbFrame = frame(profile.rgbFrame, videoW, videoH);
        const aFrame = profile.aFrame === undefined || profile.aFrame === null ? null : frame(profile.aFrame, videoW, videoH);
        const durationMs = duration(profile);
        if (!rgbFrame || (!aFrame && profile.aFrame !== undefined && profile.aFrame !== null) || !durationMs) continue;
        return { profile, durationMs, animationConfig: { profileName, sourceWidth: videoW, sourceHeight: videoH, renderWidth: w, renderHeight: h, rgbFrame, aFrame } };
    }
    throw unavailable();
}

function candidatesFrom(data: unknown): Candidate[] {
    const original = record(record(record(data)?.enhancedGiftData)?.originalData);
    const asset = record(original?.asset);
    if (!asset) return [];
    const candidates = new Map<string, Candidate>();
    const seen = new Set<string>();
    let inspected = 0;
    const push = (value: unknown, labelValue: unknown) => {
        if (++inspected > 64 || candidates.size >= 16 || typeof value !== 'string' || value.length > 16384) return;
        const url = value.trim();
        if (!url || seen.has(url)) return;
        seen.add(url);
        if (typeof labelValue === 'string' && labelValue.length > 128) return;
        const label = typeof labelValue === 'string' ? labelValue.toLowerCase() : '';
        if (label.includes('encrypt') || url.toLowerCase().includes('encrypt')) return;
        let score = 20;
        if (label.includes('h264')) score += 100;
        if (label.includes('bytevc1')) score += 90;
        if (label.includes('bvc1')) score += 80;
        if (label.includes('480p')) score -= 10;
        if (label.includes('crop')) score -= 15;
        if (!label) score += 10;
        candidates.set(url, { url, score });
    };
    const resources = Array.isArray(asset.videoResourceList) ? asset.videoResourceList : [];
    for (let index = 0; index < Math.min(64, resources.length) && inspected < 64 && candidates.size < 16; index++) {
        const resource = record(resources[index]);
        if (!resource) { inspected++; continue; }
        const label = resource.videoTypeName || resource.format || resource.qualityType;
        const list = record(resource.videoUrl)?.urlList;
        if (Array.isArray(list)) for (let item = 0; item < list.length && inspected < 64 && candidates.size < 16; item++) push(list[item], label);
        if (inspected < 64 && candidates.size < 16) push(resource.mainUrl, label);
    }
    const list = record(asset.resourceModel)?.urlList;
    if (Array.isArray(list)) for (let item = 0; item < list.length && inspected < 64 && candidates.size < 16; item++) push(list[item], 'resourceModel');
    if (inspected < 64 && candidates.size < 16) push(asset.resourceUri, 'resourceUri');
    return [...candidates.values()].sort((left, right) => right.score - left.score);
}

async function exists(file: string): Promise<boolean> {
    try { await fsp.lstat(file); return true; }
    catch (error) { if (record(error)?.code === 'ENOENT') return false; throw unavailable(); }
}

/** Streaming directory enumeration, no symlink/special-file traversal or unbounded readdir allocation. */
async function walk(root: string, signal: AbortSignal, byteLimit: number, nodeLimit: number, skip = new Set<string>()): Promise<Tree> {
    const tree: Tree = { bytes: 0, files: new Map() };
    let nodes = 0;
    const visit = async (directory: string, depth: number): Promise<void> => {
        check(signal);
        if (depth > 32) throw unavailable();
        const info = await fsp.lstat(directory);
        if (!info.isDirectory() || info.isSymbolicLink()) throw unavailable();
        const entries = await fsp.opendir(directory, { bufferSize: 32 });
        for await (const entry of entries) {
            check(signal);
            const file = path.join(directory, entry.name);
            if (skip.has(file)) continue;
            if (++nodes > nodeLimit) throw unavailable();
            const stat = await fsp.lstat(file);
            if (stat.isSymbolicLink()) throw unavailable();
            if (stat.isDirectory()) await visit(file, depth + 1);
            else {
                if (!stat.isFile() || stat.nlink !== 1 || !Number.isSafeInteger(stat.size) || stat.size < 0) throw unavailable();
                tree.bytes += stat.size;
                if (!Number.isSafeInteger(tree.bytes) || tree.bytes > byteLimit) throw unavailable();
                tree.files.set(file, stat.size);
            }
        }
    };
    await visit(root, 0);
    return tree;
}

async function readJson(file: string, signal: AbortSignal): Promise<unknown> {
    check(signal);
    const handle = await fsp.open(file, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = await handle.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > JSON_BYTES) throw unavailable();
        const buffer = Buffer.alloc(JSON_BYTES + 1);
        let length = 0;
        while (length < buffer.length) {
            check(signal);
            const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
            if (!bytesRead) break;
            length += bytesRead;
        }
        check(signal);
        if (length > JSON_BYTES) throw unavailable();
        return JSON.parse(buffer.subarray(0, length).toString('utf8'));
    } finally { await handle.close(); }
}

async function validateAsset(entry: string, tree: Tree, signal: AbortSignal): Promise<ResolvedGiftAnimation> {
    const asset = path.join(entry, 'asset');
    const realAsset = await fsp.realpath(asset);
    if (realAsset !== asset || !tree.files.has(path.join(asset, 'config.json'))) throw unavailable();
    const { profile, animationConfig, durationMs } = profileFor(await readJson(path.join(asset, 'config.json'), signal));
    const preferred = profile.path === undefined || profile.path === '' ? 'output.mp4' : profile.path;
    if (typeof preferred !== 'string' || preferred.length > 1024 || /[\\:\p{Cc}]/u.test(preferred) ||
        preferred.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/u.test(part))) throw unavailable();
    let media = path.resolve(asset, preferred);
    if (!within(asset, media)) throw unavailable();
    if (!tree.files.has(media)) {
        const fallback = [...tree.files.keys()].filter(file => path.dirname(file) === asset && file.toLowerCase().endsWith('.mp4')).sort()[0];
        if (!fallback) throw unavailable();
        media = fallback;
    }
    if (!media.toLowerCase().endsWith('.mp4') || !tree.files.has(media) || tree.files.get(media)! > DEFAULT_ZIP_EXTRACTION_LIMITS.fileBytes ||
        await fsp.realpath(media) !== media) throw unavailable();
    const handle = await fsp.open(media, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
        const stat = await handle.stat();
        const header = Buffer.alloc(8);
        const { bytesRead } = await handle.read(header, 0, 8, 0);
        if (!stat.isFile() || stat.nlink !== 1 || stat.size > DEFAULT_ZIP_EXTRACTION_LIMITS.fileBytes ||
            bytesRead !== 8 || header.toString('ascii', 4, 8) !== 'ftyp') throw unavailable();
    } finally { await handle.close(); }
    check(signal);
    return { mediaFilePath: media, mediaContentType: 'video/mp4', durationMs, animationConfig };
}

/** One readiness contract for both warm hits and new-work root admission. */
async function readPublished(entry: string, signal: AbortSignal, byteLimit: number): Promise<ResolvedGiftAnimation> {
    const tree = await walk(entry, signal, byteLimit, ENTRY_NODES);
    const metadata = record(await readJson(path.join(entry, 'metadata.json'), signal));
    const metadataKeys = ['mediaFilePath', 'mediaContentType', 'durationMs', 'animationConfig'];
    if (!metadata || Object.keys(metadata).length !== metadataKeys.length || !metadataKeys.every(key => Object.hasOwn(metadata, key)) ||
        typeof metadata.mediaFilePath !== 'string' || !within(path.join(entry, 'asset'), metadata.mediaFilePath)) throw unavailable();
    const value = await validateAsset(entry, tree, signal);
    const config = record(metadata.animationConfig);
    const scalarKeys = ['profileName', 'sourceWidth', 'sourceHeight', 'renderWidth', 'renderHeight'] as const;
    const configKeys = [...scalarKeys, 'rgbFrame', 'aFrame'];
    const sameFrame = (input: unknown, expected: number[] | null) => expected === null ? input === null :
        Array.isArray(input) && input.length === expected.length && expected.every((part, index) => input[index] === part);
    if (metadata.mediaFilePath !== value.mediaFilePath || metadata.durationMs !== value.durationMs || metadata.mediaContentType !== value.mediaContentType ||
        !config || Object.keys(config).length !== configKeys.length || !configKeys.every(key => Object.hasOwn(config, key)) ||
        !scalarKeys.every(key => config[key] === value.animationConfig[key]) ||
        !sameFrame(config.rgbFrame, value.animationConfig.rgbFrame) || !sameFrame(config.aFrame, value.animationConfig.aFrame)) throw unavailable();
    check(signal);
    return value;
}

function getGiftAnimationDependencyStatus() {
    return { extraction: { available: true, command: null, implementation: 'bounded-zip' } };
}

/**
 * Published entries are immutable, including on dispose/corruption/quota pressure.
 * One cache owner serializes admission/publication and reserves pending entry
 * slots. Extraction takes an exclusive reservation of the remaining byte budget;
 * concurrent downloads may hold at most maxConcurrent bounded temporary archives.
 * No multi-process quota/lease guarantee is made. Clear the cache only when its
 * playback users have retired. A coalesced job borrows its first caller's budget;
 * later callers do not cancel that shared job and recheck their own signal.
 * Cancellation after the disk commit can populate the cache without returning
 * an asset to the caller; a public readiness marker must never be rolled back.
 */
function createTikTokGiftAnimationResolver(options: ResolverOptions = {}) {
    const maxEntries = options.maxEntries ?? 12;
    const maxCacheBytes = options.maxCacheBytes ?? 512 * 1024 * 1024;
    const maxConcurrent = options.maxConcurrent ?? 2;
    const timeoutMs = options.timeoutMs ?? 30000;
    if (![maxEntries, maxCacheBytes, maxConcurrent, timeoutMs].every(value => Number.isSafeInteger(value) && value > 0) || timeoutMs > 0x7fffffff) throw unavailable();
    const log = options.logger ?? logger;
    const errorHandler = createPlatformErrorHandler(log, 'tiktok-gift-animation');
    const download = options.downloadArchive ?? createArchiveDownloader();
    const configuredRoot = path.resolve(options.cacheDirectory || GIFT_ANIMATION_CACHE_DIR);
    const lifetime = new AbortController();
    const jobs = new Map<string, Promise<ResolvedGiftAnimation | null>>();
    const attempts = new Set<Promise<ResolvedGiftAnimation | null>>();
    const pendingEntries = new Set<string>();
    const worktrees = new Set<string>();
    const publications = new Set<string>();
    let admitted = true;
    let disposal: Promise<void> | undefined;
    let rootPromise: Promise<string> | undefined;
    let cacheTail = Promise.resolve();
    const locked = async <T>(action: () => Promise<T>): Promise<T> => {
        const previous = cacheTail;
        let release!: () => void;
        cacheTail = new Promise<void>(resolve => { release = resolve; });
        await previous;
        try { return await action(); } finally { release(); }
    };
    const report = (key: string, stage: string) => {
        try {
            errorHandler.handleEventProcessingError(unavailable(), 'gift-animation-resolve', { cacheKey: key, stage }, 'Failed resolving TikTok gift animation asset candidate');
            log.debug?.('Gift animation candidate unavailable', 'tiktok-gift-animation', { cacheKey: key, stage });
        } catch { /* Diagnostics must not interrupt cleanup or optional fallback. */ }
    };
    const rootDirectory = () => rootPromise ??= (async () => {
        await fsp.mkdir(configuredRoot, { recursive: true, mode: 0o700 });
        const info = await fsp.lstat(configuredRoot);
        if (!info.isDirectory() || info.isSymbolicLink() ||
            (typeof process.getuid === 'function' && info.uid !== process.getuid())) throw unavailable();
        // Old cache roots may have been created with the process's default mode.
        // Tighten our owned root without removing any retained playback files.
        if (process.platform !== 'win32') await fsp.chmod(configuredRoot, 0o700);
        return fsp.realpath(configuredRoot);
    })();
    const scan = async (root: string, signal: AbortSignal, reservedEntries: number) => {
        if (reservedEntries > maxEntries) throw unavailable();
        const owned = new Set([...worktrees, ...publications]);
        const entries: string[] = [];
        const directory = await fsp.opendir(root, { bufferSize: 32 });
        for await (const item of directory) {
            check(signal);
            const entry = path.join(root, item.name);
            if (owned.has(entry)) continue;
            // SHA-1 URL cache keys are exactly 40 lowercase hexadecimal digits.
            // A workspace-looking prefix is never proof of this owner's admission.
            if (!/^[a-f0-9]{40}$/u.test(item.name) || !item.isDirectory()) throw unavailable();
            entries.push(entry);
            if (entries.length + reservedEntries > maxEntries || entries.length > TREE_NODES) throw unavailable();
        }
        const tree = await walk(root, signal, maxCacheBytes, TREE_NODES, owned);
        for (const entry of entries) await readPublished(entry, signal, maxCacheBytes);
        return { bytes: tree.bytes, entries: entries.length };
    };

    async function run(candidate: Candidate, key: string, signal: AbortSignal): Promise<ResolvedGiftAnimation | null> {
        let work: string | undefined;
        let unpublished: string | undefined;
        let stage = 'cache';
        try {
            check(signal);
            const root = await rootDirectory();
            const entry = path.join(root, key);
            const hit = await locked(async () => {
                check(signal);
                if (await exists(entry)) {
                    return readPublished(entry, signal, maxCacheBytes);
                }
                stage = 'admission';
                const usage = await scan(root, signal, pendingEntries.size + 1);
                if (usage.bytes >= maxCacheBytes) throw unavailable();
                pendingEntries.add(key);
                work = await fsp.mkdtemp(path.join(root, '.gift-work-'));
                worktrees.add(work);
                return null;
            });
            if (hit) { check(signal); return hit; }
            check(signal);
            const privateWork = work!;
            const archive = path.join(privateWork, 'archive.zip');
            const archiveBytes = Math.min(maxCacheBytes, DEFAULT_ZIP_EXTRACTION_LIMITS.archiveBytes);
            stage = 'download';
            await download(candidate.url, archive, { signal, maxBytes: archiveBytes, timeoutMs });
            check(signal);
            const archiveStat = await fsp.lstat(archive);
            if (!archiveStat.isFile() || archiveStat.isSymbolicLink() || archiveStat.size > archiveBytes) throw unavailable();
            return await locked(async () => {
                check(signal);
                stage = 'quota';
                const usage = await scan(root, signal, pendingEntries.size);
                const available = maxCacheBytes - usage.bytes;
                if (available <= 0) throw unavailable();
                stage = 'extract';
                const extracted = await extractBoundedZip(archive, privateWork, { signal, limits: {
                    archiveBytes,
                    fileBytes: Math.min(available, DEFAULT_ZIP_EXTRACTION_LIMITS.fileBytes),
                    totalBytes: Math.min(available, DEFAULT_ZIP_EXTRACTION_LIMITS.totalBytes)
                } });
                check(signal);
                await fsp.rename(extracted.directory, path.join(privateWork, 'asset'));
                await fsp.rm(archive);
                stage = 'validate';
                const tree = await walk(privateWork, signal, available, ENTRY_NODES);
                const local = await validateAsset(privateWork, tree, signal);
                const value = { ...local, mediaFilePath: path.join(entry, path.relative(privateWork, local.mediaFilePath)) };
                const metadata = Buffer.from(JSON.stringify(value));
                stage = 'quota';
                if (metadata.length > JSON_BYTES || tree.bytes + metadata.length > available) throw unavailable();
                await fsp.writeFile(path.join(privateWork, 'metadata.json'), metadata, { flag: 'wx', mode: 0o600, signal });
                check(signal);
                stage = 'publish';
                // Reserve this destination exclusively, then publish its readiness
                // marker by atomic file rename (portable to Windows too). Only
                // an unready reservation can be rolled back. A successful marker
                // rename is a public disk commit, even before its await resumes.
                await fsp.mkdir(entry, { mode: 0o700 });
                unpublished = entry;
                publications.add(entry);
                check(signal);
                await fsp.rename(path.join(privateWork, 'asset'), path.join(entry, 'asset'));
                check(signal);
                await fsp.rename(path.join(privateWork, 'metadata.json'), path.join(entry, 'metadata.json'));
                unpublished = undefined;
                publications.delete(entry);
                pendingEntries.delete(key);
                check(signal);
                return value;
            });
        } catch {
            report(key, signal.aborted ? 'stopped' : stage);
            return null;
        } finally {
            try {
                const cleanup = await Promise.allSettled([
                    ...(unpublished ? [fsp.rm(unpublished, { recursive: true, force: true })] : []),
                    ...(work ? [fsp.rm(work, { recursive: true, force: true })] : [])
                ]);
                if (cleanup.some(result => result.status === 'rejected')) {
                    report(key, 'cleanup');
                    throw unavailable();
                }
            } finally {
                if (work) worktrees.delete(work);
                if (unpublished) publications.delete(unpublished);
                pendingEntries.delete(key);
            }
        }
    }

    function resolveFromNotificationData(data: unknown, context: { signal?: AbortSignal } = {}): Promise<ResolvedGiftAnimation | null> {
        if (!admitted) return Promise.resolve(null);
        const timeout = AbortSignal.timeout(timeoutMs);
        const signal = AbortSignal.any([lifetime.signal, timeout, ...(context.signal ? [context.signal] : [])]);
        // Retain one observer across downloader/extractor/validation transitions
        // (Bun native timeout stops when its last listener is removed).
        const observeStop = () => undefined;
        signal.addEventListener('abort', observeStop, { once: true });
        const attempt = Promise.resolve().then(async () => {
            try {
                for (const candidate of candidatesFrom(data)) {
                    check(signal);
                    if (!admitted) return null;
                    const key = crypto.createHash('sha1').update(candidate.url).digest('hex');
                    let job = jobs.get(key);
                    if (!job) {
                        if (jobs.size >= maxConcurrent) return null;
                        job = Promise.resolve().then(() => run(candidate, key, signal));
                        jobs.set(key, job);
                        void job.then(() => { jobs.delete(key); }, () => { jobs.delete(key); });
                    }
                    const value = await job;
                    check(signal);
                    if (value) return value;
                }
                return null;
            } catch { return null; }
            finally { signal.removeEventListener('abort', observeStop); }
        });
        attempts.add(attempt);
        void attempt.then(() => { attempts.delete(attempt); }, () => { attempts.delete(attempt); });
        return attempt;
    }

    function dispose(): Promise<void> {
        if (disposal) return disposal;
        admitted = false;
        let complete!: () => void;
        disposal = new Promise<void>(resolve => { complete = resolve; });
        lifetime.abort();
        void Promise.allSettled([...attempts, ...jobs.values()]).then(() => complete());
        return disposal;
    }
    return { resolveFromNotificationData, dispose };
}

export { createTikTokGiftAnimationResolver, GIFT_ANIMATION_CACHE_DIR, getGiftAnimationDependencyStatus };
