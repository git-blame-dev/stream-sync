const { describe, test, expect } = require('bun:test');
const EventEmitter = require('events');

const PlatformEventRouter = require('../../src/services/PlatformEventRouter.ts');
const ChatNotificationRouter = require('../../src/services/ChatNotificationRouter.ts');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');
const { createConfigFixture } = require('../helpers/config-fixture');
const { createMockDisplayQueue, noOpLogger } = require('../helpers/mock-factories');

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

describe('YouTube emote chat parts pipeline (integration)', () => {
    test('preserves canonical message.parts from router to display queue', async () => {
        const eventBus = createEventBus();
        const config = createConfigFixture({
            general: {
                messagesEnabled: true,
                logChatMessages: false
            },
            youtube: {
                enabled: true,
                messagesEnabled: true
            },
            obs: { enabled: false }
        });
        const displayQueue = createMockDisplayQueue();
        const runtime = {
            config,
            displayQueue,
            handleChatMessage: async () => {}
        };
        const chatRouter = new ChatNotificationRouter({
            runtime,
            logger: noOpLogger,
            config
        });

        runtime.handleChatMessage = (platform, normalizedData) => chatRouter.handleChatMessage(platform, normalizedData);

        const platformEventRouter = new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager: { handleNotification: async () => {} },
            config,
            logger: noOpLogger
        });

        try {
            eventBus.emit('platform:event', {
                platform: 'youtube',
                type: PlatformEvents.CHAT_MESSAGE,
                data: {
                    username: 'test-youtube-user',
                    userId: 'UC_TEST_CHANNEL_700000',
                    avatarUrl: 'https://yt3.ggpht.example.invalid/test-youtube-user=w48-h48-c-k-nd',
                    message: {
                        text: '',
                        parts: [
                            {
                                type: 'emote',
                                platform: 'youtube',
                                emoteId: 'UC_TEST_EMOTE_700/TEST_EMOTE_700',
                                imageUrl: 'https://yt3.ggpht.example.invalid/test-youtube-emote-700=w48-h48-c-k-nd'
                            }
                        ]
                    },
                    timestamp: '2024-01-01T00:00:00.000Z',
                    isMod: false,
                    isPaypiggy: false,
                    isBroadcaster: false,
                    metadata: {}
                }
            });

            await new Promise(setImmediate);

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('chat');
            expect(queued.platform).toBe('youtube');
            expect(queued.data.message).toEqual({
                text: '',
                parts: [
                    {
                        type: 'emote',
                        platform: 'youtube',
                        emoteId: 'UC_TEST_EMOTE_700/TEST_EMOTE_700',
                        imageUrl: 'https://yt3.ggpht.example.invalid/test-youtube-emote-700=w48-h48-c-k-nd'
                    }
                ]
            });
        } finally {
            platformEventRouter.dispose();
        }
    });

    test('preserves non-custom emoji glyph text without emitting emote parts', async () => {
        const eventBus = createEventBus();
        const config = createConfigFixture({
            general: {
                messagesEnabled: true,
                logChatMessages: false
            },
            youtube: {
                enabled: true,
                messagesEnabled: true
            },
            obs: { enabled: false }
        });
        const displayQueue = createMockDisplayQueue();
        const runtime = {
            config,
            displayQueue,
            handleChatMessage: async () => {}
        };
        const chatRouter = new ChatNotificationRouter({
            runtime,
            logger: noOpLogger,
            config
        });

        runtime.handleChatMessage = (platform, normalizedData) => chatRouter.handleChatMessage(platform, normalizedData);

        const platformEventRouter = new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager: { handleNotification: async () => {} },
            config,
            logger: noOpLogger
        });

        try {
            eventBus.emit('platform:event', {
                platform: 'youtube',
                type: PlatformEvents.CHAT_MESSAGE,
                data: {
                    username: 'test-youtube-unicode-user',
                    userId: 'UC_TEST_CHANNEL_700001',
                    avatarUrl: 'https://yt3.ggpht.example.invalid/test-youtube-unicode-user=w48-h48-c-k-nd',
                    message: {
                        text: 'hi how are you 🙏goodbye 💔'
                    },
                    timestamp: '2024-01-01T00:00:00.000Z',
                    isMod: false,
                    isPaypiggy: false,
                    isBroadcaster: false,
                    metadata: {}
                }
            });

            await new Promise(setImmediate);

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('chat');
            expect(queued.platform).toBe('youtube');
            expect(queued.data.message).toEqual({
                text: 'hi how are you 🙏goodbye 💔'
            });
        } finally {
            platformEventRouter.dispose();
        }
    });
});
