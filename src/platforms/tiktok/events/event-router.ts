import { validateNormalizedMessage } from '../../../utils/message-normalization';
import { normalizeTikTokChatEvent } from './event-normalizer';
import { UNKNOWN_CHAT_MESSAGE, UNKNOWN_CHAT_USERNAME } from '../../../constants/degraded-chat';
import { getValidMessageParts } from '../../../utils/message-parts';
import { collectMissingFields, getMissingFields, mergeMissingFieldsMetadata } from '../../../utils/missing-fields';
import { parseNotificationCount } from '../../../utils/notification-count';

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
    SHARE?: string;
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
    connectionGeneration: number;
    connection: {
        on: (eventName: string, handler: (payload: unknown) => void | Promise<void>) => void;
        off?: (eventName: string, handler: (payload: unknown) => void | Promise<void>) => void;
        removeListener?: (eventName: string, handler: (payload: unknown) => void | Promise<void>) => void;
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
    _handleStreamEnd: (data?: TikTokRawEvent, connectionGeneration?: number) => Promise<void>;
    handleConnectionIssue: (issue: unknown, isError?: boolean) => Promise<unknown>;
    handleConnectionError: (error: unknown) => void;
    handleRetry: (error: unknown) => unknown;
    handleTikTokGift: (data: TikTokRawEvent) => Promise<void>;
    handleTikTokFollow: (data: TikTokRawEvent) => Promise<void>;
    handleTikTokShare: (data: TikTokRawEvent) => Promise<void>;
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
return record ? { ...record } : {};
}

function hasCanonicalMessageParts(normalizedData: Record<string, unknown>): boolean {
const message = asRecord(normalizedData.message);
return getValidMessageParts({ message }).length > 0;
}

function isRecoverableTikTokChatNormalizationError(error: unknown): boolean {
const message = error instanceof Error ? error.message : '';
return message === 'Missing TikTok message data'
|| message === 'Missing TikTok userId (user data)'
|| message === 'Missing TikTok userId (uniqueId)'
|| message === 'Missing TikTok username (nickname)'
|| message === 'Missing TikTok message text'
|| message === 'Missing TikTok timestamp';
}

