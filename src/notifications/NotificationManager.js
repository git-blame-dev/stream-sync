
const EventEmitter = require('events');
const { safeSetInterval } = require('../utils/timeout-validator');
const {  DonationSpamDetection } = require('../utils/spam-detection');
const { logger } = require('../core/logging');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { PlatformEvents } = require('../interfaces/PlatformEvents');
const { createSyntheticGiftFromAggregated } = require('./aggregated-donation-transformer');

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
        if (!dependencies.textProcessing) {
            throw new Error('NotificationManager requires textProcessing dependency');
        }

        this.constants = dependencies.constants;
        this.textProcessing = dependencies.textProcessing;
        const goalsDependency = dependencies.obsGoals;
        if (goalsDependency && typeof goalsDependency.processDonationGoal === 'function') {
            this.obsGoals = goalsDependency;
        } else {
            throw new Error('NotificationManager requires obsGoals dependency');
        }
        
        this.eventBus = dependencies.eventBus;
        this.configService = dependencies.configService;
        this.ttsService = dependencies.ttsService;
        this.vfxCommandService = dependencies.vfxCommandService;
        this.userTrackingService = dependencies.userTrackingService;
        this.displayQueue = dependencies.displayQueue;

        if (!this.displayQueue) {
            throw new Error('NotificationManager requires displayQueue dependency');
        }
        if (!this.configService) {
            throw new Error('NotificationManager requires ConfigService dependency');
        }

        this.logger.debug('[NotificationManager] Initialized', 'notification-manager');
        
        this.donationSpamDetector = dependencies.donationSpamDetector;

        this.userNotificationSuppression = new Map();
        this.suppressionConfig = {
            enabled: dependencies.suppressionEnabled !== false,
            maxNotificationsPerUser: 5,
            suppressionWindowMs: 60000,
            suppressionDurationMs: 300000,
            cleanupIntervalMs: 300000
        };

        this._loadSuppressionConfig();

        if (!this.eventBus) {
            throw new Error('NotificationManager requires EventBus dependency');
        }

        if (!this.configService) {
            throw new Error('NotificationManager requires ConfigService dependency');
        }
        
        const { PRIORITY_LEVELS, NOTIFICATION_CONFIGS } = this.constants;
        this.PRIORITY_LEVELS = PRIORITY_LEVELS;
        this.NOTIFICATION_CONFIGS = NOTIFICATION_CONFIGS;
        this.NotificationBuilder = require('../utils/notification-builder');

        const { processDonationGoal } = this.obsGoals;
        this.processDonationGoal = processDonationGoal;

        this.startSuppressionCleanup();
        this.errorHandler = null;
    }


    build(input) {
        const NotificationBuilder = require('../utils/notification-builder');
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
            'platform:paypiggy': this.PRIORITY_LEVELS.MEMBER,
            'platform:raid': this.PRIORITY_LEVELS.RAID,
            'platform:share': this.PRIORITY_LEVELS.SHARE,
            'redemption': this.PRIORITY_LEVELS.REDEMPTION,
            'platform:giftpaypiggy': this.PRIORITY_LEVELS.GIFTPAYPIGGY,
            'command': this.PRIORITY_LEVELS.COMMAND,
            'greeting': this.PRIORITY_LEVELS.GREETING,
            'farewell': this.PRIORITY_LEVELS.GREETING,
            'platform:chat-message': this.PRIORITY_LEVELS.CHAT,
            'general': this.PRIORITY_LEVELS.DEFAULT
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
            this._handleNotificationError(`Error handling aggregated donation: ${error.message}`, error, { aggregatedData }, { eventType: 'aggregated-donation' });
        }
    }

    async handleNotification(notificationType, platform, data) {
        return this.handleNotificationInternal(notificationType, platform, data, false);
    }

    async handleNotificationInternal(notificationType, platform, data, skipSpamDetection) {
        if (typeof platform !== 'string') {
            this.logger.warn(`[NotificationManager] Invalid platform type: ${typeof platform}`, 'notification-manager', { notificationType, platform });
            return { success: false, error: 'Invalid platform type', notificationType, platform };
        }

        // Check if we have configuration access through ConfigService or app
        if (!this._hasConfigAccess()) {
            this.logger.warn(`[NotificationManager] No configuration access available, cannot process notification`, platform, { notificationType, data });
            return { success: false, error: 'Configuration unavailable', notificationType, platform };
        }
        if (!data || typeof data !== 'object') {
            this.logger.warn(`[NotificationManager] handleNotification called with invalid data`, platform, { notificationType, data });
            return { success: false, error: 'Invalid notification data', notificationType, platform };
        }
        const incomingType = data?.type;
        const originalType = notificationType;
        let resolvedType = notificationType;

        // Require canonical types from platform adapters; no alias remapping

        const disallowedPaidAliases = ['subscription', 'subscribe', 'membership', 'member', 'superfan', 'supporter', 'paid_supporter'];
        if (disallowedPaidAliases.includes(resolvedType)) {
            this._handleNotificationError(
                `[NotificationManager] Unsupported paid alias type: ${resolvedType}`,
                null,
                { notificationType: resolvedType, platform },
                { eventType: 'unsupported-paid-alias' }
            );
            return { success: false, error: 'Unsupported paid alias', notificationType: resolvedType, platform };
        }

        const canonicalType = resolvedType;
        const config = this.NOTIFICATION_CONFIGS[canonicalType];
        if (!config) {
            this._handleNotificationError(`[NotificationManager] Unknown notification type: ${canonicalType}`, null, { notificationType: canonicalType, platform }, { eventType: 'unknown-notification-type' });
            return { success: false, error: 'Unknown notification type', notificationType: canonicalType, platform };
        }
        if (incomingType && incomingType !== canonicalType) {
            this._handleNotificationError(`[NotificationManager] Incoming type mismatch: ${incomingType} vs ${canonicalType}`, null, { notificationType: canonicalType, platform }, { eventType: 'unknown-notification-type' });
            return { success: false, error: 'Unknown notification type', notificationType: canonicalType, platform };
        }
        notificationType = canonicalType;
        const monetizationTypes = new Set([
            'platform:gift',
            'platform:paypiggy',
            'platform:giftpaypiggy',
            'platform:envelope'
        ]);
        const isMonetizationType = monetizationTypes.has(notificationType);

        const normalizedData = { ...data };
        if (normalizedData.type) delete normalizedData.type;
        if (normalizedData.platform) delete normalizedData.platform;
        if (normalizedData.user) delete normalizedData.user;
        if (normalizedData.displayName) delete normalizedData.displayName;
        if (normalizedData.isSuperfan !== undefined) delete normalizedData.isSuperfan;
        if (normalizedData.isGift !== undefined) delete normalizedData.isGift;
        if (normalizedData.isBits !== undefined) delete normalizedData.isBits;
        if (isMonetizationType && normalizedData.metadata !== undefined) delete normalizedData.metadata;
        data = normalizedData;
        const resolvedSourceType = data.sourceType !== undefined
            ? data.sourceType
            : (originalType !== canonicalType ? originalType : undefined);

        const platformName = platform.toLowerCase();
        const isErrorPayload = data.isError === true;
        
        // Check if notifications are enabled for this type
        const isEnabled = this._areNotificationsEnabled(config.settingKey, platformName);
        
        if (!isEnabled) {
            this.logger.debug(`[${platformName}] ${notificationType} notifications disabled, skipping for ${data.username}`, 'notification-manager');
            return { success: false, error: 'Notifications disabled', notificationType, platform, disabled: true };
        }

        // Filter zero-amount monetary notifications (fiat-based gifts only)
        if (!isErrorPayload && notificationType === 'platform:gift' &&
            typeof data.amount === 'number' &&
            data.amount <= 0) {
            const currency = typeof data.currency === 'string' ? data.currency.trim().toLowerCase() : '';
            if (currency && currency !== 'coins' && currency !== 'bits') {
                this.logger.debug(`[${platformName}] ${notificationType} with zero amount filtered out for ${data.username}`, 'notification-manager');
                return { success: false, filtered: true, reason: 'Zero amount not displayed', notificationType, platform };
            }
        }

        if (data.userId !== undefined && data.userId !== null) {
            data.userId = String(data.userId);
        }

        // Check per-user notification suppression
        if (data.userId && this.isUserSuppressed(data.userId, notificationType)) {
            if (this._isDebugEnabled()) {
                this.platformLogger.debug(platformName, `Notification suppressed for ${data.username} (${notificationType})`);
            }
            return { suppressed: true, reason: 'user_suppression' };
        }

        // Handle gift spam before any other processing (unless skipped)
        if (notificationType === 'platform:gift' && this.donationSpamDetector && !skipSpamDetection && !data.isAggregated && !isErrorPayload) {
            try {
            if (!data.giftType || data.giftCount === undefined || data.amount === undefined) {
                throw new Error('Gift spam detection requires giftType, giftCount, and amount');
            }
            const giftCount = Number(data.giftCount);
            const amount = Number(data.amount);
            if (!Number.isFinite(giftCount) || giftCount <= 0) {
                throw new Error('Gift spam detection requires valid giftCount');
            }
            if (!Number.isFinite(amount)) {
                throw new Error('Gift spam detection requires valid amount');
            }
            const perGiftAmount = amount / giftCount;
            const spamResult = this.donationSpamDetector.handleDonationSpam(
                data.userId,
                data.username,
                perGiftAmount,
                data.giftType,
                giftCount,
                platform
            );

            if (!spamResult.shouldShow) {
                    this.platformLogger.debug(platform, `Spam gift suppressed from ${data.username}.`);
                    return { suppressed: true, reason: 'spam_detection' }; // Stop processing this notification
                }
            } catch (error) {
                this.platformLogger.warn(platform, `Error in spam detection: ${error.message}`);
                // Continue processing if spam detection fails
            }
        }

        const username = (typeof data.username === 'string') ? data.username.trim() : '';
        if (!username && !isErrorPayload) {
            this._handleNotificationError(
                `[NotificationManager] ${notificationType} notification missing username`,
                null,
                { notificationType, platform, data },
                { eventType: 'notification-missing-username' }
            );
            return { success: false, error: 'Missing username', notificationType, platform };
        }
        if (username) {
            data.username = username;
        }

        if (this._isDebugEnabled()) {
            try {
                const logMessage = this.generateLogMessage(notificationType, data);
                this.platformLogger.info(platform, logMessage);
            } catch (logError) {
                this.logger.warn(`[NotificationManager] Debug log failed: ${logError.message}`, 'notification-manager');
            }
        }

        if (data.userId) {
            this.trackUserNotification(data.userId, notificationType);
        }

        let vfxConfig = null;
        try {
            vfxConfig = await this._getVFXConfigFromService(config.commandKey, data.message ?? null);
        } catch (vfxError) {
            this._handleNotificationError(
                `[NotificationManager] VFX config failed: ${vfxError.message}`,
                vfxError,
                { commandKey: config.commandKey },
                { eventType: 'vfx-config' }
            );
        }

        let notificationData;
        try {
            // Use modern NotificationBuilder for consistent notification creation
            // Pass ALL relevant data fields to ensure complete notifications
            notificationData = this.NotificationBuilder.build({
                type: canonicalType,
                platform: platform,
                username: data.username,
                userId: data.userId,
                // Gift/donation fields
                amount: data.amount,
                currency: data.currency,
                giftType: data.giftType,
                giftCount: data.giftCount,
                // Paid supporter fields
                tier: data.tier,
                months: data.months,
                // Message content
                message: data.message,
                // Super Sticker specific
                sticker: data.sticker,
                stickerName: data.stickerName,
                stickerEmoji: data.stickerEmoji,
                // Pass through any additional data
                ...data,
                sourceType: resolvedSourceType
            });
            
            // Validate that notificationData has required structure
            if (!notificationData || typeof notificationData !== 'object') {
                throw new Error('NotificationBuilder.build() returned invalid data structure');
            }
            
            // Enforce canonical notification type
            notificationData.type = canonicalType;
            
            // Ensure required fields exist
            if (data.username) {
                const { formatUsername12 } = require('../utils/validation');
                formatUsername12(data.username, false);
                formatUsername12(data.username, true);
            }

            // Add sourceType metadata for non-monetization notifications only
            if (resolvedSourceType !== undefined) {
                if (isMonetizationType) {
                    notificationData.sourceType = resolvedSourceType;
                } else if (notificationData.metadata && typeof notificationData.metadata === 'object') {
                    notificationData.metadata = { ...notificationData.metadata, sourceType: resolvedSourceType };
                } else {
                    notificationData.metadata = { sourceType: resolvedSourceType };
                }
            }

            if (!notificationData.displayMessage) {
                throw new Error(`Missing displayMessage in notification data for ${notificationType}`);
            }
            if (!notificationData.ttsMessage) {
                this.logger.warn(`Missing ttsMessage in notification data for ${notificationType}`, notificationData);
            }
            
        } catch (error) {
            this._handleNotificationError(
                `Error creating notification data for ${notificationType} from ${platform}: ${error.message}`,
                error,
                { notificationType, platform, data },
                { eventType: 'notification-data-build' }
            );
            return { success: false, error: 'Notification build failed', notificationType, platform };
        }
        
        const priorityType = canonicalType;
        const displayType = notificationType;
        
        // Structure the item properly for DisplayQueue
        const item = {
            type: displayType,
            data: notificationData,
            platform: platform,
            priority: this.getPriorityForType(priorityType, config),
            vfxConfig: vfxConfig
        };
        
        // Validate item structure before adding to queue
        if (!item.data || typeof item.data !== 'object') {
            this._handleNotificationError(
                `Invalid item data structure for ${notificationType} from ${platform}`,
                null,
                { notificationType, platform, item },
                { eventType: 'notification-structure' }
            );
            return { success: false, error: 'Invalid data structure', details: 'item.data is not a valid object' };
        }
        
        // Add to display queue with error handling
        try {
            this.displayQueue.addItem(item);
        } catch (error) {
            this._handleNotificationError(
                `Error in notification processing for ${notificationType} from ${platform}: ${error.message}`,
                error,
                { notificationType, platform, item },
                { eventType: 'display-queue' }
            );
            return { success: false, error: 'Display queue error', details: error.message }; // Stop processing if display queue fails
        }

        // Handle special processing (gifts, donations, etc.) after adding to queue
        try {
            if (config.hasSpecialProcessing) {
                await this.handleSpecialProcessing(notificationType, platform, data);
            }
        } catch (error) {
            this._handleNotificationError(
                `Error in special processing for ${notificationType} from ${platform}: ${error.message}`,
                error,
                { notificationType, platform, data },
                { eventType: 'special-processing' }
            );
            // Don't return - notification is already in queue, just log the special processing error
        }
        
        // Return success with the notification data
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

    async handleSpecialProcessing(notificationType, platform, data) {
        try {
            // Goal tracking is now handled in display-queue.js when notifications start playing
            // This ensures goals only increment when notifications are actually displayed
            
            // VFX command execution - route through VFXCommandService via EventBus
            // Visual effects are emitted by DisplayQueue when the item actually plays.
            const config = this.NOTIFICATION_CONFIGS[notificationType];
            
            // TTS processing - route through TTSService via EventBus
            await this._processTTS(notificationType, platform, data);
            
            // Other special processing can go here
        } catch (error) {
            this._handleNotificationError(
                `Error in special processing for ${notificationType}: ${error.message}`,
                error,
                { notificationType, platform, data },
                { eventType: 'special-processing' }
            );
            // Don't throw - continue with notification display even if special processing fails
        }
    }

    getStats() {
        if (!this.displayQueue || typeof this.displayQueue.getQueueLength !== 'function') {
            throw new Error('NotificationManager requires displayQueue with getQueueLength');
        }
        return {
            supportedNotificationTypes: Object.keys(this.NOTIFICATION_CONFIGS),
            displayQueueLength: this.displayQueue.getQueueLength(),
            priorityLevels: Object.keys(this.PRIORITY_LEVELS)
        };
    }

    async handleGiftNotification(platform, data) {
        await this.handleNotification('platform:gift', platform, data);
    }

    isUserSuppressed(userId, notificationType) {
        if (!this.suppressionConfig.enabled) {
            return false;
        }

        const userData = this.userNotificationSuppression.get(userId);
        if (!userData) {
            return false;
        }

        const now = Date.now();
        
        // Check if user is in suppression period
        if (userData.suppressedUntil && now < userData.suppressedUntil) {
            this.logger.debug(`[Suppression] User ${userId} is suppressed until ${new Date(userData.suppressedUntil)}`, 'notification-manager');
            return true;
        }

        // Check notification count in window
        const windowStart = now - this.suppressionConfig.suppressionWindowMs;
        const recentNotifications = userData.notifications.filter(n => n.timestamp > windowStart);
        
        if (recentNotifications.length >= this.suppressionConfig.maxNotificationsPerUser) {
            // Suppress user for the configured duration
            userData.suppressedUntil = now + this.suppressionConfig.suppressionDurationMs;
            this.logger.debug(`[Suppression] User ${userId} exceeded limit (${recentNotifications.length}/${this.suppressionConfig.maxNotificationsPerUser}), suppressing until ${new Date(userData.suppressedUntil)}`, 'notification-manager');
            return true;
        }

        return false;
    }

    trackUserNotification(userId, notificationType) {
        if (!this.suppressionConfig.enabled) {
            return;
        }

        const now = Date.now();
        let userData = this.userNotificationSuppression.get(userId);
        
        if (!userData) {
            userData = {
                notifications: [],
                suppressedUntil: null
            };
            this.userNotificationSuppression.set(userId, userData);
        }

        // Add notification to tracking
        userData.notifications.push({
            timestamp: now,
            type: notificationType
        });

        this.logger.debug(`[Suppression] Tracked notification for user ${userId}: ${notificationType}`, 'notification-manager');
    }

    startSuppressionCleanup() {
        if (!this.suppressionConfig.enabled) {
            return;
        }

        this.cleanupInterval = safeSetInterval(() => {
            this.cleanupSuppressionData();
        }, this.suppressionConfig.cleanupIntervalMs);

        this.logger.debug(`[Suppression] Started cleanup interval (${this.suppressionConfig.cleanupIntervalMs}ms)`, 'notification-manager');
    }
    
    stopSuppressionCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            this.logger.debug('[Suppression] Stopped cleanup interval', 'notification-manager');
        }
    }

    cleanupSuppressionData() {
        const now = Date.now();
        const cutoffTime = now - this.suppressionConfig.suppressionWindowMs;
        let cleanedCount = 0;

        for (const [userId, userData] of this.userNotificationSuppression.entries()) {
            // Remove old notifications
            const originalCount = userData.notifications.length;
            userData.notifications = userData.notifications.filter(n => n.timestamp > cutoffTime);
            
            // Remove suppression if expired
            if (userData.suppressedUntil && now > userData.suppressedUntil) {
                userData.suppressedUntil = null;
            }

            // Remove user data if no recent activity
            if (userData.notifications.length === 0 && !userData.suppressedUntil) {
                this.userNotificationSuppression.delete(userId);
                cleanedCount++;
            } else if (originalCount !== userData.notifications.length) {
                cleanedCount++;
            }
        }

        if (cleanedCount > 0) {
            this.logger.debug(`[Suppression] Cleaned up ${cleanedCount} user suppression entries`, 'notification-manager');
        }
    }

    // ================================================================================================
    // PHASE 3.1-3.5: EVENT-DRIVEN ARCHITECTURE PRIVATE METHODS
    // ================================================================================================

    _loadSuppressionConfig() {
        const generalConfig = this.configService.get('general');
        if (!generalConfig || typeof generalConfig !== 'object') {
            throw new Error('Invalid suppression config: general config is missing or invalid');
        }
        const requiredKeys = [
            'userSuppressionEnabled',
            'maxNotificationsPerUser',
            'suppressionWindowMs',
            'suppressionDurationMs',
            'suppressionCleanupIntervalMs'
        ];
        const missingKeys = requiredKeys.filter((key) => generalConfig[key] === undefined);
        if (missingKeys.length > 0) {
            throw new Error(`Missing suppression config values: ${missingKeys.join(', ')}`);
        }

        this.suppressionConfig = {
            enabled: !!generalConfig.userSuppressionEnabled,
            maxNotificationsPerUser: generalConfig.maxNotificationsPerUser,
            suppressionWindowMs: generalConfig.suppressionWindowMs,
            suppressionDurationMs: generalConfig.suppressionDurationMs,
            cleanupIntervalMs: generalConfig.suppressionCleanupIntervalMs
        };
    }

    _hasConfigAccess() {
        return !!this.configService;
    }

    _areNotificationsEnabled(settingKey, platform) {
        try {
            return this.configService.areNotificationsEnabled(settingKey, platform);
        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error checking notifications enabled: ${error.message}`,
                error,
                { settingKey, platform },
                { eventType: 'notifications-enabled' }
            );
            return false;
        }
    }

    _isDebugEnabled() {
        try {
            return this.configService.isDebugEnabled();
        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error checking debug enabled: ${error.message}`,
                error,
                null,
                { eventType: 'debug-enabled' }
            );
            return false;
        }
    }

    async _isFirstMessage(userId, context = {}) {
        try {
            if (!this.userTrackingService) {
                throw new Error('UserTrackingService not available for first message check');
            }

            return this.userTrackingService.isFirstMessage(userId, context);
        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error checking first message: ${error.message}`,
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
                `[NotificationManager] Error getting VFX config: ${error.message}`,
                error,
                { commandKey, message },
                { eventType: 'vfx-config' }
            );
            throw error;
        }
    }

    async _processTTS(notificationType, platform, data) {
        try {
            // Check if TTS is enabled
            const ttsConfig = this.configService.getTTSConfig();
            const ttsEnabled = ttsConfig.enabled;
            
            if (!ttsEnabled) {
                return;
            }
            
            // Get the notification data to extract TTS message
            const notificationData = this.NotificationBuilder.build({
                type: notificationType,
                platform: platform,
                username: data.username,
                userId: data.userId,
                amount: data.amount,
                currency: data.currency,
                giftType: data.giftType,
                giftCount: data.giftCount,
                tier: data.tier,
                months: data.months,
                message: data.message,
                sticker: data.sticker,
                stickerName: data.stickerName,
                stickerEmoji: data.stickerEmoji,
                ...data
            });
            
            if (!notificationData?.ttsMessage) {
                return;
            }
            
            this.logger.debug(`[NotificationManager] Processing TTS for ${notificationType}: ${notificationData.ttsMessage}`, 'notification-manager');

            // Emit TTS event for processing via EventBus
            this.eventBus.emit(PlatformEvents.TTS_SPEECH_REQUESTED, {
                text: notificationData.ttsMessage,
                notificationType,
                platform,
                source: 'notification-manager',
                options: {
                    source: 'notification-manager'
                }
            });
        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error processing TTS: ${error.message}`,
                error,
                { notificationType, platform, data },
                { eventType: 'tts-processing' }
            );
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
                `[NotificationManager] Error processing VFX: ${error.message}`,
                error,
                { vfxNotification },
                { eventType: 'vfx-processing' }
            );
        }
    }

    async processTTSForNotification(ttsNotification) {
        try {
            this.logger.debug(`[NotificationManager] Processing TTS for ${ttsNotification.type}`, 'notification-manager');

            // Check TTS enabled through ConfigService
            const ttsConfig = this.configService.getTTSConfig();
            const ttsEnabled = ttsConfig.enabled;

            if (!ttsEnabled) {
                this.logger.debug('[NotificationManager] TTS disabled, skipping', 'notification-manager');
                return;
            }

            if (!ttsNotification.ttsMessage) {
                return;
            }

            const context = {
                platform: ttsNotification.platform,
                username: ttsNotification.username,
                userId: ttsNotification.userId,
                type: ttsNotification.type
            };

            if (this.eventBus) {
                this.eventBus.emit(PlatformEvents.TTS_SPEECH_REQUESTED, {
                    text: ttsNotification.ttsMessage,
                    notificationType: ttsNotification.type,
                    platform: ttsNotification.platform,
                    source: 'notification-manager'
                });
                return;
            }

            if (this.ttsService) {
                await this.ttsService.speak(ttsNotification.ttsMessage, context);
            }

        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error processing TTS: ${error.message}`,
                error,
                { ttsNotification },
                { eventType: 'tts-notification' }
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
            const isEnabled = this._areNotificationsEnabled(settingKey, platform);
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
                this.logger.warn(`[NotificationManager] handleNotification failed: ${handleError.message} - continuing with minimal processing`);
            }

        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error processing notification: ${error.message}`,
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
