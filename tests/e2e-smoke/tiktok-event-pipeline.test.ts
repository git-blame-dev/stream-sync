import { describe, test, afterEach, expect } from 'bun:test';
import { createRequire } from 'node:module';

const load = createRequire(__filename);
const EventEmitter = load('events');
const NotificationManager = load('../../src/notifications/NotificationManager');
const { PlatformEventRouter } = load('../../src/services/PlatformEventRouter.ts');
const { TikTokPlatform } = load('../../src/platforms/tiktok.ts');
const { createTextProcessingManager } = load('../../src/utils/text-processing');
const { createConfigFixture } = load('../helpers/config-fixture');
const { createMockDisplayQueue, noOpLogger } = load('../helpers/mock-factories');
const { createMockFn, restoreAllMocks } = load('../helpers/bun-mock-utils');
const {
    useFakeTimers,
    useRealTimers,
    setSystemTime,
    advanceTimersByTime,
    clearAllTimers
} = load('../helpers/bun-timers');
const { setupTikTokEventListeners, cleanupTikTokEventListeners } = load('../../src/platforms/tiktok/events/event-router.ts');
const { expectNoTechnicalArtifacts } = load('../helpers/assertion-helpers');
const coreConstants = load('../../src/core/constants');

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

const assertNonEmptyString = (value) => {
    expect(typeof value).toBe('string');
    expect(value.trim()).not.toBe('');
};

type ChatRuntimeCall = {
    platform: string;
    message: {
        message: {
            text: string;
            parts?: unknown[];
        };
        username: string;
    };
};

