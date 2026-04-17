import { validateNormalizedMessage } from '../../../utils/message-normalization';
import { normalizeTikTokChatEvent } from './event-normalizer';
import { UNKNOWN_CHAT_MESSAGE, UNKNOWN_CHAT_USERNAME } from '../../../constants/degraded-chat';
import { getValidMessageParts } from '../../../utils/message-parts';
import { collectMissingFields, getMissingFields, mergeMissingFieldsMetadata } from '../../../utils/missing-fields';

const PlatformEvents = {
    CHAT_MESSAGE: 'platform:chat-message',
    VIEWER_COUNT: 'platform:viewer-count',
    ENVELOPE: 'platform:envelope',
    PAYPIGGY: 'platform:paypiggy'
} as const;

const DEFAULT_CHAT_DEDUP_TTL_MS = 90 * 60 * 1000;
const DEFAULT_CHAT_MAX_CACHE_SIZE = 10_000;
const DEFAULT_CHAT_MAX_AGE_MS = 20 * 60 * 1000;

type TikTokDisplayText = {
    defaultPattern?: unknown;
    displayType?: unknown;
};

type TikTokUserPayload = Record<string, unknown> & {
    uniqueId?: unknown;
    nickname?: unknown;
    userId?: unknown;
    profilePictureUrl?: unknown;
    profilePicture?: { url?: unknown };
    followRole?: unknown;
    userBadges?: unknown;
};

type TikTokCommonPayload = Record<string, unknown> & {
    msgId?: unknown;
    createTime?: unknown;
    displayText?: TikTokDisplayText;
};

type TikTokRawEvent = Record<string, unknown> & {
    comment?: unknown;
    user?: TikTokUserPayload;
    common?: TikTokCommonPayload;
    displayText?: TikTokDisplayText;
    displayType?: unknown;
    actionType?: unknown;
    type?: unknown;
    label?: unknown;
    userIdentity?: {
        isSubscriberOfAnchor?: unknown;
    };
    isModerator?: unknown;
    isOwner?: unknown;
    viewerCount?: unknown;
};

type TikTokWebcastEventMap = {
    CHAT: string;
    GIFT: string;
    FOLLOW: string;
    SOCIAL: string;
    ROOM_USER: string;
    ENVELOPE?: string;
    SUBSCRIBE?: string;
    SUPER_FAN?: string;
    ERROR: string;
    DISCONNECT: string;
    STREAM_END?: string;
};

type TikTokControlEventMap = {
    CONNECTED?: string;
    DISCONNECTED?: string;
    ERROR?: string;
};

type TikTokPlatformRouterContract = {
    listenersConfigured: boolean;
    connection: {
        on: (eventName: string, handler: (payload: unknown) => void | Promise<void>) => void;
        removeAllListeners?: (eventName?: string) => void;
    } | null;
    WebcastEvent: TikTokWebcastEventMap;
    ControlEvent?: TikTokControlEventMap;
    platformName?: string;
    timestampService?: unknown;
    selfMessageDetectionService?: {
        shouldFilterMessage: (
            platform: string,
            messageData: { username?: string; userId?: string; isBroadcaster?: boolean },
            config: unknown
        ) => boolean;
    } | null;
    config: Record<string, unknown>;
    logger: {
        warn: (message: string, source?: string, details?: unknown) => void;
        debug: (message: string, source?: string, details?: unknown) => void;
        info: (message: string, source?: string, details?: unknown) => void;
    };
    errorHandler: {
        handleConnectionError: (error: unknown, context?: string, message?: string) => void;
        handleEventProcessingError: (error: unknown, context: string, payload?: unknown, message?: string) => void;
        handleCleanupError: (error: unknown, context?: string, message?: string) => void;
    };
    constructor?: {
        resolveEventTimestampMs?: (data: TikTokRawEvent) => number | null;
    };
    _logIncomingEvent: (eventType: string, data: unknown) => Promise<void> | void;
    _emitPlatformEvent: (type: string, payload: Record<string, unknown>) => void;
    _handleStandardEvent: (eventType: string, data: TikTokRawEvent, options?: Record<string, unknown>) => Promise<unknown>;
    _handleStreamEnd: () => Promise<void>;
    handleConnectionIssue: (issue: unknown, isError?: boolean) => Promise<unknown>;
    handleConnectionError: (error: unknown) => void;
    handleRetry: (error: unknown) => unknown;
    handleTikTokGift: (data: TikTokRawEvent) => Promise<void>;
    handleTikTokFollow: (data: TikTokRawEvent) => Promise<void>;
    handleTikTokSocial: (data: TikTokRawEvent) => Promise<void>;
    connectionActive: boolean;
    cachedViewerCount: number;
    connectionTime: number;
    _getTimestamp: (data: TikTokRawEvent) => string | null;
    _getPlatformMessageId: (data: TikTokRawEvent) => string | null;
    _handleChatMessage: (rawData: TikTokRawEvent, normalizedData: Record<string, unknown>) => Promise<void>;
    chatReplayProtectionConfig?: {
        ttlMs?: number;
        maxCacheSize?: number;
        maxAgeMs?: number;
    };
    _chatReplayIngressState?: {
        recentMessageIds?: Map<string, number>;
    };
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, unknown>;
}

