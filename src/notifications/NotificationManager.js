
const EventEmitter = require('events');
const { safeSetInterval } = require('../utils/timeout-validator');
const {  DonationSpamDetection } = require('../utils/spam-detection');
const { logger } = require('../core/logging');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { PlatformEvents } = require('../interfaces/PlatformEvents');

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
        
        // New service dependencies (NO MORE APP DEPENDENCY)
        this.eventBus = dependencies.eventBus;
        this.configService = dependencies.configService;
        this.ttsService = dependencies.ttsService;
        this.vfxCommandService = dependencies.vfxCommandService;
        this.userTrackingService = dependencies.userTrackingService;
        this.displayQueue = dependencies.displayQueue;

        // Validation for required services
        if (!this.displayQueue) {
            throw new Error('NotificationManager requires displayQueue dependency');
        }
        if (!this.configService) {
            throw new Error('NotificationManager requires ConfigService dependency');
        }
        
        // MODERNIZATION: Pure service-based architecture
        // All dependencies injected via constructor for better testability and modularity
        this.logger.debug('[NotificationManager] Initializing with pure service-based architecture', 'notification-manager', {
            hasEventBus: !!this.eventBus,
            hasConfigService: !!this.configService,
            hasVFXCommandService: !!this.vfxCommandService,
            hasTTSService: !!this.ttsService,
            hasUserTrackingService: !!this.userTrackingService
        });
        
        // Initialize donation spam detection (simplified - will be configured later)
        this.donationSpamDetector = dependencies.donationSpamDetector; // Support dependency injection, undefined if not provided

        // Per-user notification suppression system
        this.userNotificationSuppression = new Map();
        this.suppressionConfig = {
            // Disable in test environment to prevent resource leaks
            enabled: process.env.NODE_ENV !== 'test',
            maxNotificationsPerUser: 5,
            suppressionWindowMs: 60000, // 1 minute
            suppressionDurationMs: 300000, // 5 minutes
            cleanupIntervalMs: 300000 // 5 minutes
        };

        // Load suppression configuration from ConfigService or app config
        this._loadSuppressionConfig();
        
        // Validate required services for event-driven architecture
        if (!this.eventBus) {
            throw new Error('NotificationManager requires EventBus dependency for event-driven architecture');
        }
        
        if (!this.configService) {
            throw new Error('NotificationManager requires ConfigService dependency');
        }
        
        const { PRIORITY_LEVELS, NOTIFICATION_CONFIGS } = this.constants;
        this.PRIORITY_LEVELS = PRIORITY_LEVELS;
        
        // Use consolidated NOTIFICATION_CONFIGS from constants.js
        // This ensures single source of truth and fixes envelope notification hiding bug
        this.NOTIFICATION_CONFIGS = NOTIFICATION_CONFIGS;
        
        // Use NotificationBuilder for modern notification creation
        this.NotificationBuilder = require('../utils/notification-builder');
        
        const { processDonationGoal } = this.obsGoals;
        this.processDonationGoal = processDonationGoal;
        
        this.logger.debug('[NotificationManager] Unified notification system initialized');

        // Start cleanup interval for suppression tracking
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
            'follow': this.PRIORITY_LEVELS.FOLLOW,
            'gift': this.PRIORITY_LEVELS.GIFT,
            'envelope': this.PRIORITY_LEVELS.ENVELOPE,
            'paypiggy': this.PRIORITY_LEVELS.MEMBER,
            'raid': this.PRIORITY_LEVELS.RAID,
            'share': this.PRIORITY_LEVELS.SHARE,
            'redemption': this.PRIORITY_LEVELS.REDEMPTION,
            'giftpaypiggy': this.PRIORITY_LEVELS.GIFTPAYPIGGY,
            'command': this.PRIORITY_LEVELS.COMMAND,
            'greeting': this.PRIORITY_LEVELS.GREETING,
            'farewell': this.PRIORITY_LEVELS.GREETING,
            'chat': this.PRIORITY_LEVELS.CHAT,
            'general': this.PRIORITY_LEVELS.DEFAULT
        };
        
        if (!Object.prototype.hasOwnProperty.call(priorityMap, notificationType)) {
            throw new Error(`Missing priority mapping for ${notificationType}`);
        }
        return priorityMap[notificationType];
    }


    handleAggregatedDonation(aggregatedData) {
        try {
            this.logger.info(`[Aggregated] Processing aggregated donation from ${aggregatedData.username} on ${aggregatedData.platform}: ${aggregatedData.message}`, 'notification-manager');
            
            // Create a synthetic gift notification for the aggregated donation
            const syntheticGiftData = {
                userId: aggregatedData.userId,
                username: aggregatedData.username,
                giftType: `Multiple Gifts (${aggregatedData.giftTypes.join(', ')})`,
                giftCount: aggregatedData.totalGifts,
                amount: aggregatedData.totalCoins,
                currency: 'coins',
                message: aggregatedData.message,
                isAggregated: true // Flag to identify this as an aggregated donation
            };
            
            // Process as a regular gift notification, but skip spam detection
            this.handleNotificationInternal('gift', aggregatedData.platform, syntheticGiftData, true);
            
        } catch (error) {
            this._handleNotificationError(`Error handling aggregated donation: ${error.message}`, error, { aggregatedData }, { eventType: 'aggregated-donation' });
        }
    }

    async handleNotification(notificationType, platform, data) {
        return this.handleNotificationInternal(notificationType, platform, data, false);
    }

    async handleNotificationInternal(notificationType, platform, data, skipSpamDetection) {
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

        const isSuperfan = data?.isSuperfan === true;

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

        const normalizedData = { ...data };
        if (normalizedData.type) delete normalizedData.type;
        if (normalizedData.platform) delete normalizedData.platform;
        if (normalizedData.user) delete normalizedData.user;
        if (normalizedData.displayName) delete normalizedData.displayName;
        data = normalizedData;

        const platformName = platform.toLowerCase();
        const isErrorPayload = data.isError === true;
        
        // Check if notifications are enabled for this type
        const isEnabled = this._areNotificationsEnabled(config.settingKey, platformName);
        
        if (!isEnabled) {
            this.logger.debug(`[${platformName}] ${notificationType} notifications disabled, skipping for ${data.username}`, 'notification-manager');
            return { success: false, error: 'Notifications disabled', notificationType, platform, disabled: true };
        }

        // Filter zero-amount monetary notifications (fiat-based gifts only)
        if (!isErrorPayload && notificationType === 'gift' &&
            typeof data.amount === 'number' &&
            data.amount <= 0) {
            const currency = typeof data.currency === 'string' ? data.currency.trim().toLowerCase() : '';
            if (currency && currency !== 'coins' && currency !== 'bits') {
                this.logger.debug(`[${platformName}] ${notificationType} with zero amount filtered out for ${data.username}`, 'notification-manager');
                return { success: false, filtered: true, reason: 'Zero amount not displayed', notificationType, platform };
            }
        }

        // Check per-user notification suppression
        if (data.userId && this.isUserSuppressed(data.userId, notificationType)) {
            if (this._isDebugEnabled()) {
                this.platformLogger.debug(platformName, `Notification suppressed for ${data.username} (${notificationType})`);
            }
            return { suppressed: true, reason: 'user_suppression' };
        }

        // Handle gift spam before any other processing (unless skipped)
        if (notificationType === 'gift' && this.donationSpamDetector && !skipSpamDetection && !data.isAggregated && !isErrorPayload) {
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
        if (!username) {
            this._handleNotificationError(
                `[NotificationManager] ${notificationType} notification missing username`,
                null,
                { notificationType, platform, data },
                { eventType: 'notification-missing-username' }
            );
            return { success: false, error: 'Missing username', notificationType, platform };
        }
        data.username = username;
        if (data.userId !== undefined && data.userId !== null) {
            data.userId = String(data.userId);
        }

        // Log notifications to console when debug mode is enabled
        if (this._isDebugEnabled()) {
            const logMessage = this.generateLogMessage(notificationType, data);
            this.platformLogger.info(platform, logMessage);
        }

        // Track notification for suppression
        if (data.userId) {
            this.trackUserNotification(data.userId, notificationType);
        }

        // Get VFX configuration and create notification data with error handling
        const vfxConfig = await this._getVFXConfigFromService(config.commandKey, data.message ?? null);
        let notificationData;
        try {
            // Use modern NotificationBuilder for consistent notification creation
            // Pass ALL relevant data fields to ensure complete notifications
            notificationData = this.NotificationBuilder.build({
                type: canonicalType,
                platform: platform,
                username: data.username,
                userId: data.userId,
                isSuperfan,
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
                sourceType: data.sourceType
            });
            
            // Validate that notificationData has required structure
            if (!notificationData || typeof notificationData !== 'object') {
                throw new Error('NotificationBuilder.build() returned invalid data structure');
            }
            
            // Enforce canonical notification type
            notificationData.type = canonicalType;
            
            // Ensure required fields exist
            const { formatUsername12 } = require('../utils/validation');
            const sanitizedUsername = formatUsername12(data.username, false);
            const sanitizedTtsUsername = formatUsername12(data.username, true);

            // Add sourceType metadata for diagnostics
            if (data.sourceType || originalType !== canonicalType) {
                const sourceType = data.sourceType !== undefined ? data.sourceType : originalType;
                if (notificationData.metadata && typeof notificationData.metadata === 'object') {
                    notificationData.metadata = { ...notificationData.metadata, sourceType };
                } else {
                    notificationData.metadata = { sourceType };
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

    async handleGreeting(platform, normalizedData) {
        try {
            // Validate normalized data structure
            if (!normalizedData || typeof normalizedData !== 'object') {
                this.platformLogger.warn(platform, 'Invalid normalized data provided to handleGreeting', { data: normalizedData });
                return;
            }

        // Check if greetings are enabled using ConfigService or app config
        const greetingsEnabled = this._areGreetingsEnabled(platform);
        if (!greetingsEnabled) {
            return;
        }

            // Optimize: Use standardized data fields
            const userId = normalizedData.userId;
            const username = normalizedData.username;
            
            if (!userId) {
                this.platformLogger.warn(platform, 'No userId provided for greeting check', { data: normalizedData });
                return;
            }

            // Check if this is a first message using UserTrackingService or app
            const isFirstMessage = await this._isFirstMessage(userId, normalizedData);
                
        if (isFirstMessage) {
                this.platformLogger.console(platform, `First message from ${username}, showing greeting.`);
            
                const normalizedGreetingData = { ...normalizedData };
                delete normalizedGreetingData.displayName;
                delete normalizedGreetingData.user;
                const greetingData = this.NotificationBuilder.build({
                    type: 'greeting',
                    platform: platform,
                    username,
                    userId,
                    metadata: normalizedGreetingData.metadata,
                    // Pass any additional data that might be needed
                    ...normalizedGreetingData
                });
                
            const item = {
                type: 'greeting',
                data: greetingData,
                platform: platform,
                priority: this.PRIORITY_LEVELS.GREETING,
            };

                // Get VFX config using VFXCommandService for consistent command selection
                const vfxConfig = await this._getVFXConfigFromService('greetings', normalizedData.message);
                this.logger.debug('[NotificationManager] Greeting VFX config result', 'notification-manager', vfxConfig);
                
                if (vfxConfig) {
                    this.logger.debug('[NotificationManager] Adding VFX config to greeting item', 'notification-manager', {
                        filename: vfxConfig.filename,
                        mediaSource: vfxConfig.mediaSource,
                        vfxFilePath: vfxConfig.vfxFilePath
                    });
                    item.vfxConfig = vfxConfig;
                } else {
                    this.logger.debug('[NotificationManager] No VFX config found for greetings', 'notification-manager');
                }

                this.displayQueue.addItem(item);
            }
        } catch (error) {
            this.platformLogger.error(platform, `Error handling greeting: ${error.message}`, error);
            // Don't rethrow to prevent blocking message processing
        }
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
            case 'gift': {
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
            case 'raid':
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

    async showGreeting(platform, username, userId) {
        if (!userId) {
            throw new Error('showGreeting requires userId');
        }
        const data = {
            username: username,
            userId: userId
        };
        
        await this.handleGreeting(platform, data);
    }

    async handleGiftNotification(platform, data) {
        await this.handleNotification('gift', platform, data);
    }

    async processChatMessage(platform, data) {
        // Only handle greeting processing here, command processing is handled elsewhere
        await this.handleGreeting(platform, data);
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
            throw error;
        }
    }

    _areGreetingsEnabled(platform) {
        try {
            return this.configService.getPlatformConfig(platform, 'greetingsEnabled');
        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error checking greetings enabled: ${error.message}`,
                error,
                { platform },
                { eventType: 'greetings-enabled' }
            );
            throw error;
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
            throw error;
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

    // MODERNIZATION: Event-driven service methods

    async handleChatMessage(chatMessage) {
        try {
            this.logger.debug(`[NotificationManager] Processing chat message from ${chatMessage.platform}:${chatMessage.username}`, 'notification-manager');

            // Check if it's a first message using UserTrackingService
            const isFirstMessage = await this._isFirstMessage(chatMessage.userId);

            // Process greeting if first message and greetings enabled
            if (isFirstMessage && this._isGreetingEnabled(chatMessage.platform)) {
                await this._processGreetingNotification(chatMessage);
            }

            // Emit notification processed event for the original chat message
            const notificationData = {
                type: 'chat',
                platform: chatMessage.platform,
                username: chatMessage.username,
                userId: chatMessage.userId,
                message: chatMessage.message,  // Use original message, not greeting
                isFirstMessage,
                timestamp: new Date().toISOString()
            };

            if (this.eventBus) {
                this.eventBus.emit('notification:processed', notificationData);
            }

        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error processing chat message: ${error.message}`,
                error,
                { chatMessage },
                { eventType: 'chat-processing' }
            );
            if (this.eventBus) {
                this.eventBus.emit('notification:error', { error: error.message, context: 'chat-message' });
            }
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
                    
                    // Emit notification processed event on success
                    if (this.eventBus) {
                        this.eventBus.emit('notification:processed', {
                            type: vfxNotification.type,
                            platform: vfxNotification.platform,
                            username: vfxNotification.username,
                            vfxCommand: vfxNotification.vfxCommand
                        });
                    }
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
            if (this.eventBus) {
                this.eventBus.emit('vfx:command-failed', { 
                    command: vfxNotification.vfxCommand,
                    error: error.message,
                    username: vfxNotification.username,
                    userId: vfxNotification.userId,
                    platform: vfxNotification.platform
                });
                
                // Still emit notification processed event to indicate graceful degradation
                this.eventBus.emit('notification:processed', {
                    type: vfxNotification.type,
                    platform: vfxNotification.platform,
                    username: vfxNotification.username,
                    userId: vfxNotification.userId,
                    vfxCommand: vfxNotification.vfxCommand,
                    status: 'partial_failure',
                    error: error.message
                });
            }
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
            if (this.eventBus) {
                this.eventBus.emit(PlatformEvents.TTS_SPEECH_FAILED, { 
                    text: ttsNotification.ttsMessage,
                    error: error.message,
                    username: ttsNotification.username,
                    userId: ttsNotification.userId,
                    platform: ttsNotification.platform
                });
            }
        }
    }

    async processNotification(notification) {
        try {
            this.logger.debug(`[NotificationManager] Processing ${notification.type} notification`, 'notification-manager');

            const settingKey = this.NOTIFICATION_CONFIGS[notification.type]?.settingKey;
            if (!settingKey) {
                throw new Error(`Unsupported notification type: ${notification.type}`);
            }
            const isEnabled = this._areNotificationsEnabled(settingKey, notification.platform);
            if (!isEnabled) {
                this.logger.debug(`[NotificationManager] ${notification.type} notifications disabled`, 'notification-manager');
                return;
            }

            // Process through existing notification system (this might fail if handleNotification requires services)
            try {
                if (!notification.data) {
                    throw new Error('Notification processing requires notification.data');
                }
                await this.handleNotification(notification.type, notification.platform, notification.data);
            } catch (handleError) {
                this.logger.warn(`[NotificationManager] handleNotification failed: ${handleError.message} - continuing with minimal processing`);
            }

            // Always emit notification processed event even with degraded functionality
            if (this.eventBus) {
                this.eventBus.emit('notification:processed', notification);
            }

        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error processing notification: ${error.message}`,
                error,
                { notification },
                { eventType: 'notification-processing' }
            );
            if (this.eventBus) {
                this.eventBus.emit('notification:error', { error: error.message, notification });
            }
        }
    }

    // Helper methods for modernized functionality

    _isGreetingEnabled(platform) {
        try {
            return this.configService.getPlatformConfig(platform, 'greetingsEnabled');
        } catch (error) {
            this._handleNotificationError(
                `[NotificationManager] Error checking greeting settings: ${error.message}`,
                error,
                { platform },
                { eventType: 'greeting-settings' }
            );
            return false;
        }
    }

    async _processGreetingNotification(chatMessage) {
        try {
            const greetingData = {
                type: 'chat',
                subType: 'greeting',
                platform: chatMessage.platform,
                username: chatMessage.username,
                userId: chatMessage.userId,
                message: `Welcome ${chatMessage.username}!`,
                isFirstMessage: true
            };

            // Emit greeting as notification:processed but DON'T return early - continue to process original message
            if (this.eventBus) {
                this.eventBus.emit('notification:processed', greetingData);
            }

            // Process through existing greeting handler if available
            if (typeof this.handleGreeting === 'function') {
                await this.handleGreeting(chatMessage.platform, {
                    username: chatMessage.username,
                    userId: chatMessage.userId,
                    message: chatMessage.message
                });
            }

        } catch (error) {
            this._handleNotificationError(`[NotificationManager] Error processing greeting: ${error.message}`, error, { chatMessage }, { eventType: 'greeting' });
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

// Factory function for creating NotificationManager with dependencies
function createNotificationManager(dependencies = {}) {
    return new NotificationManager(dependencies);
}

// Export the class and factory function
module.exports = NotificationManager; 
module.exports.createNotificationManager = createNotificationManager; 