describe('TikTok event pipeline (smoke E2E)', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    test('routes chat and gift into user-facing notifications', async () => {
        const eventBus = createEventBus();
        const logger = noOpLogger;
        const displayQueue = createMockDisplayQueue();
        const textProcessing = createTextProcessingManager({ logger });
        const config = createConfigFixture({
            general: {
                messagesEnabled: true,
                giftsEnabled: true
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
            constants: coreConstants,
            textProcessing,
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });
        const runtimeCalls: { chat: ChatRuntimeCall[] } = { chat: [] };
        const runtime = {
            handleChatMessage: (platform, message) => runtimeCalls.chat.push({ platform, message }),
            handleGiftNotification: async (platform, username, payload) =>
                notificationManager.handleNotification(payload.type, platform, payload)
        };

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
            comment: 'hello from tiktok',
            user: { userId: 'test-user-id-1', uniqueId: 'test-user-1', nickname: 'test-user-one' },
            common: { createTime: eventTimestamp }
        };
        const giftPayload = {
            user: {
                userId: 'test-user-id-2',
                uniqueId: 'test-user-2',
                nickname: 'test-user-two',
                profilePictureUrl: 'https://example.invalid/tiktok-smoke-immediate-avatar.jpg'
            },
            repeatCount: 1,
            repeatEnd: true,
            giftDetails: { giftName: 'Rose', diamondCount: 1, giftType: 0 },
            common: { createTime: eventTimestamp, msgId: 'test-gift-msg-1' }
        };

        try {
            connection.emit(WebcastEvent.CHAT, chatPayload);
            connection.emit(WebcastEvent.GIFT, giftPayload);

            await new Promise(setImmediate);

            expect(runtimeCalls.chat).toHaveLength(1);
            const firstChatCall = runtimeCalls.chat[0]!;
            expect(firstChatCall.message.message.text).toBe('hello from tiktok');
            expect(firstChatCall.message.username).toBe('test-user-one');

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            assertNonEmptyString(queued.data.displayMessage);
            assertNonEmptyString(queued.data.ttsMessage);
            assertNonEmptyString(queued.data.logMessage);
            expectNoTechnicalArtifacts(queued.data.displayMessage);
            expectNoTechnicalArtifacts(queued.data.ttsMessage);
            expectNoTechnicalArtifacts(queued.data.logMessage);
            expect(queued.data.username).toBe('test-user-two');
            expect(queued.data.giftType).toBe('Rose');
            expect(queued.data.avatarUrl).toBe('https://example.invalid/tiktok-smoke-immediate-avatar.jpg');
        } finally {
            router.dispose();
            cleanupTikTokEventListeners(platform);
        }
    });

    test('routes emote-only TikTok chat into runtime chat handling', async () => {
        const eventBus = createEventBus();
        const logger = noOpLogger;
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
            constants: coreConstants,
            textProcessing,
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });
        const runtimeCalls: { chat: ChatRuntimeCall[] } = { chat: [] };
        const runtime = {
            handleChatMessage: (platform, message) => runtimeCalls.chat.push({ platform, message })
        };

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
            user: { userId: 'test-user-id-emote-smoke', uniqueId: 'test-user-emote-smoke', nickname: 'test-user-emote-smoke' },
            common: { createTime: eventTimestamp }
        };

        try {
            connection.emit(WebcastEvent.CHAT, chatPayload);

            await new Promise(setImmediate);

            expect(runtimeCalls.chat).toHaveLength(1);
            const firstChatCall = runtimeCalls.chat[0]!;
            expect(firstChatCall.message.message).toEqual({
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

    test('suppresses duplicate replay chats while allowing fresh chats', async () => {
        useFakeTimers();
        setSystemTime(new Date('2025-01-20T12:05:00.000Z'));

        const eventBus = createEventBus();
        const logger = noOpLogger;
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
            constants: coreConstants,
            textProcessing,
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });
        const runtimeCalls: { chat: ChatRuntimeCall[] } = { chat: [] };
        const runtime = {
            handleChatMessage: (platform, message) => runtimeCalls.chat.push({ platform, message })
        };

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
            user: { userId: 'test-user-id-smoke', uniqueId: 'test-user-smoke', nickname: 'test-user-smoke' },
            common: { createTime: eventTimestamp, msgId }
        });

        try {
            connection.emit(WebcastEvent.CHAT, makeChatPayload('test-chat-msg-smoke-1', 'hello once'));
            connection.emit(WebcastEvent.CHAT, makeChatPayload('test-chat-msg-smoke-1', 'hello duplicate'));
            connection.emit(WebcastEvent.CHAT, makeChatPayload('test-chat-msg-smoke-2', 'hello twice'));

            await new Promise(setImmediate);

            expect(runtimeCalls.chat).toHaveLength(2);
            expect(runtimeCalls.chat.map((entry) => entry.message.message.text)).toEqual(['hello once', 'hello twice']);
        } finally {
            router.dispose();
            cleanupTikTokEventListeners(platform);
            clearAllTimers();
            useRealTimers();
        }
    });

    test('produces one aggregated user-facing gift notification for rapid burst', async () => {
        useFakeTimers();
        setSystemTime(new Date('2025-01-20T12:00:00.000Z'));

        const eventBus = createEventBus();
        const logger = noOpLogger;
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
            constants: coreConstants,
            textProcessing,
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });
        const runtime = {
            handleGiftNotification: async (platform, username, payload) =>
                notificationManager.handleNotification(payload.type, platform, payload)
        };

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
                    url: ['https://example.invalid/tiktok-smoke-aggregated-avatar.jpg']
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

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('platform:gift');
            expect(queued.data.giftType).toBe('Hand Heart');
            expect(queued.data.giftCount).toBe(4);
            expect(queued.data.aggregatedCount).toBe(4);
            assertNonEmptyString(queued.data.displayMessage);
            assertNonEmptyString(queued.data.ttsMessage);
            assertNonEmptyString(queued.data.logMessage);
            expectNoTechnicalArtifacts(queued.data.displayMessage);
            expectNoTechnicalArtifacts(queued.data.ttsMessage);
            expectNoTechnicalArtifacts(queued.data.logMessage);
            expect(queued.data.avatarUrl).toBe('https://example.invalid/tiktok-smoke-aggregated-avatar.jpg');
        } finally {
            router.dispose();
            cleanupTikTokEventListeners(platform);
            clearAllTimers();
            useRealTimers();
        }
    });
});
