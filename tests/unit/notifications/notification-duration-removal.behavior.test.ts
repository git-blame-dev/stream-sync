const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
export {};
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');

const EventEmitter = require('events');
const NotificationManager = require('../../../src/notifications/NotificationManager');
const { ChatNotificationRouter } = require('../../../src/services/ChatNotificationRouter.js');

type QueueItem = {
    duration?: unknown;
    [key: string]: unknown;
};

type NotificationManagerLike = {
    handleNotification: (type: string, platform: string, data: Record<string, unknown>) => Promise<unknown>;
};

type ChatNotificationRouterLike = {
    enqueueChatMessage: (platform: string, author: Record<string, unknown>, message: string) => void;
    queueGreeting: (platform: string, username: string) => Promise<void>;
};

describe('Display items avoid hardcoded durations', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    describe('NotificationManager items', () => {
        let queuedItems: QueueItem[];
        let notificationManager: NotificationManagerLike;

        beforeEach(() => {
            queuedItems = [];
            notificationManager = new NotificationManager({
                logger: noOpLogger,
                displayQueue: {
                    addItem: (item: QueueItem) => queuedItems.push(item),
                    addToQueue: createMockFn(),
                    processQueue: createMockFn(),
                    isQueueEmpty: createMockFn().mockReturnValue(true),
                    clearQueue: createMockFn()
                },
                eventBus: new EventEmitter(),
                constants: require('../../../src/core/constants'),
                textProcessing: { formatChatMessage: createMockFn() },
                obsGoals: { processDonationGoal: createMockFn() },
                config: createConfigFixture(),
                vfxCommandService: {
                    executeCommand: createMockFn().mockResolvedValue({ success: true }),
                    getVFXConfig: createMockFn().mockResolvedValue(null)
                },
                userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(true) }
            });
        });

        it('enqueues follow notifications without a duration property', async () => {
            await notificationManager.handleNotification('platform:follow', 'tiktok', { username: 'Follower', userId: 'f-1' });

            expect(queuedItems[0]).toBeDefined();
            expect(queuedItems[0]).not.toHaveProperty('duration');
        });

    });

    describe('ChatNotificationRouter items', () => {
        let queuedItems: QueueItem[];
        let router: ChatNotificationRouterLike;

        beforeEach(() => {
            queuedItems = [];
            const runtime = {
                displayQueue: {
                    addItem: (item: QueueItem) => queuedItems.push(item)
                },
                config: { general: {} },
                commandCooldownService: {
                    checkUserCooldown: createMockFn().mockReturnValue(true),
                    updateUserCooldown: createMockFn(),
                    checkGlobalCooldown: createMockFn().mockReturnValue(true)
                },
                vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
            };

            router = new ChatNotificationRouter({
                runtime,
                logger: noOpLogger,
                config: createConfigFixture()
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
