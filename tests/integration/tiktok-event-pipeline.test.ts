const { describe, test, afterEach, expect } = require('bun:test');
const EventEmitter = require('events');

const NotificationManager = require('../../src/notifications/NotificationManager');
const PlatformEventRouter = require('../../src/services/PlatformEventRouter.js');
const { TikTokPlatform } = require('../../src/platforms/tiktok');
const { createTextProcessingManager } = require('../../src/utils/text-processing');
const { createConfigFixture } = require('../helpers/config-fixture');
const { createMockDisplayQueue, noOpLogger } = require('../helpers/mock-factories');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const {
    useFakeTimers,
    useRealTimers,
    setSystemTime,
    advanceTimersByTime,
    clearAllTimers
} = require('../helpers/bun-timers');
const { setupTikTokEventListeners, cleanupTikTokEventListeners } = require('../../src/platforms/tiktok/events/event-router.js');

const createEventBus = () => {
    const emitter = new EventEmitter();
    return {
        emit: (event, payload) => emitter.emit(event, payload),
        subscribe: (event, handler) => {
            emitter.on(event, handler);
            return () => emitter.off(event, handler);
        }
    };
};

describe('TikTok event pipeline (integration)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('routes chat, gift, and share through platform:event', async () => {
        const eventBus = createEventBus();
        const logger = noOpLogger;
        const runtimeCalls = {
            chat: [],
            gift: [],
            share: []
        };
        const runtime = {
            handleChatMessage: (platform, message) => runtimeCalls.chat.push({ platform, message }),
            handleGiftNotification: (platform, username, payload) => runtimeCalls.gift.push({ platform, username, payload }),
            handleShareNotification: (platform, username, payload) => runtimeCalls.share.push({ platform, username, payload })
        };
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const config = createConfigFixture({
            general: {
                messagesEnabled: true,
                giftsEnabled: true,
                sharesEnabled: true
            },
            tiktok: {
                enabled: true
            },
            obs: { enabled: false }
        });
        const notificationManager = new NotificationManager({
            displayQueue,
            logger,
            eventBus,
            config,
            constants: require('../../src/core/constants'),
            textProcessing,
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });

        const router = new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager,
            config,
            logger
        });

        const connection = new EventEmitter();
        const WebcastEvent = {
            CHAT: 'chat',
            GIFT: 'gift',
            SOCIAL: 'social'
        };
        const ControlEvent = {
            DISCONNECTED: 'disconnected',
            ERROR: 'error'
        };

        const platform = new TikTokPlatform(
            {
                enabled: true,
                username: 'test-user',
                giftAggregationEnabled: false
            },
            {
                logger,
                eventBus,
                TikTokWebSocketClient: createMockFn(),
                WebcastEvent,
                ControlEvent,
                connectionFactory: { createConnection: createMockFn() }
            }
        );

        platform.connection = connection;
        setupTikTokEventListeners(platform);

        const eventTimestamp = Date.parse('2025-01-20T12:00:00.000Z');
        const chatPayload = {
            comment: 'hello there',
            user: { userId: 'test-user-id-1', uniqueId: 'test-user-1', nickname: 'test-user-one' },
            common: { createTime: eventTimestamp }
        };
        const giftPayload = {
            user: {
                userId: 'test-user-id-2',
                uniqueId: 'test-user-2',
                nickname: 'test-user-two',
                profilePictureUrl: 'https://example.invalid/tiktok-integration-immediate-avatar.jpg'
            },
            repeatCount: 2,
            repeatEnd: true,
            giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
            common: { createTime: eventTimestamp, msgId: 'test-gift-msg-1' }
        };
        const sharePayload = {
            user: { userId: 'test-user-id-3', uniqueId: 'test-user-3', nickname: 'test-user-three' },
            displayType: 'share',
            common: { createTime: eventTimestamp }
        };

        try {
            connection.emit(WebcastEvent.CHAT, chatPayload);
            connection.emit(WebcastEvent.GIFT, giftPayload);
            connection.emit(WebcastEvent.SOCIAL, sharePayload);

            await new Promise(setImmediate);

            expect(runtimeCalls.chat).toHaveLength(1);
            expect(runtimeCalls.chat[0].message.message.text).toBe('hello there');
            expect(runtimeCalls.chat[0].message.username).toBe('test-user-one');

            expect(runtimeCalls.gift).toHaveLength(1);
            expect(runtimeCalls.gift[0].payload.giftType).toBe('Rose');
            expect(runtimeCalls.gift[0].payload.giftCount).toBe(2);
            expect(runtimeCalls.gift[0].payload.avatarUrl).toBe('https://example.invalid/tiktok-integration-immediate-avatar.jpg');

            expect(runtimeCalls.share).toHaveLength(1);
            expect(runtimeCalls.share[0].payload.username).toBe('test-user-three');
        } finally {
            router.dispose();
            cleanupTikTokEventListeners(platform);
        }
    });

    test('routes emote-only TikTok chat payloads through platform:event chat path', async () => {
        const eventBus = createEventBus();
        const logger = noOpLogger;
        const runtimeCalls = {
            chat: []
        };
        const runtime = {
            handleChatMessage: (platform, message) => runtimeCalls.chat.push({ platform, message })
        };
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const config = createConfigFixture({
            general: {
                messagesEnabled: true
            },
            tiktok: {
                enabled: true
            },
            obs: { enabled: false }
        });
        const notificationManager = new NotificationManager({
            displayQueue,
            logger,
            eventBus,
            config,
            constants: require('../../src/core/constants'),
            textProcessing,
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });

        const router = new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager,
            config,
            logger
        });

        const connection = new EventEmitter();
        const WebcastEvent = {
            CHAT: 'chat'
        };
        const ControlEvent = {
            DISCONNECTED: 'disconnected',
            ERROR: 'error'
        };

        const platform = new TikTokPlatform(
            {
                enabled: true,
                username: 'test-user',
                giftAggregationEnabled: false
            },
            {
                logger,
                eventBus,
                TikTokWebSocketClient: createMockFn(),
                WebcastEvent,
                ControlEvent,
                connectionFactory: { createConnection: createMockFn() }
            }
        );

        platform.connection = connection;
        setupTikTokEventListeners(platform);

        const eventTimestamp = Date.parse('2025-01-20T12:00:00.000Z');
        const chatPayload = {
            comment: ' ',
            emotes: [
                {
                    placeInComment: 0,
                    emote: {
                        emoteId: '1234512345123451234',
                        image: {
                            imageUrl: 'https://example.invalid/tiktok-emote.webp'
                        }
                    }
                }
            ],
            user: { userId: 'test-user-id-emote', uniqueId: 'test-user-emote', nickname: 'test-user-emote' },
            common: { createTime: eventTimestamp }
        };

        try {
            connection.emit(WebcastEvent.CHAT, chatPayload);

            await new Promise(setImmediate);

            expect(runtimeCalls.chat).toHaveLength(1);
            expect(runtimeCalls.chat[0].message.message).toEqual({
                text: '',
                parts: [
                    {
                        type: 'emote',
                        platform: 'tiktok',
                        emoteId: '1234512345123451234',
                        imageUrl: 'https://example.invalid/tiktok-emote.webp',
                        placeInComment: 0
                    }
                ]
            });
        } finally {
            router.dispose();
            cleanupTikTokEventListeners(platform);
        }
    });

    test('routes only fresh unique chats during mixed replay bursts', async () => {
        useFakeTimers();
        setSystemTime(new Date('2025-01-20T12:05:00.000Z'));

        const eventBus = createEventBus();
        const logger = noOpLogger;
        const runtimeCalls = {
            chat: []
        };
        const runtime = {
            handleChatMessage: (platform, message) => runtimeCalls.chat.push({ platform, message })
        };
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const config = createConfigFixture({
            general: {
                messagesEnabled: true
            },
            tiktok: {
                enabled: true
            },
            obs: { enabled: false }
        });
        const notificationManager = new NotificationManager({
            displayQueue,
            logger,
            eventBus,
            config,
            constants: require('../../src/core/constants'),
            textProcessing,
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });

        const router = new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager,
            config,
            logger
        });

        const connection = new EventEmitter();
        const WebcastEvent = {
            CHAT: 'chat'
        };
        const ControlEvent = {
            DISCONNECTED: 'disconnected',
            ERROR: 'error'
        };

        const platform = new TikTokPlatform(
            {
                enabled: true,
                username: 'test-user',
                giftAggregationEnabled: false
            },
            {
                logger,
                eventBus,
                TikTokWebSocketClient: createMockFn(),
                WebcastEvent,
                ControlEvent,
                connectionFactory: { createConnection: createMockFn() }
            }
        );

        platform.connection = connection;
        setupTikTokEventListeners(platform);

        const eventTimestamp = Date.parse('2025-01-20T12:05:00.000Z');
        const makeChatPayload = (msgId, comment) => ({
            comment,
            user: { userId: 'test-user-id-mixed', uniqueId: 'test-user-mixed', nickname: 'test-user-mixed' },
            common: { createTime: eventTimestamp, msgId }
        });

        try {
            connection.emit(WebcastEvent.CHAT, makeChatPayload('test-chat-msg-a', 'first'));
            connection.emit(WebcastEvent.CHAT, makeChatPayload('test-chat-msg-b', 'second'));
            connection.emit(WebcastEvent.CHAT, makeChatPayload('test-chat-msg-a', 'first-duplicate'));
            connection.emit(WebcastEvent.CHAT, makeChatPayload('test-chat-msg-c', 'third'));
            connection.emit(WebcastEvent.CHAT, makeChatPayload('test-chat-msg-b', 'second-duplicate'));

            await new Promise(setImmediate);

            expect(runtimeCalls.chat).toHaveLength(3);
            expect(runtimeCalls.chat.map((entry) => entry.message.message.text)).toEqual(['first', 'second', 'third']);
        } finally {
            router.dispose();
            cleanupTikTokEventListeners(platform);
            clearAllTimers();
            useRealTimers();
        }
    });

    test('aggregates rapid distinct gift message ids when aggregation is enabled', async () => {
        useFakeTimers();
        setSystemTime(new Date('2025-01-20T12:00:00.000Z'));

        const eventBus = createEventBus();
        const logger = noOpLogger;
        const runtimeCalls = {
            gift: []
        };
        const runtime = {
            handleGiftNotification: (platform, username, payload) => runtimeCalls.gift.push({ platform, username, payload })
        };
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const config = createConfigFixture({
            general: {
                giftsEnabled: true
            },
            tiktok: {
                enabled: true,
                giftAggregationEnabled: true
            },
            obs: { enabled: false }
        });
        const notificationManager = new NotificationManager({
            displayQueue,
            logger,
            eventBus,
            config,
            constants: require('../../src/core/constants'),
            textProcessing,
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });

        const router = new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager,
            config,
            logger
        });

        const connection = new EventEmitter();
        const WebcastEvent = {
            GIFT: 'gift'
        };
        const ControlEvent = {
            DISCONNECTED: 'disconnected',
            ERROR: 'error'
        };

        const platform = new TikTokPlatform(
            {
                enabled: true,
                username: 'test-user',
                giftAggregationEnabled: true
            },
            {
                logger,
                eventBus,
                TikTokWebSocketClient: createMockFn(),
                WebcastEvent,
                ControlEvent,
                connectionFactory: { createConnection: createMockFn() }
            }
        );

        platform.connection = connection;
        setupTikTokEventListeners(platform);

        const baseEventTimestamp = Date.parse('2025-01-20T12:00:00.000Z');
        const buildGiftPayload = (msgId, offsetMs) => ({
            user: {
                userId: 'test-user-id-2',
                uniqueId: 'test-user-2',
                nickname: 'test-user-two',
                profilePicture: {
                    url: ['https://example.invalid/tiktok-integration-aggregated-avatar.jpg']
                }
            },
            repeatCount: 1,
            repeatEnd: 0,
            giftDetails: { giftName: 'Hand Heart', diamondCount: 100, giftType: 2 },
            common: { createTime: baseEventTimestamp + offsetMs, msgId }
        });

        try {
            connection.emit(WebcastEvent.GIFT, buildGiftPayload('test-gift-msg-1', 10));
            connection.emit(WebcastEvent.GIFT, buildGiftPayload('test-gift-msg-2', 20));
            connection.emit(WebcastEvent.GIFT, buildGiftPayload('test-gift-msg-3', 30));
            connection.emit(WebcastEvent.GIFT, buildGiftPayload('test-gift-msg-4', 40));

            await new Promise(setImmediate);
            await advanceTimersByTime(platform.giftAggregationDelay + 500);
            await new Promise(setImmediate);

            expect(runtimeCalls.gift).toHaveLength(1);
            expect(runtimeCalls.gift[0].payload.giftType).toBe('Hand Heart');
            expect(runtimeCalls.gift[0].payload.giftCount).toBe(4);
            expect(runtimeCalls.gift[0].payload.aggregatedCount).toBe(4);
            expect(runtimeCalls.gift[0].payload.isAggregated).toBe(true);
            expect(runtimeCalls.gift[0].payload.avatarUrl).toBe('https://example.invalid/tiktok-integration-aggregated-avatar.jpg');
        } finally {
            router.dispose();
            cleanupTikTokEventListeners(platform);
            clearAllTimers();
            useRealTimers();
        }
    });
});
