import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import * as axios from 'axios';

import { logger } from '../../core/logging';
import { createPlatformErrorHandler } from '../../utils/platform-error-handler';

const execFileAsyncDefault = promisify(execFile);
const axiosClient = axios.default || axios;

const GIFT_ANIMATION_CACHE_DIR = path.join(os.tmpdir(), 'stream-sync-tiktok-gift-animation');
const GIFT_ANIMATION_MAX_ENTRIES = 12;

type ResolverLogger = {
debug?: (message: string, scope?: string, payload?: unknown) => void;
};

type ResolverOptions = {
logger?: ResolverLogger;
cacheDirectory?: unknown;
maxEntries?: unknown;
fetchBinary?: (url: string, requestOptions: { timeout: number }) => Promise<{ data: ArrayBuffer | Buffer | Uint8Array | string }>;
executeFile?: (file: string, args: string[]) => Promise<{ stdout?: string; stderr?: string }>;
unzipBinary?: unknown;
unzipBinaries?: unknown;
fileExists?: (candidatePath: string) => boolean;
platform?: unknown;
pathEnv?: unknown;
pathext?: unknown;
};

type AnimationCandidate = { url: string; label: string };
type RankedAnimationCandidate = AnimationCandidate & { score: number };

type AnimationConfig = {
profileName: unknown;
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

type FetchBinaryData = ArrayBuffer | Buffer | Uint8Array | string;

function fileExists(candidatePath: unknown): boolean {
    if (typeof candidatePath !== 'string' || candidatePath.trim().length === 0) {
        return false;
    }

    try {
        return fs.statSync(candidatePath).isFile();
    } catch {
        return false;
    }
}

function normalizeString(value: unknown): string {
    return typeof value === 'string' ? value.trim() : '';
}

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, unknown>;
}

function hasErrorCode(error: unknown, code: string): boolean {
    const errorRecord = asRecord(error);
    return errorRecord?.code === code;
}

function isResolvedGiftAnimation(value: unknown): value is ResolvedGiftAnimation {
    const record = asRecord(value);
    const animationConfig = asRecord(record?.animationConfig);
    return typeof record?.mediaFilePath === 'string'
        && typeof record.mediaContentType === 'string'
        && typeof record.durationMs === 'number'
        && Number.isFinite(record.durationMs)
        && animationConfig !== null;
}

function toBuffer(data: FetchBinaryData): Buffer {
    if (typeof data === 'string') {
        return Buffer.from(data);
    }
    if (data instanceof ArrayBuffer) {
        return Buffer.from(new Uint8Array(data));
    }
    return Buffer.from(data);
}

function uniqueNonEmpty(values: unknown[] = []): string[] {
    const seen = new Set<string>();
    const result: string[] = [];

    for (const value of values) {
        const normalized = normalizeString(value);
        if (!normalized || seen.has(normalized)) {
            continue;
        }
        seen.add(normalized);
        result.push(normalized);
    }

    return result;
}

function buildUnzipBinaryCandidates(options: ResolverOptions = {}): string[] {
    const configuredUnzipBinaries = Array.isArray(options.unzipBinaries)
        ? options.unzipBinaries
        : [options.unzipBinary];

    const candidates = [...configuredUnzipBinaries, 'unzip'];
    if (process.platform !== 'win32') {
        candidates.push('/usr/bin/unzip', '/bin/unzip');
    }

    return uniqueNonEmpty(candidates);
}

function resolveMetadataDurationMs(profile: Record<string, unknown> = {}): number {
    const frameCount = Number(profile.f);
    if (Number.isFinite(frameCount) && frameCount > 0) {
        return Math.round((frameCount / 30) * 1000);
    }

    const durationMs = Number(profile.durationMs);
    if (Number.isFinite(durationMs) && durationMs > 0) {
        return Math.round(durationMs);
    }

    const durationSeconds = Number(profile.duration);
    if (Number.isFinite(durationSeconds) && durationSeconds > 0) {
        return Math.round(durationSeconds * 1000);
    }

    return 0;
}