function buildDegradedTikTokChatEvent(platform: TikTokPlatformRouterContract, data: TikTokRawEvent = {}): Record<string, unknown> {
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

function getChatReplayConfig(platform: TikTokPlatformRouterContract): { ttlMs: number; maxCacheSize: number; maxAgeMs: number } {
    const provided = platform?.chatReplayProtectionConfig;
    const providedTtlMs = provided?.ttlMs;
    const providedMaxCacheSize = provided?.maxCacheSize;
    const providedMaxAgeMs = provided?.maxAgeMs;
    const ttlMs = Number.isFinite(providedTtlMs) && typeof providedTtlMs === 'number' && providedTtlMs > 0
        ? providedTtlMs
        : DEFAULT_CHAT_DEDUP_TTL_MS;
    const maxCacheSize = Number.isFinite(providedMaxCacheSize) && typeof providedMaxCacheSize === 'number' && providedMaxCacheSize > 0
        ? providedMaxCacheSize
        : DEFAULT_CHAT_MAX_CACHE_SIZE;
    const maxAgeMs = Number.isFinite(providedMaxAgeMs) && typeof providedMaxAgeMs === 'number' && providedMaxAgeMs > 0
        ? providedMaxAgeMs
        : DEFAULT_CHAT_MAX_AGE_MS;

    return {
        ttlMs,
        maxCacheSize,
        maxAgeMs
    };
}

function getChatReplayState(platform: TikTokPlatformRouterContract): { recentMessageIds: Map<string, number> } {
    if (!platform._chatReplayIngressState || typeof platform._chatReplayIngressState !== 'object') {
        platform._chatReplayIngressState = {
            recentMessageIds: new Map()
        };
    }

    if (!(platform._chatReplayIngressState.recentMessageIds instanceof Map)) {
        platform._chatReplayIngressState.recentMessageIds = new Map();
    }

    return { recentMessageIds: platform._chatReplayIngressState.recentMessageIds };
}

function getPlatformMessageId(platform: TikTokPlatformRouterContract, data: TikTokRawEvent): string | null {
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

type RouterConnection = NonNullable<TikTokPlatformRouterContract['connection']>;
type RouterCallback = (payload: unknown) => void | Promise<void>;
const ownedListeners = new WeakMap<TikTokPlatformRouterContract, Array<{
    connection: RouterConnection;
    event: string;
    callback: RouterCallback;
}>>();

async function reportEventFailure(platform: TikTokPlatformRouterContract, error: unknown, context: string, message?: string) {
    try {
        await platform.errorHandler.handleEventProcessingError(error, context, undefined, message);
    } catch {
        // A failed diagnostic must not escape an EventEmitter callback.
    }
}

function registerListener(platform: TikTokPlatformRouterContract, event: string, handler: RouterCallback) {
    const connection = platform.connection;
    if (!connection) return;
    const registration = ownedListeners.get(platform);
    const callback: RouterCallback = async (payload) => {
        if (ownedListeners.get(platform) !== registration) return;
        try {
            await handler(payload);
        } catch (error) {
            if (ownedListeners.get(platform) !== registration) return;
            await reportEventFailure(platform, error, event === platform.WebcastEvent.CHAT ? 'chat-message' : event);
        }
    };
    connection.on(event, callback);
    const listeners = ownedListeners.get(platform) ?? [];
    listeners.push({ connection, event, callback });
    ownedListeners.set(platform, listeners);
}

function cleanupTikTokEventListeners(platform: TikTokPlatformRouterContract) {
    for (const { connection, event, callback } of ownedListeners.get(platform) ?? []) {
        try {
            const remove = connection.off ?? connection.removeListener;
            remove?.call(connection, event, callback);
        } catch (error) {
            platform.errorHandler?.handleCleanupError(error, 'tiktok event listener cleanup');
        }
    }
    ownedListeners.delete(platform);
    platform.listenersConfigured = false;
}

function isTikTokEventListenerSetupCurrent(platform: TikTokPlatformRouterContract): boolean {
    return platform.listenersConfigured
        && (ownedListeners.get(platform)?.some(({ connection }) => connection === platform.connection) ?? false);
}

function setupTikTokEventListeners(platform: TikTokPlatformRouterContract) {
    if (isTikTokEventListenerSetupCurrent(platform)) {
        return;
    }

    if (!platform.connection) {
        const error = new Error('TikTok connection missing connection object');
        platform.errorHandler?.handleConnectionError(error, 'connection', error.message);
        throw error;
    }

    if (typeof platform.connection.on !== 'function') {
        const error = new Error('TikTok connection missing event emitter interface (on)');
        platform.errorHandler?.handleConnectionError(
            error,
            'connection',
            'TikTok connection is missing required event emitter methods'
        );
        throw error;
    }

    cleanupTikTokEventListeners(platform);

    const registeredConnection = platform.connection;
    const registeredGeneration = platform.connectionGeneration;
    const registration = [] as NonNullable<ReturnType<typeof ownedListeners.get>>;
    ownedListeners.set(platform, registration);
    const isCurrentRegistration = () => platform.connection === registeredConnection
        && platform.connectionGeneration === registeredGeneration
        && ownedListeners.get(platform) === registration;

    registerListener(platform, platform.WebcastEvent.CHAT, async (payload: unknown) => {
        if (!isCurrentRegistration()) return;
        await platform._logIncomingEvent('chat', payload);
        if (!isCurrentRegistration()) return;
        const payloadRecord = asRecord(payload);
        const data = asTikTokRawEvent(payload);

        try {
            if (!payloadRecord) {
                platform.logger.warn('Received invalid chat data:', 'tiktok', {
                    dataType: typeof payload,
                    hasPayload: payload !== null && payload !== undefined
                });
                return;
            }

            if (typeof data.comment !== 'string') {
                platform.logger.warn('Received chat data with invalid comment:', 'tiktok', {
                    commentType: typeof data.comment,
                    hasComment: data.comment !== null && data.comment !== undefined,
                    eventKeys: Object.keys(data).sort()
                });
            }

            const resolveEventTimestampMs = platform?.constructor?.resolveEventTimestampMs;
            const eventTimestampMs = (typeof resolveEventTimestampMs === 'function')
                ? resolveEventTimestampMs(data)
                : null;

            if (platform.connectionTime > 0 && eventTimestampMs !== null && eventTimestampMs < platform.connectionTime) {
                platform.logger.debug('Filtering message sent before connection', 'tiktok', {
                    eventTimestamp: eventTimestampMs,
                    connectionRecordedAt: platform.connectionTime,
                    messageLength: typeof data.comment === 'string' ? data.comment.length : 0
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
                    ...(typeof platform.platformName === 'string' ? { platformName: platform.platformName } : {}),
                    ...(platform.timestampService !== undefined ? { timestampService: platform.timestampService } : {})
                }) as Record<string, unknown>;
            } catch (error) {
                if (!isCurrentRegistration()) return;
                if (!isRecoverableTikTokChatNormalizationError(error)) {
                    throw error;
                }
                normalizedData = buildDegradedTikTokChatEvent(platform, data) as Record<string, unknown>;
            }
            const validation = validateNormalizedMessage(normalizedData);

            if (!validation.isValid) {
                platform.logger.warn('Message normalization validation failed', 'tiktok', {
                    issues: validation.errors,
                    eventKeys: Object.keys(data).sort(),
                    hasComment: typeof data.comment === 'string' && data.comment.length > 0
                });
            }

            if (platform.selfMessageDetectionService) {
                const normalizedUsername = typeof normalizedData.username === 'string' ? normalizedData.username : undefined;
                const normalizedUserId = typeof normalizedData.userId === 'string' ? normalizedData.userId : undefined;
                const messageData = {
                    ...(normalizedUsername !== undefined ? { username: normalizedUsername } : {}),
                    ...(normalizedUserId !== undefined ? { userId: normalizedUserId } : {}),
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
                    originalMessageLength: typeof data.comment === 'string' ? data.comment.length : 0,
                    normalizedMessageLength: messageText.length,
                    messagePartCount: Array.isArray(normalizedMessageRecord?.parts) ? normalizedMessageRecord.parts.length : 0
                });
                return;
            }

            await platform._handleChatMessage(data, normalizedData);
        } catch (error) {
            if (!isCurrentRegistration()) return;
            await reportEventFailure(platform,
                error,
                'chat-message',
                `Error processing chat message: ${error instanceof Error ? error.message : error}`
            );
        }
    });

    registerListener(platform, platform.WebcastEvent.GIFT, async (payload: unknown) => {
        if (!isCurrentRegistration()) return;
        const data = asTikTokRawEvent(payload);
        await platform._logIncomingEvent('gift', data);
        if (!isCurrentRegistration()) return;

        try {
            await platform.handleTikTokGift(data);
        } catch (error) {
            if (!isCurrentRegistration()) return;
            await reportEventFailure(platform, error, 'gift', 'Error processing gift');
        }
    });

    registerListener(platform, platform.WebcastEvent.FOLLOW, async (payload: unknown) => {
        if (!isCurrentRegistration()) return;
        const data = asTikTokRawEvent(payload);
        await platform._logIncomingEvent('follow', data);
        if (!isCurrentRegistration()) return;

        try {
            await platform.handleTikTokFollow(data);
        } catch (error) {
            if (!isCurrentRegistration()) return;
            await reportEventFailure(platform,
                error,
                'follow',
                `Error processing follow: ${error instanceof Error ? error.message : error}`
            );
        }
    });

    if (typeof platform.WebcastEvent.SHARE !== 'undefined') {
        registerListener(platform, platform.WebcastEvent.SHARE, async (payload: unknown) => {
            if (!isCurrentRegistration()) return;
            const data = asTikTokRawEvent(payload);
            await platform._logIncomingEvent('share', data);
            if (!isCurrentRegistration()) return;

            try {
                await platform.handleTikTokShare(data);
            } catch (error) {
                if (!isCurrentRegistration()) return;
                await reportEventFailure(platform, error, 'share', 'Error processing share event');
            }
        });
    }

    if (typeof platform.WebcastEvent.ENVELOPE !== 'undefined') {
        registerListener(platform, platform.WebcastEvent.ENVELOPE, async (payload: unknown) => {
            if (!isCurrentRegistration()) return;
            const data = asTikTokRawEvent(payload);
            try {
                await platform._logIncomingEvent('envelope', data);
                if (!isCurrentRegistration()) return;
                await platform._handleStandardEvent('envelope', data, {
                    factoryMethod: 'createEnvelope',
                    emitType: PlatformEvents.ENVELOPE
                });
            } catch (error) {
                if (!isCurrentRegistration()) return;
                await reportEventFailure(platform, error, 'envelope', 'Error in handleEnvelopeNotification');
            }
        });
    }

    if (typeof platform.WebcastEvent.SUBSCRIBE !== 'undefined') {
        registerListener(platform, platform.WebcastEvent.SUBSCRIBE, async (payload: unknown) => {
            if (!isCurrentRegistration()) return;
            const data = asTikTokRawEvent(payload);
            await platform._logIncomingEvent('subscribe', data);
            if (!isCurrentRegistration()) return;

            try {
                await platform._handleStandardEvent('paypiggy', data, {
                    factoryMethod: 'createSubscription',
                    emitType: PlatformEvents.PAYPIGGY
                });
            } catch (error) {
                if (!isCurrentRegistration()) return;
                await reportEventFailure(platform, error, 'subscribe', 'Error in handleSubscriptionNotification');
            }
        });
    }

    if (typeof platform.WebcastEvent.SUPER_FAN !== 'undefined') {
        registerListener(platform, platform.WebcastEvent.SUPER_FAN, async (payload: unknown) => {
            if (!isCurrentRegistration()) return;
            const data = asTikTokRawEvent(payload);
            await platform._logIncomingEvent('superfan', data);
            if (!isCurrentRegistration()) return;

            try {
                await platform._handleStandardEvent('paypiggy', data, {
                    factoryMethod: 'createSuperfan',
                    emitType: PlatformEvents.PAYPIGGY
                });
            } catch (error) {
                if (!isCurrentRegistration()) return;
                await reportEventFailure(platform, error, 'superfan', 'Error in handleSuperfanNotification');
            }
        });
    }

    if (typeof platform.WebcastEvent.SOCIAL !== 'undefined') {
        registerListener(platform, platform.WebcastEvent.SOCIAL, async (payload: unknown) => {
            if (!isCurrentRegistration()) return;
            const data = asTikTokRawEvent(payload);
            await platform._logIncomingEvent('social', data);
            if (!isCurrentRegistration()) return;

            try {
                await platform.handleTikTokSocial(data);
            } catch (error) {
                if (!isCurrentRegistration()) return;
                await reportEventFailure(platform, error, 'social', 'Error processing social event');
            }
        });
    }

    registerListener(platform, platform.WebcastEvent.ROOM_USER, async (payload: unknown) => {
        if (!isCurrentRegistration()) return;
        const data = asTikTokRawEvent(payload);
        const incomingLog = platform._logIncomingEvent('roomUser', data);
        try {
            const viewerCount = parseNotificationCount(data.viewerCount);
            if (viewerCount === null) {
                platform.logger.warn('[TikTok Viewer Count] Invalid viewer count in room user payload', 'tiktok', {
                    viewerCountType: typeof data.viewerCount,
                    hasViewerCount: data.viewerCount !== null && data.viewerCount !== undefined,
                    eventKeys: Object.keys(data).sort()
                });
                return;
            }

            const timestamp = typeof platform._getTimestamp === 'function'
                ? platform._getTimestamp(data)
                : null;
            if (typeof timestamp !== 'string' || !timestamp.trim() || !Number.isFinite(Date.parse(timestamp))) {
                platform.logger.warn('[TikTok Viewer Count] Missing timestamp in room user payload', 'tiktok', {
                    eventKeys: Object.keys(data).sort(),
                    hasViewerCount: data.viewerCount !== null && data.viewerCount !== undefined
                });
                return;
            }

            platform.cachedViewerCount = viewerCount;
            platform._emitPlatformEvent(PlatformEvents.VIEWER_COUNT, {
                platform: 'tiktok',
                count: viewerCount,
                timestamp
            });
        } finally {
            await incomingLog;
        }
    });

    const disconnectedEvent = platform.ControlEvent?.DISCONNECTED || 'disconnected';
    const errorEvent = platform.ControlEvent?.ERROR || 'error';

    registerListener(platform, disconnectedEvent, async (reason: unknown) => {
        if (!isCurrentRegistration()) return;
        await platform._logIncomingEvent('disconnected', reason);
        if (!isCurrentRegistration()) return;
        try {
            await platform.handleConnectionIssue(reason, false);
        } catch (error) {
            await reportEventFailure(platform,
                error,
                'disconnected',
                'Error handling disconnected control event'
            );
        }
    });

    registerListener(platform, errorEvent, async (err: unknown) => {
        if (!isCurrentRegistration()) return;
        await platform._logIncomingEvent('control-error', err);
        if (!isCurrentRegistration()) return;
        await platform.handleConnectionError(err);
    });

    registerListener(platform, platform.WebcastEvent.ERROR, async (err: unknown) => {
        if (!isCurrentRegistration()) return;
        const errorRecord = asRecord(err);
        await platform._logIncomingEvent('error', err);
        if (!isCurrentRegistration()) return;
        await platform.errorHandler.handleConnectionError(
            err,
            'webcast connection',
            `Webcast Connection Error: ${errorRecord?.message}`
        );

        if (isCurrentRegistration() && platform.connectionActive) {
            await platform.handleRetry(err);
        }
    });

    registerListener(platform, platform.WebcastEvent.DISCONNECT, async () => {
        if (!isCurrentRegistration()) return;
        await platform._logIncomingEvent('disconnect', {});
        if (!isCurrentRegistration()) return;
        platform.logger.info('Disconnected from webcast', 'tiktok');
        platform.connectionActive = false;
        platform.listenersConfigured = false;
    });

    if (typeof platform.WebcastEvent.STREAM_END !== 'undefined') {
        registerListener(platform, platform.WebcastEvent.STREAM_END, async (payload: unknown) => {
            if (!isCurrentRegistration()) return;
            const data = asTikTokRawEvent(payload);
            const streamEndPromise = platform._handleStreamEnd(data, registeredGeneration);
            await Promise.all([streamEndPromise, Promise.resolve().then(() => platform._logIncomingEvent('streamEnd', data))]);
        });
    }

    registerListener(platform, 'rawData', async (payload: unknown) => {
        const payloadRecord = asRecord(payload);
        const eventType = typeof payloadRecord?.type === 'string' ? payloadRecord.type : 'unknown';
        await platform._logIncomingEvent(eventType, payload);
    });

    platform.listenersConfigured = true;
}

export { cleanupTikTokEventListeners, isTikTokEventListenerSetupCurrent, setupTikTokEventListeners };
