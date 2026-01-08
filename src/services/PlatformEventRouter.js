
const { logger: defaultLogger } = require('../core/logging');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { NOTIFICATION_CONFIGS } = require('../core/constants');

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

        const aliasPaidTypes = ['subscription', 'resubscription', 'membership', 'member', 'subscribe', 'superfan', 'supporter', 'paid_supporter'];
        if (aliasPaidTypes.includes(type)) {
            throw new Error(`Unsupported paid alias event type: ${type}`);
        }

        // Config gating only applies to notification types with explicit settings
        if (NOTIFICATION_CONFIGS[type]?.settingKey) {
            if (this._isNotificationEnabled(type, platform) === false) {
                this.logger.debug(`[${platform}] ${type} notifications disabled at router`, 'PlatformEventRouter');
                return;
            }
        }

        switch (type) {
            case 'chat':
                if (this.runtime?.handleChatMessage) {
                    const normalizedChat = this._normalizeChatEvent(data, platform);
                    if (!normalizedChat) {
                        return;
                    }
                    await this.runtime.handleChatMessage(platform, normalizedChat);
                }
                return;
            case 'viewer-count':
                if (this.runtime?.updateViewerCount) {
                    if (data.count === undefined) {
                        throw new Error('Viewer-count event requires count');
                    }
                    this.runtime.updateViewerCount(platform, data.count);
                }
                return;
            case 'gift': {
                if (this.runtime?.handleGiftNotification) {
                    const sanitized = this._sanitizeNotificationPayload(data, type, platform);
                    if (!sanitized) {
                        return;
                    }
                    await this.runtime.handleGiftNotification(platform, sanitized.username, {
                        ...sanitized,
                        type
                    });
                }
                return;
            }
            case 'paypiggy': {
                if (this.runtime?.handlePaypiggyNotification) {
                    const sanitized = this._sanitizeNotificationPayload(data, type, platform);
                    if (!sanitized) {
                        return;
                    }
                    sanitized.type = 'paypiggy';
                    await this.runtime.handlePaypiggyNotification(platform, sanitized.username, sanitized);
                }
                return;
            }
            case 'giftpaypiggy': {
                if (this.runtime?.handleGiftPaypiggyNotification) {
                    const sanitized = this._sanitizeNotificationPayload(data, type, platform);
                    if (!sanitized) {
                        return;
                    }
                    await this.runtime.handleGiftPaypiggyNotification(platform, sanitized.username, sanitized);
                }
                return;
            }
            case 'follow': {
                if (this.runtime?.handleFollowNotification) {
                    const sanitized = this._sanitizeNotificationPayload(data, type, platform);
                    if (!sanitized) {
                        return;
                    }
                    await this.runtime.handleFollowNotification(platform, sanitized.username, sanitized);
                }
                return;
            }
            case 'share': {
                if (this.runtime?.handleShareNotification) {
                    const sanitized = this._sanitizeNotificationPayload(data, type, platform);
                    if (!sanitized) {
                        return;
                    }
                    await this.runtime.handleShareNotification(platform, sanitized.username, sanitized);
                }
                return;
            }
            case 'raid': {
                if (this.runtime?.handleRaidNotification) {
                    const sanitized = this._sanitizeNotificationPayload(data, type, platform);
                    if (!sanitized) {
                        return;
                    }
                    await this.runtime.handleRaidNotification(platform, sanitized.username, sanitized);
                }
                return;
            }
            case 'stream-status':
                return;
            case 'stream-detected':
                if (this.runtime?.handleStreamDetected) {
                    await this.runtime.handleStreamDetected(platform, data);
                }
                return;
            case 'envelope':
                if (this.runtime?.handleEnvelopeNotification) {
                    await this.runtime.handleEnvelopeNotification(platform, data);
                }
                return;
            default:
                await this.forwardToNotificationManager(type, platform, data);
        }
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

    _sanitizeNotificationPayload(data = {}, sourceType = null, sourcePlatform = null) {
        if (!data || typeof data !== 'object') {
            throw new Error('Notification payload must be an object');
        }

        const sanitized = { ...data };
        const originalType = sanitized.type || sourceType;
        const originalPlatform = sanitized.platform || sourcePlatform;

        delete sanitized.type;
        delete sanitized.platform;
        delete sanitized.user;
        delete sanitized.displayName;

        if (!sanitized.username || typeof sanitized.username !== 'string' || !sanitized.username.trim()) {
            throw new Error('Notification payload requires username');
        }
        if (!sanitized.userId) {
            throw new Error('Notification payload requires userId');
        }
        if (!originalPlatform) {
            throw new Error('Notification payload requires platform');
        }
        if (!originalType) {
            throw new Error('Notification payload requires type');
        }

        return {
            username: sanitized.username.trim(),
            userId: sanitized.userId,
            platform: originalPlatform,
            sourceType: originalType,
            ...sanitized
        };
    }

}

module.exports = PlatformEventRouter;
