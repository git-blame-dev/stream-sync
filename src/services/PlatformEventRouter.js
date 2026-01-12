
const { logger: defaultLogger } = require('../core/logging');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { NOTIFICATION_CONFIGS } = require('../core/constants');
const { PlatformEvents } = require('../interfaces/PlatformEvents');

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

class PlatformEventRouter {
    constructor(options) {
        if (!options) {
            throw new Error('PlatformEventRouter requires options');
        }
        this.eventBus = options.eventBus;
        this.runtime = options.runtime;
        this.notificationManager = options.notificationManager;
        this.configService = options.configService;
        this.logger = options.logger;
        if (!this.eventBus || !this.runtime || !this.notificationManager || !this.configService || !this.logger) {
            throw new Error('PlatformEventRouter requires eventBus, runtime, notificationManager, configService, and logger');
        }
        this.errorHandler = createPlatformErrorHandler(this.logger, 'platform-event-router');
        this.subscription = null;

        this.start();
    }

    start() {
        if (!this.eventBus || typeof this.eventBus.subscribe !== 'function') {
            throw new Error('PlatformEventRouter requires eventBus.subscribe');
        }

        this.subscription = this.eventBus.subscribe('platform:event', async (event) => {
            try {
                await this.routeEvent(event);
            } catch (error) {
                const errorDetails = error instanceof Error ? error.message : String(error);
                this._handleRouterError(`Error routing platform event: ${errorDetails}`, error, event?.type || 'unknown');
            }
        });
    }

    async routeEvent(event) {
        if (!event || typeof event !== 'object') {
            throw new Error('PlatformEventRouter requires event object');
        }
        const { platform, data, type } = event;
        if (!platform || !type || !data) {
            throw new Error('PlatformEventRouter requires platform, type, and data');
        }

        if (ALIAS_PAID_TYPES.includes(type)) {
            throw new Error(`Unsupported paid alias event type: ${type}`);
        }

        const notificationType = this._resolveNotificationType(type);

        // Config gating only applies to notification types with explicit settings
        if (notificationType && NOTIFICATION_CONFIGS[notificationType]?.settingKey) {
            if (this._isNotificationEnabled(notificationType, platform) === false) {
                this.logger.debug(`[${platform}] ${notificationType} notifications disabled at router`, 'PlatformEventRouter');
                return;
            }
        }

        switch (type) {
            case PlatformEvents.CHAT_MESSAGE:
                if (this.runtime?.handleChatMessage) {
                    const normalizedChat = this._normalizeChatEvent(data, platform);
                    if (!normalizedChat) {
                        return;
                    }
                    await this.runtime.handleChatMessage(platform, normalizedChat);
                }
                return;
            case PlatformEvents.VIEWER_COUNT:
                if (this.runtime?.updateViewerCount) {
                    if (!data?.timestamp) {
                        throw new Error('Viewer-count event requires timestamp');
                    }
                    if (data.count === undefined) {
                        throw new Error('Viewer-count event requires count');
                    }
                    const count = typeof data.count === 'string' ? Number(data.count) : data.count;
                    if (!Number.isFinite(count)) {
                        throw new Error('Viewer-count event requires numeric count');
                    }
                    this.runtime.updateViewerCount(platform, count);
                }
                return;
            case PlatformEvents.GIFT: {
                await this._routeRuntimeNotification('handleGiftNotification', notificationType, platform, data, (sanitized) => ({
                    ...sanitized,
                    type: notificationType
                }));
                return;
            }
            case PlatformEvents.PAYPIGGY: {
                await this._routeRuntimeNotification('handlePaypiggyNotification', notificationType, platform, data, (sanitized) => ({
                    ...sanitized,
                    type: 'paypiggy'
                }));
                return;
            }
            case PlatformEvents.GIFTPAYPIGGY: {
                await this._routeRuntimeNotification('handleGiftPaypiggyNotification', notificationType, platform, data);
                return;
            }
            case PlatformEvents.FOLLOW: {
                await this._routeRuntimeNotification('handleFollowNotification', notificationType, platform, data);
                return;
            }
            case PlatformEvents.SHARE: {
                await this._routeRuntimeNotification('handleShareNotification', notificationType, platform, data);
                return;
            }
            case PlatformEvents.RAID: {
                await this._routeRuntimeNotification('handleRaidNotification', notificationType, platform, data);
                return;
            }
            case PlatformEvents.STREAM_STATUS:
            case PlatformEvents.CHAT_CONNECTED:
            case PlatformEvents.CHAT_DISCONNECTED:
            case PlatformEvents.CONNECTION_STATUS:
            case PlatformEvents.PLATFORM_CONNECTION:
            case PlatformEvents.ERROR:
            case PlatformEvents.HEALTH_CHECK:
                return;
            case PlatformEvents.STREAM_DETECTED:
                if (this.runtime?.handleStreamDetected) {
                    await this.runtime.handleStreamDetected(platform, data);
                }
                return;
            case PlatformEvents.ENVELOPE:
                if (this.runtime?.handleEnvelopeNotification) {
                    const sanitized = this._sanitizeNotificationPayload(data, notificationType, platform);
                    await this.runtime.handleEnvelopeNotification(platform, sanitized);
                }
                return;
            default:
                if (notificationType) {
                    await this.forwardToNotificationManager(notificationType, platform, data);
                    return;
                }
                throw new Error(`Unsupported platform event type: ${type}`);
        }
    }

