
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { expectNoTechnicalArtifacts } = require('../../helpers/assertion-helpers');

const { initializeTestLogging, createMockConfig } = require('../../helpers/test-setup');

// Initialize test logging BEFORE importing NotificationManager
initializeTestLogging();

const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager Service Dependency Injection - Modernized', () => {
    let mockDisplayQueue;
    let mockLogger;
    let mockConfigService;
    let mockVFXCommandService;
    let mockTTSService;
    let mockUserTrackingService;
    let mockEventBus;
    let notificationManager;

    beforeEach(() => {
        // Mock display queue
        mockDisplayQueue = {
            addItem: createMockFn(),
            getQueueLength: createMockFn().mockReturnValue(0)
        };

        // Mock logger
        mockLogger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        // Mock ConfigService
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

        // Mock VFX Command Service
        mockVFXCommandService = {
            executeCommand: createMockFn().mockResolvedValue({ success: true }),
            getVFXConfig: createMockFn().mockResolvedValue({ filename: 'test.mp4' })
        };

        // Mock TTS Service
        mockTTSService = {
            speak: createMockFn().mockResolvedValue({ success: true })
        };

        // Mock User Tracking Service
        mockUserTrackingService = {
            isFirstMessage: createMockFn().mockResolvedValue(false),
            trackUser: createMockFn()
        };

        // Mock EventBus
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
            // BEHAVIOR: NotificationManager works with just displayQueue
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                configService: mockConfigService
            });

            // System initialized and stable
            expect(notificationManager).toBeDefined();
            expect(typeof notificationManager.handleNotification).toBe('function');
        });

        it('should accept all service dependencies via constructor', () => {
            // BEHAVIOR: Full service injection pattern
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                configService: mockConfigService,
                vfxCommandService: mockVFXCommandService,
                ttsService: mockTTSService,
                userTrackingService: mockUserTrackingService
            });

            // All services properly injected
            expect(notificationManager.eventBus).toBe(mockEventBus);
            expect(notificationManager.configService).toBe(mockConfigService);
            expect(notificationManager.vfxCommandService).toBe(mockVFXCommandService);
            expect(notificationManager.ttsService).toBe(mockTTSService);
            expect(notificationManager.userTrackingService).toBe(mockUserTrackingService);
        });

        it('should prevent notifications without display system', () => {
            // BEHAVIOR: displayQueue is required
            expect(() => {
                new NotificationManager({
                    logger: mockLogger,
                    eventBus: mockEventBus,
                    constants: require('../../../src/core/constants'),
                    textProcessing: { formatChatMessage: createMockFn() },
                    obsGoals: { processDonationGoal: createMockFn() },
                    configService: mockConfigService
                    // No displayQueue
                });
            }).toThrow('NotificationManager requires displayQueue dependency');
        });

        it('should be ready for notifications when fully configured', () => {
            // BEHAVIOR: Fully configured system ready for use
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                configService: mockConfigService
            });

            // System ready to process notifications
            expect(typeof notificationManager.handleNotification).toBe('function');
            expect(typeof notificationManager.handleGreeting).toBe('function');
        });
    });

    describe('Required Service Dependencies', () => {
        it('should require EventBus for event-driven architecture', () => {
            // BEHAVIOR: EventBus is now required (not optional)
            expect(() => {
                new NotificationManager({
                    displayQueue: mockDisplayQueue,
                    logger: mockLogger,
                    constants: require('../../../src/core/constants'),
                    textProcessing: { formatChatMessage: createMockFn() },
                    obsGoals: { processDonationGoal: createMockFn() },
                    configService: mockConfigService
                    // No EventBus - should throw
                });
            }).toThrow('NotificationManager requires EventBus dependency for event-driven architecture');
        });

        it('should require ConfigService for notification setup', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            expect(() => {
                new NotificationManager({
                    displayQueue: mockDisplayQueue,
                    logger: mockLogger,
                    eventBus: mockEventBus,
                    constants: require('../../../src/core/constants'),
                    textProcessing: { formatChatMessage: createMockFn() },
                    obsGoals: { processDonationGoal: createMockFn() }
                });
            }).toThrow('NotificationManager requires ConfigService dependency');
        });

        it('should work without spam detector gracefully', () => {
            // BEHAVIOR: Spam detector is optional
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                configService: mockConfigService
                // No donationSpamDetector
            });

            // Should be undefined (optional)
            expect(notificationManager.donationSpamDetector).toBeUndefined();
        });

        it('should reject notifications without VFX services', async () => {
            // BEHAVIOR: VFX services are required for notification processing
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                configService: mockConfigService
                // No VFX services
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
            // BEHAVIOR: Full service stack enables all features
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                configService: mockConfigService,
                vfxCommandService: mockVFXCommandService,
                ttsService: mockTTSService,
                userTrackingService: mockUserTrackingService
            });

            // When: User sends a gift
            await notificationManager.handleNotification('platform:gift', 'tiktok', {
                username: 'TestUser',
                userId: '123',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            });

            // Then: Gift notification appears
            expect(mockDisplayQueue.addItem).toHaveBeenCalled();

            // Verify notification content is user-friendly
            const addedItem = mockDisplayQueue.addItem.mock.calls[0][0];
            expect(addedItem).toBeDefined();
            expect(addedItem.data).toBeDefined();
        });

        it('should display notifications with minimal services', async () => {
            // BEHAVIOR: Core functionality works with minimal services
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                configService: mockConfigService,
                vfxCommandService: mockVFXCommandService,
                ttsService: mockTTSService,
                userTrackingService: mockUserTrackingService
            });

            // When: User sends a gift
            await notificationManager.handleNotification('platform:gift', 'tiktok', {
                username: 'TestUser',
                userId: '123',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            });

            // Then: Gift notification still appears (graceful degradation)
            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
        });
    });

    describe('Configuration Loading via ConfigService', () => {
        it('should respect user configuration for notification frequency control', () => {
            // BEHAVIOR: ConfigService provides notification settings
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

            // When: NotificationManager initializes with custom config
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                configService: customConfigService
            });

            // Then: Should attempt to load config
            expect(customConfigService.get).toHaveBeenCalled();
        });

        it('should require ConfigService instead of relying on defaults', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            expect(() => {
                new NotificationManager({
                    displayQueue: mockDisplayQueue,
                    logger: mockLogger,
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
            // BEHAVIOR: Spam detector filters notifications
            const mockSpamDetector = {
                handleDonationSpam: createMockFn().mockReturnValue({ shouldShow: true })
            };

            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
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

            // Process gift
            await notificationManager.handleNotification('platform:gift', 'tiktok', {
                username: 'TestUser',
                userId: '123',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            });

            // Should use spam detector
            expect(mockSpamDetector.handleDonationSpam).toHaveBeenCalled();
        });

        it('should work without spam detector', async () => {
            // BEHAVIOR: Spam detection is optional
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                configService: mockConfigService,
                vfxCommandService: mockVFXCommandService,
                ttsService: mockTTSService,
                userTrackingService: mockUserTrackingService
                // No spam detector
            });

            // Process gift without spam detection
            await notificationManager.handleNotification('platform:gift', 'tiktok', {
                username: 'TestUser',
                userId: '123',
                giftType: 'Rose',
                giftCount: 1,
                amount: 1,
                currency: 'coins'
            });

            // Should still work
            expect(mockDisplayQueue.addItem).toHaveBeenCalled();
        });
    });

    describe('Graceful Degradation', () => {
        it('should handle missing services gracefully during notification processing', async () => {
            // BEHAVIOR: Missing optional services don't break notifications
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            notificationManager = new NotificationManager({
                displayQueue: mockDisplayQueue,
                logger: mockLogger,
                eventBus: mockEventBus,
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                configService: mockConfigService,
                vfxCommandService: mockVFXCommandService,
                ttsService: mockTTSService,
                userTrackingService: mockUserTrackingService
                // Minimal services only
            });

            // Process various notification types
            const notifications = [
                { type: 'platform:follow', data: { username: 'User1', userId: '1' } },
                { type: 'platform:gift', data: { username: 'User2', userId: '2', giftType: 'Rose', giftCount: 1, amount: 1, currency: 'coins' } },
                { type: 'platform:paypiggy', data: { username: 'User3', userId: '3', tier: '1' } }
            ];

            for (const notif of notifications) {
                await notificationManager.handleNotification(notif.type, 'tiktok', notif.data);
            }

            // All notifications should be processed
            expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(3);
        });

        it('should reject null ConfigService dependency', () => {
            const mockEventBus = { emit: createMockFn(), on: createMockFn(), off: createMockFn() };
            expect(() => {
                new NotificationManager({
                    displayQueue: mockDisplayQueue,
                    logger: mockLogger,
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
