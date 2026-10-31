import { safeSetInterval, safeSetTimeout } from './timeout-validator';
import { createPlatformErrorHandler } from './platform-error-handler';
import { copyNotificationContributions, type NotificationContribution } from '../notifications/notification-contribution';
import { DEFAULT_AVATAR_URL } from '../constants/avatar';

type SpamLogger = {
    debug: (message: string, source?: string) => void;
    info: (message: string, source?: string) => void;
    warn?: (message: string, source?: string) => void;
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
        avatarUrl?: string;
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
    avatarUrl?: string;
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

        this.logger.debug(`Spam detection initialized: ${JSON.stringify(configSummary)}`, 'spam-detection');
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
            }
        } catch (error) {
            this.destroy();
            throw error;
        }
    }

    isLowValueDonation(unitAmount: number | null | undefined, platform = 'unknown'): boolean {
        const platformConfig = this.config.getPlatformConfig(platform);

        if (!platformConfig.enabled) {
            return false;
        }

        if (unitAmount === null || unitAmount === undefined) {
            this.logger.warn?.(`Invalid gift amount: ${String(unitAmount)}`, 'spam-detection');
            return false;
        }

        const isLowValue = unitAmount <= platformConfig.lowValueThreshold;

        return isLowValue;
    }

    handleDonationSpam(
        userId: string | null | undefined,
        username: string | null | undefined,
        unitAmount: number,
        giftType: string,
        giftCount: number,
        platform?: string | null,
        source?: { amount: number; currency: string; contribution: NotificationContribution; avatarUrl?: string }
    ) {
        if (this.destroyed) {
            return { shouldShow: false, aggregatedMessage: null };
        }
        const stableIdentity = resolveStableDonationTrackerIdentity({ userId, username, platform });
        const logPlatform = trimNonEmptyString(platform) ?? 'unknown';

        try {
            if (!stableIdentity) {
                this.logger.warn?.('Donation spam detection skipped: stable donor identity is unavailable', 'spam-detection');
                return { shouldShow: true, aggregatedMessage: null };
            }

            const { trackerKey, userId: normalizedUserId, username: normalizedUsername, platform: normalizedPlatform } = stableIdentity;

            const platformConfig = this.config.getPlatformConfig(normalizedPlatform);

            if (!platformConfig.enabled || !this.isLowValueDonation(unitAmount, normalizedPlatform)) {
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
            }

            const userTracker = this.donationSpamTracker[trackerKey];
            const normalizedAvatarUrl = trimNonEmptyString(source?.avatarUrl);
            if (normalizedAvatarUrl && normalizedAvatarUrl !== DEFAULT_AVATAR_URL) {
                userTracker.avatarUrl = normalizedAvatarUrl;
            } else if (normalizedAvatarUrl && !userTracker.avatarUrl) {
                userTracker.avatarUrl = normalizedAvatarUrl;
            }

            userTracker.notifications = userTracker.notifications.filter(
                (notification) => (now - notification.timestamp) <= windowMs
            );

            const notification: DonationNotification = {
                timestamp: now,
                coinValue: unitAmount,
                giftType,
                giftCount,
                platform: normalizedPlatform
            };
            userTracker.notifications.push(notification);

            const currentNotificationCount = userTracker.notifications.length;

            if (currentNotificationCount <= platformConfig.maxIndividualNotifications) {
                return { shouldShow: true, aggregatedMessage: null };
            }

            userTracker.aggregatedCount += giftCount;
            userTracker.username = normalizedUsername;
            userTracker.platform = normalizedPlatform;

            if (!userTracker.aggregationTimer) {
                this.logger.debug(`Donation aggregation started: platform=${normalizedPlatform.toLowerCase()}, window=${platformConfig.detectionWindow}s`, 'spam-detection');
                userTracker.aggregationTimer = safeSetTimeout(() => {
                    this.processAggregatedDonation(trackerKey, userTracker);
                }, platformConfig.detectionWindow * 1000);
            }
            (userTracker.pending ??= []).push({
                ...notification,
                amount: source?.amount ?? unitAmount * giftCount,
                currency: source?.currency ?? 'coins',
                ...(source ? { contribution: copyNotificationContributions([source.contribution])[0]! } : {})
            });
            return { shouldShow: false, aggregatedMessage: null };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.handleSpamDetectionError(`Error processing donation spam: ${errorMessage}`, error, {
                userId: stableIdentity?.trackerKey ?? userId ?? null,
                platform: logPlatform,
                giftType
            });

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

                if (this.onAggregatedDonation) {
                    this.onAggregatedDonation({
                        userId: userTracker.userId,
                        username: userTracker.username,
                        platform: userTracker.platform,
                        totalCoins: groupAmount,
                        totalGifts: groupCount,
                        currency,
                        ...(userTracker.avatarUrl ? { avatarUrl: userTracker.avatarUrl } : {}),
                        contributions: copyNotificationContributions(notifications.flatMap(notification => notification.contribution ? [notification.contribution] : [])),
                        giftTypes: uniqueGiftTypes,
                        message: aggregatedMessage,
                        notifications
                    });
                }
                if (groups.size === 1) totalCoins = groupAmount;
                totalGifts += groupCount;
                userTracker.pending = userTracker.pending?.filter(notification => (notification.currency ?? 'coins') !== currency) ?? [];
                this.logger.debug(`Donation aggregation completed: platform=${userTracker.platform.toLowerCase()}, count=${groupCount}, currency=${currency}`, 'spam-detection');
            }

            userTracker.pending = [];
            userTracker.aggregatedCount = 0;
            userTracker.lastReset = Date.now();

            return {
                shouldShow: true,
                aggregatedMessage,
                totalCoinValue: groups.size === 1 ? totalCoins : null,
                totalGiftCount: totalGifts
            };
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.handleSpamDetectionError(`Error processing aggregated donation: ${errorMessage}`, error, { userId: trackerKey });
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

            for (const userId in this.donationSpamTracker) {
                const userTracker = this.donationSpamTracker[userId];
                if (!userTracker) {
                    continue;
                }
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
                }
            }

            if (cleanedUsers > 0) {
                this.logger.debug(`Expired spam tracking entries removed: ${cleanedUsers}; remaining: ${Object.keys(this.donationSpamTracker).length}`, 'spam-detection');
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.handleSpamDetectionError(`Error during spam detection cleanup: ${errorMessage}`, error);
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
    }

    destroy(): void {
        if (this.destroyed) return;
        this.destroyed = true;
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
