import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { createPlatformErrorHandler } from './platform-error-handler';
import { getSystemTimestampISO } from './timestamp';

const LOG_CONTEXT = 'token-store';

type LoggerLike = {
    info: (message: string, context?: string, payload?: unknown) => void;
    warn: (message: string, context?: string, payload?: unknown) => void;
};

type TwitchTokenPayload = {
    accessToken?: string | null;
    refreshToken?: string | null;
    expiresAt?: number | null;
    updatedAt?: string;
};

type TokenStoreData = {
    twitch?: TwitchTokenPayload;
    [key: string]: unknown;
};

type FsApi = {
    chmod?: (targetPath: string, mode: number) => Promise<void> | void;
    mkdir?: (dirPath: string, options: { recursive: boolean; mode: number }) => Promise<void> | void;
    stat?: (targetPath: string) => Promise<unknown> | unknown;
    readFile: (targetPath: string, encoding: 'utf8') => Promise<string> | string;
    writeFile: (targetPath: string, content: string, options: { encoding: 'utf8'; mode: number }) => Promise<void> | void;
    rename: (oldPath: string, newPath: string) => Promise<void> | void;
    unlink?: (targetPath: string) => Promise<void> | void;
};

type FsImpl = {
    promises?: FsApi;
    existsSync?: (targetPath: string) => boolean;
} & Partial<FsApi>;

const getErrorCode = (error: unknown): string | null => {
    if (!error || typeof error !== 'object' || !('code' in error)) {
        return null;
    }
    const code = (error as { code?: unknown }).code;
    return typeof code === 'string' ? code : null;
};

const getErrorMessage = (error: unknown): string | null => {
    if (!error || typeof error !== 'object' || !('message' in error)) {
        return null;
    }
    const message = (error as { message?: unknown }).message;
    return typeof message === 'string' ? message : null;
};

const requireTokenStorePath = (tokenStorePath: string) => {
    if (!tokenStorePath) {
        throw new Error('tokenStorePath is required for token persistence');
    }
};

const requireLogger = (logger: unknown): LoggerLike => {
    if (!logger || typeof (logger as { info?: unknown }).info !== 'function') {
        throw new Error('Logger is required for token store operations');
    }
    return logger as LoggerLike;
};

const getFsApi = (fsImpl: unknown): FsApi => {
    const resolved = (fsImpl || fs) as FsImpl;
    return (resolved.promises || resolved) as FsApi;
};

const getErrorHandler = (logger: LoggerLike) => createPlatformErrorHandler(logger, LOG_CONTEXT);

const isPlainObject = (value: unknown): value is Record<string, unknown> => {
    if (!value || typeof value !== 'object') {
        return false;
    }

    const prototype = Object.getPrototypeOf(value);
    return prototype === Object.prototype || prototype === null;
};

const isUnsafeObjectKey = (key: string) => key === '__proto__' || key === 'constructor' || key === 'prototype';

const createInvalidTokenStoreError = (tokenStorePath: string, detail: string) =>
    new Error(`Invalid token store file: ${tokenStorePath} (${detail})`);

const requireOptionalStringField = (
    payload: Record<string, unknown>,
    fieldName: keyof TwitchTokenPayload,
    tokenStorePath: string
) => {
    const value = payload[fieldName];
    if (value === undefined || value === null) {
        return null;
    }

    if (typeof value !== 'string' || value.trim().length === 0) {
        if (fieldName === 'accessToken') {
            throw createInvalidTokenStoreError(tokenStorePath, 'Token store must provide string accessToken');
        }
        throw createInvalidTokenStoreError(tokenStorePath, `malformed twitch.${fieldName}`);
    }

    return value;
};

const validateTwitchTokenPayload = (value: unknown, tokenStorePath: string): TwitchTokenPayload | null => {
    if (value === undefined || value === null) {
        return null;
    }

    if (!isPlainObject(value)) {
        throw createInvalidTokenStoreError(tokenStorePath, 'malformed twitch payload');
    }

    const twitch: TwitchTokenPayload = {};
    const accessToken = requireOptionalStringField(value, 'accessToken', tokenStorePath);
    const refreshToken = requireOptionalStringField(value, 'refreshToken', tokenStorePath);
    const updatedAt = requireOptionalStringField(value, 'updatedAt', tokenStorePath);
    const expiresAt = value.expiresAt;

    if (expiresAt !== undefined && expiresAt !== null) {
        if (typeof expiresAt !== 'number' || !Number.isFinite(expiresAt)) {
            throw createInvalidTokenStoreError(tokenStorePath, 'malformed twitch.expiresAt');
        }
        twitch.expiresAt = expiresAt;
    }

    if (accessToken !== null) {
        twitch.accessToken = accessToken;
    }
    if (refreshToken !== null) {
        twitch.refreshToken = refreshToken;
    }
    if (updatedAt !== null) {
        twitch.updatedAt = updatedAt;
    }

    return twitch;
};