function asTikTokRawEvent(value: unknown): TikTokRawEvent {
    const record = asRecord(value);
    return (record || {}) as TikTokRawEvent;
}

function hasCanonicalMessageParts(normalizedData: Record<string, unknown>) {
    return getValidMessageParts({ message: normalizedData?.message }).length > 0;
}

function isRecoverableTikTokChatNormalizationError(error: unknown) {
    const message = error instanceof Error ? error.message : '';
    return message === 'Missing TikTok message data'
        || message === 'Missing TikTok userId (uniqueId)'
        || message === 'Missing TikTok username (nickname)'
        || message === 'Missing TikTok message text'
        || message === 'Missing TikTok timestamp';
}

function buildDegradedTikTokChatEvent(platform: TikTokPlatformRouterContract, data: TikTokRawEvent = {}) {
    const userData = data?.user && typeof data.user === 'object' ? data.user : {};
    const userId = typeof userData.uniqueId === 'string' ? userData.uniqueId.trim() : '';
    const username = typeof userData.nickname === 'string' ? userData.nickname.trim() : '';
    const rawComment = typeof data.comment === 'string' ? data.comment : '';
    const message = rawComment.trim();
    const timestamp = typeof platform?._getTimestamp === 'function' ? platform._getTimestamp(data) : null;
    const resolveEventTimestampMs = platform?.constructor?.resolveEventTimestampMs;
    const resolvedCreateTimeMs = typeof resolveEventTimestampMs === 'function'
        ? resolveEventTimestampMs(data)
        : null;
    const profilePicture = userData.profilePictureUrl
        || (Array.isArray(userData.profilePicture?.url) ? userData.profilePicture.url[0] : null)
        || null;

    const missingFields = collectMissingFields({
        userId: !!userId,
        username: !!username,
        message: !!message,
        timestamp: typeof timestamp === 'string' && timestamp.trim().length > 0
    });

    return {
        platform: platform?.platformName || 'tiktok',
        ...(userId ? { userId } : {}),
        username: username || UNKNOWN_CHAT_USERNAME,
        message: {
            text: message || UNKNOWN_CHAT_MESSAGE
        },
        ...(typeof timestamp === 'string' && timestamp.trim().length > 0 ? { timestamp } : {}),
        isMod: !!data?.isModerator,
        isPaypiggy: data?.userIdentity?.isSubscriberOfAnchor === true,
        isBroadcaster: !!data?.isOwner,
        metadata: mergeMissingFieldsMetadata({
            profilePicture,
            followRole: userData.followRole ?? null,
            userBadges: Array.isArray(userData.userBadges) ? userData.userBadges : null,
            createTime: resolvedCreateTimeMs || null,
            numericId: typeof userData.userId === 'string' ? userData.userId.trim() : null
        }, missingFields, {
            ...(typeof timestamp === 'string' && timestamp.trim().length > 0 ? { sourceTimestamp: timestamp } : {})
        }),
        rawData: { data }
    };
}

