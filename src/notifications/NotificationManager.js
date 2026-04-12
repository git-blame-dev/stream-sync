
const EventEmitter = require('events');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { createSyntheticGiftFromAggregated } = require('./aggregated-donation-transformer');
const { NotificationInputValidator } = require('./notification-input-validator');
const { NotificationPayloadBuilder } = require('./notification-payload-builder');
const { NotificationGate } = require('./notification-gate');

function getErrorMessage(error) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

class NotificationManager extends EventEmitter {
    constructor(dependencies = {}) {
        super(); // Initialize EventEmitter
        
        if (!dependencies.logger) {
            throw new Error('NotificationManager requires logger dependency');
        }

        this.logger = dependencies.logger;

        this.log = this.logger;
        this.platformLogger = this.logger;
        if (!dependencies.constants) {
            throw new Error('NotificationManager requires constants dependency');
        }

        this.constants = dependencies.constants;
        const goalsDependency = dependencies.obsGoals;
        if (goalsDependency && typeof goalsDependency.processDonationGoal === 'function') {
            this.obsGoals = goalsDependency;
        } else {
            throw new Error('NotificationManager requires obsGoals dependency');
        }
        
        this.eventBus = dependencies.eventBus;
        this.config = dependencies.config;
        this.vfxCommandService = dependencies.vfxCommandService;
        this.userTrackingService = dependencies.userTrackingService;
        this.displayQueue = dependencies.displayQueue;

        if (!this.displayQueue) {
            throw new Error('NotificationManager requires displayQueue dependency');
        }
        if (!this.config || typeof this.config !== 'object') {
            throw new Error('NotificationManager requires config dependency');
        }

        this.logger.debug('[NotificationManager] Initialized', 'notification-manager');
        
        this.donationSpamDetector = dependencies.donationSpamDetector;

        if (!this.eventBus) {
            throw new Error('NotificationManager requires EventBus dependency');
        }
        
        const { PRIORITY_LEVELS, NOTIFICATION_CONFIGS } = this.constants;
        this.PRIORITY_LEVELS = PRIORITY_LEVELS;
        this.NOTIFICATION_CONFIGS = NOTIFICATION_CONFIGS;
        const { NotificationBuilder } = require('../utils/notification-builder.js');
        this.NotificationBuilder = NotificationBuilder;
        this.inputValidator = new NotificationInputValidator(this.NOTIFICATION_CONFIGS);
        this.notificationGate = new NotificationGate(this.config);
        this.payloadBuilder = new NotificationPayloadBuilder(this.NotificationBuilder);

        const { processDonationGoal } = this.obsGoals;
        this.processDonationGoal = processDonationGoal;

        this.errorHandler = null;
    }


    build(input) {
        const { NotificationBuilder } = require('../utils/notification-builder.js');
        return NotificationBuilder.build(input);
    }

    getPriorityForType(notificationType, config) {
        // If config has priority, use it
        if (config && typeof config.priority === 'number') {
            return config.priority;
        }
        
        // Map notification types to priority levels for backward compatibility
        const priorityMap = {
            'platform:follow': this.PRIORITY_LEVELS.FOLLOW,
            'platform:gift': this.PRIORITY_LEVELS.GIFT,
            'platform:envelope': this.PRIORITY_LEVELS.ENVELOPE,
            'platform:paypiggy': this.PRIORITY_LEVELS.PAYPIGGY,
            'platform:raid': this.PRIORITY_LEVELS.RAID,
            'platform:share': this.PRIORITY_LEVELS.SHARE,
            'platform:giftpaypiggy': this.PRIORITY_LEVELS.GIFTPAYPIGGY,
            'command': this.PRIORITY_LEVELS.COMMAND,
            'greeting': this.PRIORITY_LEVELS.GREETING,
            'farewell': this.PRIORITY_LEVELS.FAREWELL,
            'platform:chat-message': this.PRIORITY_LEVELS.CHAT
        };
        
        if (!Object.prototype.hasOwnProperty.call(priorityMap, notificationType)) {
            throw new Error(`Missing priority mapping for ${notificationType}`);
        }
        return priorityMap[notificationType];
    }


    async handleAggregatedDonation(aggregatedData) {
        try {
            this.logger.info(`[Aggregated] Processing aggregated donation from ${aggregatedData.username} on ${aggregatedData.platform}: ${aggregatedData.message}`, 'notification-manager');

            const syntheticGiftData = createSyntheticGiftFromAggregated(aggregatedData);

            await this.handleNotificationInternal('platform:gift', aggregatedData.platform, syntheticGiftData, true);

        } catch (error) {
            this._handleNotificationError(`Error handling aggregated donation: ${getErrorMessage(error)}`, error, { aggregatedData }, { eventType: 'aggregated-donation' });
        }
    }