function resolveCommandInPath(commandName: unknown, options: ResolverOptions = {}): string | null {
    const command = normalizeString(commandName);
    if (!command) {
        return null;
    }

    const fileExistsFn = typeof options.fileExists === 'function' ? options.fileExists : fileExists;
    if (path.isAbsolute(command) || command.includes(path.sep)) {
        return fileExistsFn(command) ? command : null;
    }

    const runtimePlatform = normalizeString(options.platform) || process.platform;
    const pathEnv = typeof options.pathEnv === 'string' ? options.pathEnv : (process.env.PATH || '');
    const pathEntries = pathEnv
        .split(path.delimiter)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);

    const hasExtension = path.extname(command).length > 0;
    let extensions = [''];
    if (runtimePlatform === 'win32' && !hasExtension) {
        const pathext = typeof options.pathext === 'string' ? options.pathext : (process.env.PATHEXT || '.EXE;.CMD;.BAT;.COM');
        extensions = uniqueNonEmpty(pathext.split(';')).map((entry) => entry.toLowerCase());
    }

    for (const entry of pathEntries) {
        for (const extension of extensions) {
            const suffix = runtimePlatform === 'win32' ? extension : '';
            const candidate = path.join(entry, `${command}${suffix}`);
            if (fileExistsFn(candidate)) {
                return candidate;
            }
        }
    }

    return null;
}

function resolveFirstAvailableCommand(candidates: unknown[], options: ResolverOptions = {}): string | null {
    for (const candidate of uniqueNonEmpty(candidates)) {
        const resolved = resolveCommandInPath(candidate, options);
        if (resolved) {
            return resolved;
        }
    }
    return null;
}

function getGiftAnimationDependencyStatus(options: ResolverOptions = {}): {
unzip: { available: boolean; command: string | null; candidates: string[] };
extraction: { available: boolean; command: string | null };
} {
    const unzipCandidates = buildUnzipBinaryCandidates(options);

    const unzipCommand = resolveFirstAvailableCommand(unzipCandidates, options);

    return {
        unzip: {
            available: !!unzipCommand,
            command: unzipCommand || null,
            candidates: unzipCandidates
        },
        extraction: {
            available: !!unzipCommand,
            command: unzipCommand || null
        }
    };
}

function normalizeFrame(value: unknown): number[] | null {
    if (!Array.isArray(value) || value.length < 4) {
        return null;
    }

    const parsed = value.slice(0, 4).map((entry) => Number(entry));
    if (!parsed.every((entry) => Number.isFinite(entry) && entry >= 0)) {
        return null;
    }

    return parsed;
}

function sanitizeAnimationConfig(profileInfo: { profileName?: unknown; profile?: Record<string, unknown> } | null | undefined): AnimationConfig | null {
    if (!profileInfo || !profileInfo.profile) {
        return null;
    }

    const profile = profileInfo.profile;
    const sourceWidth = Number(profile.videoW);
    const sourceHeight = Number(profile.videoH);
    const renderWidth = Number(profile.w);
    const renderHeight = Number(profile.h);
    const rgbFrame = normalizeFrame(profile.rgbFrame);
    const aFrame = normalizeFrame(profile.aFrame);

    if (!Number.isFinite(sourceWidth) || sourceWidth <= 0) {
        return null;
    }
    if (!Number.isFinite(sourceHeight) || sourceHeight <= 0) {
        return null;
    }
    if (!Number.isFinite(renderWidth) || renderWidth <= 0) {
        return null;
    }
    if (!Number.isFinite(renderHeight) || renderHeight <= 0) {
        return null;
    }
    if (!rgbFrame) {
        return null;
    }

    return {
        profileName: profileInfo.profileName,
        sourceWidth,
        sourceHeight,
        renderWidth,
        renderHeight,
        rgbFrame,
        aFrame
    };
}

