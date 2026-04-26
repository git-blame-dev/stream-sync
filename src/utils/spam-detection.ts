import { safeSetInterval, safeSetTimeout } from './timeout-validator';
import { createPlatformErrorHandler } from './platform-error-handler';

type SpamLogger = {
    debug: (message: string, source?: string) => void;
    info: (message: string, source?: string) => void;
};

type SpamConfigShape = {
    enabled?: boolean;
    lowValueThreshold?: number;
    detectionWindow?: number;
    maxIndividualNotifications?: number;
    tiktokEnabled?: boolean;
    tiktokLowValueThreshold?: number;
    twitchEnabled?: boolean;
    twitchLowValueThreshold?: number;
    youtubeEnabled?: boolean;
    youtubeLowValueThreshold?: number;
};

type SpamDetectionDependencies = {
    logger?: SpamLogger;
};

type DonationSpamDetectionDependencies = {
    logger?: SpamLogger;
    onAggregatedDonation?: ((aggregatedData: {
        userId: string;
        username: string;
        platform: string;
        totalCoins: number;
        totalGifts: number;
        giftTypes: string[];
        message: string;
        notifications: DonationNotification[];
    }) => void) | null;
    autoCleanup?: boolean;
};

type DonationNotification = {
    timestamp: number;
    coinValue: number;
    giftType: string;
    giftCount: number;
    platform: string;
};

type UserSpamTracker = {
    notifications: DonationNotification[];
    aggregatedCount: number;
    lastReset: number;
    aggregationTimer: ReturnType<typeof setTimeout> | null;
    username: string;
    platform: string;
};

type PlatformConfig = {
    enabled: boolean;
    lowValueThreshold: number;
    detectionWindow: number;
    maxIndividualNotifications: number;
};

class SpamDetectionConfig {
    logger: SpamLogger;
    enabled: boolean;
    lowValueThreshold: number;
    detectionWindow: number;
    maxIndividualNotifications: number;
    tiktokEnabled: boolean;
    tiktokLowValueThreshold: number;
    twitchEnabled: boolean;
    twitchLowValueThreshold: number;
    youtubeEnabled: boolean;
    youtubeLowValueThreshold: number;

    constructor(config: SpamConfigShape = {}, dependencies: SpamDetectionDependencies = {}) {
        if (!dependencies.logger) {
            throw new Error('SpamDetectionConfig requires logger dependency');
        }
        this.logger = dependencies.logger;

        this.enabled = config.enabled ?? false;
        this.lowValueThreshold = config.lowValueThreshold ?? 0;
        this.detectionWindow = config.detectionWindow ?? 0;
        this.maxIndividualNotifications = config.maxIndividualNotifications ?? 0;
        this.tiktokEnabled = config.tiktokEnabled ?? this.enabled;
        this.tiktokLowValueThreshold = config.tiktokLowValueThreshold ?? this.lowValueThreshold;
        this.twitchEnabled = config.twitchEnabled ?? this.enabled;
        this.twitchLowValueThreshold = config.twitchLowValueThreshold ?? this.lowValueThreshold;
        this.youtubeEnabled = config.youtubeEnabled ?? this.enabled;
        this.youtubeLowValueThreshold = config.youtubeLowValueThreshold ?? this.lowValueThreshold;

        this.logConfiguration();
    }

    getPlatformConfig(platform = 'unknown'): PlatformConfig {
        const normalizedPlatform = platform.toLowerCase();
        const platformSettings: Record<string, { enabled: boolean; lowValueThreshold: number }> = {
            tiktok: {
                enabled: this.tiktokEnabled,
                lowValueThreshold: this.tiktokLowValueThreshold
            },
            twitch: {
                enabled: this.twitchEnabled,
                lowValueThreshold: this.twitchLowValueThreshold
            },
            youtube: {
                enabled: this.youtubeEnabled,
                lowValueThreshold: this.youtubeLowValueThreshold
            }
        };

        const selectedPlatformSettings = platformSettings[normalizedPlatform];
        const enabled = selectedPlatformSettings ? selectedPlatformSettings.enabled : this.enabled;
        const lowValueThreshold = selectedPlatformSettings ? selectedPlatformSettings.lowValueThreshold : this.lowValueThreshold;

        return {
            enabled,
            lowValueThreshold,
            detectionWindow: this.detectionWindow,
            maxIndividualNotifications: this.maxIndividualNotifications
        };
    }

