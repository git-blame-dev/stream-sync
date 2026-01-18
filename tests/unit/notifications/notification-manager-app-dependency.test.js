
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const { initializeTestLogging } = require('../../helpers/test-setup');

initializeTestLogging();

const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager Service Dependency Injection - Modernized', () => {
    let mockDisplayQueue;
    let mockConfigService;
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

        mockConfigService = {
            get: createMockFn((section) => {
                if (section !== 'general') {
                    return {};
                }
                return {
                    userSuppressionEnabled: false,
                    maxNotificationsPerUser: 5,
                    suppressionWindowMs: 60000,
                    suppressionDurationMs: 300000,
                    suppressionCleanupIntervalMs: 300000
                };
            }),
            isEnabled: createMockFn().mockReturnValue(true),
            getNotificationSettings: createMockFn().mockReturnValue({ enabled: true }),
            getTTSConfig: createMockFn().mockReturnValue({ enabled: true }),
            isDebugEnabled: createMockFn().mockReturnValue(false),
            areNotificationsEnabled: createMockFn().mockReturnValue(true),
            getPlatformConfig: createMockFn().mockReturnValue(true),
            getCLIOverrides: createMockFn().mockReturnValue({})
        };

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
                configService: mockConfigService
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
                configService: mockConfigService,
                vfxCommandService: mockVFXCommandService,
                ttsService: mockTTSService,
                userTrackingService: mockUserTrackingService
            });

            expect(notificationManager.eventBus).toBe(mockEventBus);
            expect(notificationManager.configService).toBe(mockConfigService);
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
                    configService: mockConfigService
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
                configService: mockConfigService
            });

            expect(typeof notificationManager.handleNotification).toBe('function');
            expect(typeof notificationManager.handleGreeting).toBe('function');
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
                    configService: mockConfigService
                });
            }).toThrow('NotificationManager requires EventBus dependency');
        });

        it('should require ConfigService for notification setup', () => {
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
            }).toThrow('NotificationManager requires ConfigService dependency');
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
                configService: mockConfigService
            });

            expect(notificationManager.donationSpamDetector).toBeUndefined();
        });

        it('should reject notifications without VFX services', async () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                configService: mockConfigService
            });

            await expect(notificationManager.handleNotification('platform:gift', 'tiktok', {
                username: 'TestUser',
                userId: '123',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            })).rejects.toThrow('VFXCommandService not available for config lookup: gifts');
            expect(mockDisplayQueue.addItem).not.toHaveBeenCalled();
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
                configService: mockConfigService,
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
                configService: mockConfigService,
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

    describe('Configuration Loading via ConfigService', () => {
        it('should respect user configuration for notification frequency control', () => {
            const customConfigService = {
                ...mockConfigService,
                get: createMockFn((section, key, defaultValue) => {
                    if (section === 'general' && key === undefined) {
                        return {
                            userSuppressionEnabled: false,
                            maxNotificationsPerUser: 10,
                            suppressionWindowMs: 30000,
                            suppressionDurationMs: 300000,
                            suppressionCleanupIntervalMs: 300000
                        };
                    }
                    if (section === 'general' && key === 'userSuppressionEnabled') return false;
                    if (section === 'general' && key === 'maxNotificationsPerUser') return 10;
                    if (section === 'general' && key === 'suppressionWindowMs') return 30000;
                    return defaultValue;
                })
            };

            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: noOpLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                configService: customConfigService
            });

            expect(customConfigService.get).toHaveBeenCalled();
        });

        it('should require ConfigService instead of relying on defaults', () => {
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
            }).toThrow('NotificationManager requires ConfigService dependency');
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
                configService: mockConfigService,
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
                configService: mockConfigService,
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
                configService: mockConfigService,
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

        it('should reject null ConfigService dependency', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            expect(() => {
                new NotificationManager({
                    displayQueue: mockDisplayQueue,
                    logger: noOpLogger,
                    eventBus: mockEventBus,
                    constants: require('../../../src/core/constants'),
                    textProcessing: { formatChatMessage: createMockFn() },
                    obsGoals: { processDonationGoal: createMockFn() },
                    configService: null,
                    vfxCommandService: null,
                    ttsService: null,
                    userTrackingService: null
                });
            }).toThrow('NotificationManager requires ConfigService dependency');
        });
    });
});
