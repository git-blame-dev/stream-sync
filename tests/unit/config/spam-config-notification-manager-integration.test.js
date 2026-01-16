
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { config } = require('../../../src/core/config');
const NotificationManager = require('../../../src/notifications/NotificationManager');
const { createTextProcessingManager } = require('../../../src/utils/text-processing');

// Mock logger to capture log messages
const mockLogger = {
    debug: createMockFn(),
    info: createMockFn(),
    warn: createMockFn(),
    error: createMockFn()
};

// Mock constants with required PRIORITY_LEVELS
const mockConstants = {
    PRIORITY_LEVELS: {
        CHAT: 1,
        FOLLOW: 2,
        MEMBER: 3,
        GIFT: 4,
        RAID: 6,
        ENVELOPE: 8
    },
    NOTIFICATION_CONFIGS: {
        'platform:gift': {
            priority: 4,
            duration: 5000,
            settingKey: 'giftsEnabled',
            commandKey: 'gifts'
        }
    }
};

describe('Spam Detection Service Integration Tests - Modernized', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let notificationManager;
    let mockDisplayQueue;
    let mockSpamDetector;
    let configService;

    beforeEach(() => {
        mockDisplayQueue = {
            addItem: createMockFn(),
            processQueue: createMockFn()
        };

        mockSpamDetector = {
            handleDonationSpam: createMockFn().mockReturnValue({ shouldShow: true })
        };

        configService = {
            areNotificationsEnabled: createMockFn().mockReturnValue(true),
            getPlatformConfig: createMockFn().mockReturnValue(true),
            isDebugEnabled: createMockFn().mockReturnValue(false),
            getTimingConfig: createMockFn().mockReturnValue({ greetingDuration: 5000 }),
            get: createMockFn((section) => {
                if (section === 'general') {
                    return {
                        enabled: true,
                        giftsEnabled: true,
                        greetingsEnabled: true,
                        userSuppressionEnabled: false,
                        maxNotificationsPerUser: 5,
                        suppressionWindowMs: 60000,
                        suppressionDurationMs: 300000,
                        suppressionCleanupIntervalMs: 300000
                    };
                }
                return {};
            }),
            getTTSConfig: createMockFn().mockReturnValue({ enabled: false })
        };
    });

    describe('when spam detection service is provided', () => {
        beforeEach(() => {
            // Create NotificationManager with spam detector dependency
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const textProcessing = createTextProcessingManager({ logger: mockLogger });
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                configService,
                donationSpamDetector: mockSpamDetector,
                textProcessing,
                obsGoals: { processDonationGoal: createMockFn() },
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
            });
        });

        it('should store spam detector when provided via dependency injection', () => {
            expect(notificationManager.donationSpamDetector).toBe(mockSpamDetector);
        });

        it('should use spam detector to filter gift notifications', async () => {
            // BEHAVIOR: Spam detector processes each gift notification
            const giftData = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 10,
                currency: 'coins'
            };

            await notificationManager.handleNotification('platform:gift', 'tiktok', giftData);

            // Should delegate to spam detector
            expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalledWith(
                'user123',
                'TestUser',
                10,
                'Rose',
                1,
                'tiktok'
            );
        });

        it('should display gift when spam detector approves', async () => {
            // BEHAVIOR: Approved gifts added to display queue
            mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: true });

            const giftData = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 10,
                currency: 'coins'
            };

            await notificationManager.handleNotification('platform:gift', 'tiktok', giftData);

            // Should add to display queue
            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
        });

        it('should suppress gift when spam detector rejects', async () => {
            // BEHAVIOR: Spam gifts blocked from display queue
            mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: false });

            const giftData = {
                userId: 'spammer',
                username: 'SpamUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            };

            const result = await notificationManager.handleNotificationInternal('platform:gift', 'tiktok', giftData, false);

            // Should suppress and NOT add to display queue
            expect(result.suppressed).toBe(true);
            expect(result.reason).toBe('spam_detection');
            expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
        });
    });

    describe('when spam detection service is not provided', () => {
        beforeEach(() => {
            // Create NotificationManager WITHOUT spam detector
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                configService,
                textProcessing: createTextProcessingManager({ logger: mockLogger }),
                obsGoals: { processDonationGoal: createMockFn() },
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
                // donationSpamDetector: NOT PROVIDED
            });
        });

        it('should have undefined spam detector when not provided', () => {
            expect(notificationManager.donationSpamDetector).toBeUndefined();
        });

        it('should process gifts without spam detection', async () => {
            // BEHAVIOR: Gifts processed normally when spam detection not enabled
            const giftData = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 10,
                currency: 'coins'
            };

            await notificationManager.handleNotification('platform:gift', 'tiktok', giftData);

            // Should add directly to display queue (no filtering)
            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
        });

        it('should handle rapid gifts without spam protection', async () => {
            // BEHAVIOR: Without spam detector, all gifts are displayed
            const rapidGifts = [
                { userId: 'user1', username: 'User1', giftType: 'Rose', giftCount: 1, amount: 1, currency: 'coins' },
                { userId: 'user1', username: 'User1', giftType: 'Rose', giftCount: 1, amount: 1, currency: 'coins' },
                { userId: 'user1', username: 'User1', giftType: 'Rose', giftCount: 1, amount: 1, currency: 'coins' }
            ];

            for (const gift of rapidGifts) {
                await notificationManager.handleNotification('platform:gift', 'tiktok', gift);
            }

            // All gifts should be added (no spam protection)
            expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(3);
        });
    });

    describe('when verifying spam configuration availability', () => {
        it('should have spam configuration accessible from config module', () => {
            // BEHAVIOR: Configuration provides spam settings for service creation
            expect(config.spam).toBeDefined();
            expect(config.spam.spamDetectionEnabled).toBeDefined();
            expect(config.spam.lowValueThreshold).toBeDefined();
            expect(config.spam.spamDetectionWindow).toBeDefined();
            expect(config.spam.maxIndividualNotifications).toBeDefined();
        });

        it('should use the correct spam configuration values from config.ini', () => {
            // BEHAVIOR: Configuration loads expected values from config file
            const spamConfig = config.spam;

            // These should match the values from config.ini [gifts] section
            expect(spamConfig.lowValueThreshold).toBe(9);
            expect(spamConfig.spamDetectionEnabled).toBe(true);
            expect(spamConfig.spamDetectionWindow).toBe(5);
            expect(spamConfig.maxIndividualNotifications).toBe(1);
        });
    });

    describe('when handling edge cases', () => {
        beforeEach(() => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                configService,
                donationSpamDetector: mockSpamDetector,
                textProcessing: createTextProcessingManager({ logger: mockLogger }),
                obsGoals: { processDonationGoal: createMockFn() },
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
            });
        });

        it('should skip spam detection for aggregated donations', async () => {
            // BEHAVIOR: Aggregated gifts bypass spam filtering
            const aggregatedGift = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Multiple Gifts',
                giftCount: 5,
                amount: 50,
                currency: 'coins',
                isAggregated: true
            };

            await notificationManager.handleNotification('platform:gift', 'tiktok', aggregatedGift);

            // Should NOT call spam detector for aggregated gifts
            expect(mockSpamDetector.handleDonationSpam).not.toHaveBeenCalled();

            // Should add directly to display queue
            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
        });

        it('should handle spam detector errors gracefully', async () => {
            // BEHAVIOR: Spam detector errors don't block gift display
            mockSpamDetector.handleDonationSpam.mockImplementation(() => {
                throw new Error('Spam detector error');
            });

            const giftData = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 10,
                currency: 'coins'
            };

            // Should not throw
            await expect(
                notificationManager.handleNotification('platform:gift', 'tiktok', giftData)
            ).resolves.toBeDefined();

            // Gift should still be processed (graceful degradation)
            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
        });
    });

    describe('when verifying service injection pattern', () => {
        it('should accept spam detector via constructor dependency injection', () => {
            // BEHAVIOR: Constructor accepts spam detector as optional dependency
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const nm = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                configService,
                donationSpamDetector: mockSpamDetector,
                textProcessing: createTextProcessingManager({ logger: mockLogger }),
                obsGoals: { processDonationGoal: createMockFn() },
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
            });

            // Should store the injected dependency
            expect(nm.donationSpamDetector).toBe(mockSpamDetector);
        });

        it('should handle missing spam detector gracefully', () => {
            // BEHAVIOR: Spam detector is optional, system works without it
            const localLogger = {
                debug: createMockFn(),
                info: createMockFn(),
                warn: createMockFn(),
                error: createMockFn()
            };

            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const nm = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: localLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                configService,
                textProcessing: createTextProcessingManager({ logger: mockLogger }),
                obsGoals: { processDonationGoal: createMockFn() },
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
                // donationSpamDetector: NOT PROVIDED
            });

            // Should be undefined (optional dependency)
            expect(nm.donationSpamDetector).toBeUndefined();

            // Should warn about missing EventBus/ConfigService but NOT about spam
            const spamWarnings = localLogger.warn.mock.calls.filter(call =>
                call[0] && call[0].toLowerCase().includes('spam')
            );
            expect(spamWarnings).toHaveLength(0);
        });
    });
});
