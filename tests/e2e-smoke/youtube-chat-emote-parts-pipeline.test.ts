import { describe, test, expect } from 'bun:test';
const EventEmitter = require('events');

const PlatformEventRouter = require('../../src/services/PlatformEventRouter');
const ChatNotificationRouter = require('../../src/services/ChatNotificationRouter');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');
const { YouTubePlatform } = require('../../src/platforms/youtube');
const { createConfigFixture } = require('../helpers/config-fixture');
const { createMockDisplayQueue, noOpLogger } = require('../helpers/mock-factories');
const { createMockFn } = require('../helpers/bun-mock-utils');
const { createYouTubeRunsMessageChatItem } = require('../helpers/youtube-test-data');

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

describe('YouTube emote chat parts pipeline (smoke E2E)', () => {
    test('routes YouTube runs emoji chat into display queue with canonical parts', async () => {
        const eventBus = createEventBus();
        const config = createConfigFixture({
            general: {
                messagesEnabled: true,
                logChatMessages: false
            },
            youtube: {
                enabled: true,
                messagesEnabled: true,
                username: 'test-channel'
            },
            obs: { enabled: false }
        });
        const displayQueue = createMockDisplayQueue();
        const runtime = {
            config,
            displayQueue,
            handleChatMessage: async (_platform, _normalizedData) => {}
        };
        const chatRouter = new ChatNotificationRouter({ runtime, logger: noOpLogger, config });
        runtime.handleChatMessage = (platform, normalizedData) => chatRouter.handleChatMessage(platform, normalizedData);

        const platformEventRouter = new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager: { handleNotification: async () => {} },
            config,
            logger: noOpLogger
        });

        const platform = new YouTubePlatform(config.youtube, {
            logger: noOpLogger,
            streamDetectionService: {
                detectLiveStreams: createMockFn().mockResolvedValue({
                    success: true,
                    videoIds: [],
                    detectionMethod: 'test'
                })
            },
            notificationManager: {
                emit: createMockFn(),
                on: createMockFn(),
                removeListener: createMockFn()
            },
            ChatFileLoggingService: class { logRawPlatformData() {} },
            USER_AGENTS: ['test-agent']
        });

        platform.handlers = {
            onChat: (payload) => {
                eventBus.emit('platform:event', {
                    platform: 'youtube',
                    type: PlatformEvents.CHAT_MESSAGE,
                    data: payload
                });
            }
        };

        try {
            platform.handleChatTextMessage(createYouTubeRunsMessageChatItem({
                item: {
                    author: {
                        id: 'UC_TEST_CHANNEL_800001',
                        name: 'test-smoke-youtube-user'
                    },
                    message: {
                        text: 'UC_TEST_EMOTE_800/TEST_EMOTE_800',
                        runs: [
                            {
                                text: 'UC_TEST_EMOTE_800/TEST_EMOTE_800',
                                emoji: {
                                    emoji_id: 'UC_TEST_EMOTE_800/TEST_EMOTE_800',
                                    is_custom: true,
                                    shortcuts: [':testEightHundred:'],
                                    image: [
                                        {
                                            url: 'https://yt3.ggpht.example.invalid/test-youtube-emote-800=w48-h48-c-k-nd',
                                            width: 48,
                                            height: 48
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                },
                videoId: 'test-smoke-video-id'
            }));

            await new Promise(setImmediate);

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('chat');
            expect(queued.platform).toBe('youtube');
            expect(queued.data.message).toEqual({
                text: ':testEightHundred:',
                parts: [
                    {
                        type: 'emote',
                        platform: 'youtube',
                        emoteId: 'UC_TEST_EMOTE_800/TEST_EMOTE_800',
                        imageUrl: 'https://yt3.ggpht.example.invalid/test-youtube-emote-800=w48-h48-c-k-nd'
                    }
                ]
            });
        } finally {
            platformEventRouter.dispose();
            await platform.cleanup();
        }
    });

    test('routes YouTube non-custom emoji runs into glyph text for display queue', async () => {
        const eventBus = createEventBus();
        const config = createConfigFixture({
            general: {
                messagesEnabled: true,
                logChatMessages: false
            },
            youtube: {
                enabled: true,
                messagesEnabled: true,
                username: 'test-channel'
            },
            obs: { enabled: false }
        });
        const displayQueue = createMockDisplayQueue();
        const runtime = {
            config,
            displayQueue,
            handleChatMessage: async (_platform, _normalizedData) => {}
        };
        const chatRouter = new ChatNotificationRouter({ runtime, logger: noOpLogger, config });
        runtime.handleChatMessage = (platform, normalizedData) => chatRouter.handleChatMessage(platform, normalizedData);

        const platformEventRouter = new PlatformEventRouter({
            eventBus,
            runtime,
            notificationManager: { handleNotification: async () => {} },
            config,
            logger: noOpLogger
        });

        const platform = new YouTubePlatform(config.youtube, {
            logger: noOpLogger,
            streamDetectionService: {
                detectLiveStreams: createMockFn().mockResolvedValue({
                    success: true,
                    videoIds: [],
                    detectionMethod: 'test'
                })
            },
            notificationManager: {
                emit: createMockFn(),
                on: createMockFn(),
                removeListener: createMockFn()
            },
            ChatFileLoggingService: class { logRawPlatformData() {} },
            USER_AGENTS: ['test-agent']
        });

        platform.handlers = {
            onChat: (payload) => {
                eventBus.emit('platform:event', {
                    platform: 'youtube',
                    type: PlatformEvents.CHAT_MESSAGE,
                    data: payload
                });
            }
        };

        try {
            platform.handleChatTextMessage(createYouTubeRunsMessageChatItem({
                item: {
                    author: {
                        id: 'UC_TEST_CHANNEL_800002',
                        name: 'test-smoke-youtube-unicode-user'
                    },
                    message: {
                        runs: [
                            { text: 'hi how are you ' },
                            {
                                emoji: {
                                    emoji_id: 'U+1F64F',
                                    is_custom: false,
                                    shortcuts: [':folded_hands:'],
                                    image: [
                                        {
                                            url: 'https://yt3.ggpht.example.invalid/test-youtube-unicode-folded-hands=w48-h48-c-k-nd',
                                            width: 48,
                                            height: 48
                                        }
                                    ]
                                }
                            },
                            { text: 'goodbye ' },
                            {
                                emoji: {
                                    emoji_id: 'U+1F494',
                                    is_custom: false,
                                    shortcuts: [':broken_heart:'],
                                    image: [
                                        {
                                            url: 'https://yt3.ggpht.example.invalid/test-youtube-unicode-broken-heart=w48-h48-c-k-nd',
                                            width: 48,
                                            height: 48
                                        }
                                    ]
                                }
                            }
                        ]
                    }
                },
                videoId: 'test-smoke-video-id-unicode'
            }));

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
            await platform.cleanup();
        }
    });
});