function getChatReplayConfig(platform: TikTokPlatformRouterContract) {
    const provided = platform?.chatReplayProtectionConfig;
    const ttlMs = Number.isFinite(provided?.ttlMs) && provided.ttlMs > 0
        ? provided.ttlMs
        : DEFAULT_CHAT_DEDUP_TTL_MS;
    const maxCacheSize = Number.isFinite(provided?.maxCacheSize) && provided.maxCacheSize > 0
        ? provided.maxCacheSize
        : DEFAULT_CHAT_MAX_CACHE_SIZE;
    const maxAgeMs = Number.isFinite(provided?.maxAgeMs) && provided.maxAgeMs > 0
        ? provided.maxAgeMs
        : DEFAULT_CHAT_MAX_AGE_MS;

    return {
        ttlMs,
        maxCacheSize,
        maxAgeMs
    };
}

function getChatReplayState(platform: TikTokPlatformRouterContract) {
    if (!platform._chatReplayIngressState || typeof platform._chatReplayIngressState !== 'object') {
        platform._chatReplayIngressState = {
            recentMessageIds: new Map()
        };
    }

    if (!(platform._chatReplayIngressState.recentMessageIds instanceof Map)) {
        platform._chatReplayIngressState.recentMessageIds = new Map();
    }

    return platform._chatReplayIngressState;
}

function getPlatformMessageId(platform: TikTokPlatformRouterContract, data: TikTokRawEvent) {
    if (typeof platform?._getPlatformMessageId !== 'function') {
        return null;
    }

    return platform._getPlatformMessageId(data);
}

function checkDuplicateChatMessage(platform: TikTokPlatformRouterContract, data: TikTokRawEvent) {
    const messageId = getPlatformMessageId(platform, data);
    if (!messageId) {
        return { isDuplicate: false, messageId: null };
    }

    const { ttlMs, maxCacheSize } = getChatReplayConfig(platform);
    const state = getChatReplayState(platform);
    const now = Date.now();
    const lastSeen = state.recentMessageIds.get(messageId);

    if (lastSeen && (now - lastSeen) < ttlMs) {
        return { isDuplicate: true, messageId };
    }

    state.recentMessageIds.set(messageId, now);

    if (state.recentMessageIds.size > maxCacheSize) {
        const cutoff = now - ttlMs;
        for (const [id, seenAt] of state.recentMessageIds.entries()) {
            if (seenAt < cutoff) {
                state.recentMessageIds.delete(id);
            }
        }

        while (state.recentMessageIds.size > maxCacheSize) {
            const oldestKey = state.recentMessageIds.keys().next().value;
            if (!oldestKey) {
                break;
            }
            state.recentMessageIds.delete(oldestKey);
        }
    }

    return { isDuplicate: false, messageId };
}

function isStaleChatReplay(platform: TikTokPlatformRouterContract, eventTimestampMs: number | null) {
    if (eventTimestampMs === null) {
        return false;
    }

    const { maxAgeMs } = getChatReplayConfig(platform);
    return (Date.now() - eventTimestampMs) > maxAgeMs;
}