function resolveAnimationProfile(configObject: Record<string, unknown> | null | undefined): {
profileName: unknown;
profile: Record<string, unknown>;
animationConfig: AnimationConfig;
} | null {
    if (!configObject || typeof configObject !== 'object') {
        return null;
    }

const orderedProfiles: Array<{ profileName: unknown; profile: Record<string, unknown> }> = [];
    const portraitProfile = asRecord(configObject.portrait);
    if (portraitProfile) {
        orderedProfiles.push({ profileName: 'portrait', profile: portraitProfile });
    }

    for (const [key, value] of Object.entries(configObject)) {
        const profile = asRecord(value);
        if (key === 'portrait' || !profile) {
            continue;
        }
        orderedProfiles.push({ profileName: key, profile });
    }

    if (normalizeString(configObject.path)) {
        orderedProfiles.push({ profileName: 'default', profile: configObject });
    }

    for (const profileInfo of orderedProfiles) {
        const animationConfig = sanitizeAnimationConfig(profileInfo);
        if (animationConfig) {
            return {
                profileName: profileInfo.profileName,
                profile: profileInfo.profile,
                animationConfig
            };
        }
    }

    return null;
}

function scoreAnimationCandidate(candidate: AnimationCandidate): number {
    const label = normalizeString(candidate.label).toLowerCase();
    const url = normalizeString(candidate.url).toLowerCase();
    if (!url || label.includes('encrypt') || url.includes('encrypt')) {
        return -1;
    }

    let score = 20;
    if (label.includes('h264')) score += 100;
    if (label.includes('bytevc1')) score += 90;
    if (label.includes('bvc1')) score += 80;
    if (label.includes('480p')) score -= 10;
    if (label.includes('crop')) score -= 15;
    if (!label) score += 10;
    return score;
}

function extractAnimationCandidates(originalData: unknown): RankedAnimationCandidate[] {
    if (!originalData || typeof originalData !== 'object') {
        return [];
    }

    const originalRecord = originalData as Record<string, unknown>;
    const asset = originalRecord.asset && typeof originalRecord.asset === 'object'
        ? originalRecord.asset as Record<string, unknown>
        : {};
    const candidates: AnimationCandidate[] = [];

const pushCandidate = (url: unknown, label: unknown): void => {
        const normalizedUrl = normalizeString(url);
        if (!normalizedUrl) {
            return;
        }
        candidates.push({ url: normalizedUrl, label: normalizeString(label) });
    };

    const resources: unknown[] = Array.isArray(asset.videoResourceList) ? asset.videoResourceList : [];
    for (const resource of resources) {
        if (!resource || typeof resource !== 'object') {
            continue;
        }

        const resourceRecord = resource as Record<string, unknown>;
        const label = resourceRecord.videoTypeName || resourceRecord.format || resourceRecord.qualityType;
        const videoUrlRecord = resourceRecord.videoUrl && typeof resourceRecord.videoUrl === 'object'
            ? resourceRecord.videoUrl as Record<string, unknown>
            : {};
        const urlList: unknown[] = Array.isArray(videoUrlRecord.urlList) ? videoUrlRecord.urlList : [];
        for (const url of urlList) {
            pushCandidate(url, label);
        }
        pushCandidate(resourceRecord.mainUrl, label);
    }

    const resourceModel = asset.resourceModel && typeof asset.resourceModel === 'object'
        ? asset.resourceModel as Record<string, unknown>
        : {};
    const resourceModelUrls: unknown[] = Array.isArray(resourceModel.urlList) ? resourceModel.urlList : [];
    for (const url of resourceModelUrls) {
        pushCandidate(url, 'resourceModel');
    }
    pushCandidate(asset.resourceUri, 'resourceUri');

    const deduped = new Map<string, AnimationCandidate>();
    for (const candidate of candidates) {
        if (!deduped.has(candidate.url)) {
            deduped.set(candidate.url, candidate);
        }
    }

    return Array.from(deduped.values())
        .map((candidate) => ({ ...candidate, score: scoreAnimationCandidate(candidate) }))
        .filter((candidate) => candidate.score >= 0)
        .sort((left, right) => right.score - left.score);
}