    logConfiguration(): void {
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
    logger: SpamLogger;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    onAggregatedDonation: DonationSpamDetectionDependencies['onAggregatedDonation'];
    config: SpamDetectionConfig;
    cleanupInterval: ReturnType<typeof setInterval> | null;
    donationSpamTracker: Record<string, UserSpamTracker>;

    constructor(config: SpamDetectionConfig, dependencies: DonationSpamDetectionDependencies = {}) {
        if (!dependencies.logger) {
            throw new Error('DonationSpamDetection requires logger dependency');
        }

        this.logger = dependencies.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'spam-detection');
        this.onAggregatedDonation = dependencies.onAggregatedDonation ?? null;
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

    isLowValueDonation(unitAmount: number | null | undefined, platform = 'unknown'): boolean {
        const platformConfig = this.config.getPlatformConfig(platform);

        if (!platformConfig.enabled) {
            this.logger.debug(`${platform} spam detection disabled, skipping check for ${String(unitAmount)}`, 'spam-detection');
            return false;
        }

        if (unitAmount === null || unitAmount === undefined) {
            this.logger.debug(`Invalid gift amount: ${String(unitAmount)}`, 'spam-detection');
            return false;
        }

        const isLowValue = unitAmount <= platformConfig.lowValueThreshold;
        this.logger.debug(
            `${platform} amount ${unitAmount} ${isLowValue ? 'IS' : 'IS NOT'} low value (threshold: ${platformConfig.lowValueThreshold})`,
            'spam-detection'
        );

        return isLowValue;
    }

    handleDonationSpam(
        userId: string,
        username: string,
        unitAmount: number,
        giftType: string,
        giftCount: number,
        platform = 'Unknown'
    ) {
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
                    username,
                    platform
                };
                this.logger.debug(`Initialized tracking for user: ${userId}`, 'spam-detection');
            }

            const userTracker = this.donationSpamTracker[userId];
            const originalCount = userTracker.notifications.length;
            userTracker.notifications = userTracker.notifications.filter(
                (notification) => (now - notification.timestamp) <= windowMs
            );

            if (originalCount !== userTracker.notifications.length) {
                this.logger.debug(`Cleaned ${originalCount - userTracker.notifications.length} old notifications for ${userId}`, 'spam-detection');
            }

            userTracker.notifications.push({
                timestamp: now,
                coinValue: unitAmount,
                giftType,
                giftCount,
                platform
            });

            const currentNotificationCount = userTracker.notifications.length;
            this.logger.debug(`${username}: ${currentNotificationCount}/${platformConfig.maxIndividualNotifications} notifications in window`, 'spam-detection');

