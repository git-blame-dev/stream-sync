import { safeSetInterval, safeSetTimeout } from './timeout-validator';
import { createPlatformErrorHandler } from './platform-error-handler';
import { copyNotificationContributions, type NotificationContribution } from '../notifications/notification-contribution';

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
    tiktokLowValueThreshold?: number | null;
    twitchEnabled?: boolean;
    twitchLowValueThreshold?: number | null;
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
        currency: string;
        contributions: readonly NotificationContribution[];
    }) => void) | null;
    autoCleanup?: boolean;
};

type DonationNotification = {
    timestamp: number;
    coinValue: number;
    giftType: string;
    giftCount: number;
    platform: string;
    amount?: number;
    currency?: string;
    contribution?: NotificationContribution;
};

type UserSpamTracker = {
    userId: string;
    notifications: DonationNotification[];
    pending?: DonationNotification[];
    aggregatedCount: number;
    lastReset: number;
    aggregationTimer: ReturnType<typeof setTimeout> | null;
    username: string;
    platform: string;
};

type StableDonationTrackerIdentity = {
    trackerKey: string;
    userId: string;
    username: string;
    platform: string;
};

type PlatformConfig = {
    enabled: boolean;
    lowValueThreshold: number;
    detectionWindow: number;
    maxIndividualNotifications: number;
};

function trimNonEmptyString(value: unknown): string | null {
    if (typeof value !== 'string') {
        return null;
    }

    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
}

