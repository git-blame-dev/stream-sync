
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');

const { noOpLogger } = require('../../helpers/mock-factories');

const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

describe('NotificationManager Spam Protection Behavior - Modernized', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let NotificationManager;
    let mockLogger;
    let mockConstants;
    let mockDisplayQueue;
    let mockSpamDetector;
    let configService;

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

        configService = {
            areNotificationsEnabled: createMockFn().mockReturnValue(true),
            getPlatformConfig: createMockFn().mockReturnValue(true),
            isDebugEnabled: createMockFn().mockReturnValue(false),
            getTimingConfig: createMockFn().mockReturnValue({ greetingDuration: 5000 }),
            getTTSConfig: createMockFn().mockReturnValue({ enabled: false }),
            get: createMockFn((section) => {
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

        NotificationManager = require('../../../src/notifications/NotificationManager');
    });

    describe('when spam protection is properly configured', () => {
        it('should enable spam protection when spam detector is provided', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                donationSpamDetector: mockSpamDetector,
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
            });

            expect(notificationManager.donationSpamDetector).toBe(mockSpamDetector);
        });

        it('should access spam configuration for effective spam protection', () => {
            const { config } = require('../../../src/core/config');

            expect(config).toBeDefined();
            expect(config.spam).toBeDefined();

            const hasSpamConfig = config && config.spam;
            expect(hasSpamConfig).toBeTruthy();
        });

        it('should use spam detector when provided via constructor', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                donationSpamDetector: mockSpamDetector,
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
            });

            expect(notificationManager.donationSpamDetector).toBe(mockSpamDetector);

            const giftData = {
                userId: 'user123',
                username: 'TestUser',
                giftType: 'Rose',
                giftCount: 1,
                amount: 10,
                currency: 'coins'
            };

            await notificationManager.handleNotification('platform:gift', 'tiktok', giftData);

            expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalled();
        });
    });

    describe('when spam detector is not provided', () => {
        it('should operate without spam protection gracefully', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
            });

            expect(notificationManager.donationSpamDetector).toBeUndefined();

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

        it('should initialize successfully without spam detector (optional dependency)', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
            });

            expect(notificationManager.donationSpamDetector).toBeUndefined();
            expect(notificationManager).toBeDefined();
        });
    });

    describe('when checking configuration availability', () => {
        describe('and verifying spam configuration structure', () => {
            it('should provide spam config compatible with SpamDetectionConfig constructor', () => {
                const { config } = require('../../../src/core/config');
                const spamConfig = config.spam;

                expect(spamConfig.spamDetectionEnabled).toBeDefined();
                expect(spamConfig.spamDetectionWindow).toBeDefined();
                expect(spamConfig.maxIndividualNotifications).toBeDefined();
                expect(spamConfig.lowValueThreshold).toBeDefined();

                expect(typeof spamConfig.spamDetectionEnabled).toBe('boolean');
                expect(typeof spamConfig.spamDetectionWindow).toBe('number');
                expect(typeof spamConfig.maxIndividualNotifications).toBe('number');
                expect(typeof spamConfig.lowValueThreshold).toBe('number');
            });

            it('should have valid spam configuration values', () => {
                const { config } = require('../../../src/core/config');
                const spamConfig = config.spam;

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
            mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: true });

            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                donationSpamDetector: mockSpamDetector,
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
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

            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
        });

        it('should block gifts that fail spam detection', async () => {
            mockSpamDetector.handleDonationSpam.mockReturnValue({ shouldShow: false });

            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                donationSpamDetector: mockSpamDetector,
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
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

        it('should skip spam detection for aggregated donations', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            const notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                configService,
                constants: mockConstants,
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                donationSpamDetector: mockSpamDetector,
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
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

            expect(mockSpamDetector.handleDonationSpam).not.toHaveBeenCalled();
        });
    });
});
