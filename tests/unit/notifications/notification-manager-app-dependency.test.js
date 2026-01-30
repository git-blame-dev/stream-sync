
const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');

const { initializeTestLogging } = require('../../helpers/test-setup');

initializeTestLogging();

const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager Service Dependency Injection - Modernized', () => {
    let mockDisplayQueue;
    let mockConfig;
    let mockVFXCommandService;
    let mockTTSService;
    let mockUserTrackingService;
    let mockEventBus;
    let notificationManager;

    beforeEach(() => {
        mockDisplayQueue = {
            addItem: createMockFn(),
            getQueueLength: createMockFn().mockReturnValue(0)
        };

        mockConfig = createConfigFixture({
            general: {
                userSuppressionEnabled: false,
                maxNotificationsPerUser: 5,
                suppressionWindowMs: 60000,
                suppressionDurationMs: 300000,
                suppressionCleanupIntervalMs: 300000,
                ttsEnabled: true,
                debugEnabled: false,
                followsEnabled: true,
                giftsEnabled: true,
                paypiggiesEnabled: true
            }
        });

        mockVFXCommandService = {
            executeCommand: createMockFn().mockResolvedValue({ success: true }),
            getVFXConfig: createMockFn().mockResolvedValue({ filename: 'test.mp4' })
        };

        mockTTSService = {
            speak: createMockFn().mockResolvedValue({ success: true })
        };

        mockUserTrackingService = {
            isFirstMessage: createMockFn().mockResolvedValue(false),
            trackUser: createMockFn()
        };

        mockEventBus = {
            emit: createMockFn(),
            on: createMockFn(),
            off: createMockFn()
        };
    });

    afterEach(() => {
        restoreAllMocks();
        // Clean up any notification manager instances to prevent hanging tests
        if (notificationManager) {
            if (notificationManager.stopSuppressionCleanup) {
                notificationManager.stopSuppressionCleanup();
            }
            // Clean up spam detection intervals too
            if (notificationManager.donationSpamDetector && notificationManager.donationSpamDetector.destroy) {
                notificationManager.donationSpamDetector.destroy();
            }
        }
    });

    describe('Constructor Service Injection', () => {
        it('should initialize with minimal required dependencies', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                config: mockConfig
            });

            expect(notificationManager).toBeDefined();
            expect(typeof notificationManager.handleNotification).toBe('function');
        });

        it('should accept all service dependencies via constructor', () => {
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                config: mockConfig,
                vfxCommandService: mockVFXCommandService,
                ttsService: mockTTSService,
                userTrackingService: mockUserTrackingService
            });

            expect(notificationManager.eventBus).toBe(mockEventBus);
            expect(notificationManager.config).toBe(mockConfig);
            expect(notificationManager.vfxCommandService).toBe(mockVFXCommandService);
            expect(notificationManager.ttsService).toBe(mockTTSService);
            expect(notificationManager.userTrackingService).toBe(mockUserTrackingService);
        });

        it('should prevent notifications without display system', () => {
            expect(() => {
                new NotificationManager({
                    logger: noOpLogger,
                    eventBus: mockEventBus,
                    constants: require('../../../src/core/constants'),
                    textProcessing: { formatChatMessage: createMockFn() },
                    obsGoals: { processDonationGoal: createMockFn() },
                    config: mockConfig
                });
            }).toThrow('NotificationManager requires displayQueue dependency');
        });

        it('should be ready for notifications when fully configured', () => {
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                config: mockConfig
            });

            expect(typeof notificationManager.handleNotification).toBe('function');
        });
    });

    describe('Required Service Dependencies', () => {
        it('should require EventBus for event-driven architecture', () => {
            expect(() => {
                new NotificationManager({
                    displayQueue: mockDisplayQueue,
                    logger: noOpLogger,
                    constants: require('../../../src/core/constants'),
                    textProcessing: { formatChatMessage: createMockFn() },
                    obsGoals: { processDonationGoal: createMockFn() },
                    config: mockConfig
                });
            }).toThrow('NotificationManager requires EventBus dependency');
        });

        it('should require config for notification setup', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            expect(() => {
                new NotificationManager({
                    displayQueue: mockDisplayQueue,
                    logger: noOpLogger,
                    eventBus: mockEventBus,
                    constants: require('../../../src/core/constants'),
                    textProcessing: { formatChatMessage: createMockFn() },
                    obsGoals: { processDonationGoal: createMockFn() }
                });
            }).toThrow('NotificationManager requires config dependency');
        });

        it('should work without spam detector gracefully', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                config: mockConfig
            });

            expect(notificationManager.donationSpamDetector).toBeUndefined();
        });

        it('should continue processing notifications without VFX services', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                config: mockConfig
            });

            const result = await notificationManager.handleNotification('platform:gift', 'tiktok', {
                username: 'TestUser',
                userId: '123',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            });

            expect(result.success).toBe(true);
        });
    });

    describe('Notification Processing With Services', () => {
        it('should process notifications with full service integration', async () => {
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                config: mockConfig,
                vfxCommandService: mockVFXCommandService,
                ttsService: mockTTSService,
                userTrackingService: mockUserTrackingService
            });

            await notificationManager.handleNotification('platform:gift', 'tiktok', {
                username: 'TestUser',
                userId: '123',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            });

            expect(mockDisplayQueue.addItem).toHaveBeenCalled();

            const addedItem = mockDisplayQueue.addItem.mock.calls[0][0];
            expect(addedItem).toBeDefined();
            expect(addedItem.data).toBeDefined();
        });

        it('should display notifications with minimal services', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                config: mockConfig,
                vfxCommandService: mockVFXCommandService,
                ttsService: mockTTSService,
                userTrackingService: mockUserTrackingService
            });

            await notificationManager.handleNotification('platform:gift', 'tiktok', {
                username: 'TestUser',
                userId: '123',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            });

            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
        });
    });

    describe('Configuration Loading via plain config', () => {
        it('should respect user configuration for notification frequency control', () => {
            const customConfig = createConfigFixture({
                general: {
                    userSuppressionEnabled: false,
                    maxNotificationsPerUser: 10,
                    suppressionWindowMs: 30000,
                    suppressionDurationMs: 300000,
                    suppressionCleanupIntervalMs: 300000
                }
            });

            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                config: customConfig
            });

            expect(notificationManager.suppressionConfig.maxNotificationsPerUser).toBe(10);
        });

        it('should require config instead of relying on defaults', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            expect(() => {
                new NotificationManager({
                    displayQueue: mockDisplayQueue,
                    logger: noOpLogger,
                    eventBus: mockEventBus,
                    constants: require('../../../src/core/constants'),
                    textProcessing: { formatChatMessage: createMockFn() },
                    obsGoals: { processDonationGoal: createMockFn() }
                });
            }).toThrow('NotificationManager requires config dependency');
        });
    });

    describe('Spam Detection Integration', () => {
        it('should use spam detector when provided', async () => {
            const mockSpamDetector = {
                handleDonationSpam: createMockFn().mockReturnValue({ shouldShow: true })
            };

            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                config: mockConfig,
                vfxCommandService: mockVFXCommandService,
                ttsService: mockTTSService,
                userTrackingService: mockUserTrackingService,
                donationSpamDetector: mockSpamDetector
            });

            await notificationManager.handleNotification('platform:gift', 'tiktok', {
                username: 'TestUser',
                userId: '123',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            });

            expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalled();
        });

        it('should work without spam detector', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                config: mockConfig,
                vfxCommandService: mockVFXCommandService,
                ttsService: mockTTSService,
                userTrackingService: mockUserTrackingService
            });

            await notificationManager.handleNotification('platform:gift', 'tiktok', {
                username: 'TestUser',
                userId: '123',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            });

            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
        });
    });

    describe('Graceful Degradation', () => {
        it('should handle missing services gracefully during notification processing', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                config: mockConfig,
                vfxCommandService: mockVFXCommandService,
                ttsService: mockTTSService,
                userTrackingService: mockUserTrackingService
            });

            const notifications = [
                { type: 'platform:follow', data: { username: 'User1', userId: '1' } },
                { type: 'platform:gift', data: { username: 'User2', userId: '2', giftType: 'Rose', giftCount: 1, amount: 1, currency: 'coins' } },
                { type: 'platform:paypiggy', data: { username: 'User3', userId: '3', tier: '1' } }
            ];

            for (const notif of notifications) {
                await notificationManager.handleNotification(notif.type, 'tiktok', notif.data);
            }

            expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(3);
        });

        it('should reject null config dependency', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            expect(() => {
                new NotificationManager({
                    displayQueue: mockDisplayQueue,
                    logger: noOpLogger,
                    eventBus: mockEventBus,
                    constants: require('../../../src/core/constants'),
                    textProcessing: { formatChatMessage: createMockFn() },
                    obsGoals: { processDonationGoal: createMockFn() },
                    config: null,
                    vfxCommandService: null,
                    ttsService: null,
                    userTrackingService: null
                });
            }).toThrow('NotificationManager requires config dependency');
        });
    });
});
