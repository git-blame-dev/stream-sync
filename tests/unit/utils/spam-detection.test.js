
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { spyOn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { initializeTestLogging } = require('../../helpers/test-setup');
const { createMockLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const {
    SpamDetectionConfig,
    createSpamDetectionConfig,
    createDonationSpamDetection
} = require('../../../src/utils/spam-detection');
const testClock = require('../../helpers/test-clock');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
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
        // Create mocks using factory functions
        mockLogger = createMockLogger('debug');
        spyOn(Date, 'now').mockImplementation(() => testClock.now());
        mockConstants = {
            SPAM_DETECTION: {
                DEFAULT_THRESHOLD: 10,
                DEFAULT_WINDOW: 5,
                DEFAULT_MAX_NOTIFICATIONS: 2
            }
        };

        // Create test configuration using SpamDetectionConfig class
        const configObj = {
            lowValueThreshold: 10,
            spamDetectionEnabled: true,
            spamDetectionWindow: 5,
            maxIndividualNotifications: 2,
            platforms: {
                tiktok: {
                    spamDetectionEnabled: true,
                    lowValueThreshold: 5,
                    spamDetectionWindow: 3,
                    maxIndividualNotifications: 1
                },
                twitch: {
                    spamDetectionEnabled: true,
                    lowValueThreshold: 10,
                    spamDetectionWindow: 5,
                    maxIndividualNotifications: 2
                },
                youtube: {
                    spamDetectionEnabled: false,
                    lowValueThreshold: 1.00,
                    spamDetectionWindow: 5,
                    maxIndividualNotifications: 2
                }
            }
        };
        
        // Require the spam detection module first
        // Create configuration using SpamDetectionConfig class
        config = new SpamDetectionConfig(configObj, { logger: mockLogger, constants: mockConstants });
    });

    afterEach(() => {
        restoreAllMocks();
        global.Date.now.mockRestore();
    });

    describe('when initializing spam detection configuration', () => {
        it('should create configuration with default values', () => {
            const defaultConfig = {};
            const spamConfig = createSpamDetectionConfig(defaultConfig, {
                logger: mockLogger,
                constants: mockConstants
            });

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
            const spamConfig = createSpamDetectionConfig(customConfig, {
                logger: mockLogger,
                constants: mockConstants
            });

            expect(spamConfig.lowValueThreshold).toBe(20);
            expect(spamConfig.spamDetectionEnabled).toBe(false);
            expect(spamConfig.spamDetectionWindow).toBe(10);
            expect(spamConfig.maxIndividualNotifications).toBe(5);
        });

        it('should initialize platform-specific configurations', () => {
            // Use the already created config instance from beforeEach
            expect(config.platformConfigs.tiktok.enabled).toBe(true);
            expect(config.platformConfigs.tiktok.lowValueThreshold).toBe(5);
            expect(config.platformConfigs.youtube.enabled).toBe(false);
            expect(config.platformConfigs.youtube.lowValueThreshold).toBe(1.00);
        });

        it('should validate configuration values', () => {
            const invalidConfig = {
                lowValueThreshold: -5,
                spamDetectionWindow: 0,
                maxIndividualNotifications: -1
            };
            const spamConfig = createSpamDetectionConfig(invalidConfig, {
                logger: mockLogger,
                constants: mockConstants
            });

            // Should use default values for invalid inputs
            expect(spamConfig.lowValueThreshold).toBe(10);
            expect(spamConfig.spamDetectionWindow).toBe(5);
            expect(spamConfig.maxIndividualNotifications).toBe(2);
        });

        it('should parse string booleans and numbers with safe fallbacks', () => {
            const stringConfig = {
                spamDetectionEnabled: 'false',
                lowValueThreshold: '20',
                spamDetectionWindow: 'not-a-number',
                platforms: {
                    tiktok: { spamDetectionEnabled: 'false', lowValueThreshold: '5' },
                    youtube: { spamDetectionEnabled: 'true', lowValueThreshold: 'invalid' }
                }
            };

            const spamConfig = createSpamDetectionConfig(stringConfig, {
                logger: mockLogger,
                constants: mockConstants
            });

            expect(spamConfig.spamDetectionEnabled).toBe(false);
            expect(spamConfig.lowValueThreshold).toBe(20);
            expect(spamConfig.spamDetectionWindow).toBe(5); // fallback due to invalid
            expect(spamConfig.platformConfigs.tiktok.enabled).toBe(false);
            expect(spamConfig.platformConfigs.tiktok.lowValueThreshold).toBe(5);
            expect(spamConfig.platformConfigs.youtube.enabled).toBe(true);
            expect(spamConfig.platformConfigs.youtube.lowValueThreshold).toBe(1.00); // fallback to default USD threshold
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

            // TikTok has lower threshold (5)
            expect(detection.isLowValueDonation(3, 'tiktok')).toBe(true);
            expect(detection.isLowValueDonation(7, 'tiktok')).toBe(false);

            // Twitch has higher threshold (10)
            expect(detection.isLowValueDonation(8, 'twitch')).toBe(true);
            expect(detection.isLowValueDonation(12, 'twitch')).toBe(false);

            // YouTube has USD threshold (1.00) but is disabled by default
            // When disabled, isLowValueDonation should return false (spam detection inactive)
            expect(detection.isLowValueDonation(0.50, 'youtube')).toBe(false);
            expect(detection.isLowValueDonation(1.50, 'youtube')).toBe(false);
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
                autoCleanup: false // Disable automatic periodic cleanup for tests
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
            // First donation
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            
            // Second donation within window
            const result = detection.handleDonationSpam('user1', 'User1', 3, 'Rose', 1, 'tiktok');

            expect(result.shouldShow).toBe(false);
            expect(result.aggregatedMessage).toBeNull();
        });

        it('should reset tracking after time window expires', () => {
            // First donation
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            
            // Fast-forward time beyond window
            testClock.advance(11000); // 11 seconds later

            // Second donation after window
            const result = detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');

            expect(result.shouldShow).toBe(true);
            expect(result.aggregatedMessage).toBeNull();

        });

        it('should keep recent entries', () => {
            // Add donations
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            detection.handleDonationSpam('user2', 'User2', 8, 'bits', 1, 'twitch');

            // Clean up immediately (should keep recent entries)
            detection.cleanupSpamDetection();

            const stats = detection.getStatistics();
            expect(stats.trackedUsers).toBe(2);
        });

        it('should handle cleanup with no entries', () => {
            // Ensure we start with clean state
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
            // Add some test data
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            detection.handleDonationSpam('user2', 'User2', 8, 'bits', 1, 'twitch');
            detection.handleDonationSpam('user1', 'User1', 3, 'Rose', 1, 'tiktok'); // Spam

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
                autoCleanup: false // Disable automatic periodic cleanup for tests
            });
        });

        afterEach(() => {
            if (detection) {
                detection.destroy();
            }
        });

        it('should reset all tracking data', () => {
            // Add some test data
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            detection.handleDonationSpam('user2', 'User2', 8, 'bits', 1, 'twitch');

            // Reset tracking
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
                autoCleanup: false // Disable automatic periodic cleanup for tests
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

            // YouTube spam detection is disabled by default
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
                autoCleanup: false // Disable automatic periodic cleanup for tests
            });
        });

        afterEach(() => {
            if (detection) {
                detection.destroy();
            }
        });

        it('should cleanup periodically', () => {
            detection.setupPeriodicCleanup();

            // Add some test data
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');

            // Cleanup should be scheduled
            expect(detection.cleanupInterval).toBeDefined();
        });
    });

    describe('when destroying spam detection', () => {
        let detection;

        beforeEach(() => {
            detection = createDonationSpamDetection(config, {
                logger: mockLogger,
                constants: mockConstants,
                autoCleanup: false // Disable automatic periodic cleanup for tests
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
            detection.destroy(); // Should not throw error

            expect(detection.cleanupInterval).toBeNull();
        });
    });
}); 
