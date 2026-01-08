const { withTimeout } = require('../utils/timeout-wrapper');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

const DEFAULT_TIMEOUT_MS = 2000;

function createResolverErrorHandler(logger) {
    if (!logger || typeof logger.error !== 'function') {
        return null;
    }

    const errorHandler = createPlatformErrorHandler(logger, 'youtube-channel-resolver');
    return function handleResolverError(message, error, eventType = 'channel-resolve', eventData = null) {
        if (error instanceof Error) {
            errorHandler.handleEventProcessingError(error, eventType, eventData, message, 'youtube-channel-resolver');
            return;
        }

        const fallbackError = new Error(message);
        errorHandler.handleEventProcessingError(fallbackError, eventType, eventData, message, 'youtube-channel-resolver');
    };
}

function normalizeChannelHandle(channelHandle) {
    if (!channelHandle || typeof channelHandle !== 'string') {
        return '';
    }
    return channelHandle.trim();
}

function isChannelId(channelHandle) {
    if (!channelHandle || typeof channelHandle !== 'string') {
        return false;
    }

    return /^UC[a-zA-Z0-9_\-]{22}$/.test(channelHandle);
}

function normalizeHandleForCache(channelHandle) {
    const trimmed = normalizeChannelHandle(channelHandle);
    if (!trimmed || isChannelId(trimmed)) {
        return '';
    }
    return trimmed.replace(/^@/, '').toLowerCase();
}

function buildHandleUrl(handleKey) {
    return `https://www.youtube.com/@${handleKey}`;
}

async function resolveChannelId(innertubeClient, channelHandle, options = {}) {
    const timeout = Number.isFinite(options.timeout) ? options.timeout : DEFAULT_TIMEOUT_MS;
    const logger = options.logger;
    const onError = options.onError;
    const throwOnError = options.throwOnError === true;
    const handleError = onError || createResolverErrorHandler(logger);

    const trimmedHandle = normalizeChannelHandle(channelHandle);
    if (!trimmedHandle) {
        if (handleError) {
            handleError('Channel handle is required', new Error('Missing channel handle'), 'channel-resolve', {
                channelHandle
            });
        }
        return null;
    }

    if (isChannelId(trimmedHandle)) {
        return trimmedHandle;
    }

    const handleKey = normalizeHandleForCache(trimmedHandle);
    if (!handleKey) {
        if (handleError) {
            handleError('Invalid channel handle', new Error('Invalid channel handle'), 'channel-resolve', {
                channelHandle: trimmedHandle
            });
        }
        return null;
    }

    if (!innertubeClient || typeof innertubeClient.resolveURL !== 'function') {
        const unavailableError = new Error('resolveURL unavailable');
        if (handleError) {
            handleError('YouTube resolveURL is unavailable', unavailableError, 'channel-resolve', {
                channelHandle: handleKey
            });
        }
        if (throwOnError) {
            throw unavailableError;
        }
        return null;
    }

    try {
        const handleUrl = buildHandleUrl(handleKey);
        const resolved = await withTimeout(
            innertubeClient.resolveURL(handleUrl),
            timeout,
            'YouTube resolveURL operation'
        );
        const browseId = resolved?.payload?.browseId;

        if (!browseId || typeof browseId !== 'string' || !browseId.trim()) {
            if (handleError) {
                handleError('Channel not found', new Error('Channel not found'), 'channel-resolve', {
                    channelHandle: handleKey
                });
            }
            return null;
        }

        return browseId.trim();
    } catch (error) {
        if (handleError) {
            handleError(`Channel resolution failed: ${error.message}`, error, 'channel-resolve', {
                channelHandle: handleKey
            });
        }
        if (throwOnError) {
            throw error;
        }
        return null;
    }
}

module.exports = {
    normalizeChannelHandle,
    normalizeHandleForCache,
    isChannelId,
    resolveChannelId
};
