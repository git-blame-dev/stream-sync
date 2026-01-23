
const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = require('../../helpers/test-setup');
const { createMockNotificationDispatcher, noOpLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { expectValidNotification, expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');
const { createTextProcessingManager } = require('../../../src/utils/text-processing');

initializeTestLogging();

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('Spam Detection Service Integration Tests', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let mockLogger;
    let mockConstants;
    let mockDisplayQueue;
    let mockSpamDetector;
    let mockConfigService;
    let mockTextProcessing;
    let mockObsGoals;
    let mockVfxCommandService;
    let mockTtsService;
    let NotificationManager;

    beforeEach(() => {
        mockLogger = noOpLogger;

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
            addItem: createMockFn(),
            processQueue: createMockFn()
        };

        mockSpamDetector = {
            handleDonationSpam: createMockFn().mockReturnValue({ shouldShow: true })
        };

        mockConfigService = {
            get: createMockFn((section) => {
                if (section === 'general') {
                    return {
                        enabled: true,
                        chatEnabled: true,
                        greetingsEnabled: true,
                        giftsEnabled: true,
                        userSuppressionEnabled: false,
                        maxNotificationsPerUser: 5,
                        suppressionWindowMs: 60000,
                        suppressionDurationMs: 300000,
                        suppressionCleanupIntervalMs: 300000
                    };
                }
                return {};
            }),
            areNotificationsEnabled: createMockFn(() => true),
            getPlatformConfig: createMockFn(() => true),
            getTTSConfig: createMockFn(() => ({ enabled: false })),
            isDebugEnabled: createMockFn(() => false)
        };

        mockTextProcessing = createTextProcessingManager({ logger: mockLogger });
        mockObsGoals = { processDonationGoal: createMockFn() };
        mockVfxCommandService = { getVFXConfig: createMockFn().mockResolvedValue(null) };
        mockTtsService = { speak: createMockFn() };

        NotificationManager = require('../../../src/notifications/NotificationManager');
    });

    describe('when spam detection configuration is available', () => {
        it('should use spam detector service when provided', async () => {
            const { config } = require('../../../src/core/config');

            expect(config.spam).toBeDefined();
            expect(config.spam.spamDetectionEnabled).toBe(true);
        });

        it('should contain all required spam detection properties in config', () => {
            const { config } = require('../../../src/core/config');
            const spamConfig = config.spam;

            expect(spamConfig).toHaveProperty('spamDetectionEnabled');
            expect(spamConfig).toHaveProperty('spamDetectionWindow');
            expect(spamConfig).toHaveProperty('maxIndividualNotifications');
            expect(spamConfig).toHaveProperty('lowValueThreshold');

            expect(typeof spamConfig.spamDetectionEnabled).toBe('boolean');
            expect(typeof spamConfig.spamDetectionWindow).toBe('number');
            expect(typeof spamConfig.maxIndividualNotifications).toBe('number');
            expect(typeof spamConfig.lowValueThreshold).toBe('number');
        });

        it('should map to existing gift configuration values exactly', () => {
            const { config } = require('../../../src/core/config');
            const spamConfig = config.spam;
            const giftConfig = config.gifts;

            expect(spamConfig.spamDetectionEnabled).toBe(giftConfig.spamDetectionEnabled);
            expect(spamConfig.spamDetectionWindow).toBe(giftConfig.spamDetectionWindow);
            expect(spamConfig.maxIndividualNotifications).toBe(giftConfig.maxIndividualNotifications);
            expect(spamConfig.lowValueThreshold).toBe(giftConfig.lowValueThreshold);
        });

        it('should provide correct default values from config.ini', () => {
            const { config, configManager } = require('../../../src/core/config');
            const spamConfig = config.spam;

            expect(spamConfig.spamDetectionEnabled).toBe(configManager.getBoolean('gifts', 'spamDetectionEnabled', true));
            expect(spamConfig.spamDetectionWindow).toBe(configManager.getNumber('gifts', 'spamDetectionWindow', 5));
            expect(spamConfig.maxIndividualNotifications).toBe(configManager.getNumber('gifts', 'maxIndividualNotifications', 2));
            expect(spamConfig.lowValueThreshold).toBe(configManager.getNumber('gifts', 'lowValueThreshold', 10));
        });
    });

    describe('when NotificationManager is initialized with spam detector', () => {
        it('should process gifts through spam detector when provided', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                donationSpamDetector: mockSpamDetector,
                configService: mockConfigService,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService,
                ttsService: mockTtsService
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

            expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalledWith(
                'user123',
                'TestUser',
                10,
                'Rose',
                1,
                'tiktok'
            );
        });

        it('should store spam detector when provided via dependency injection', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                donationSpamDetector: mockSpamDetector,
                configService: mockConfigService,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService,
                ttsService: mockTtsService
            });

            expect(notificationManager.donationSpamDetector).toBe(mockSpamDetector);
        });

        it('should suppress gifts when spam detector indicates spam', async () => {
            mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: false });

            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                donationSpamDetector: mockSpamDetector,
                configService: mockConfigService,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService,
                ttsService: mockTtsService
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

            expect(result.suppressed).toBe(true);
            expect(result.reason).toBe('spam_detection');
            expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
        });
    });

    describe('when NotificationManager is initialized without spam detector', () => {
        it('should gracefully handle missing spam detector dependency', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                configService: mockConfigService,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService,
                ttsService: mockTtsService
            });

            const giftData = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 10,
                currency: 'coins'
            };

            await expect(
                notificationManager.handleNotification('platform:gift', 'tiktok', giftData)
            ).resolves.toBeDefined();

            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
        });

        it('should have undefined spam detector when not provided', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                configService: mockConfigService,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService,
                ttsService: mockTtsService
            });

            expect(notificationManager.donationSpamDetector).toBeUndefined();
        });
    });

    describe('when handling edge cases', () => {
        it('should skip spam detection for aggregated donations', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                donationSpamDetector: mockSpamDetector,
                configService: mockConfigService,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService,
                ttsService: mockTtsService
            });

            const aggregatedGift = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 5,
                amount: 50,
                currency: 'coins',
                isAggregated: true
            };

            await notificationManager.handleNotification('platform:gift', 'tiktok', aggregatedGift);

            expect(mockSpamDetector.handleDonationSpam).not.toHaveBeenCalled();
        });

        it('should validate spam config property types from configuration', () => {
            const { config } = require('../../../src/core/config');
            const spamConfig = config.spam;

            expect(typeof spamConfig.spamDetectionEnabled).toBe('boolean');
            expect(typeof spamConfig.spamDetectionWindow).toBe('number');
            expect(typeof spamConfig.maxIndividualNotifications).toBe('number');
            expect(typeof spamConfig.lowValueThreshold).toBe('number');

            expect(spamConfig.spamDetectionWindow).toBeGreaterThan(0);
            expect(spamConfig.maxIndividualNotifications).toBeGreaterThan(0);
            expect(spamConfig.lowValueThreshold).toBeGreaterThanOrEqual(0);
        });
    });

    describe('when validating integration with spam detection system', () => {
        it('should provide config structure compatible with SpamDetectionConfig constructor', () => {
            const { config } = require('../../../src/core/config');
            const spamConfig = config.spam;

            expect(spamConfig).toBeTruthy();
            expect(spamConfig.spamDetectionEnabled).toBeDefined();
            expect(spamConfig.spamDetectionWindow).toBeDefined();
            expect(spamConfig.maxIndividualNotifications).toBeDefined();
            expect(spamConfig.lowValueThreshold).toBeDefined();

            expect(spamConfig.spamDetectionWindow).toBeGreaterThan(0);
            expect(spamConfig.maxIndividualNotifications).toBeGreaterThan(0);
            expect(spamConfig.lowValueThreshold).toBeGreaterThan(0);
        });

        it('should support NotificationManager dependency injection pattern', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                donationSpamDetector: mockSpamDetector,
                configService: mockConfigService,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService,
                ttsService: mockTtsService
            });

            expect(notificationManager.donationSpamDetector).toBe(mockSpamDetector);
        });
    });

    describe('when ensuring no technical artifacts in user-facing content', () => {
        it('should not expose internal configuration details to users', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: mockConstants,
                donationSpamDetector: mockSpamDetector,
                configService: mockConfigService,
                textProcessing: mockTextProcessing,
                obsGoals: mockObsGoals,
                vfxCommandService: mockVfxCommandService,
                ttsService: mockTtsService
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

            const queueCall = mockDisplayQueue.addItem.mock.calls[0];
            if (queueCall) {
                const notificationData = queueCall[0].data;
                if (notificationData.displayMessage) {
                    expectNoTechnicalArtifacts(notificationData.displayMessage);
                }
                expect(notificationData).not.toHaveProperty('spamDetectionConfig');
                expect(notificationData).not.toHaveProperty('configService');
            }
        });

        it('should provide meaningful property names for spam detection settings', () => {
            const { config } = require('../../../src/core/config');
            const spamConfig = config.spam;

            expect(spamConfig).toHaveProperty('spamDetectionEnabled');
            expect(spamConfig).toHaveProperty('spamDetectionWindow');
            expect(spamConfig).toHaveProperty('maxIndividualNotifications');
            expect(spamConfig).toHaveProperty('lowValueThreshold');
        });
    });
});
