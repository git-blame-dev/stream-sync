import { YOUTUBE } from '../core/endpoints';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { withTimeout } from '../utils/timeout-wrapper';
import { sanitizeLogText } from '../core/logger/safe-log-serializer';

const DEFAULT_TIMEOUT_MS = 2000;
const MAX_HANDLE_LENGTH = 128;

type ResolverLogger = {
    error: (message: string, scope?: string, payload?: unknown) => void;
};

type ResolverClient = {
    resolveURL?: (url: string) => Promise<{
        payload?: {
            browseId?: unknown;
        };
    }>;
};

type ResolverErrorHandler = (message: string, error: unknown, eventType?: string, eventData?: Record<string, unknown> | null) => void;

type ResolveOptions = {
    timeout?: number;
    logger?: ResolverLogger;
    onError?: ResolverErrorHandler;
    throwOnError?: boolean;
};

function createResolverErrorHandler(logger?: ResolverLogger): ResolverErrorHandler | null {
    if (!logger || typeof logger.error !== 'function') {
        return null;
    }

    const errorHandler = createPlatformErrorHandler(logger, 'youtube-channel-resolver');
    return function handleResolverError(message: string, error: unknown, eventType = 'channel-resolve', eventData: Record<string, unknown> | null = null) {
        if (error instanceof Error) {
            errorHandler.handleEventProcessingError(error, eventType, eventData, message, 'youtube-channel-resolver');
            return;
        }

        const fallbackError = new Error(message);
        errorHandler.handleEventProcessingError(fallbackError, eventType, eventData, message, 'youtube-channel-resolver');
    };
}

function normalizeChannelHandle(channelHandle: unknown): string {
    if (!channelHandle || typeof channelHandle !== 'string') {
        return '';
    }

    const normalized = channelHandle.trim();
    return Array.from(normalized).length <= MAX_HANDLE_LENGTH ? normalized : '';
}

function isChannelId(channelHandle: unknown): boolean {
    if (!channelHandle || typeof channelHandle !== 'string') {
        return false;
    }

    return /^UC[a-zA-Z0-9_\-]{22}$/.test(channelHandle);
}

function normalizeHandleForCache(channelHandle: unknown): string {
    const trimmed = normalizeChannelHandle(channelHandle);
    if (!trimmed || isChannelId(trimmed)) {
        return '';
    }

    return trimmed.replace(/^@/, '').toLowerCase();
}

function buildHandleUrl(handleKey: string): string {
    return YOUTUBE.buildChannelUrl(handleKey);
}

async function resolveChannelId(innertubeClient: ResolverClient | null, channelHandle: unknown, options: ResolveOptions = {}): Promise<string | null> {
    const timeout = Number.isFinite(options.timeout) ? Number(options.timeout) : DEFAULT_TIMEOUT_MS;
    const logger = options.logger;
    const onError = options.onError;
    const throwOnError = options.throwOnError === true;
    const errorHandler = onError || createResolverErrorHandler(logger);
    const handleError: ResolverErrorHandler = (message, error, eventType, eventData) => {
        errorHandler?.(sanitizeLogText(message).slice(0, 4096), error, eventType, {
            channelHandle: sanitizeLogText(typeof eventData?.channelHandle === 'string' ? eventData.channelHandle : '').slice(0, 256)
        });
    };

    const trimmedHandle = normalizeChannelHandle(channelHandle);
    if (!trimmedHandle) {
        handleError?.('Channel handle is required', new Error('Missing channel handle'), 'channel-resolve', {
            channelHandle: typeof channelHandle === 'string' ? channelHandle : ''
        });
        return null;
    }

    if (isChannelId(trimmedHandle)) {
        return trimmedHandle;
    }

    const handleKey = normalizeHandleForCache(trimmedHandle);
    if (!handleKey) {
        handleError?.('Invalid channel handle', new Error('Invalid channel handle'), 'channel-resolve', {
            channelHandle: trimmedHandle
        });
        return null;
    }

    if (!innertubeClient || typeof innertubeClient.resolveURL !== 'function') {
        const unavailableError = new Error('resolveURL unavailable');
        handleError?.('YouTube resolveURL is unavailable', unavailableError, 'channel-resolve', {
            channelHandle: handleKey
        });
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
            handleError?.('Channel not found', new Error('Channel not found'), 'channel-resolve', {
                channelHandle: handleKey
            });
            return null;
        }

        const channelId = browseId.trim();
        if (!isChannelId(channelId)) {
            handleError('Resolved channel ID is invalid', new Error('Resolved channel ID is invalid'), 'channel-resolve', {
                channelHandle: handleKey
            });
            return null;
        }
        return channelId;
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        handleError?.(`Channel resolution failed: ${errorMessage}`, error, 'channel-resolve', {
            channelHandle: handleKey
        });
        if (throwOnError) {
            throw error;
        }
        return null;
    }
}

export {
    normalizeChannelHandle,
    normalizeHandleForCache,
    isChannelId,
    resolveChannelId
};