const sanitizeTokenStoreData = (value: unknown, tokenStorePath: string): TokenStoreData => {
    if (!isPlainObject(value)) {
        throw createInvalidTokenStoreError(tokenStorePath, 'expected top-level object');
    }

    const sanitized: TokenStoreData = {};
    for (const [key, fieldValue] of Object.entries(value)) {
        if (isUnsafeObjectKey(key)) {
            continue;
        }

        if (key === 'twitch') {
            const twitch = validateTwitchTokenPayload(fieldValue, tokenStorePath);
            if (twitch) {
                sanitized.twitch = twitch;
            }
            continue;
        }

        sanitized[key] = fieldValue;
    }

    return sanitized;
};

const logTokenStoreError = (
    logger: LoggerLike,
    message: string,
    error: unknown = null,
    payload: Record<string, unknown> | null = null
) => {
    const handler = getErrorHandler(logger);
    if (error instanceof Error) {
        handler.handleEventProcessingError(error, LOG_CONTEXT, payload, message, LOG_CONTEXT);
        return;
    }
    handler.logOperationalError(message, LOG_CONTEXT, payload);
};

const cleanupTempTokenStoreFile = async (fsApi: FsApi, tempPath: string, logger: LoggerLike) => {
    if (typeof fsApi.unlink !== 'function') {
        return;
    }

    try {
        await fsApi.unlink(tempPath);
    } catch (cleanupError) {
        if (getErrorCode(cleanupError) === 'ENOENT') {
            return;
        }

        logTokenStoreError(logger, 'Failed to clean token store temp file', cleanupError, {
            tempPath
        });
    }
};

const isPosixRuntime = () => process.platform !== 'win32';

const trySetPermissions = async (fsApi: FsApi, targetPath: string, mode: number, logger: LoggerLike, contextLabel: string) => {
    if (!isPosixRuntime() || typeof fsApi.chmod !== 'function') {
        return;
    }

    try {
        await fsApi.chmod(targetPath, mode);
    } catch (error) {
        logTokenStoreError(logger, `Failed to set ${contextLabel} permissions`, error, {
            targetPath,
            mode
        });
    }
};

const ensureDirectoryExists = async (fsImpl: unknown, tokenStorePath: string, logger: LoggerLike) => {
    const dirPath = path.dirname(tokenStorePath);
    const fsApi = getFsApi(fsImpl);

    if (typeof fsApi.mkdir === 'function') {
        await fsApi.mkdir(dirPath, { recursive: true, mode: 0o700 });
        await trySetPermissions(fsApi, dirPath, 0o700, logger, 'token store directory');
        return;
    }

    const syncFs = fsImpl as FsImpl | null | undefined;
    if (syncFs && typeof syncFs.existsSync === 'function') {
        if (!syncFs.existsSync(dirPath)) {
            throw new Error(`Token store directory does not exist: ${dirPath}`);
        }
        return;
    }

    try {
        if (typeof fsApi.stat !== 'function') {
            throw new Error(`Token store directory does not exist: ${dirPath}`);
        }
        await fsApi.stat(dirPath);
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            throw new Error(`Token store directory does not exist: ${dirPath}`);
        }
        throw error;
    }
};

const readTokenStoreFile = async (fsImpl: unknown, tokenStorePath: string): Promise<string> => {
    const fsApi = getFsApi(fsImpl);
    return fsApi.readFile(tokenStorePath, 'utf8');
};

const writeTokenStoreFile = async (fsImpl: unknown, tokenStorePath: string, payload: TokenStoreData, logger: LoggerLike) => {
    const fsApi = getFsApi(fsImpl);
    const tempPath = `${tokenStorePath}.${process.pid}.${Date.now()}-${randomUUID()}.tmp`;
    const content = JSON.stringify(payload, null, 2);
    const writeOptions: { encoding: 'utf8'; mode: number } = { encoding: 'utf8', mode: 0o600 };

    try {
        await fsApi.writeFile(tempPath, content, writeOptions);
        await trySetPermissions(fsApi, tempPath, 0o600, logger, 'token store temp file');
        await fsApi.rename(tempPath, tokenStorePath);
        await trySetPermissions(fsApi, tokenStorePath, 0o600, logger, 'token store file');
    } catch (error) {
        await cleanupTempTokenStoreFile(fsApi, tempPath, logger);
        throw error;
    }
};