    async handleNotification(notificationType, platform, data) {
        return this.handleNotificationInternal(notificationType, platform, data, false);
    }

    async handleNotificationInternal(notificationType, platform, data, skipSpamDetection) {
        const platformValidation = this.inputValidator.validatePlatform(platform);
        if (!platformValidation.success) {
            this.logger.warn(`[NotificationManager] Invalid platform: ${String(platform)}`, 'notification-manager', { notificationType, platform });
            return { success: false, error: platformValidation.error, notificationType, platform };
        }
        platform = platformValidation.canonicalPlatform;

        if (!this.notificationGate.hasConfigAccess()) {
            this.logger.warn(`[NotificationManager] No configuration access available, cannot process notification`, platform, { notificationType, data });
            return { success: false, error: 'Configuration unavailable', notificationType, platform };
        }

        const dataValidation = this.inputValidator.validateData(data);
        if (!dataValidation.success) {
            this.logger.warn(`[NotificationManager] handleNotification called with invalid data`, platform, { notificationType, data });
            return { success: false, error: dataValidation.error, notificationType, platform };
        }

        const typeValidation = this.inputValidator.validateType(notificationType, data);
        if (!typeValidation.success) {
            if (typeValidation.errorType === 'incoming-type-mismatch') {
                this._handleNotificationError(
                    `[NotificationManager] Incoming type mismatch: ${typeValidation.incomingType} vs ${typeValidation.canonicalType}`,
                    null,
                    { notificationType, platform },
                    { eventType: 'unknown-notification-type' }
                );
                return { success: false, error: typeValidation.error, notificationType, platform };
            }

            this._handleNotificationError(
                `[NotificationManager] Unknown notification type: ${notificationType}`,
                null,
                { notificationType, platform },
                { eventType: 'unknown-notification-type' }
            );
            return { success: false, error: typeValidation.error, notificationType, platform };
        }

        const canonicalType = typeValidation.canonicalType;
        const config = typeValidation.config;
        const isMonetizationType = typeValidation.isMonetizationType;
        const originalType = notificationType;
        notificationType = canonicalType;

        const normalizedData = this.payloadBuilder.normalizeData(data, isMonetizationType);
        const platformName = platform;
        const isErrorPayload = normalizedData.isError === true;
        
        const isEnabled = this.notificationGate.isEnabled(config.settingKey, platformName);
        
        if (!isEnabled) {
            this.logger.debug(`[${platformName}] ${notificationType} notifications disabled, skipping for ${normalizedData.username}`, 'notification-manager');
            return { success: false, error: 'Notifications disabled', notificationType, platform, disabled: true };
        }

        // Filter zero-amount monetary notifications (fiat-based gifts only)
        if (!isErrorPayload && notificationType === 'platform:gift' &&
            typeof normalizedData.amount === 'number' &&
            normalizedData.amount <= 0) {
            const currency = typeof normalizedData.currency === 'string' ? normalizedData.currency.trim().toLowerCase() : '';
            if (currency && currency !== 'coins' && currency !== 'bits') {
                this.logger.debug(`[${platformName}] ${notificationType} with zero amount filtered out for ${normalizedData.username}`, 'notification-manager');
                return { success: false, filtered: true, reason: 'Zero amount not displayed', notificationType, platform };
            }
        }

        if (normalizedData.userId !== undefined && normalizedData.userId !== null) {
            normalizedData.userId = String(normalizedData.userId);
        }

        if (notificationType === 'platform:gift' && this.donationSpamDetector && !skipSpamDetection && !normalizedData.isAggregated && !isErrorPayload) {
            try {
                if (!normalizedData.giftType || normalizedData.giftCount === undefined || normalizedData.amount === undefined) {
                    throw new Error('Gift spam detection requires giftType, giftCount, and amount');
                }
                const giftCount = Number(normalizedData.giftCount);
                const amount = Number(normalizedData.amount);
                if (!Number.isFinite(giftCount) || giftCount <= 0) {
                    throw new Error('Gift spam detection requires valid giftCount');
                }
                if (!Number.isFinite(amount)) {
                    throw new Error('Gift spam detection requires valid amount');
                }
                const perGiftAmount = amount / giftCount;
                const spamResult = this.donationSpamDetector.handleDonationSpam(
                    normalizedData.userId,
                    normalizedData.username,
                    perGiftAmount,
                    normalizedData.giftType,
                    giftCount,
                    platform
                );

                if (!spamResult.shouldShow) {
                    this.platformLogger.debug(`Spam gift suppressed from ${normalizedData.username}.`, platform);
                    return { suppressed: true, reason: 'spam_detection' };
                }
            } catch (error) {
                this.platformLogger.warn(`Error in spam detection: ${getErrorMessage(error)}`, platform);
            }
        }

        const username = (typeof normalizedData.username === 'string') ? normalizedData.username.trim() : '';
        if (!username && !isErrorPayload) {
            this._handleNotificationError(
                `[NotificationManager] ${notificationType} notification missing username`,
                null,
                { notificationType, platform, data: normalizedData },
                { eventType: 'notification-missing-username' }
            );
            return { success: false, error: 'Missing username', notificationType, platform };
        }
        if (username) {
            normalizedData.username = username;
        }

        if (this._isDebugEnabled()) {
            try {
                const logMessage = this.generateLogMessage(notificationType, normalizedData);
                this.platformLogger.info(logMessage, platform);
            } catch (logError) {
                this.logger.warn(`[NotificationManager] Debug log failed: ${getErrorMessage(logError)}`, 'notification-manager');
            }
        }

        let vfxConfig = null;
        try {
            vfxConfig = await this._getVFXConfigFromService(config.commandKey, normalizedData.message ?? null);
        } catch (vfxError) {
            this._handleNotificationError(
                `[NotificationManager] VFX config failed: ${getErrorMessage(vfxError)}`,
                vfxError,
                { commandKey: config.commandKey },
                { eventType: 'vfx-config' }
            );
        }

        let notificationData;
        try {
            const payload = this.payloadBuilder.buildPayload({
                canonicalType,
                platform,
                data: normalizedData,
                originalType,
                isMonetizationType,
                normalizedData
            });
            notificationData = payload.notificationData;
            
            if (!notificationData || typeof notificationData !== 'object') {
                throw new Error('NotificationBuilder.build() returned invalid data structure');
            }
            
            if (!notificationData.displayMessage) {
                throw new Error(`Missing displayMessage in notification data for ${notificationType}`);
            }
            if (!notificationData.ttsMessage) {
                this.logger.warn(`Missing ttsMessage in notification data for ${notificationType}`, notificationData);
            }
            
        } catch (error) {
            this._handleNotificationError(
                `Error creating notification data for ${notificationType} from ${platform}: ${getErrorMessage(error)}`,
                error,
                { notificationType, platform, data: normalizedData },
                { eventType: 'notification-data-build' }
            );
            return { success: false, error: 'Notification build failed', notificationType, platform };
        }
        
        const priorityType = canonicalType;
        const displayType = notificationType;
        
        const item = {
            type: displayType,
            data: notificationData,
            platform: platform,
            priority: this.getPriorityForType(priorityType, config),
            vfxConfig: vfxConfig
        };
        
        if (!item.data || typeof item.data !== 'object') {
            this._handleNotificationError(
                `Invalid item data structure for ${notificationType} from ${platform}`,
                null,
                { notificationType, platform, item },
                { eventType: 'notification-structure' }
            );
            return { success: false, error: 'Invalid data structure', details: 'item.data is not a valid object' };
        }
        
        try {
            this.displayQueue.addItem(item);
        } catch (error) {
            this._handleNotificationError(
                `Error in notification processing for ${notificationType} from ${platform}: ${getErrorMessage(error)}`,
                error,
                { notificationType, platform, item, data: normalizedData },
                { eventType: 'display-queue' }
            );
            return { success: false, error: 'Display queue error', details: getErrorMessage(error) };
        }

        return {
            success: true,
            notificationType,
            platform,
            notificationData,
            priority: config.priority,
            vfxConfig
        };
    }

