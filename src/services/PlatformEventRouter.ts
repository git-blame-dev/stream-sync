import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { NOTIFICATION_CONFIGS } from '../core/constants';
import { isIsoTimestamp } from '../utils/timestamp';
import { getValidMessageParts, normalizeBadgeImages } from '../utils/message-parts';
import { UNKNOWN_CHAT_MESSAGE, UNKNOWN_CHAT_USERNAME } from '../constants/degraded-chat';
import { getMissingFields } from '../utils/missing-fields';

const PlatformEvents = {
    CHAT_MESSAGE: 'platform:chat-message',
    VIEWER_COUNT: 'platform:viewer-count',
    GIFT: 'platform:gift',
    PAYPIGGY: 'platform:paypiggy',
    GIFTPAYPIGGY: 'platform:giftpaypiggy',
    FOLLOW: 'platform:follow',
    SHARE: 'platform:share',
    RAID: 'platform:raid',
    STREAM_STATUS: 'platform:stream-status',
    STREAM_DETECTED: 'platform:stream-detected',
    ENVELOPE: 'platform:envelope'
} as const;

const ALIAS_PAID_TYPES = [
    'subscription',
    'resubscription',
    'membership',
    'member',
    'subscribe',
    'superfan',
    'supporter',
    'paid_supporter'
];

type RouterRecord = Record<string, unknown>;

type RouterLogger = {
    debug: (message: string, scope: string, data?: unknown) => void;
    warn: (message: string, scope: string, data?: unknown) => void;
};

type RouterEventBus = {
    subscribe: (eventName: string, handler: (event: unknown) => Promise<void>) => (() => void) | void;
};

type RuntimeNotificationHandler = (platform: string, username: unknown, payload: RouterRecord) => Promise<unknown> | unknown;

type RouterRuntime = {
    handleChatMessage?: (platform: string, payload: RouterRecord) => Promise<unknown> | unknown;
    updateViewerCount?: (platform: string, count: number) => void;
    handleGiftNotification?: RuntimeNotificationHandler;
    handlePaypiggyNotification?: RuntimeNotificationHandler;
    handleGiftPaypiggyNotification?: RuntimeNotificationHandler;
    handleFollowNotification?: RuntimeNotificationHandler;
    handleShareNotification?: RuntimeNotificationHandler;
    handleRaidNotification?: RuntimeNotificationHandler;
    handleStreamDetected?: (platform: string, payload: RouterRecord) => Promise<unknown> | unknown;
    handleEnvelopeNotification?: (platform: string, payload: RouterRecord) => Promise<unknown> | unknown;
    [key: string]: unknown;
};

type RouterNotificationManager = {
    handleNotification?: (type: string, platform: string, payload: RouterRecord) => Promise<unknown> | unknown;
};

type RouterOptions = {
    eventBus: RouterEventBus;
    runtime: RouterRuntime;
    notificationManager: RouterNotificationManager;
    config: Record<string, RouterRecord>;
    logger: RouterLogger;
};

type NotificationType = keyof typeof NOTIFICATION_CONFIGS;

type NormalizedChatPayload = {
    platform: string;
    userId?: string;
    username: string;
    message: {
        text: string;
        parts?: ReturnType<typeof resolveCanonicalMessageParts>;
    };
    timestamp?: string;
    isMod: unknown;
    isPaypiggy: boolean;
    isBroadcaster: unknown;
    avatarUrl?: string;
    metadata?: RouterRecord;
    badgeImages?: ReturnType<typeof normalizeBadgeImages>;
};

function asRouterRecord(value: unknown): RouterRecord {
    return value && typeof value === 'object' ? (value as RouterRecord) : {};
}

function isNotificationType(value: string): value is NotificationType {
    return Object.prototype.hasOwnProperty.call(NOTIFICATION_CONFIGS, value);
}

function resolveCanonicalMessageParts(data: unknown = {}) {
    return getValidMessageParts(asRouterRecord(data))
        .map((part) => {
            if (part.type === 'emote') {
                const placeInComment = Number((part as { placeInComment?: unknown }).placeInComment);
                return {
                    type: 'emote',
                    platform: typeof part.platform === 'string' ? part.platform : undefined,
                    emoteId: part.emoteId.trim(),
                    imageUrl: part.imageUrl.trim(),
                    ...(Number.isInteger(placeInComment) && placeInComment >= 0
                        ? { placeInComment }
                        : {})
                };
            }

            return {
                type: 'text',
                text: part.text
            };
        });
}