            if (currentNotificationCount <= platformConfig.maxIndividualNotifications) {
                this.logger.info(
                    `${platform} - ${username}: Individual notification ${currentNotificationCount}/${platformConfig.maxIndividualNotifications} - showing normally`,
                    'spam-detection'
                );
                return { shouldShow: true, aggregatedMessage: null };
            }

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
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.handleSpamDetectionError(`Error processing donation spam for ${username}: ${errorMessage}`, error, {
                userId,
                platform,
                giftType
            });
            this.logger.debug(`Error processing donation spam for ${username}: ${errorMessage}`, 'spam-detection');
            return { shouldShow: true, aggregatedMessage: null };
        }
    }

    processAggregatedDonation(userId: string, userTracker: UserSpamTracker) {
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

            const totalCoins = userTracker.notifications.reduce((sum, notification) => sum + (notification.coinValue * notification.giftCount), 0);
            const totalGifts = userTracker.notifications.reduce((sum, notification) => sum + notification.giftCount, 0);
            const uniqueGiftTypes = [...new Set(userTracker.notifications.map((notification) => notification.giftType))];

            const aggregatedMessage = totalGifts > 1
                ? `${userTracker.username} sent ${totalGifts} gifts worth ${totalCoins} coins (${uniqueGiftTypes.join(', ')})`
                : `${userTracker.username} sent ${totalGifts} gift worth ${totalCoins} coins (${uniqueGiftTypes[0]})`;

            this.logger.info(`${userTracker.platform} - Processing aggregated donation: ${aggregatedMessage}`, 'spam-detection');

            if (this.onAggregatedDonation) {
                this.onAggregatedDonation({
                    userId,
                    username: userTracker.username,
                    platform: userTracker.platform,
                    totalCoins,
                    totalGifts,
                    giftTypes: uniqueGiftTypes,
                    message: aggregatedMessage,
                    notifications: userTracker.notifications
                });
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
                aggregatedMessage,
                totalCoinValue: totalCoins,
                totalGiftCount: totalGifts
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.handleSpamDetectionError(`Error processing aggregated donation for user ${userId}: ${errorMessage}`, error, { userId });
            return {
                shouldShow: false,
                aggregatedMessage: null,
                totalCoinValue: 0,
                totalGiftCount: 0
            };
        }
    }

    cleanupSpamDetection(forceCleanup = false): void {
        try {
            const now = Date.now();
            const windowMs = forceCleanup ? 0 : this.config.detectionWindow * 1000 * 2;
            let cleanedUsers = 0;
            const totalUsers = Object.keys(this.donationSpamTracker).length;

            this.logger.debug(`Starting cleanup of ${totalUsers} tracked users${forceCleanup ? ' (forced)' : ''}`, 'spam-detection');

            for (const userId in this.donationSpamTracker) {
                const userTracker = this.donationSpamTracker[userId];
                const originalNotifications = userTracker.notifications.length;
                userTracker.notifications = userTracker.notifications.filter(
                    (notification) => (now - notification.timestamp) <= windowMs
                );

                if (userTracker.notifications.length === 0 && (forceCleanup || (now - userTracker.lastReset) > windowMs)) {
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
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.handleSpamDetectionError(`Error during spam detection cleanup: ${errorMessage}`, error);
            this.logger.debug(`Error during spam detection cleanup: ${errorMessage}`, 'spam-detection');
        }
    }

    setupPeriodicCleanup(): void {
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
            totalNotifications,
            enabled: this.config.enabled,
            threshold: this.config.lowValueThreshold
        };
    }

    resetTracking(): void {
        for (const userId in this.donationSpamTracker) {
            delete this.donationSpamTracker[userId];
        }
        this.logger.debug('All tracking data reset', 'spam-detection');
    }

    destroy(): void {
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

    private handleSpamDetectionError(message: string, error: unknown = null, payload: Record<string, unknown> | null = null): void {
        if (!this.errorHandler) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'spam-detection');
        }

        if (error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'spam-detection', payload, message, 'spam-detection');
            return;
        }

        this.errorHandler.logOperationalError(message, 'spam-detection', payload);
    }
}

function createSpamDetectionConfig(config: SpamConfigShape, dependencies: SpamDetectionDependencies = {}): SpamDetectionConfig {
    return new SpamDetectionConfig(config, dependencies);
}

function createDonationSpamDetection(config: SpamDetectionConfig, dependencies: DonationSpamDetectionDependencies = {}): DonationSpamDetection {
    return new DonationSpamDetection(config, dependencies);
}

export {
    SpamDetectionConfig,
    createSpamDetectionConfig,
    createDonationSpamDetection
};