    async getVFXConfig(commandKey, message) {
        if (arguments.length < 2) {
            throw new Error('getVFXConfig requires message (use null when none)');
        }
        return await this._getVFXConfigFromService(commandKey, message);
    }


    generateLogMessage(notificationType, data) {
        const config = this.NOTIFICATION_CONFIGS[notificationType];
        
        // Use custom template if provided
        if (config.logTemplate) {
            return this.interpolateTemplate(config.logTemplate, data);
        }

        // Default logic for complex types
        switch (notificationType) {
            case 'platform:gift': {
                if (!data.giftType || data.giftCount === undefined || data.amount === undefined || !data.currency) {
                    throw new Error('Gift log message requires giftType, giftCount, amount, and currency');
                }
                const giftCount = Number(data.giftCount);
                const giftType = data.giftType;
                const amount = Number(data.amount);
                const currency = String(data.currency).toLowerCase();
                if (currency === 'bits') {
                    return this.NotificationBuilder.formatBitsLogMessage({
                        username: data.username,
                        giftType,
                        amount
                    });
                }
                if (currency === 'coins') {
                    return `Gift from ${data.username}: ${giftCount}x ${giftType} (${amount} coins)`;
                }
                const formattedAmount = this.NotificationBuilder
                    ? this.NotificationBuilder.formatCurrency(amount, data.currency)
                    : `${amount} ${data.currency}`;
                return `Gift from ${data.username}: ${giftType} (${formattedAmount})`;
            }
            case 'platform:raid':
                if (data.viewerCount === undefined) {
                    throw new Error('Raid log message requires viewerCount');
                }
                return `Incoming raid from ${data.username} with ${data.viewerCount} viewers!`;
            default:
                throw new Error(`Unsupported notification type for log message: ${notificationType}`);
        }
    }