class PlatformEventRouter {
    eventBus: RouterEventBus;
    runtime: RouterRuntime;
    notificationManager: RouterNotificationManager;
    config: Record<string, RouterRecord>;
    logger: RouterLogger;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    subscription: (() => void) | null;

    constructor(options: RouterOptions) {
        if (!options) {
            throw new Error('PlatformEventRouter requires options');
        }
        this.eventBus = options.eventBus;
        this.runtime = options.runtime;
        this.notificationManager = options.notificationManager;
        this.config = options.config;
        this.logger = options.logger;
        if (!this.eventBus || !this.runtime || !this.notificationManager || !this.config || !this.logger) {
            throw new Error('PlatformEventRouter requires eventBus, runtime, notificationManager, config, and logger');
        }
        this.errorHandler = createPlatformErrorHandler(this.logger, 'platform-event-router');
        this.subscription = null;

        this.start();
    }

    start() {
        if (!this.eventBus || typeof this.eventBus.subscribe !== 'function') {
            throw new Error('PlatformEventRouter requires eventBus.subscribe');
        }

        const unsubscribe = this.eventBus.subscribe('platform:event', async (event: unknown) => {
            try {
                await this.routeEvent(event);
            } catch (error) {
                const errorDetails = error instanceof Error ? error.message : String(error);
                const eventRecord = asRouterRecord(event);
                const eventType = typeof eventRecord.type === 'string' ? eventRecord.type : 'unknown';
                this._handleRouterError(`Error routing platform event: ${errorDetails}`, error, eventType);
            }
        });
        this.subscription = typeof unsubscribe === 'function' ? unsubscribe : null;
    }

    async routeEvent(event: unknown) {
        const eventRecord = asRouterRecord(event);
        if (!event || typeof event !== 'object') {
            throw new Error('PlatformEventRouter requires event object');
        }

        const platform = typeof eventRecord.platform === 'string' ? eventRecord.platform : '';
        const type = typeof eventRecord.type === 'string' ? eventRecord.type : '';
        const data = eventRecord.data;
        if (!platform || !type || !data || typeof data !== 'object') {
            throw new Error('PlatformEventRouter requires platform, type, and data');
        }
        const payload = asRouterRecord(data);

        if (ALIAS_PAID_TYPES.includes(type)) {
            throw new Error(`Unsupported paid alias event type: ${type}`);
        }

        if (type !== PlatformEvents.CHAT_MESSAGE && isNotificationType(type) && NOTIFICATION_CONFIGS[type]?.settingKey) {
            if (this._isNotificationEnabled(type, platform) === false) {
                this.logger.debug(`[${platform}] ${type} notifications disabled at router`, 'PlatformEventRouter');
                return;
            }
        }

        switch (type) {
            case PlatformEvents.CHAT_MESSAGE:
                if (this.runtime?.handleChatMessage) {
                    const normalizedChat = this._normalizeChatEvent(payload, platform);
                    if (!normalizedChat) {
                        return;
                    }
                    await this.runtime.handleChatMessage(platform, normalizedChat);
                }
                return;
            case PlatformEvents.VIEWER_COUNT:
                if (this.runtime?.updateViewerCount) {
                    if (!payload.timestamp || !isIsoTimestamp(String(payload.timestamp))) {
                        throw new Error('Viewer-count event requires ISO timestamp');
                    }
                    if (payload.count === undefined) {
                        throw new Error('Viewer-count event requires count');
                    }
                    const count = typeof payload.count === 'string'
                        ? Number(payload.count)
                        : (typeof payload.count === 'number' ? payload.count : Number.NaN);
                    if (!Number.isFinite(count)) {
                        throw new Error('Viewer-count event requires numeric count');
                    }
                    this.runtime.updateViewerCount(platform, count);
                }
                return;
            case PlatformEvents.GIFT: {
                await this._routeRuntimeNotification('handleGiftNotification', type, platform, payload, (sanitized) => ({
                    ...sanitized,
                    type
                }));
                return;
            }
            case PlatformEvents.PAYPIGGY: {
                await this._routeRuntimeNotification('handlePaypiggyNotification', type, platform, payload, (sanitized) => ({
                    ...sanitized,
                    type
                }));
                return;
            }
            case PlatformEvents.GIFTPAYPIGGY: {
                await this._routeRuntimeNotification('handleGiftPaypiggyNotification', type, platform, payload);
                return;
            }
            case PlatformEvents.FOLLOW: {
                await this._routeRuntimeNotification('handleFollowNotification', type, platform, payload);
                return;
            }
            case PlatformEvents.SHARE: {
                await this._routeRuntimeNotification('handleShareNotification', type, platform, payload);
                return;
            }
            case PlatformEvents.RAID: {
                await this._routeRuntimeNotification('handleRaidNotification', type, platform, payload);
                return;
            }
            case PlatformEvents.STREAM_STATUS:
                return;
            case PlatformEvents.STREAM_DETECTED:
                if (this.runtime?.handleStreamDetected) {
                    await this.runtime.handleStreamDetected(platform, payload);
                }
                return;
            case PlatformEvents.ENVELOPE:
                if (this.runtime?.handleEnvelopeNotification) {
                    const sanitized = this._sanitizeNotificationPayload(payload, type, platform);
                    await this.runtime.handleEnvelopeNotification(platform, sanitized);
                }
                return;
            default:
                if (isNotificationType(type)) {
                    await this.forwardToNotificationManager(type, platform, payload);
                    return;
                }
                throw new Error(`Unsupported platform event type: ${type}`);
        }
    }