function isPathWithin(rootPath: string, candidatePath: string): boolean {
    const normalizedRoot = path.resolve(rootPath);
    const normalizedCandidate = path.resolve(candidatePath);
    return normalizedCandidate === normalizedRoot
        || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function isMissingExecutableError(error: unknown, executableName: unknown): boolean {
    const name = normalizeString(executableName).toLowerCase();
    if (!name) {
        return false;
    }

    if (hasErrorCode(error, 'ENOENT')) {
        return true;
    }

    const message = normalizeString(asRecord(error)?.message).toLowerCase();
    return message.includes('executable not found') && message.includes(name);
}

function createTikTokGiftAnimationResolver(options: ResolverOptions = {}): { resolveFromNotificationData: (notificationData: unknown) => Promise<ResolvedGiftAnimation | null> } {
    const resolverLogger = options.logger || logger;
    const errorHandler = createPlatformErrorHandler(resolverLogger, 'tiktok-gift-animation');
    const cacheDirectory = normalizeString(options.cacheDirectory) || GIFT_ANIMATION_CACHE_DIR;
    const configuredMaxEntries = Number(options.maxEntries);
    const maxEntries = Number.isInteger(configuredMaxEntries) && configuredMaxEntries > 0
        ? configuredMaxEntries
        : GIFT_ANIMATION_MAX_ENTRIES;

    const fetchBinary = options.fetchBinary || ((url, requestOptions) => axiosClient.get(url, {
        responseType: 'arraybuffer',
        timeout: requestOptions.timeout
    }));
    const executeFile = options.executeFile || execFileAsyncDefault;

const logDebug = (message: string, data: unknown = null): void => {
        if (!resolverLogger || typeof resolverLogger.debug !== 'function') {
            return;
        }
        resolverLogger.debug(message, 'tiktok-gift-animation', data);
    };

const inFlight = new Map<string, Promise<ResolvedGiftAnimation>>();

const extractZipArchive = async (zipPath: string, extractDirectory: string): Promise<void> => {
        const unzipBinaries = buildUnzipBinaryCandidates(options);

        const tried = new Set<string>();
        for (const unzipBinary of unzipBinaries) {
            if (tried.has(unzipBinary)) {
                continue;
            }
            tried.add(unzipBinary);

            try {
                await executeFile(unzipBinary, ['-o', zipPath, '-d', extractDirectory]);
                return;
            } catch (unzipError) {
                if (isMissingExecutableError(unzipError, unzipBinary)) {
                    continue;
                }

                if (unzipBinary !== 'unzip') {
                    if (isMissingExecutableError(unzipError, 'unzip')) {
                        continue;
                    }
                }

                throw unzipError;
            }
        }

        throw new Error('Gift animation extraction requires unzip in PATH');
    };

const pruneCache = async (): Promise<void> => {
        await fsp.mkdir(cacheDirectory, { recursive: true });
        const entries = await fsp.readdir(cacheDirectory, { withFileTypes: true });
const directories: Array<{ entryPath: string; modifiedAtMs: number }> = [];

        for (const entry of entries) {
            if (!entry.isDirectory()) {
                continue;
            }

            const entryPath = path.join(cacheDirectory, entry.name);
            try {
                const stat = await fsp.stat(entryPath);
                directories.push({ entryPath, modifiedAtMs: stat.mtimeMs });
            } catch {
                continue;
            }
        }

        directories.sort((left, right) => right.modifiedAtMs - left.modifiedAtMs);
        for (let index = maxEntries; index < directories.length; index += 1) {
            const directory = directories[index];
            if (!directory) {
                continue;
            }
            await fsp.rm(directory.entryPath, { recursive: true, force: true });
        }
    };

const touchCacheEntry = async (entryDirectory: string): Promise<void> => {
        const now = new Date();
        try {
            await fsp.utimes(entryDirectory, now, now);
        } catch {
            return;
        }
    };

const removeCacheEntry = async (entryDirectory: string): Promise<void> => {
        await fsp.rm(entryDirectory, { recursive: true, force: true });
    };

const readJson = async (filePath: string): Promise<unknown> => {
        const raw = await fsp.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    };

const ensureMediaPathWithinExtractDirectory = async (extractDirectory: string, mediaFilePath: string): Promise<string> => {
        const extractDirectoryRealPath = await fsp.realpath(extractDirectory);
        const mediaFileRealPath = await fsp.realpath(mediaFilePath);
        if (!isPathWithin(extractDirectoryRealPath, mediaFileRealPath)) {
            throw new Error('Gift animation media path escapes extract directory');
        }
        return mediaFileRealPath;
    };

const resolveCandidate = async (candidate: RankedAnimationCandidate): Promise<ResolvedGiftAnimation> => {
        const cacheKey = crypto.createHash('sha1').update(candidate.url).digest('hex');
        const existingPromise = inFlight.get(cacheKey);
        if (existingPromise) {
            return existingPromise;
        }

        const resolverPromise = (async () => {
            const entryDirectory = path.join(cacheDirectory, cacheKey);
            const metadataPath = path.join(entryDirectory, 'metadata.json');

            await fsp.mkdir(entryDirectory, { recursive: true });

            if (fs.existsSync(metadataPath)) {
                let resolvedFromCache: ResolvedGiftAnimation | null = null;
                try {
                    const metadata = await readJson(metadataPath);
                    const metadataRecord = asRecord(metadata);
                    const metadataMediaFilePath = typeof metadataRecord?.mediaFilePath === 'string'
                        ? metadataRecord.mediaFilePath
                        : '';
                    if (!metadataRecord || !metadataMediaFilePath || !fs.existsSync(metadataMediaFilePath)) {
                        throw new Error('Cached gift animation metadata is invalid');
                    }

                    const extractDirectory = path.join(entryDirectory, 'asset');
                    const safeMediaPath = await ensureMediaPathWithinExtractDirectory(extractDirectory, metadataMediaFilePath);
                    const cacheCandidate = {
                        ...metadataRecord,
                        mediaFilePath: safeMediaPath
                    };
                    if (!isResolvedGiftAnimation(cacheCandidate)) {
                        throw new Error('Cached gift animation metadata is invalid');
                    }
                    resolvedFromCache = cacheCandidate;
                } catch (cacheError) {
                    logDebug('Evicting corrupt TikTok gift animation cache entry', {
                        candidateUrl: candidate.url,
                        cacheKey,
                        error: normalizeString(asRecord(cacheError)?.message) || String(cacheError)
                    });
                    await removeCacheEntry(entryDirectory);
                    await fsp.mkdir(entryDirectory, { recursive: true });
                }

                if (resolvedFromCache) {
                    await touchCacheEntry(entryDirectory);
                    await pruneCache();
                    logDebug('Resolved TikTok gift animation from cache', {
                        candidateUrl: candidate.url,
                        cacheKey,
                        durationMs: resolvedFromCache.durationMs
                    });
                    return resolvedFromCache;
                }
            }

            const zipPath = path.join(entryDirectory, 'asset.zip');
            const extractDirectory = path.join(entryDirectory, 'asset');
            await fsp.mkdir(extractDirectory, { recursive: true });

            logDebug('Downloading TikTok gift animation candidate', {
                candidateUrl: candidate.url,
                cacheKey
            });
            const response = await fetchBinary(candidate.url, { timeout: 30000 });
            await fsp.writeFile(zipPath, toBuffer(response.data));
            await extractZipArchive(zipPath, extractDirectory);

            const configObject = await readJson(path.join(extractDirectory, 'config.json'));
            const profileInfo = resolveAnimationProfile(asRecord(configObject));
            if (!profileInfo || !profileInfo.animationConfig) {
                throw new Error('Gift animation profile is invalid');
            }

            const preferredPath = normalizeString(profileInfo.profile.path);
            let mediaFilePath = preferredPath
                ? path.resolve(extractDirectory, preferredPath)
                : path.resolve(extractDirectory, 'output.mp4');

            if (!isPathWithin(extractDirectory, mediaFilePath)) {
                throw new Error('Gift animation path escaped extract directory');
            }

            if (!fs.existsSync(mediaFilePath)) {
                const files = await fsp.readdir(extractDirectory);
                const fallback = files.find((entry) => entry.toLowerCase().endsWith('.mp4'));
                if (!fallback) {
                    throw new Error('Gift animation mp4 not found');
                }

                mediaFilePath = path.join(extractDirectory, fallback);
                if (!isPathWithin(extractDirectory, mediaFilePath)) {
                    throw new Error('Gift animation fallback path escaped extract directory');
                }
            }

            mediaFilePath = await ensureMediaPathWithinExtractDirectory(extractDirectory, mediaFilePath);

            const durationMs = resolveMetadataDurationMs(profileInfo.profile);
            if (!durationMs || durationMs <= 0) {
                throw new Error('Gift animation duration unavailable');
            }

            const resolved: ResolvedGiftAnimation = {
                mediaFilePath,
                mediaContentType: 'video/mp4',
                durationMs,
                animationConfig: profileInfo.animationConfig
            };

            await fsp.writeFile(metadataPath, JSON.stringify(resolved));
            await touchCacheEntry(entryDirectory);
            await pruneCache();
            logDebug('Resolved TikTok gift animation candidate', {
                candidateUrl: candidate.url,
                cacheKey,
                durationMs: resolved.durationMs,
                profileName: resolved.animationConfig?.profileName || null
            });
            return resolved;
        })();

        inFlight.set(cacheKey, resolverPromise);
        try {
            return await resolverPromise;
        } finally {
            inFlight.delete(cacheKey);
        }
    };

    const initPromise = pruneCache();

const resolveFromNotificationData = async (notificationData: unknown): Promise<ResolvedGiftAnimation | null> => {
        await initPromise;

        const notificationRecord = asRecord(notificationData);
        const enhancedGiftData = asRecord(notificationRecord?.enhancedGiftData);
        const candidates = extractAnimationCandidates(enhancedGiftData?.originalData);
        logDebug('Resolving TikTok gift animation candidates', {
            candidateCount: candidates.length
        });
        if (candidates.length === 0) {
            logDebug('No TikTok gift animation candidates found', {
                candidateCount: 0
            });
            return null;
        }

        for (const candidate of candidates) {
            logDebug('Trying TikTok gift animation candidate', {
                candidateUrl: candidate.url,
                label: candidate.label,
                score: candidate.score
            });
            try {
                const resolved = await resolveCandidate(candidate);
                if (resolved) {
                    logDebug('Selected TikTok gift animation candidate', {
                        candidateUrl: candidate.url,
                        durationMs: resolved.durationMs,
                        profileName: resolved.animationConfig?.profileName || null
                    });
                    return resolved;
                }
            } catch (error) {
                errorHandler.handleEventProcessingError(
                    error,
                    'gift-animation-resolve',
                    { url: candidate.url },
                    'Failed resolving TikTok gift animation asset candidate'
                );
            }
        }

        return null;
    };

    return {
        resolveFromNotificationData
    };
}

export {
    createTikTokGiftAnimationResolver,
    GIFT_ANIMATION_CACHE_DIR,
    getGiftAnimationDependencyStatus
};
