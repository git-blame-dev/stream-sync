
const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { initializeTestLogging } = require('../../helpers/test-setup');
const { noOpLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const {
    SpamDetectionConfig,
    createSpamDetectionConfig,
    createDonationSpamDetection
} = require('../../../src/utils/spam-detection');
const testClock = require('../../helpers/test-clock');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Spam Detection', () => {
    let mockLogger;
    let mockConstants;
    let config;

    beforeEach(() => {
        mockLogger = noOpLogger;
        spyOn(Date, 'now').mockImplementation(() => testClock.now());
        mockConstants = {
            SPAM_DETECTION: {
                DEFAULT_THRESHOLD: 10,
                DEFAULT_WINDOW: 5,
                DEFAULT_MAX_NOTIFICATIONS: 2
            }
        };

        const configObj = {
            lowValueThreshold: 10,
            spamDetectionEnabled: true,
            spamDetectionWindow: 5,
            maxIndividualNotifications: 2
        };

        config = new SpamDetectionConfig(configObj);
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('when initializing spam detection configuration', () => {
        it('should store normalized config values', () => {
            const normalizedConfig = {
                lowValueThreshold: 10,
                spamDetectionEnabled: true,
                spamDetectionWindow: 5,
                maxIndividualNotifications: 2
            };
            const spamConfig = createSpamDetectionConfig(normalizedConfig);

            expect(spamConfig.lowValueThreshold).toBe(10);
            expect(spamConfig.spamDetectionEnabled).toBe(true);
            expect(spamConfig.spamDetectionWindow).toBe(5);
            expect(spamConfig.maxIndividualNotifications).toBe(2);
        });

        it('should create configuration with custom values', () => {
            const customConfig = {
                lowValueThreshold: 20,
                spamDetectionEnabled: false,
                spamDetectionWindow: 10,
                maxIndividualNotifications: 5
            };
            const spamConfig = createSpamDetectionConfig(customConfig);

            expect(spamConfig.lowValueThreshold).toBe(20);
            expect(spamConfig.spamDetectionEnabled).toBe(false);
            expect(spamConfig.spamDetectionWindow).toBe(10);
            expect(spamConfig.maxIndividualNotifications).toBe(5);
        });

        it('should initialize platform-specific configurations', () => {
            expect(config.platformConfigs.tiktok.enabled).toBe(true);
            expect(config.platformConfigs.tiktok.lowValueThreshold).toBe(10);
            expect(config.platformConfigs.twitch.enabled).toBe(true);
            expect(config.platformConfigs.twitch.lowValueThreshold).toBe(10);
            expect(config.platformConfigs.youtube.enabled).toBe(false);
            expect(config.platformConfigs.youtube.lowValueThreshold).toBe(1.00);
        });
    });

    describe('when detecting low-value donations', () => {
        it('should detect low-value donations correctly', () => {
            const detection = createDonationSpamDetection(config, {
                logger: mockLogger,
                constants: mockConstants
            });

            expect(detection.isLowValueDonation(5, 'tiktok')).toBe(true);
            expect(detection.isLowValueDonation(15, 'tiktok')).toBe(false);
            expect(detection.isLowValueDonation(8, 'twitch')).toBe(true);
            expect(detection.isLowValueDonation(12, 'twitch')).toBe(false);
        });

        it('should handle different platforms with different thresholds', () => {
            const detection = createDonationSpamDetection(config, {
                logger: mockLogger,
                constants: mockConstants
            });

            expect(detection.isLowValueDonation(5, 'tiktok')).toBe(true);
            expect(detection.isLowValueDonation(15, 'tiktok')).toBe(false);

            expect(detection.isLowValueDonation(8, 'twitch')).toBe(true);
            expect(detection.isLowValueDonation(12, 'twitch')).toBe(false);

            expect(detection.isLowValueDonation(0.50, 'youtube')).toBe(false);
            expect(detection.isLowValueDonation(2.00, 'youtube')).toBe(false);
        });

        it('should handle unknown platforms with default threshold', () => {
            const detection = createDonationSpamDetection(config, {
                logger: mockLogger,
                constants: mockConstants
            });

            expect(detection.isLowValueDonation(8, 'unknown')).toBe(true);
            expect(detection.isLowValueDonation(12, 'unknown')).toBe(false);
        });

        it('should handle zero and negative values', () => {
            const detection = createDonationSpamDetection(config, {
                logger: mockLogger,
                constants: mockConstants
            });

            expect(detection.isLowValueDonation(0, 'tiktok')).toBe(true);
            expect(detection.isLowValueDonation(-5, 'tiktok')).toBe(true);
        });
    });

    describe('when handling donation spam', () => {
        let detection;

        beforeEach(() => {
            detection = createDonationSpamDetection(config, {
                logger: mockLogger,
                constants: mockConstants,
                autoCleanup: false
            });
        });

        afterEach(() => {
            if (detection) {
                detection.destroy();
            }
        });

        it('should allow first donation within threshold', () => {
            const result = detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');

            expect(result.shouldShow).toBe(true);
            expect(result.aggregatedMessage).toBeNull();
        });

        it('should aggregate multiple low-value donations from same user', () => {
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');

            const result = detection.handleDonationSpam('user1', 'User1', 3, 'Rose', 1, 'tiktok');

            expect(result.shouldShow).toBe(false);
            expect(result.aggregatedMessage).toBeNull();
        });

        it('should reset tracking after time window expires', () => {
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');

            testClock.advance(11000);

            const result = detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');

            expect(result.shouldShow).toBe(true);
            expect(result.aggregatedMessage).toBeNull();
        });

        it('should keep recent entries', () => {
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            detection.handleDonationSpam('user2', 'User2', 8, 'bits', 1, 'twitch');

            detection.cleanupSpamDetection();

            const stats = detection.getStatistics();
            expect(stats.trackedUsers).toBe(2);
        });

        it('should handle cleanup with no entries', () => {
            detection.cleanupSpamDetection();

            const stats = detection.getStatistics();
            expect(stats.trackedUsers).toBe(0);
        });
    });

    describe('when getting statistics', () => {
        let detection;

        beforeEach(() => {
            const spamConfig = createSpamDetectionConfig(config, {
                logger: mockLogger,
                constants: mockConstants
            });
            detection = createDonationSpamDetection(spamConfig, {
                logger: mockLogger,
                constants: mockConstants
            });
        });

        it('should return accurate statistics', () => {
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            detection.handleDonationSpam('user2', 'User2', 8, 'bits', 1, 'twitch');
            detection.handleDonationSpam('user1', 'User1', 3, 'Rose', 1, 'tiktok');

            const stats = detection.getStatistics();

            expect(stats.trackedUsers).toBe(2);
            expect(stats.totalNotifications).toBeGreaterThan(0);
            expect(stats.enabled).toBeDefined();
            expect(stats.threshold).toBeDefined();
        });

        it('should return zero statistics for empty tracker', () => {
            const stats = detection.getStatistics();

            expect(stats.trackedUsers).toBe(0);
            expect(stats.totalNotifications).toBe(0);
        });
    });

    describe('when resetting tracking', () => {
        let detection;

        beforeEach(() => {
            detection = createDonationSpamDetection(config, {
                logger: mockLogger,
                constants: mockConstants,
                autoCleanup: false
            });
        });

        afterEach(() => {
            if (detection) {
                detection.destroy();
            }
        });

        it('should reset all tracking data', () => {
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            detection.handleDonationSpam('user2', 'User2', 8, 'bits', 1, 'twitch');

            detection.resetTracking();

            const stats = detection.getStatistics();
            expect(stats.trackedUsers).toBe(0);
            expect(stats.totalNotifications).toBe(0);
        });

        it('should allow new donations after reset', () => {
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            detection.resetTracking();

            const result = detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');

            expect(result.shouldShow).toBe(true);
            expect(result.aggregatedMessage).toBeNull();
        });
    });

    describe('when handling edge cases', () => {
        let detection;

        beforeEach(() => {
            detection = createDonationSpamDetection(config, {
                logger: mockLogger,
                constants: mockConstants,
                autoCleanup: false
            });
        });

        afterEach(() => {
            if (detection) {
                detection.destroy();
            }
        });

        it('should handle very large gift counts', () => {
            const result = detection.handleDonationSpam('user1', 'User1', 1, 'Rose', 1000, 'tiktok');

            expect(result.shouldShow).toBe(true);
            expect(result.aggregatedMessage).toBeNull();
        });

        it('should handle very high coin values', () => {
            const result = detection.handleDonationSpam('user1', 'User1', 999999, 'Diamond', 1, 'tiktok');

            expect(result.shouldShow).toBe(true);
            expect(result.aggregatedMessage).toBeNull();
        });

        it('should handle missing user data', () => {
            const result = detection.handleDonationSpam(null, null, 5, 'Rose', 1, 'tiktok');

            expect(result.shouldShow).toBe(true);
            expect(result.aggregatedMessage).toBeNull();
        });

        it('should handle disabled platforms', () => {
            const result = detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'youtube');

            expect(result.shouldShow).toBe(true);
            expect(result.aggregatedMessage).toBeNull();
        });
    });

    describe('when managing cleanup scheduling', () => {
        let detection;

        beforeEach(() => {
            detection = createDonationSpamDetection(config, {
                logger: mockLogger,
                constants: mockConstants,
                autoCleanup: false
            });
        });

        afterEach(() => {
            if (detection) {
                detection.destroy();
            }
        });

        it('should cleanup periodically', () => {
            detection.setupPeriodicCleanup();

            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');

            expect(detection.cleanupInterval).toBeDefined();
        });
    });

    describe('when destroying spam detection', () => {
        let detection;

        beforeEach(() => {
            detection = createDonationSpamDetection(config, {
                logger: mockLogger,
                constants: mockConstants,
                autoCleanup: false
            });
        });

        afterEach(() => {
            if (detection) {
                detection.destroy();
            }
        });

        it('should cleanup resources on destroy', () => {
            detection.setupPeriodicCleanup();
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');

            detection.destroy();

            expect(detection.cleanupInterval).toBeNull();
            const stats = detection.getStatistics();
            expect(stats.trackedUsers).toBe(0);
        });

        it('should handle multiple destroy calls', () => {
            detection.destroy();
            detection.destroy();

            expect(detection.cleanupInterval).toBeNull();
        });
    });
}); 
