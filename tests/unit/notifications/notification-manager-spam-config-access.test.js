
const { expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');

// MANDATORY imports
const {
    initializeTestLogging
} = require('../../helpers/test-setup');

const {
    createMockLogger
} = require('../../helpers/mock-factories');

const {
    setupAutomatedCleanup
} = require('../../helpers/mock-lifecycle');

// Initialize FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('NotificationManager Spam Protection Behavior - Modernized', () => {
    let NotificationManager;
    let mockLogger;
    let mockConstants;
    let mockDisplayQueue;
    let mockSpamDetector;
    let configService;

    beforeEach(() => {
        mockLogger = createMockLogger();

        mockConstants = {
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

        mockDisplayQueue = {
            addItem: jest.fn(),
            processQueue: jest.fn()
        };

        mockSpamDetector = {
            handleDonationSpam: jest.fn().mockReturnValue({ shouldShow: true })
        };

        configService = {
            areNotificationsEnabled: jest.fn().mockReturnValue(true),
            getPlatformConfig: jest.fn().mockReturnValue(true),
            isDebugEnabled: jest.fn().mockReturnValue(false),
            getTimingConfig: jest.fn().mockReturnValue({ greetingDuration: 5000 }),
            getTTSConfig: jest.fn().mockReturnValue({ enabled: false }),
            get: jest.fn((section) => {
                if (section !== 'general') {
                    return true;
                }
                return {
                    userSuppressionEnabled: false,
                    maxNotificationsPerUser: 5,
                    suppressionWindowMs: 60000,
                    suppressionDurationMs: 300000,
                    suppressionCleanupIntervalMs: 300000
                };
            })
        };

        // Import NotificationManager after mocks are set up
        NotificationManager = require('../../../src/notifications/NotificationManager');
    });

    describe('when spam protection is properly configured', () => {
        it('should enable spam protection silently for optimal user experience', () => {
            // BEHAVIOR: Spam protection works without user-facing warnings
            const { config } = require('../../../src/core/config');

            const mockEventBus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: jest.fn() },
                obsGoals: { processDonationGoal: jest.fn() },
                donationSpamDetector: mockSpamDetector,
                vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) }
            });

            // Spam protection activates without disruptive messages
            const warningCalls = mockLogger.warn.mock.calls.filter(call =>
                call[0] && call[0].includes('No spam configuration found')
            );
            expect(warningCalls.length).toBe(0);
        });

        it('should access spam configuration for effective spam protection', () => {
            // BEHAVIOR: Configuration provides spam settings
            const { config } = require('../../../src/core/config');

            // Spam configuration is available
            expect(config).toBeDefined();
            expect(config.spam).toBeDefined();

            // Configuration structure supports protection
            const hasSpamConfig = config && config.spam;
            expect(hasSpamConfig).toBeTruthy();
        });

        it('should use spam detector when provided via constructor', async () => {
            // BEHAVIOR: Spam detector filters gift notifications
            const mockEventBus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: jest.fn() },
                obsGoals: { processDonationGoal: jest.fn() },
                donationSpamDetector: mockSpamDetector,
                vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) }
            });

            // Spam detector should be available
            expect(notificationManager.donationSpamDetector).toBe(mockSpamDetector);

            // Process a gift and verify spam detection is used
            const giftData = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 10,
                currency: 'coins'
            };

            await notificationManager.handleNotification('platform:gift', 'tiktok', giftData);

            // Should have called spam detector
            expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalled();
        });
    });

    describe('when spam detector is not provided', () => {
        it('should operate without spam protection gracefully', async () => {
            // BEHAVIOR: System works without spam detector (optional dependency)
            const mockEventBus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: jest.fn() },
                obsGoals: { processDonationGoal: jest.fn() },
                vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) }
                // donationSpamDetector: NOT PROVIDED
            });

            // No spam detector available
            expect(notificationManager.donationSpamDetector).toBeUndefined();

            // Process gift without spam detection
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

            // Gift should be added to queue (no filtering)
            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
        });

        it('should not log warnings about missing spam config', () => {
            // BEHAVIOR: Optional dependency - no warnings when not provided
            const localLogger = createMockLogger();

            const mockEventBus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: localLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: jest.fn() },
                obsGoals: { processDonationGoal: jest.fn() },
                vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) }
                // donationSpamDetector: NOT PROVIDED
            });

            // Should not warn about missing spam config (it's optional)
            const spamWarnings = localLogger.warn.mock.calls.filter(call =>
                call[0] && call[0].toLowerCase().includes('spam')
            );
            expect(spamWarnings).toHaveLength(0);
        });
    });

    describe('when checking configuration availability', () => {
        describe('and verifying spam configuration structure', () => {
            it('should provide spam config compatible with SpamDetectionConfig constructor', () => {
                // BEHAVIOR: Config structure matches expected interface
                const { config } = require('../../../src/core/config');
                const spamConfig = config.spam;

                // These are the properties expected by SpamDetectionConfig
                expect(spamConfig.spamDetectionEnabled).toBeDefined();
                expect(spamConfig.spamDetectionWindow).toBeDefined();
                expect(spamConfig.maxIndividualNotifications).toBeDefined();
                expect(spamConfig.lowValueThreshold).toBeDefined();

                // Properties should have correct types
                expect(typeof spamConfig.spamDetectionEnabled).toBe('boolean');
                expect(typeof spamConfig.spamDetectionWindow).toBe('number');
                expect(typeof spamConfig.maxIndividualNotifications).toBe('number');
                expect(typeof spamConfig.lowValueThreshold).toBe('number');
            });

            it('should have valid spam configuration values', () => {
                // BEHAVIOR: Configuration values are valid for spam detection
                const { config } = require('../../../src/core/config');
                const spamConfig = config.spam;

                // Verify the config is structured correctly
                expect(spamConfig).toBeTruthy();
                expect(spamConfig.spamDetectionEnabled).toBeDefined();
                expect(spamConfig.spamDetectionWindow).toBeGreaterThan(0);
                expect(spamConfig.maxIndividualNotifications).toBeGreaterThan(0);
                expect(spamConfig.lowValueThreshold).toBeGreaterThan(0);
            });
        });
    });

    describe('when spam detector filters notifications', () => {
        it('should allow gifts that pass spam detection', async () => {
            // BEHAVIOR: Approved gifts are displayed
            mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: true });

            const mockEventBus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: jest.fn() },
                obsGoals: { processDonationGoal: jest.fn() },
                donationSpamDetector: mockSpamDetector,
                vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) }
            });

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

        it('should block gifts that fail spam detection', async () => {
            // BEHAVIOR: Spam gifts are blocked
            mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: false });

            const mockEventBus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: jest.fn() },
                obsGoals: { processDonationGoal: jest.fn() },
                donationSpamDetector: mockSpamDetector,
                vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) }
            });

            const giftData = {
                userId: 'spammer',
                username: 'SpamUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            };

            const result = await notificationManager.handleNotificationInternal('platform:gift', 'tiktok', giftData, false);

            // Should be suppressed
            expect(result.suppressed).toBe(true);
            expect(result.reason).toBe('spam_detection');

            // Should NOT add to display queue
            expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
        });

        it('should skip spam detection for aggregated donations', async () => {
            // BEHAVIOR: Aggregated gifts bypass spam filtering
            const mockEventBus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: jest.fn() },
                obsGoals: { processDonationGoal: jest.fn() },
                donationSpamDetector: mockSpamDetector,
                vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) }
            });

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
        });
    });
});