const parseTokenStore = (raw: string, tokenStorePath: string): TokenStoreData => {
    try {
        return sanitizeTokenStoreData(JSON.parse(raw), tokenStorePath);
    } catch (error) {
        if (getErrorMessage(error)?.startsWith('Invalid token store file:')) {
            throw error;
        }
        throw new Error(`Invalid token store file: ${tokenStorePath}`);
    }
};

const requireSaveStringField = (fieldName: string, value: unknown) => {
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${fieldName} is required to persist tokens`);
    }
    return value;
};

const optionalSaveStringField = (fieldName: string, value: unknown) => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'string' || value.trim().length === 0) {
        throw new Error(`${fieldName} must be a non-empty string when provided`);
    }
    return value;
};

const optionalSaveExpiresAt = (value: unknown) => {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new Error('expiresAt must be a finite number when provided');
    }
    return value;
};

async function loadTokens({ tokenStorePath, fs: fsImpl, logger }: { tokenStorePath: string; fs?: unknown; logger: unknown }) {
    requireTokenStorePath(tokenStorePath);
    const safeLogger = requireLogger(logger);

    try {
        const raw = await readTokenStoreFile(fsImpl, tokenStorePath);
        const data = parseTokenStore(raw, tokenStorePath);
        const twitch = data && data.twitch;

        if (!twitch || (!twitch.accessToken && !twitch.refreshToken)) {
            return null;
        }

        return {
            accessToken: twitch.accessToken || null,
            refreshToken: twitch.refreshToken || null,
            expiresAt: twitch.expiresAt || null
        };
    } catch (error) {
        if (getErrorCode(error) === 'ENOENT') {
            safeLogger.info('Token store file not found; OAuth will be required', LOG_CONTEXT);
            return null;
        }

        logTokenStoreError(safeLogger, 'Failed to load token store', error, { tokenStorePath });
        throw error;
    }
}

async function saveTokens(
    { tokenStorePath, fs: fsImpl, logger }: { tokenStorePath: string; fs?: unknown; logger: unknown },
    { accessToken, refreshToken, expiresAt }: { accessToken: string; refreshToken?: string | null; expiresAt?: number | null }
) {
    requireTokenStorePath(tokenStorePath);
    const safeLogger = requireLogger(logger);

    const safeAccessToken = requireSaveStringField('accessToken', accessToken);
    const safeRefreshToken = optionalSaveStringField('refreshToken', refreshToken);
    const safeExpiresAt = optionalSaveExpiresAt(expiresAt);

    try {
        await ensureDirectoryExists(fsImpl, tokenStorePath, safeLogger);
    } catch (error) {
        logTokenStoreError(safeLogger, 'Token store directory missing', error, { tokenStorePath });
        throw error;
    }

    let existing: TokenStoreData = {};
    try {
        const raw = await readTokenStoreFile(fsImpl, tokenStorePath);
        existing = parseTokenStore(raw, tokenStorePath) || {};
    } catch (error) {
        const errorMessage = getErrorMessage(error);
        if (errorMessage && errorMessage.startsWith('Invalid token store file:')) {
            logTokenStoreError(safeLogger, 'Failed to parse existing token store', error, { tokenStorePath });
            throw error;
        }

        if (getErrorCode(error) !== 'ENOENT') {
            safeLogger.warn('Token store read failed; overwriting with new tokens', LOG_CONTEXT, {
                tokenStorePath,
                error: errorMessage || 'unknown'
            });
        }
    }

    const previousRefreshToken = existing.twitch && existing.twitch.refreshToken;
    const nextRefreshToken = safeRefreshToken || previousRefreshToken;
    const nextPayload: TokenStoreData = {
        ...existing,
        twitch: {
            accessToken: safeAccessToken,
            updatedAt: getSystemTimestampISO()
        }
    };

    if (nextRefreshToken && nextPayload.twitch) {
        nextPayload.twitch.refreshToken = nextRefreshToken;
    }
    if (safeExpiresAt !== null && nextPayload.twitch) {
        nextPayload.twitch.expiresAt = safeExpiresAt;
    }

    try {
        await writeTokenStoreFile(fsImpl, tokenStorePath, nextPayload, safeLogger);
        if (!refreshToken && !previousRefreshToken) {
            safeLogger.warn('Persisted access token without refresh token', LOG_CONTEXT);
        }
        return true;
    } catch (error) {
        logTokenStoreError(safeLogger, 'Failed to persist tokens to store', error, { tokenStorePath });
        throw error;
    }
}

export {
    loadTokens,
    saveTokens
};
