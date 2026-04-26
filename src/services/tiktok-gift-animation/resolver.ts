const crypto = require('crypto');
const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const axios = require('axios');

const { logger } = require('../../core/logging');
const { createPlatformErrorHandler } = require('../../utils/platform-error-handler');

const execFileAsyncDefault = promisify(execFile);

const GIFT_ANIMATION_CACHE_DIR = path.join(os.tmpdir(), 'stream-sync-tiktok-gift-animation');
const GIFT_ANIMATION_MAX_ENTRIES = 12;

function fileExists(candidatePath) {
    if (typeof candidatePath !== 'string' || candidatePath.trim().length === 0) {
        return false;
    }

    try {
        return fs.statSync(candidatePath).isFile();
    } catch {
        return false;
    }
}

function normalizeString(value) {
    return typeof value === 'string' ? value.trim() : '';
}

function uniqueNonEmpty(values = []) {
    const seen = new Set();
    const result = [];

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

function buildUnzipBinaryCandidates(options = {}) {
    const configuredUnzipBinaries = Array.isArray(options.unzipBinaries)
        ? options.unzipBinaries
        : [options.unzipBinary];

    const candidates = [...configuredUnzipBinaries, 'unzip'];
    if (process.platform !== 'win32') {
        candidates.push('/usr/bin/unzip', '/bin/unzip');
    }

    return uniqueNonEmpty(candidates);
}

function resolveMetadataDurationMs(profile = {}) {
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

function resolveCommandInPath(commandName, options = {}) {
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

function resolveFirstAvailableCommand(candidates, options = {}) {
    for (const candidate of uniqueNonEmpty(candidates)) {
        const resolved = resolveCommandInPath(candidate, options);
        if (resolved) {
            return resolved;
        }
    }
    return null;
}

function getGiftAnimationDependencyStatus(options = {}) {
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

function normalizeFrame(value) {
    if (!Array.isArray(value) || value.length < 4) {
        return null;
    }

    const parsed = value.slice(0, 4).map((entry) => Number(entry));
    if (!parsed.every((entry) => Number.isFinite(entry) && entry >= 0)) {
        return null;
    }

    return parsed;
}

function sanitizeAnimationConfig(profileInfo) {
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

function resolveAnimationProfile(configObject) {
    if (!configObject || typeof configObject !== 'object') {
        return null;
    }

    const orderedProfiles = [];
    if (configObject.portrait && typeof configObject.portrait === 'object') {
        orderedProfiles.push({ profileName: 'portrait', profile: configObject.portrait });
    }

    for (const [key, value] of Object.entries(configObject)) {
        if (key === 'portrait' || !value || typeof value !== 'object') {
            continue;
        }
        orderedProfiles.push({ profileName: key, profile: value });
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

function scoreAnimationCandidate(candidate) {
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

function extractAnimationCandidates(originalData) {
    if (!originalData || typeof originalData !== 'object') {
        return [];
    }

    const asset = originalData.asset && typeof originalData.asset === 'object'
        ? originalData.asset
        : {};
    const candidates = [];

    const pushCandidate = (url, label) => {
        const normalizedUrl = normalizeString(url);
        if (!normalizedUrl) {
            return;
        }
        candidates.push({ url: normalizedUrl, label: normalizeString(label) });
    };

    const resources = Array.isArray(asset.videoResourceList) ? asset.videoResourceList : [];
    for (const resource of resources) {
        if (!resource || typeof resource !== 'object') {
            continue;
        }

        const label = resource.videoTypeName || resource.format || resource.qualityType;
        const urlList = Array.isArray(resource.videoUrl?.urlList) ? resource.videoUrl.urlList : [];
        for (const url of urlList) {
            pushCandidate(url, label);
        }
        pushCandidate(resource.mainUrl, label);
    }

    const resourceModelUrls = Array.isArray(asset.resourceModel?.urlList) ? asset.resourceModel.urlList : [];
    for (const url of resourceModelUrls) {
        pushCandidate(url, 'resourceModel');
    }
    pushCandidate(asset.resourceUri, 'resourceUri');

    const deduped = new Map();
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

function isPathWithin(rootPath, candidatePath) {
    const normalizedRoot = path.resolve(rootPath);
    const normalizedCandidate = path.resolve(candidatePath);
    return normalizedCandidate === normalizedRoot
        || normalizedCandidate.startsWith(`${normalizedRoot}${path.sep}`);
}

function isMissingExecutableError(error, executableName) {
    const name = normalizeString(executableName).toLowerCase();
    if (!name) {
        return false;
    }

    if (error && error.code === 'ENOENT') {
        return true;
    }

    const message = normalizeString(error && error.message).toLowerCase();
    return message.includes('executable not found') && message.includes(name);
}

function createTikTokGiftAnimationResolver(options = {}) {
    const resolverLogger = options.logger || logger;
    const errorHandler = createPlatformErrorHandler(resolverLogger, 'tiktok-gift-animation');
    const cacheDirectory = normalizeString(options.cacheDirectory) || GIFT_ANIMATION_CACHE_DIR;
    const maxEntries = Number.isInteger(options.maxEntries) && options.maxEntries > 0
        ? options.maxEntries
        : GIFT_ANIMATION_MAX_ENTRIES;

    const fetchBinary = options.fetchBinary || ((url, requestOptions) => axios.get(url, {
        responseType: 'arraybuffer',
        timeout: requestOptions.timeout
    }));
    const executeFile = options.executeFile || execFileAsyncDefault;

    const logDebug = (message, data = null) => {
        if (!resolverLogger || typeof resolverLogger.debug !== 'function') {
            return;
        }
        resolverLogger.debug(message, 'tiktok-gift-animation', data);
    };

    const inFlight = new Map();

    const extractZipArchive = async (zipPath, extractDirectory) => {
        const unzipBinaries = buildUnzipBinaryCandidates(options);

        const tried = new Set();
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

    const pruneCache = async () => {
        await fsp.mkdir(cacheDirectory, { recursive: true });
        const entries = await fsp.readdir(cacheDirectory, { withFileTypes: true });
        const directories = [];

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
            await fsp.rm(directories[index].entryPath, { recursive: true, force: true });
        }
    };

    const touchCacheEntry = async (entryDirectory) => {
        const now = new Date();
        try {
            await fsp.utimes(entryDirectory, now, now);
        } catch {
            return;
        }
    };

    const readJson = async (filePath) => {
        const raw = await fsp.readFile(filePath, 'utf8');
        return JSON.parse(raw);
    };

    const ensureMediaPathWithinExtractDirectory = async (extractDirectory, mediaFilePath) => {
        const extractDirectoryRealPath = await fsp.realpath(extractDirectory);
        const mediaFileRealPath = await fsp.realpath(mediaFilePath);
        if (!isPathWithin(extractDirectoryRealPath, mediaFileRealPath)) {
            throw new Error('Gift animation media path escapes extract directory');
        }
        return mediaFileRealPath;
    };

    const resolveCandidate = async (candidate) => {
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
                const metadata = await readJson(metadataPath);
                if (metadata && typeof metadata.mediaFilePath === 'string' && fs.existsSync(metadata.mediaFilePath)) {
                    const extractDirectory = path.join(entryDirectory, 'asset');
                    const safeMediaPath = await ensureMediaPathWithinExtractDirectory(extractDirectory, metadata.mediaFilePath);
                    await touchCacheEntry(entryDirectory);
                    await pruneCache();
                    logDebug('Resolved TikTok gift animation from cache', {
                        candidateUrl: candidate.url,
                        cacheKey,
                        durationMs: metadata.durationMs
                    });
                    return {
                        ...metadata,
                        mediaFilePath: safeMediaPath
                    };
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
            await fsp.writeFile(zipPath, Buffer.from(response.data));
            await extractZipArchive(zipPath, extractDirectory);

            const configObject = await readJson(path.join(extractDirectory, 'config.json'));
            const profileInfo = resolveAnimationProfile(configObject);
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

            const resolved = {
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

    const resolveFromNotificationData = async (notificationData) => {
        await initPromise;

        const candidates = extractAnimationCandidates(notificationData?.enhancedGiftData?.originalData);
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

module.exports = {
    createTikTokGiftAnimationResolver,
    GIFT_ANIMATION_CACHE_DIR,
    getGiftAnimationDependencyStatus
};
