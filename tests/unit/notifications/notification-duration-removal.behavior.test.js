const EventEmitter = require('events');
const NotificationManager = require('../../../src/notifications/NotificationManager');
const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');

describe('Display items avoid hardcoded durations', () => {
    describe('NotificationManager items', () => {
        let queuedItems;
        let notificationManager;

        beforeEach(() => {
            queuedItems = [];
            notificationManager = new NotificationManager({
                logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
                displayQueue: {
                    addItem: (item) => queuedItems.push(item),
                    addToQueue: jest.fn(),
                    processQueue: jest.fn(),
                    isQueueEmpty: jest.fn().mockReturnValue(true),
                    clearQueue: jest.fn()
                },
                eventBus: new EventEmitter(),
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: jest.fn() },
                obsGoals: { processDonationGoal: jest.fn() },
                configService: {
                    areNotificationsEnabled: jest.fn().mockReturnValue(true),
                    isEnabled: jest.fn().mockReturnValue(true),
                    getNotificationSettings: jest.fn().mockReturnValue({ enabled: true, greetingsEnabled: true }),
                    getPlatformConfig: jest.fn().mockReturnValue(true),
                    get: jest.fn((section) => {
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
                    isDebugEnabled: jest.fn().mockReturnValue(false),
                    getTTSConfig: jest.fn().mockReturnValue({ enabled: true })
                },
                vfxCommandService: {
                    executeCommand: jest.fn().mockResolvedValue({ success: true }),
                    getVFXConfig: jest.fn().mockResolvedValue(null)
                },
                ttsService: { speak: jest.fn().mockResolvedValue({ success: true }) },
                userTrackingService: { isFirstMessage: jest.fn().mockResolvedValue(true) }
            });
        });

        it('enqueues follow notifications without a duration property', async () => {
            await notificationManager.handleNotification('follow', 'tiktok', { username: 'Follower', userId: 'f-1' });

            expect(queuedItems[0]).toBeDefined();
            expect(queuedItems[0]).not.toHaveProperty('duration');
        });

    });

    describe('ChatNotificationRouter items', () => {
        let queuedItems;
        let router;

        beforeEach(() => {
            queuedItems = [];
            const runtime = {
                displayQueue: {
                    addItem: (item) => queuedItems.push(item)
                },
                config: { general: {} },
                commandCooldownService: {
                    checkUserCooldown: jest.fn().mockReturnValue(true),
                    updateUserCooldown: jest.fn(),
                    checkGlobalCooldown: jest.fn().mockReturnValue(true)
                },
                vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) }
            };

            router = new ChatNotificationRouter({
                runtime,
                logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() }
            });
        });

        it('enqueues chat messages without a duration property', () => {
            router.enqueueChatMessage('youtube', {
                userId: 'u-2',
                username: 'Chatter',
                displayName: 'Chatter',
                message: 'Hello world!'
            }, 'Hello world!');

            expect(queuedItems[0]).toBeDefined();
            expect(queuedItems[0]).not.toHaveProperty('duration');
        });

        it('queues greetings without a duration property', async () => {
            await router.queueGreeting('youtube', 'Greeter');

            expect(queuedItems[0]).toBeDefined();
            expect(queuedItems[0]).not.toHaveProperty('duration');
        });
    });
});
