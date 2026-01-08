
const { initializeTestLogging } = require('../../helpers/test-setup');
const { createMockLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const {
    SpamDetectionConfig,
    createSpamDetectionConfig,
    createDonationSpamDetection
} = require('../../../src/utils/spam-detection');

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
            const originalDate = Date.now;
            Date.now = jest.fn(() => originalDate() + 10000); // 10 seconds later

            // Second donation after window
            const result = detection.handleDonationSpam('user1', 'User1', 3, 'Rose', 1, 'tiktok');

            expect(result.shouldShow).toBe(true);
            expect(result.aggregatedMessage).toBeNull();
            
            // Restore original Date.now
            Date.now = originalDate;
        });

        it('should handle high-value donations normally', () => {
            const result = detection.handleDonationSpam('user1', 'User1', 50, 'Diamond', 1, 'tiktok');

            expect(result.shouldShow).toBe(true);
            expect(result.aggregatedMessage).toBeNull();
                    });

        it('should respect platform-specific limits', () => {
            // TikTok has maxIndividualNotifications: 1
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            const result = detection.handleDonationSpam('user1', 'User1', 3, 'Rose', 1, 'tiktok');

            expect(result.shouldShow).toBe(false);
            expect(result.aggregatedMessage).toBeNull();

            // Twitch has maxIndividualNotifications: 2
            detection.handleDonationSpam('user2', 'User2', 8, 'bits', 1, 'twitch');
            const twitchResult1 = detection.handleDonationSpam('user2', 'User2', 6, 'bits', 1, 'twitch');
            const twitchResult2 = detection.handleDonationSpam('user2', 'User2', 4, 'bits', 1, 'twitch');

            expect(twitchResult1.shouldShow).toBe(true);
            expect(twitchResult1.aggregatedMessage).toBeNull();
            expect(twitchResult2.shouldShow).toBe(false);
            expect(twitchResult2.aggregatedMessage).toBeNull();
        });

        it('should handle different gift types', () => {
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            const result = detection.handleDonationSpam('user1', 'User1', 3, 'Heart', 1, 'tiktok');

            expect(result.shouldShow).toBe(false);
            expect(result.aggregatedMessage).toBeNull();
                    });

        it('should handle gift counts correctly', () => {
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 5, 'tiktok');
            const result = detection.handleDonationSpam('user1', 'User1', 3, 'Rose', 3, 'tiktok');

            expect(result.shouldShow).toBe(false);
            expect(result.aggregatedMessage).toBeNull();
             // 5 + 3
        });
    });

    describe('when processing aggregated donations', () => {
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

        afterEach(() => {
            if (detection) {
                detection.destroy();
            }
        });

        it('should process aggregated donation correctly', () => {
            // Set up user tracker with aggregated donations
            const userTracker = {
                notifications: [
                    { coinValue: 5, giftType: 'Rose', giftCount: 1, timestamp: Date.now() - 2000 },
                    { coinValue: 3, giftType: 'Rose', giftCount: 2, timestamp: Date.now() - 1000 }
                ],
                aggregatedCount: 2,
                lastReset: Date.now(),
                username: 'TestUser',
                platform: 'tiktok'
            };

            const result = detection.processAggregatedDonation('user1', userTracker);

            expect(result.shouldShow).toBe(true);
            expect(result.aggregatedMessage).toContain('TestUser sent 3 gifts worth 11 coins');
            expect(result.totalCoinValue).toBe(11); // 5 + (3 * 2)
            expect(result.totalGiftCount).toBe(3); // 1 + 2
        });

        it('should handle empty notifications array', () => {
            const userTracker = {
                notifications: [],
                aggregatedCount: 0,
                lastReset: Date.now()
            };

            const result = detection.processAggregatedDonation('user1', userTracker);

            expect(result.shouldShow).toBe(false);
            expect(result.aggregatedMessage).toBeNull();
                    });

        it('should calculate totals correctly', () => {
            const userTracker = {
                notifications: [
                    { coinValue: 10, giftType: 'Rose', giftCount: 5, timestamp: Date.now() - 3000 },
                    { coinValue: 5, giftType: 'Heart', giftCount: 3, timestamp: Date.now() - 2000 },
                    { coinValue: 2, giftType: 'Star', giftCount: 10, timestamp: Date.now() - 1000 }
                ],
                aggregatedCount: 3,
                lastReset: Date.now(),
                username: 'TestUser',
                platform: 'tiktok'
            };

            const result = detection.processAggregatedDonation('user1', userTracker);

            expect(result.totalCoinValue).toBe(85); // (10 * 5) + (5 * 3) + (2 * 10) = 50 + 15 + 20
            expect(result.totalGiftCount).toBe(18); // 5 + 3 + 10
        });
    });

    describe('when cleaning up spam detection', () => {
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

        it('should clean up expired entries', () => {
            // Add some donations
            detection.handleDonationSpam('user1', 'User1', 5, 'Rose', 1, 'tiktok');
            detection.handleDonationSpam('user2', 'User2', 8, 'bits', 1, 'twitch');

            // Fast-forward time beyond window (cleanup uses 2x window = 10s, so use 11s)
            const originalDate = Date.now;
            Date.now = jest.fn(() => originalDate() + 11000); // 11 seconds later

            // Clean up
            detection.cleanupSpamDetection();

            // Check that entries are cleaned up
            const stats = detection.getStatistics();
            expect(stats.trackedUsers).toBe(0);

            // Restore original Date.now
            Date.now = originalDate;
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