    _resolveNotificationType(type) {
        if (!type || typeof type !== 'string') {
            return null;
        }
        if (!type.startsWith('platform:')) {
            return null;
        }
        if (type === PlatformEvents.CHAT_MESSAGE) {
            return 'chat';
        }
        return type.replace('platform:', '');
    }

    _isNotificationEnabled(type, platform) {
        const config = NOTIFICATION_CONFIGS[type];
        const settingKey = config?.settingKey;
        if (!settingKey || !this.configService || typeof this.configService.areNotificationsEnabled !== 'function') {
            throw new Error('ConfigService.areNotificationsEnabled required for notification gating');
        }

        try {
            return this.configService.areNotificationsEnabled(settingKey, platform);
        } catch (error) {
            throw error;
        }
    }

    async forwardToNotificationManager(type, platform, data) {
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
            } catch (error) {
                this.logger.warn(`Error unsubscribing platform:event handler: ${error.message}`, 'PlatformEventRouter');
            }
        }
        this.subscription = null;
    }

    _handleRouterError(message, error, eventType = 'event-routing') {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'PlatformEventRouter', error);
        }
    }

    _normalizeChatEvent(data = {}, platform = 'unknown') {
        const metadata = data.metadata;
        if (metadata !== undefined && (typeof metadata !== 'object' || metadata === null)) {
            throw new Error('Chat event metadata must be an object');
        }
        if (!data.message || typeof data.message !== 'object') {
            throw new Error('Chat event requires message payload');
        }
        if (!data.message.text || typeof data.message.text !== 'string') {
            throw new Error('Chat event requires message text');
        }
        if (!data.message.text.trim()) {
            throw new Error('Chat event requires non-empty message text');
        }
        if (!data.username || typeof data.username !== 'string' || !data.username.trim()) {
            throw new Error('Chat event requires username');
        }
        if (!data.userId) {
            throw new Error('Chat event requires userId');
        }
        if (!data.timestamp) {
            throw new Error('Chat event requires timestamp');
        }

        const normalized = {
            platform,
            userId: String(data.userId),
            username: String(data.username).trim(),
            message: String(data.message.text).trim(),
            timestamp: String(data.timestamp),
            isMod: data.isMod,
            isSubscriber: data.isSubscriber,
            isBroadcaster: data.isBroadcaster
        };
        if (metadata !== undefined) {
            normalized.metadata = metadata;
        }

        return normalized;
    }

    async _routeRuntimeNotification(handlerName, type, platform, data, payloadBuilder = null) {
        const handler = this.runtime?.[handlerName];
        if (!handler) {
            return;
        }

        const sanitized = this._sanitizeNotificationPayload(data, type, platform);
        if (!sanitized) {
            return;
        }
        const payload = payloadBuilder ? payloadBuilder(sanitized) : sanitized;
        await handler.call(this.runtime, platform, sanitized.username, payload);
    }

    _sanitizeNotificationPayload(data = {}, sourceType = null, sourcePlatform = null) {
        if (!data || typeof data !== 'object') {
            throw new Error('Notification payload must be an object');
        }

        const sanitized = { ...data };
        const originalType = sourceType;
        const normalizedType = typeof originalType === 'string' && originalType.startsWith('platform:')
            ? originalType.replace('platform:', '')
            : originalType;
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
        if (!sanitized.timestamp) {
            throw new Error('Notification payload requires timestamp');
        }

        const normalizedUserId = sanitized.userId === undefined || sanitized.userId === null
            ? undefined
            : String(sanitized.userId);

        if (!isErrorPayload) {
            if (!sanitized.username || typeof sanitized.username !== 'string' || !sanitized.username.trim()) {
                throw new Error('Notification payload requires username');
            }
            if (!normalizedUserId) {
                throw new Error('Notification payload requires userId');
            }
        }

        if (!isErrorPayload) {
            if (normalizedType === 'gift' || normalizedType === 'envelope') {
                const giftType = typeof sanitized.giftType === 'string' ? sanitized.giftType.trim() : '';
                const giftCount = sanitized.giftCount;
                const amount = sanitized.amount;
                const currency = typeof sanitized.currency === 'string' ? sanitized.currency.trim() : '';
                const id = sanitized.id;
                if (!id || !giftType || giftCount === undefined || amount === undefined || !currency) {
                    throw new Error('Notification payload requires id, giftType, giftCount, amount, and currency');
                }
            }
            if (normalizedType === 'giftpaypiggy') {
                if (sanitized.giftCount === undefined) {
                    throw new Error('Notification payload requires giftCount');
                }
            }
        }

        const result = {
            ...sanitized,
            platform: originalPlatform,
            sourceType: normalizedType
        };
        const normalizedUsername = typeof sanitized.username === 'string' ? sanitized.username.trim() : '';
        if (normalizedUsername) {
            result.username = normalizedUsername;
        }
        if (normalizedUserId !== undefined) {
            result.userId = normalizedUserId;
        }
        return result;
    }

}

module.exports = PlatformEventRouter;