    interpolateTemplate(template, data) {
        return template.replace(/\{(\w+)\}/g, (match, key) => {
            if (data[key] === undefined) {
                throw new Error(`Missing template value for ${key}`);
            }
            return data[key];
        });
    }

    getStats() {
        return {
            supportedNotificationTypes: Object.keys(this.NOTIFICATION_CONFIGS),
            displayQueueLength: this.displayQueue.getQueueLength(),
            priorityLevels: Object.keys(this.PRIORITY_LEVELS)
        };
    }

    async handleGiftNotification(platform, data) {
        await this.handleNotification('platform:gift', platform, data);
    }

    _isDebugEnabled() {
        return this.config.general.debugEnabled;
    }

    async _isFirstMessage(userId, context = {}) {
        try {
            if (!this.userTrackingService) {
                throw new Error('UserTrackingService not available for first message check');
            }

            return this.userTrackingService.isFirstMessage(userId, context);
        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error checking first message: ${getErrorMessage(error)}`,
                error,
                { userId, context },
                { eventType: 'first-message-check' }
            );
            throw error;
        }
    }

    async _getVFXConfigFromService(commandKey, message) {
        try {
            if (!commandKey || typeof commandKey !== 'string') {
                throw new Error('VFX config lookup requires commandKey');
            }
            if (message !== null && typeof message !== 'string') {
                throw new Error('VFX config lookup requires message string or null');
            }
            // Try VFXCommandService
            if (this.vfxCommandService && typeof this.vfxCommandService.getVFXConfig === 'function') {
                const vfxConfig = await this.vfxCommandService.getVFXConfig(commandKey, message);
                this.logger.debug('[NotificationManager] VFX config received from VFXCommandService', 'notification-manager', vfxConfig);
                return vfxConfig;
            }

            throw new Error(`VFXCommandService not available for config lookup: ${commandKey}`);
        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error getting VFX config: ${getErrorMessage(error)}`,
                error,
                { commandKey, message },
                { eventType: 'vfx-config' }
            );
            throw error;
        }
    }

    async processVFXForNotification(vfxNotification) {
        try {
            this.logger.debug(`[NotificationManager] Processing VFX for ${vfxNotification.type}`, 'notification-manager');

            if (this.vfxCommandService && vfxNotification.vfxCommand) {
                const context = {
                    username: vfxNotification.username,
                    platform: vfxNotification.platform,
                    type: vfxNotification.type
                };

                try {
                    await this.vfxCommandService.executeCommand(vfxNotification.vfxCommand, context);
                    
                } catch (vfxError) {
                    // Re-throw to be caught by outer catch block
                    throw vfxError;
                }
            } else if (vfxNotification.vfxCommand) {
                this.logger.warn('[NotificationManager] No VFXCommandService available - VFX execution disabled');
            }

        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error processing VFX: ${getErrorMessage(error)}`,
                error,
                { vfxNotification },
                { eventType: 'vfx-processing' }
            );
        }
    }

    async processNotification(notification) {
        try {
            this.logger.debug(`[NotificationManager] Processing ${notification.type} notification`, 'notification-manager');

            if (typeof notification.platform !== 'string') {
                throw new Error(`Invalid platform type: ${typeof notification.platform}`);
            }
            const platform = notification.platform.toLowerCase();

            const settingKey = this.NOTIFICATION_CONFIGS[notification.type]?.settingKey;
            if (!settingKey) {
                throw new Error(`Unsupported notification type: ${notification.type}`);
            }
            const isEnabled = this.notificationGate.isEnabled(settingKey, platform);
            if (!isEnabled) {
                this.logger.debug(`[NotificationManager] ${notification.type} notifications disabled`, 'notification-manager');
                return;
            }

            // Process through existing notification system (this might fail if handleNotification requires services)
            try {
                if (!notification.data) {
                    throw new Error('Notification processing requires notification.data');
                }
                await this.handleNotification(notification.type, platform, notification.data);
            } catch (handleError) {
                this.logger.warn(`[NotificationManager] handleNotification failed: ${getErrorMessage(handleError)} - continuing with minimal processing`);
            }

        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error processing notification: ${getErrorMessage(error)}`,
                error,
                { notification },
                { eventType: 'notification-processing' }
            );
        }
    }

    _handleNotificationError(message, error = null, payload = null, options = {}) {
        const { context = 'notification-manager', eventType = 'notification' } = options;

        if (!this.errorHandler && this.logger) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'notification-manager');
        }

        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, payload, context);
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, context, payload);
        }
    }
}

module.exports = NotificationManager;