function resolveStableDonationTrackerIdentity(input: {
    userId: unknown;
    username: unknown;
    platform: unknown;
}): StableDonationTrackerIdentity | null {
    const userId = trimNonEmptyString(input.userId);
    const username = trimNonEmptyString(input.username);
    const platform = trimNonEmptyString(input.platform);

    if (!userId || !username || !platform) {
        return null;
    }

    const platformKey = platform.toLowerCase();
    return {
        trackerKey: `${platformKey}:userId:${userId}`,
        userId,
        username,
        platform
    };
}

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
    private destroyed = false;

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

        try {
            const autoCleanup = dependencies.autoCleanup !== false;
            if (autoCleanup) {
                this.setupPeriodicCleanup();
                this.logger.debug('Periodic cleanup scheduled every 30 seconds', 'spam-detection');
            }
            this.logger.info('System initialized', 'spam-detection');
        } catch (error) {
            this.destroy();
            throw error;
        }
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
        userId: string | null | undefined,
        username: string | null | undefined,
        unitAmount: number,
        giftType: string,
        giftCount: number,
        platform?: string | null,
        source?: { amount: number; currency: string; contribution: NotificationContribution }
    ) {
        if (this.destroyed) {
            return { shouldShow: false, aggregatedMessage: null };
        }
        const stableIdentity = resolveStableDonationTrackerIdentity({ userId, username, platform });
        const logUsername = trimNonEmptyString(username) ?? '<missing username>';
        const logPlatform = trimNonEmptyString(platform) ?? 'unknown';

        try {
            this.logger.debug(`Processing ${logPlatform} donation: ${logUsername} -> ${giftType} x${giftCount} (${unitAmount})`, 'spam-detection');

            if (!stableIdentity) {
                this.logger.debug('Donation spam detection skipped: stable donor identity is unavailable', 'spam-detection');
                return { shouldShow: true, aggregatedMessage: null };
            }

            const { trackerKey, userId: normalizedUserId, username: normalizedUsername, platform: normalizedPlatform } = stableIdentity;

            const platformConfig = this.config.getPlatformConfig(normalizedPlatform);

            if (!platformConfig.enabled || !this.isLowValueDonation(unitAmount, normalizedPlatform)) {
                this.logger.debug(`Allowing donation: ${!platformConfig.enabled ? 'system disabled' : 'high value'}`, 'spam-detection');
                return { shouldShow: true, aggregatedMessage: null };
            }

            const now = Date.now();
            const windowMs = platformConfig.detectionWindow * 1000;

            if (!this.donationSpamTracker[trackerKey]) {
                this.donationSpamTracker[trackerKey] = {
                    userId: normalizedUserId,
                    notifications: [],
                    pending: [],
                    aggregatedCount: 0,
                    lastReset: now,
                    aggregationTimer: null,
                    username: normalizedUsername,
                    platform: normalizedPlatform
                };
                this.logger.debug(`Initialized tracking for user: ${trackerKey}`, 'spam-detection');
            }

            const userTracker = this.donationSpamTracker[trackerKey];
            const originalCount = userTracker.notifications.length;
            userTracker.notifications = userTracker.notifications.filter(
                (notification) => (now - notification.timestamp) <= windowMs
            );

            if (originalCount !== userTracker.notifications.length) {
                this.logger.debug(`Cleaned ${originalCount - userTracker.notifications.length} old notifications for ${trackerKey}`, 'spam-detection');
            }

            const notification: DonationNotification = {
                timestamp: now,
                coinValue: unitAmount,
                giftType,
                giftCount,
                platform: normalizedPlatform
            };
            userTracker.notifications.push(notification);

            const currentNotificationCount = userTracker.notifications.length;
            this.logger.debug(`${normalizedUsername}: ${currentNotificationCount}/${platformConfig.maxIndividualNotifications} notifications in window`, 'spam-detection');

            if (currentNotificationCount <= platformConfig.maxIndividualNotifications) {
                this.logger.info(
                    `${platform} - ${normalizedUsername}: Individual notification ${currentNotificationCount}/${platformConfig.maxIndividualNotifications} - showing normally`,
                    'spam-detection'
                );
                return { shouldShow: true, aggregatedMessage: null };
            }

            userTracker.aggregatedCount += giftCount;
            userTracker.username = normalizedUsername;
            userTracker.platform = normalizedPlatform;

            this.logger.debug(`Spam threshold exceeded - aggregating notifications for ${trackerKey}`, 'spam-detection');

            if (!userTracker.aggregationTimer) {
                this.logger.info(`${normalizedPlatform} - ${normalizedUsername}: Starting aggregation timer (${platformConfig.detectionWindow}s)`, 'spam-detection');
                userTracker.aggregationTimer = safeSetTimeout(() => {
                    this.processAggregatedDonation(trackerKey, userTracker);
                }, platformConfig.detectionWindow * 1000);
            }

            this.logger.info(`${normalizedPlatform} - ${normalizedUsername}: Suppressing individual notification ${currentNotificationCount} (aggregating)`, 'spam-detection');
            (userTracker.pending ??= []).push({
                ...notification,
                amount: source?.amount ?? unitAmount * giftCount,
                currency: source?.currency ?? 'coins',
                ...(source ? { contribution: copyNotificationContributions([source.contribution])[0]! } : {})
            });
            return { shouldShow: false, aggregatedMessage: null };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.handleSpamDetectionError(`Error processing donation spam for ${logUsername}: ${errorMessage}`, error, {
                userId: stableIdentity?.trackerKey ?? userId ?? null,
                platform: logPlatform,
                giftType
            });
            this.logger.debug(`Error processing donation spam for ${logUsername}: ${errorMessage}`, 'spam-detection');
            return { shouldShow: true, aggregatedMessage: null };
        }
    }

    processAggregatedDonation(trackerKey: string, userTracker: UserSpamTracker) {
        if (userTracker.aggregationTimer) {
            clearTimeout(userTracker.aggregationTimer);
            userTracker.aggregationTimer = null;
        }
        try {
            if (!userTracker.pending?.length) {
                this.logger.debug(`No notifications to aggregate for user ${trackerKey}`, 'spam-detection');
                return {
                    shouldShow: false,
                    aggregatedMessage: null,
                    totalCoinValue: 0,
                    totalGiftCount: 0
                };
            }

            const pending = userTracker.pending;
            const groups = new Map<string, DonationNotification[]>();
            for (const notification of pending) {
                const currency = notification.currency ?? 'coins';
                const group = groups.get(currency) ?? [];
                group.push(notification);
                groups.set(currency, group);
            }
            let totalCoins = 0;
            let totalGifts = 0;
            let aggregatedMessage = '';
            for (const [currency, notifications] of groups) {
                const groupAmount = notifications.reduce((sum, notification) => sum + (notification.amount ?? notification.coinValue * notification.giftCount), 0);
                const groupCount = notifications.reduce((sum, notification) => sum + notification.giftCount, 0);
                const uniqueGiftTypes = [...new Set(notifications.map((notification) => notification.giftType))];

                aggregatedMessage = `${userTracker.username} sent ${groupCount} ${groupCount === 1 ? 'gift' : 'gifts'} worth ${groupAmount} ${currency} (${uniqueGiftTypes.join(', ')})`;

                this.logger.info(`${userTracker.platform} - Processing aggregated donation: ${aggregatedMessage}`, 'spam-detection');

                if (this.onAggregatedDonation) {
                    this.onAggregatedDonation({
                        userId: userTracker.userId,
                        username: userTracker.username,
                        platform: userTracker.platform,
                        totalCoins: groupAmount,
                        totalGifts: groupCount,
                        currency,
                        contributions: copyNotificationContributions(notifications.flatMap(notification => notification.contribution ? [notification.contribution] : [])),
                        giftTypes: uniqueGiftTypes,
                        message: aggregatedMessage,
                        notifications
                    });
                }
                if (groups.size === 1) totalCoins = groupAmount;
                totalGifts += groupCount;
                userTracker.pending = userTracker.pending?.filter(notification => (notification.currency ?? 'coins') !== currency) ?? [];
            }

            userTracker.pending = [];
            userTracker.aggregatedCount = 0;
            userTracker.lastReset = Date.now();

            this.logger.debug(`Aggregated donation processed and tracking reset for user ${trackerKey}`, 'spam-detection');

            return {
                shouldShow: true,
                aggregatedMessage,
                totalCoinValue: groups.size === 1 ? totalCoins : null,
                totalGiftCount: totalGifts
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.handleSpamDetectionError(`Error processing aggregated donation for user ${trackerKey}: ${errorMessage}`, error, { userId: trackerKey });
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
                if (!userTracker) {
                    continue;
                }
                const originalNotifications = userTracker.notifications.length;
                userTracker.notifications = userTracker.notifications.filter(
                    (notification) => (now - notification.timestamp) <= windowMs
                );

                if (!userTracker.pending?.length && userTracker.notifications.length === 0 && (forceCleanup || (now - userTracker.lastReset) > windowMs)) {
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
        if (this.destroyed) return;
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
            const userTracker = this.donationSpamTracker[userId];
            if (userTracker?.aggregationTimer) {
                clearTimeout(userTracker.aggregationTimer);
                userTracker.aggregationTimer = null;
            }
            delete this.donationSpamTracker[userId];
        }
        this.logger.debug('All tracking data reset', 'spam-detection');
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
        const hadCleanupInterval = !!this.cleanupInterval;
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        for (const userId in this.donationSpamTracker) {
            const userTracker = this.donationSpamTracker[userId];
            if (!userTracker) {
                continue;
            }
            if (userTracker.aggregationTimer) {
                clearTimeout(userTracker.aggregationTimer);
                userTracker.aggregationTimer = null;
            }
            delete this.donationSpamTracker[userId];
        }

        try {
            if (hadCleanupInterval) {
                this.logger.debug('Periodic cleanup interval cleared', 'spam-detection');
            }
            this.logger.debug('All aggregation timers cleared and tracking data reset', 'spam-detection');
        } catch {
            // Diagnostics must not interrupt detector retirement.
        }
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
