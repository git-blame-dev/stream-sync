const fs = require('fs');
const path = require('path');
const { createPlatformErrorHandler } = require('./platform-error-handler');

const LOG_CONTEXT = 'token-store';

const requireTokenStorePath = (tokenStorePath) => {
    if (!tokenStorePath) {
        throw new Error('tokenStorePath is required for token persistence');
    }
};

const requireLogger = (logger) => {
    if (!logger || typeof logger.info !== 'function') {
        throw new Error('Logger is required for token store operations');
    }
    return logger;
};

const getFsApi = (fsImpl) => {
    const resolved = fsImpl || fs;
    return resolved.promises || resolved;
};

const getErrorHandler = (logger) => createPlatformErrorHandler(logger, LOG_CONTEXT);

const logTokenStoreError = (logger, message, error = null, payload = null) => {
    const handler = getErrorHandler(logger);
    if (error instanceof Error) {
        handler.handleEventProcessingError(error, LOG_CONTEXT, payload, message, LOG_CONTEXT);
        return;
    }
    handler.logOperationalError(message, LOG_CONTEXT, payload);
};

const isPosixRuntime = () => process.platform !== 'win32';

const trySetPermissions = async (fsApi, targetPath, mode, logger, contextLabel) => {
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

const ensureDirectoryExists = async (fsImpl, tokenStorePath, logger) => {
    const dirPath = path.dirname(tokenStorePath);
    const fsApi = getFsApi(fsImpl);

    if (typeof fsApi.mkdir === 'function') {
        await fsApi.mkdir(dirPath, { recursive: true, mode: 0o700 });
        await trySetPermissions(fsApi, dirPath, 0o700, logger, 'token store directory');
        return;
    }

    if (fsImpl && typeof fsImpl.existsSync === 'function') {
        if (!fsImpl.existsSync(dirPath)) {
            throw new Error(`Token store directory does not exist: ${dirPath}`);
        }
        return;
    }

    try {
        await fsApi.stat(dirPath);
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            throw new Error(`Token store directory does not exist: ${dirPath}`);
        }
        throw error;
    }
};

const readTokenStoreFile = async (fsImpl, tokenStorePath) => {
    const fsApi = getFsApi(fsImpl);
    return fsApi.readFile(tokenStorePath, 'utf8');
};

const writeTokenStoreFile = async (fsImpl, tokenStorePath, payload, logger) => {
    const fsApi = getFsApi(fsImpl);
    const tempPath = `${tokenStorePath}.tmp`;
    const content = JSON.stringify(payload, null, 2);
    const writeOptions = { encoding: 'utf8', mode: 0o600 };

    await fsApi.writeFile(tempPath, content, writeOptions);
    await trySetPermissions(fsApi, tempPath, 0o600, logger, 'token store temp file');
    await fsApi.rename(tempPath, tokenStorePath);
    await trySetPermissions(fsApi, tokenStorePath, 0o600, logger, 'token store file');
};

const parseTokenStore = (raw, tokenStorePath) => {
    try {
        return JSON.parse(raw);
    } catch {
        throw new Error(`Invalid token store file: ${tokenStorePath}`);
    }
};

async function loadTokens({ tokenStorePath, fs: fsImpl, logger }) {
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
        if (error && error.code === 'ENOENT') {
            safeLogger.info('Token store file not found; OAuth will be required', LOG_CONTEXT);
            return null;
        }

        logTokenStoreError(safeLogger, 'Failed to load token store', error, { tokenStorePath });
        throw error;
    }
}

async function saveTokens(
    { tokenStorePath, fs: fsImpl, logger },
    { accessToken, refreshToken, expiresAt }
) {
    requireTokenStorePath(tokenStorePath);
    const safeLogger = requireLogger(logger);

    if (!accessToken) {
        throw new Error('accessToken is required to persist tokens');
    }

    try {
        await ensureDirectoryExists(fsImpl, tokenStorePath, safeLogger);
    } catch (error) {
        logTokenStoreError(safeLogger, 'Token store directory missing', error, { tokenStorePath });
        throw error;
    }

    let existing = {};
    try {
        const raw = await readTokenStoreFile(fsImpl, tokenStorePath);
        existing = parseTokenStore(raw, tokenStorePath) || {};
    } catch (error) {
        if (error && error.message && error.message.startsWith('Invalid token store file:')) {
            logTokenStoreError(safeLogger, 'Failed to parse existing token store', error, { tokenStorePath });
            throw error;
        }

        if (!error || error.code !== 'ENOENT') {
            safeLogger.warn('Token store read failed; overwriting with new tokens', LOG_CONTEXT, {
                tokenStorePath,
                error: error ? error.message : 'unknown'
            });
        }
    }

    const previousRefreshToken = existing.twitch && existing.twitch.refreshToken;
    const nextRefreshToken = refreshToken || previousRefreshToken;
    const nextPayload = {
        ...existing,
        twitch: {
            accessToken,
            updatedAt: new Date().toISOString()
        }
    };

    if (nextRefreshToken) {
        nextPayload.twitch.refreshToken = nextRefreshToken;
    }
    if (Number.isFinite(expiresAt)) {
        nextPayload.twitch.expiresAt = expiresAt;
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

async function clearTokens({ tokenStorePath, fs: fsImpl, logger }) {
    requireTokenStorePath(tokenStorePath);
    const safeLogger = requireLogger(logger);

    let existing = {};
    try {
        const raw = await readTokenStoreFile(fsImpl, tokenStorePath);
        existing = parseTokenStore(raw, tokenStorePath) || {};
    } catch (error) {
        if (error && error.code === 'ENOENT') {
            return false;
        }
        logTokenStoreError(safeLogger, 'Failed to clear token store', error, { tokenStorePath });
        throw error;
    }

    if (!existing.twitch) {
        return false;
    }

    const nextPayload = { ...existing };
    delete nextPayload.twitch;

    try {
        await writeTokenStoreFile(fsImpl, tokenStorePath, nextPayload, safeLogger);
        return true;
    } catch (error) {
        logTokenStoreError(safeLogger, 'Failed to write cleared token store', error, { tokenStorePath });
        throw error;
    }
}

module.exports = {
    loadTokens,
    saveTokens,
    clearTokens
};
