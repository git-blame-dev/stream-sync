
const { safeSetTimeout, safeSetInterval } = require('./timeout-validator');
const { createPlatformErrorHandler } = require('./platform-error-handler');

class SpamDetectionConfig {
    constructor(config = {}) {
        const { logger } = require('../core/logging');
        this.logger = logger;

        this.lowValueThreshold = config.lowValueThreshold;
        this.spamDetectionEnabled = config.spamDetectionEnabled;
        this.spamDetectionWindow = config.spamDetectionWindow;
        this.maxIndividualNotifications = config.maxIndividualNotifications;

        this.platformConfigs = {
            tiktok: {
                enabled: this.spamDetectionEnabled,
                lowValueThreshold: this.lowValueThreshold,
                spamDetectionWindow: this.spamDetectionWindow,
                maxIndividualNotifications: this.maxIndividualNotifications
            },
            twitch: {
                enabled: this.spamDetectionEnabled,
                lowValueThreshold: this.lowValueThreshold,
                spamDetectionWindow: this.spamDetectionWindow,
                maxIndividualNotifications: this.maxIndividualNotifications
            },
            youtube: {
                enabled: false,
                lowValueThreshold: 1.00,
                spamDetectionWindow: this.spamDetectionWindow,
                maxIndividualNotifications: this.maxIndividualNotifications
            }
        };

        this.logConfiguration();
    }

    getPlatformConfig(platform) {
        const platformKey = platform.toLowerCase();
        const config = this.platformConfigs[platformKey];
        
        if (!config) {
            this.logger.debug(`No platform config found for ${platform}, using defaults`, 'spam-detection');
            return {
                enabled: this.spamDetectionEnabled,
                lowValueThreshold: this.lowValueThreshold,
                spamDetectionWindow: this.spamDetectionWindow,
                maxIndividualNotifications: this.maxIndividualNotifications
            };
        }
        
        return config;
    }

    logConfiguration() {
        const configSummary = {
            enabled: this.spamDetectionEnabled,
            threshold: this.lowValueThreshold,
            window: this.spamDetectionWindow,
            maxNotifications: this.maxIndividualNotifications,
            platforms: {
                tiktok: this.platformConfigs.tiktok,
                twitch: this.platformConfigs.twitch,
                youtube: this.platformConfigs.youtube
            }
        };
        
        this.logger.info(`Spam detection initialized: ${JSON.stringify(configSummary)}`, 'spam-detection');
    }
}

class DonationSpamDetection {
    constructor(config, dependencies = {}) {
        // Use global logger directly
        const { logger } = require('../core/logging');
        this.logger = logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'spam-detection');
        this.onAggregatedDonation = dependencies.onAggregatedDonation || null;
        
        this.config = config;
        this.cleanupInterval = null; // To hold the interval ID
        this.donationSpamTracker = {};
        
        // Only setup periodic cleanup if autoCleanup is not explicitly false
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
            
            // If spam detection is disabled or not a low value donation, always show
            if (!platformConfig.enabled || !this.isLowValueDonation(unitAmount, platform)) {
                this.logger.debug(`Allowing donation: ${!platformConfig.enabled ? 'system disabled' : 'high value'}`, 'spam-detection');
                return { shouldShow: true, aggregatedMessage: null };
            }

            const now = Date.now();
            const windowMs = platformConfig.spamDetectionWindow * 1000;
            
            // Initialize or clean up old entries for this user
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
            
            // Clean up old notifications outside the detection window
            const originalCount = userTracker.notifications.length;
            userTracker.notifications = userTracker.notifications.filter(
                notification => (now - notification.timestamp) <= windowMs
            );
            
            if (originalCount !== userTracker.notifications.length) {
                this.logger.debug(`Cleaned ${originalCount - userTracker.notifications.length} old notifications for ${userId}`, 'spam-detection');
            }

            // Add current donation to tracker
            userTracker.notifications.push({
                timestamp: now,
                coinValue: unitAmount,
                giftType,
                giftCount: giftCount,
                platform: platform
            });

            const currentNotificationCount = userTracker.notifications.length;
            this.logger.debug(`${username}: ${currentNotificationCount}/${platformConfig.maxIndividualNotifications} notifications in window`, 'spam-detection');

            // Check if we've exceeded the individual notification limit
            if (currentNotificationCount <= platformConfig.maxIndividualNotifications) {
                // Still within individual notification limit - show normally
                this.logger.info(`${platform} - ${username}: Individual notification ${currentNotificationCount}/${platformConfig.maxIndividualNotifications} - showing normally`, 'spam-detection');
                return { shouldShow: true, aggregatedMessage: null };
            } else {
                // Exceeded limit - start aggregating
                userTracker.aggregatedCount += giftCount;
                userTracker.username = username; // Update username in case it changed
                userTracker.platform = platform;
                
                this.logger.debug(`Spam threshold exceeded - aggregating notifications for ${userId}`, 'spam-detection');
                
                // If this is the first time we're aggregating for this user, start the timer
                if (!userTracker.aggregationTimer) {
                    this.logger.info(`${platform} - ${username}: Starting aggregation timer (${platformConfig.spamDetectionWindow}s)`, 'spam-detection');
                    
                    userTracker.aggregationTimer = safeSetTimeout(() => {
                        this.processAggregatedDonation(userId, userTracker);
                    }, platformConfig.spamDetectionWindow * 1000);
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
            
            // On error, default to showing the notification
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

            // Call the callback if provided
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

            // Clear the timer and reset tracking for this user
            if (userTracker.aggregationTimer) {
                clearTimeout(userTracker.aggregationTimer);
                userTracker.aggregationTimer = null;
            }
            
            // Reset the user's tracking data
            userTracker.notifications = [];
            userTracker.aggregatedCount = 0;
            userTracker.lastReset = Date.now();
            
            this.logger.debug(`Aggregated donation processed and tracking reset for user ${userId}`, 'spam-detection');

            // Return result object expected by tests
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
            const windowMs = forceCleanup ? 0 : this.config.spamDetectionWindow * 1000 * 2; // Keep data for 2x the window, or 0 for force cleanup
            let cleanedUsers = 0;
            let totalUsers = Object.keys(this.donationSpamTracker).length;
            
            this.logger.debug(`Starting cleanup of ${totalUsers} tracked users${forceCleanup ? ' (forced)' : ''}`, 'spam-detection');
            
            for (const userId in this.donationSpamTracker) {
                const userTracker = this.donationSpamTracker[userId];
                
                // Remove notifications older than the extended window
                const originalNotifications = userTracker.notifications.length;
                userTracker.notifications = userTracker.notifications.filter(
                    notification => (now - notification.timestamp) <= windowMs
                );
                
                // If no recent notifications or force cleanup, remove the user entry entirely
                if (userTracker.notifications.length === 0 && 
                    (forceCleanup || (now - userTracker.lastReset) > windowMs)) {
                    // Clear any pending timers before deleting
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
            enabled: this.config.spamDetectionEnabled,
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
        
        // Clear all aggregation timers and tracking data to prevent memory leaks
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

function createSpamDetectionConfig(config, dependencies) {
    return new SpamDetectionConfig(config, dependencies);
}

function createDonationSpamDetection(config, dependencies) {
    return new DonationSpamDetection(config, dependencies);
}

// Export both classes and functions for flexibility
module.exports = {
    // Class exports
    SpamDetectionConfig,
    DonationSpamDetection,
    createSpamDetectionConfig,
    createDonationSpamDetection
}; 
