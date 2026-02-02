
const { safeSetTimeout, safeSetInterval } = require('./timeout-validator');
const { createPlatformErrorHandler } = require('./platform-error-handler');

class SpamDetectionConfig {
    constructor(config = {}, dependencies = {}) {
        if (!dependencies.logger) {
            throw new Error('SpamDetectionConfig requires logger dependency');
        }
        this.logger = dependencies.logger;

        this.enabled = config.enabled;
        this.lowValueThreshold = config.lowValueThreshold;
        this.detectionWindow = config.detectionWindow;
        this.maxIndividualNotifications = config.maxIndividualNotifications;
        this.tiktokEnabled = config.tiktokEnabled;
        this.tiktokLowValueThreshold = config.tiktokLowValueThreshold;
        this.twitchEnabled = config.twitchEnabled;
        this.twitchLowValueThreshold = config.twitchLowValueThreshold;
        this.youtubeEnabled = config.youtubeEnabled;
        this.youtubeLowValueThreshold = config.youtubeLowValueThreshold;

        this.logConfiguration();
    }

    getPlatformConfig(platform = 'unknown') {
        const p = platform.toLowerCase();
        const platformEnabledKey = `${p}Enabled`;
        const platformThresholdKey = `${p}LowValueThreshold`;
        
        const platformEnabled = this[platformEnabledKey] ?? this.enabled;
        const platformThreshold = this[platformThresholdKey] ?? this.lowValueThreshold;
        
        return {
            enabled: platformEnabled,
            lowValueThreshold: platformThreshold,
            detectionWindow: this.detectionWindow,
            maxIndividualNotifications: this.maxIndividualNotifications
        };
    }

    logConfiguration() {
        const configSummary = {
            enabled: this.enabled,
            threshold: this.lowValueThreshold,
            window: this.detectionWindow,
            maxNotifications: this.maxIndividualNotifications
        };
        
        this.logger.info(`Spam detection initialized: ${JSON.stringify(configSummary)}`, 'spam-detection');
    }
}

class DonationSpamDetection {
    constructor(config, dependencies = {}) {
        if (!dependencies.logger) {
            throw new Error('DonationSpamDetection requires logger dependency');
        }
        this.logger = dependencies.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'spam-detection');
        this.onAggregatedDonation = dependencies.onAggregatedDonation || null;
        
        this.config = config;
        this.cleanupInterval = null;
        this.donationSpamTracker = {};
        
        const autoCleanup = dependencies.autoCleanup !== false;
        if (autoCleanup) {
            this.setupPeriodicCleanup();
            this.logger.debug('Periodic cleanup scheduled every 30 seconds', 'spam-detection');
        }
        