function cleanupTikTokEventListeners(platform: TikTokPlatformRouterContract) {
    if (!platform?.connection) {
        return;
    }

    const removeAllListeners = platform.connection.removeAllListeners;
    if (typeof removeAllListeners !== 'function') {
        platform.listenersConfigured = false;
        return;
    }

    if (platform.WebcastEvent) {
        const eventTypes = [
            platform.WebcastEvent.CHAT,
            platform.WebcastEvent.GIFT,
            platform.WebcastEvent.FOLLOW,
            platform.WebcastEvent.ROOM_USER,
            platform.WebcastEvent.ENVELOPE,
            platform.WebcastEvent.SUBSCRIBE,
            platform.WebcastEvent.SUPER_FAN,
            platform.WebcastEvent.SOCIAL,
            platform.WebcastEvent.ERROR,
            platform.WebcastEvent.DISCONNECT,
            platform.WebcastEvent.STREAM_END
        ];

        eventTypes.forEach((eventType) => {
            if (!eventType) {
                return;
            }

            try {
                removeAllListeners.call(platform.connection, eventType);
            } catch (error) {
                platform.errorHandler?.handleCleanupError(error, 'tiktok event listener cleanup');
            }
        });
    }

    const connectedEvent = platform.ControlEvent?.CONNECTED || 'connected';
    const disconnectedEvent = platform.ControlEvent?.DISCONNECTED || 'disconnected';
    const errorEvent = platform.ControlEvent?.ERROR || 'error';

    // Remove rawData listener to prevent duplicate logging on reconnect
    try {
        removeAllListeners.call(platform.connection, 'rawData');
    } catch (error) {
        platform.errorHandler?.handleCleanupError(error, 'tiktok rawData listener cleanup');
    }

    [connectedEvent, disconnectedEvent, errorEvent].forEach((eventType) => {
        if (!eventType) {
            return;
        }

        try {
            removeAllListeners.call(platform.connection, eventType);
        } catch (error) {
            platform.errorHandler?.handleCleanupError(error, 'tiktok event listener cleanup');
        }
    });

    platform.listenersConfigured = false;
}