    _isNotificationEnabled(type: NotificationType, platform: string) {
        const settingKey = NOTIFICATION_CONFIGS[type]?.settingKey;
        if (!settingKey) {
            throw new Error(`Unknown notification type: ${type}`);
        }
        const platformName = String(platform).toLowerCase();
        const value = this.config[platformName]?.[settingKey];
        if (value === undefined) {
            throw new Error(`Config missing ${platformName}.${settingKey}`);
        }
        return !!value;
    }

    async forwardToNotificationManager(type: string, platform: string, data: RouterRecord) {
        if (this.notificationManager?.handleNotification) {
            const sanitized = this._sanitizeNotificationPayload(data, type, platform);
            if (!sanitized) {
                return;
            }
            await this.notificationManager.handleNotification(type, platform, sanitized);
        } else {
            throw new Error(`No notification manager available for platform event ${type}`);
        }
    }

    dispose() {
        if (this.subscription) {
            try {
                this.subscription();
            } catch (error: unknown) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.warn(`Error unsubscribing platform:event handler: ${errorMessage}`, 'PlatformEventRouter');
            }
        }
        this.subscription = null;
    }

    _handleRouterError(message: string, error: unknown, eventType = 'event-routing') {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'PlatformEventRouter', error);
        }
    }

    _normalizeChatEvent(data: unknown = {}, platform = 'unknown') {
        const payload = asRouterRecord(data);
        const metadataValue = payload.metadata;
        const metadata = (metadataValue && typeof metadataValue === 'object')
            ? asRouterRecord(metadataValue)
            : metadataValue;
        const avatarUrl = typeof payload.avatarUrl === 'string' ? payload.avatarUrl.trim() : '';
        const messageParts = resolveCanonicalMessageParts(payload);
        const badgeImages = normalizeBadgeImages(payload.badgeImages);
        const missingFields = getMissingFields(metadata);
        const isMissingField = (fieldName: string) => missingFields.includes(fieldName);
        if (metadataValue !== undefined && (typeof metadataValue !== 'object' || metadataValue === null)) {
            throw new Error('Chat event metadata must be an object');
        }
        const messagePayload = asRouterRecord(payload.message);
        if ((!payload.message || typeof payload.message !== 'object') && !isMissingField('message')) {
            throw new Error('Chat event requires message payload');
        }
        if ((typeof messagePayload.text !== 'string') && !isMissingField('message')) {
            throw new Error('Chat event requires message text');
        }
        const normalizedText = typeof messagePayload.text === 'string'
            ? String(messagePayload.text).trim()
            : '';
        if (!normalizedText && messageParts.length === 0 && !isMissingField('message')) {
            throw new Error('Chat event requires non-empty message text');
        }
        const normalizedUsername = typeof payload.username === 'string' ? payload.username.trim() : '';
        if (!normalizedUsername && !isMissingField('username')) {
            throw new Error('Chat event requires username');
        }
        const normalizedUserId = (typeof payload.userId === 'string' && payload.userId.trim())
            ? payload.userId.trim()
            : (payload.userId !== undefined && payload.userId !== null ? String(payload.userId).trim() : '');
        if (!normalizedUserId && !isMissingField('userId')) {
            throw new Error('Chat event requires userId');
        }
        const normalizedTimestamp = (typeof payload.timestamp === 'string' && payload.timestamp.trim() && isIsoTimestamp(String(payload.timestamp)))
            ? String(payload.timestamp)
            : '';
        if (!normalizedTimestamp && !isMissingField('timestamp')) {
            throw new Error('Chat event requires ISO timestamp');
        }

        const normalized: NormalizedChatPayload = {
            platform,
            ...(normalizedUserId ? { userId: normalizedUserId } : {}),
            username: normalizedUsername || UNKNOWN_CHAT_USERNAME,
            message: {
                text: normalizedText || (isMissingField('message') ? UNKNOWN_CHAT_MESSAGE : '')
            },
            ...(normalizedTimestamp ? { timestamp: normalizedTimestamp } : {}),
            isMod: payload.isMod,
            isPaypiggy: payload.isPaypiggy === true,
            isBroadcaster: payload.isBroadcaster
        };
        if (messageParts.length > 0) {
            normalized.message.parts = messageParts;
        }
        if (avatarUrl) {
            normalized.avatarUrl = avatarUrl;
        }
        if (metadata !== undefined || missingFields.length > 0) {
            normalized.metadata = {
                ...(asRouterRecord(metadata) || {})
            };
            delete normalized.metadata.messageParts;
            if (missingFields.length > 0) {
                normalized.metadata.missingFields = missingFields;
            }
        }
        if (badgeImages.length > 0) {
            normalized.badgeImages = badgeImages;
        }

        return normalized;
    }

    async _routeRuntimeNotification(handlerName: string, type: string, platform: string, data: RouterRecord, payloadBuilder: ((sanitized: RouterRecord) => RouterRecord) | null = null) {
        const handler = this.runtime?.[handlerName];
        if (!handler) {
            return;
        }

        const sanitized = this._sanitizeNotificationPayload(data, type, platform);
        if (!sanitized) {
            return;
        }
        const payload = payloadBuilder ? payloadBuilder(sanitized) : sanitized;
        await (handler as RuntimeNotificationHandler).call(this.runtime, platform, sanitized.username, payload);
    }

    _sanitizeNotificationPayload(data: unknown = {}, sourceType: string | null = null, sourcePlatform: string | null = null) {
        if (!data || typeof data !== 'object') {
            throw new Error('Notification payload must be an object');
        }

        const sanitized: RouterRecord = { ...asRouterRecord(data) };
        const originalType = sourceType;
        const originalPlatform = sourcePlatform;

        delete sanitized.type;
        delete sanitized.platform;
        delete sanitized.user;
        delete sanitized.displayName;

        const isErrorPayload = sanitized.isError === true;

        if (!originalPlatform) {
            throw new Error('Notification payload requires platform');
        }
        if (!originalType) {
            throw new Error('Notification payload requires type');
        }
        if (!sanitized.timestamp || !isIsoTimestamp(String(sanitized.timestamp))) {
            throw new Error('Notification payload requires ISO timestamp');
        }

        const normalizedUserIdValue = sanitized.userId === undefined || sanitized.userId === null
            ? ''
            : String(sanitized.userId).trim();
        const normalizedUserId = normalizedUserIdValue || undefined;
        const normalizedUsername = typeof sanitized.username === 'string' ? sanitized.username.trim() : '';
        const isAnonymousPayload = sanitized.isAnonymous === true;
        const allowsAnonymous = isAnonymousPayload &&
            (originalType === PlatformEvents.GIFT || originalType === PlatformEvents.GIFTPAYPIGGY);

        if (!isErrorPayload) {
            if (!allowsAnonymous) {
                if (!normalizedUsername) {
                    throw new Error('Notification payload requires username');
                }
                if (!normalizedUserId) {
                    throw new Error('Notification payload requires userId');
                }
            } else if ((normalizedUsername && !normalizedUserId) || (!normalizedUsername && normalizedUserId)) {
                throw new Error('Notification payload requires username and userId when identity is provided');
            }
        }

        if (!isErrorPayload) {
            if (originalType === PlatformEvents.GIFT || originalType === PlatformEvents.ENVELOPE) {
                const giftType = typeof sanitized.giftType === 'string' ? sanitized.giftType.trim() : '';
                const giftCount = sanitized.giftCount;
                const amount = sanitized.amount;
                const currency = typeof sanitized.currency === 'string' ? sanitized.currency.trim() : '';
                const id = sanitized.id;
                if (!id || !giftType || giftCount === undefined || amount === undefined || !currency) {
                    throw new Error('Notification payload requires id, giftType, giftCount, amount, and currency');
                }
            }
            if (originalType === PlatformEvents.GIFTPAYPIGGY) {
                if (sanitized.giftCount === undefined) {
                    throw new Error('Notification payload requires giftCount');
                }
            }
        }

        const result = {
            ...sanitized,
            platform: originalPlatform,
            sourceType: originalType,
            type: originalType
        } as RouterRecord;
        if (normalizedUsername) {
            result.username = normalizedUsername;
        }
        if (normalizedUserId !== undefined) {
            result.userId = normalizedUserId;
        }
        return result;
    }

}

export { PlatformEventRouter };