        this.logger.info('System initialized', 'spam-detection');
    }

    isLowValueDonation(unitAmount, platform = 'unknown') {
        const platformConfig = this.config.getPlatformConfig(platform);
        
        if (!platformConfig.enabled) {
            this.logger.debug(`${platform} spam detection disabled, skipping check for ${unitAmount}`, 'spam-detection');
            return false;
        }
        
        if (unitAmount === null || unitAmount === undefined) {
            this.logger.debug(`Invalid gift amount: ${unitAmount}`, 'spam-detection');
            return false;
        }
        
        const isLowValue = unitAmount <= platformConfig.lowValueThreshold;
        this.logger.debug(`${platform} amount ${unitAmount} ${isLowValue ? 'IS' : 'IS NOT'} low value (threshold: ${platformConfig.lowValueThreshold})`, 'spam-detection');
        
        return isLowValue;
    }

    handleDonationSpam(userId, username, unitAmount, giftType, giftCount, platform = 'Unknown') {
        try {
            this.logger.debug(`Processing ${platform} donation: ${username} -> ${giftType} x${giftCount} (${unitAmount})`, 'spam-detection');
            
            const platformConfig = this.config.getPlatformConfig(platform);
            
            if (!platformConfig.enabled || !this.isLowValueDonation(unitAmount, platform)) {
                this.logger.debug(`Allowing donation: ${!platformConfig.enabled ? 'system disabled' : 'high value'}`, 'spam-detection');
                return { shouldShow: true, aggregatedMessage: null };
            }

            const now = Date.now();
            const windowMs = platformConfig.detectionWindow * 1000;
            
            if (!this.donationSpamTracker[userId]) {
                this.donationSpamTracker[userId] = {
                    notifications: [],
                    aggregatedCount: 0,
                    lastReset: now,
                    aggregationTimer: null,
                    username: username,
                    platform: platform
                };
                this.logger.debug(`Initialized tracking for user: ${userId}`, 'spam-detection');
            }

            const userTracker = this.donationSpamTracker[userId];
            
            const originalCount = userTracker.notifications.length;
            userTracker.notifications = userTracker.notifications.filter(
                notification => (now - notification.timestamp) <= windowMs
            );
            
            if (originalCount !== userTracker.notifications.length) {
                this.logger.debug(`Cleaned ${originalCount - userTracker.notifications.length} old notifications for ${userId}`, 'spam-detection');
            }

            userTracker.notifications.push({
                timestamp: now,
                coinValue: unitAmount,
                giftType,
                giftCount: giftCount,
                platform: platform
            });

            const currentNotificationCount = userTracker.notifications.length;
            this.logger.debug(`${username}: ${currentNotificationCount}/${platformConfig.maxIndividualNotifications} notifications in window`, 'spam-detection');

            if (currentNotificationCount <= platformConfig.maxIndividualNotifications) {
                this.logger.info(`${platform} - ${username}: Individual notification ${currentNotificationCount}/${platformConfig.maxIndividualNotifications} - showing normally`, 'spam-detection');
                return { shouldShow: true, aggregatedMessage: null };
            } else {
                userTracker.aggregatedCount += giftCount;
                userTracker.username = username;
                userTracker.platform = platform;
                
                this.logger.debug(`Spam threshold exceeded - aggregating notifications for ${userId}`, 'spam-detection');
                
                if (!userTracker.aggregationTimer) {
                    this.logger.info(`${platform} - ${username}: Starting aggregation timer (${platformConfig.detectionWindow}s)`, 'spam-detection');
                    
                    userTracker.aggregationTimer = safeSetTimeout(() => {
                        this.processAggregatedDonation(userId, userTracker);
                    }, platformConfig.detectionWindow * 1000);
                }
                
                this.logger.info(`${platform} - ${username}: Suppressing individual notification ${currentNotificationCount} (aggregating)`, 'spam-detection');
                return { shouldShow: false, aggregatedMessage: null };
            }
        } catch (err) {
            const errorMsg = `Error processing donation spam for ${username}: ${err.message || err}`;
            this._handleSpamDetectionError(errorMsg, err, {
                userId,
                platform,
                giftType
            });
            this.logger.debug(errorMsg, 'spam-detection');
            
            return { shouldShow: true, aggregatedMessage: null };
        }
    }

    processAggregatedDonation(userId, userTracker) {
        try {
            if (!userTracker.notifications || userTracker.notifications.length === 0) {
                this.logger.debug(`No notifications to aggregate for user ${userId}`, 'spam-detection');
                return {
                    shouldShow: false,
                    aggregatedMessage: null,
                    totalCoinValue: 0,
                    totalGiftCount: 0
                };
            }

            const totalCoins = userTracker.notifications.reduce((sum, notif) => sum + (notif.coinValue * notif.giftCount), 0);
            const totalGifts = userTracker.notifications.reduce((sum, notif) => sum + notif.giftCount, 0);
            const uniqueGiftTypes = [...new Set(userTracker.notifications.map(notif => notif.giftType))];
            
            const aggregatedMessage = totalGifts > 1 
                ? `${userTracker.username} sent ${totalGifts} gifts worth ${totalCoins} coins (${uniqueGiftTypes.join(', ')})`
                : `${userTracker.username} sent ${totalGifts} gift worth ${totalCoins} coins (${uniqueGiftTypes[0]})`;

            this.logger.info(`${userTracker.platform} - Processing aggregated donation: ${aggregatedMessage}`, 'spam-detection');

            if (this.onAggregatedDonation) {
                const aggregatedData = {
                    userId: userId,
                    username: userTracker.username,
                    platform: userTracker.platform,
                    totalCoins: totalCoins,
                    totalGifts: totalGifts,
                    giftTypes: uniqueGiftTypes,
                    message: aggregatedMessage,
                    notifications: userTracker.notifications
                };
                
                this.onAggregatedDonation(aggregatedData);
            }

            if (userTracker.aggregationTimer) {
                clearTimeout(userTracker.aggregationTimer);
                userTracker.aggregationTimer = null;
            }
            
            userTracker.notifications = [];
            userTracker.aggregatedCount = 0;
            userTracker.lastReset = Date.now();
            
            this.logger.debug(`Aggregated donation processed and tracking reset for user ${userId}`, 'spam-detection');

            return {
                shouldShow: true,
                aggregatedMessage: aggregatedMessage,
                totalCoinValue: totalCoins,
                totalGiftCount: totalGifts
            };
            
        } catch (error) {
            this._handleSpamDetectionError(
                `Error processing aggregated donation for user ${userId}: ${error.message}`,
                error,
                { userId }
            );
        }
    }

    cleanupSpamDetection(forceCleanup = false) {
        try {
            const now = Date.now();
            const windowMs = forceCleanup ? 0 : this.config.detectionWindow * 1000 * 2;
            let cleanedUsers = 0;
            let totalUsers = Object.keys(this.donationSpamTracker).length;
            
            this.logger.debug(`Starting cleanup of ${totalUsers} tracked users${forceCleanup ? ' (forced)' : ''}`, 'spam-detection');
            
            for (const userId in this.donationSpamTracker) {
                const userTracker = this.donationSpamTracker[userId];
                
                const originalNotifications = userTracker.notifications.length;
                userTracker.notifications = userTracker.notifications.filter(
                    notification => (now - notification.timestamp) <= windowMs
                );
                
                if (userTracker.notifications.length === 0 && 
                    (forceCleanup || (now - userTracker.lastReset) > windowMs)) {
                    if (userTracker.aggregationTimer) {
                        clearTimeout(userTracker.aggregationTimer);
                        userTracker.aggregationTimer = null;
                    }
                    delete this.donationSpamTracker[userId];
                    cleanedUsers++;
                    this.logger.debug(`Cleaned up${forceCleanup ? ' (forced)' : ' stale'} entry for user: ${userId}`, 'spam-detection');
                } else if (originalNotifications !== userTracker.notifications.length) {
                    this.logger.debug(`Cleaned ${originalNotifications - userTracker.notifications.length} old notifications for user: ${userId}`, 'spam-detection');
                }
            }
            
            const remainingUsers = Object.keys(this.donationSpamTracker).length;
            this.logger.info(`Cleanup complete: ${cleanedUsers} users removed, ${remainingUsers} users remaining`, 'spam-detection');
            
        } catch (err) {
            const errorMsg = `Error during spam detection cleanup: ${err.message || err}`;
            this._handleSpamDetectionError(errorMsg, err);
            this.logger.debug(errorMsg, 'spam-detection');
        }
    }

    setupPeriodicCleanup() {
        this.cleanupInterval = safeSetInterval(() => {
            this.cleanupSpamDetection();
        }, 30000);
    }

    getStatistics() {
        const userCount = Object.keys(this.donationSpamTracker).length;
        const totalNotifications = Object.values(this.donationSpamTracker)
            .reduce((sum, tracker) => sum + tracker.notifications.length, 0);
        
        return {
            trackedUsers: userCount,
            totalNotifications: totalNotifications,
            enabled: this.config.enabled,
            threshold: this.config.lowValueThreshold
        };
    }

    resetTracking() {
        for (const userId in this.donationSpamTracker) {
            delete this.donationSpamTracker[userId];
        }
        this.logger.debug('All tracking data reset', 'spam-detection');
    }

    destroy() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
            this.logger.debug('Periodic cleanup interval cleared', 'spam-detection');
        }
        
        for (const userId in this.donationSpamTracker) {
            const userTracker = this.donationSpamTracker[userId];
            if (userTracker.aggregationTimer) {
                clearTimeout(userTracker.aggregationTimer);
                userTracker.aggregationTimer = null;
            }
            delete this.donationSpamTracker[userId];
        }
        this.logger.debug('All aggregation timers cleared and tracking data reset', 'spam-detection');
    }
}

DonationSpamDetection.prototype._handleSpamDetectionError = function(message, error = null, payload = null) {
    if (!this.errorHandler) {
        this.errorHandler = createPlatformErrorHandler(this.logger, 'spam-detection');
    }

    if (error instanceof Error) {
        this.errorHandler.handleEventProcessingError(error, 'spam-detection', payload, message, 'spam-detection');
        return;
    }

    this.errorHandler.logOperationalError(message, 'spam-detection', payload);
};

function createSpamDetectionConfig(config, dependencies = {}) {
    return new SpamDetectionConfig(config, dependencies);
}

function createDonationSpamDetection(config, dependencies = {}) {
    return new DonationSpamDetection(config, dependencies);
}

module.exports = {
    SpamDetectionConfig,
    createSpamDetectionConfig,
    createDonationSpamDetection
};