function setupTikTokEventListeners(platform: TikTokPlatformRouterContract) {
    if (platform.listenersConfigured) {
        return;
    }

    if (!platform.connection) {
        const error = new Error('TikTok connection missing connection object');
        platform.errorHandler?.handleConnectionError(error, 'connection', error.message);
        throw error;
    }

    if (typeof platform.connection.on !== 'function') {
        const error = new Error('TikTok connection missing event emitter interface (on/removeAllListeners)');
        platform.errorHandler?.handleConnectionError(
            error,
            'connection',
            'TikTok connection is missing required event emitter methods'
        );
        throw error;
    }

    cleanupTikTokEventListeners(platform);

    platform.connection.on(platform.WebcastEvent.CHAT, async (payload: unknown) => {
        await platform._logIncomingEvent('chat', payload);
        const payloadRecord = asRecord(payload);
        const data = asTikTokRawEvent(payload);

        try {
            if (!payloadRecord) {
                platform.logger.warn('Received invalid chat data:', 'tiktok', {
                    dataType: typeof payload,
                    data: payload
                });
                return;
            }

            if (typeof data.comment !== 'string') {
                platform.logger.warn('Received chat data with invalid comment:', 'tiktok', {
                    comment: data.comment,
                    commentType: typeof data.comment,
                    data
                });
            }

            const resolveEventTimestampMs = platform?.constructor?.resolveEventTimestampMs;
            const eventTimestampMs = (typeof resolveEventTimestampMs === 'function')
                ? resolveEventTimestampMs(data)
                : null;

            if (platform.connectionTime > 0 && eventTimestampMs !== null && eventTimestampMs < platform.connectionTime) {
                platform.logger.debug(`Filtering historical message (pre-connection): "${data.comment}"`, 'tiktok', {
                    eventTimestamp: eventTimestampMs,
                    connectionRecordedAt: platform.connectionTime
                });
                return;
            }

            const duplicateCheck = checkDuplicateChatMessage(platform, data);
            if (duplicateCheck.isDuplicate) {
                platform.logger.debug('Skipping duplicate TikTok chat message at ingress', 'tiktok', {
                    messageId: duplicateCheck.messageId
                });
                return;
            }

            const isStaleReplay = isStaleChatReplay(platform, eventTimestampMs);
            if (isStaleReplay) {
                platform.logger.debug('Skipping stale TikTok chat replay at ingress', 'tiktok', {
                    messageId: duplicateCheck.messageId,
                    createTime: data?.common?.createTime ?? null
                });
                return;
            }

            let normalizedData: Record<string, unknown>;
            try {
                normalizedData = normalizeTikTokChatEvent(data, {
                    platformName: platform.platformName,
                    timestampService: platform.timestampService
                }) as Record<string, unknown>;
            } catch (error) {
                if (!isRecoverableTikTokChatNormalizationError(error)) {
                    throw error;
                }
                normalizedData = buildDegradedTikTokChatEvent(platform, data) as Record<string, unknown>;
            }
            const validation = validateNormalizedMessage(normalizedData);

            if (!validation.isValid) {
                platform.logger.warn('Message normalization validation failed', 'tiktok', {
                    issues: validation.errors,
                    originalData: data
                });
            }

            if (platform.selfMessageDetectionService) {
                const normalizedUsername = typeof normalizedData.username === 'string' ? normalizedData.username : undefined;
                const normalizedUserId = typeof normalizedData.userId === 'string' ? normalizedData.userId : undefined;
                const messageData = {
                    username: normalizedUsername,
                    userId: normalizedUserId,
                    isBroadcaster: normalizedData.isBroadcaster === true
                };

                if (platform.selfMessageDetectionService.shouldFilterMessage('tiktok', messageData, platform.config)) {
                    platform.logger.debug(`Filtering self-message from ${messageData.username}`, 'tiktok');
                    return;
                }
            }

            const normalizedMessage = normalizedData.message;
            const normalizedMessageRecord = asRecord(normalizedMessage);
            const messageText = typeof normalizedMessage === 'string'
                ? normalizedMessage
                : (typeof normalizedMessageRecord?.text === 'string' ? normalizedMessageRecord.text : '');
            const missingFields = getMissingFields(asRecord(normalizedData.metadata) || {});
            const isMessageMarkedMissing = missingFields.includes('message');
            if ((!messageText || messageText.trim() === '') && !hasCanonicalMessageParts(normalizedData) && !isMessageMarkedMissing) {
                platform.logger.debug('Skipping empty message after normalization', 'tiktok', {
                    originalComment: data.comment,
                    normalizedMessage: messageText,
                    messageParts: Array.isArray(normalizedMessageRecord?.parts) ? normalizedMessageRecord.parts : []
                });
                return;
            }

            await platform._handleChatMessage(data, normalizedData);
        } catch (error) {
            platform.errorHandler.handleEventProcessingError(
                error,
                'chat-message',
                data,
                `Error processing chat message: ${error instanceof Error ? error.message : error}`
            );
        }
    });

    platform.connection.on(platform.WebcastEvent.GIFT, async (payload: unknown) => {
        const data = asTikTokRawEvent(payload);
        await platform._logIncomingEvent('gift', data);

        try {
            await platform.handleTikTokGift(data);
        } catch (error) {
            platform.errorHandler.handleEventProcessingError(error, 'gift', data, 'Error processing gift');
        }
    });

    platform.connection.on(platform.WebcastEvent.FOLLOW, async (payload: unknown) => {
        const data = asTikTokRawEvent(payload);
        await platform._logIncomingEvent('follow', data);

        try {
            await platform.handleTikTokFollow(data);
        } catch (error) {
            platform.errorHandler.handleEventProcessingError(
                error,
                'follow',
                data,
                `Error processing follow: ${error instanceof Error ? error.message : error}`
            );
        }
    });

    if (typeof platform.WebcastEvent.ENVELOPE !== 'undefined') {
        platform.connection.on(platform.WebcastEvent.ENVELOPE, async (payload: unknown) => {
            const data = asTikTokRawEvent(payload);
            try {
                await platform._logIncomingEvent('envelope', data);
                await platform._handleStandardEvent('envelope', data, {
                    factoryMethod: 'createEnvelope',
                    emitType: PlatformEvents.ENVELOPE
                });
            } catch (error) {
                platform.errorHandler.handleEventProcessingError(error, 'envelope', data, 'Error in handleEnvelopeNotification');
            }
        });
    }

    if (typeof platform.WebcastEvent.SUBSCRIBE !== 'undefined') {
        platform.connection.on(platform.WebcastEvent.SUBSCRIBE, async (payload: unknown) => {
            const data = asTikTokRawEvent(payload);
            await platform._logIncomingEvent('subscribe', data);

            try {
                await platform._handleStandardEvent('paypiggy', data, {
                    factoryMethod: 'createSubscription',
                    emitType: PlatformEvents.PAYPIGGY
                });
            } catch (error) {
                platform.errorHandler.handleEventProcessingError(error, 'subscribe', data, 'Error in handleSubscriptionNotification');
            }
        });
    }

    if (typeof platform.WebcastEvent.SUPER_FAN !== 'undefined') {
        platform.connection.on(platform.WebcastEvent.SUPER_FAN, async (payload: unknown) => {
            const data = asTikTokRawEvent(payload);
            await platform._logIncomingEvent('superfan', data);

            try {
                await platform._handleStandardEvent('paypiggy', data, {
                    factoryMethod: 'createSuperfan',
                    emitType: PlatformEvents.PAYPIGGY
                });
            } catch (error) {
                platform.errorHandler.handleEventProcessingError(error, 'superfan', data, 'Error in handleSuperfanNotification');
            }
        });
    }

    if (typeof platform.WebcastEvent.SOCIAL !== 'undefined') {
        platform.connection.on(platform.WebcastEvent.SOCIAL, async (payload: unknown) => {
            const data = asTikTokRawEvent(payload);
            await platform._logIncomingEvent('social', data);

            try {
                await platform.handleTikTokSocial(data);
            } catch (error) {
                platform.errorHandler.handleEventProcessingError(error, 'social', data, 'Error processing social event');
            }
        });
    }

    platform.connection.on(platform.WebcastEvent.ROOM_USER, (payload: unknown) => {
        const data = asTikTokRawEvent(payload);
        platform._logIncomingEvent('roomUser', data);
        const viewerCount = data.viewerCount as number;
        platform.cachedViewerCount = viewerCount;

        const timestamp = typeof platform._getTimestamp === 'function'
            ? platform._getTimestamp(data)
            : null;
        if (!timestamp) {
            platform.logger.warn('[TikTok Viewer Count] Missing timestamp in room user payload', 'tiktok', { data });
            return;
        }

        platform._emitPlatformEvent(PlatformEvents.VIEWER_COUNT, {
            platform: 'tiktok',
            count: viewerCount,
            timestamp
        });
    });

    const disconnectedEvent = platform.ControlEvent?.DISCONNECTED || 'disconnected';
    const errorEvent = platform.ControlEvent?.ERROR || 'error';

    platform.connection.on(disconnectedEvent, async (reason: unknown) => {
        await platform._logIncomingEvent('disconnected', reason);
        try {
            await platform.handleConnectionIssue(reason, false);
        } catch (error) {
            platform.errorHandler.handleEventProcessingError(
                error,
                'disconnected',
                reason,
                'Error handling disconnected control event'
            );
        }
    });

    platform.connection.on(errorEvent, (err: unknown) => {
        platform._logIncomingEvent('control-error', err);
        platform.handleConnectionError(err);
    });

    platform.connection.on(platform.WebcastEvent.ERROR, (err: unknown) => {
        const errorRecord = asRecord(err);
        platform._logIncomingEvent('error', err);
        platform.errorHandler.handleConnectionError(
            err,
            'webcast connection',
            `Webcast Connection Error: ${errorRecord?.message}`
        );

        if (platform.connectionActive) {
            platform.handleRetry(err);
        }
    });

    platform.connection.on(platform.WebcastEvent.DISCONNECT, async () => {
        platform._logIncomingEvent('disconnect', {});
        platform.logger.info('Disconnected from webcast', 'tiktok');
        platform.connectionActive = false;
        platform.listenersConfigured = false;
        await platform.handleConnectionIssue({ message: 'WebSocket disconnected' }, false);
    });

    if (typeof platform.WebcastEvent.STREAM_END !== 'undefined') {
        platform.connection.on(platform.WebcastEvent.STREAM_END, async (payload: unknown) => {
            const data = asTikTokRawEvent(payload);
            await platform._logIncomingEvent('streamEnd', data);
            await platform._handleStreamEnd(data);
        });
    }

    platform.connection.on('rawData', async (payload: unknown) => {
        const payloadRecord = asRecord(payload);
        const eventType = typeof payloadRecord?.type === 'string' ? payloadRecord.type : 'unknown';
        await platform._logIncomingEvent(eventType, payload);
    });

    platform.listenersConfigured = true;
}

export { cleanupTikTokEventListeners, setupTikTokEventListeners };
