import { describe, test, expect } from 'bun:test';
const EventEmitter = require('events');

const PlatformEventRouter = require('../../src/services/PlatformEventRouter');
const ChatNotificationRouter = require('../../src/services/ChatNotificationRouter');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');
const { TwitchPlatform } = require('../../src/platforms/twitch.ts');
const { createConfigFixture } = require('../helpers/config-fixture');
const { createMockDisplayQueue, noOpLogger } = require('../helpers/mock-factories');
const { createTwitchEventSubChatMessageEvent } = require('../helpers/twitch-test-data');

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

describe('Twitch emote chat parts pipeline (smoke E2E)', () => {
    test('routes Twitch EventSub emote chat into display queue with canonical parts', async () => {
        const eventBus = createEventBus();
        const config = createConfigFixture({
            general: {
                messagesEnabled: true,
                logChatMessages: false
            },
            twitch: {
                enabled: true,
                messagesEnabled: true
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

        const platform = new TwitchPlatform(config.twitch, {
            logger: noOpLogger,
            twitchAuth: {
                isReady: () => true,
                refreshTokens: async () => true,
                getUserId: () => 'test-user-id'
            },
            ChatFileLoggingService: class { logRawPlatformData() {} }
        });

        platform.handlers = {
            onChat: (payload) => {
                eventBus.emit('platform:event', {
                    platform: 'twitch',
                    type: PlatformEvents.CHAT_MESSAGE,
                    data: payload
                });
            }
        };

        try {
            await platform.onMessageHandler(createTwitchEventSubChatMessageEvent({
                chatter_user_id: 'test-smoke-user-id',
                chatter_user_name: 'test-smoke-user-name',
                broadcaster_user_id: 'test-smoke-broadcaster-id',
                timestamp: '2024-01-01T00:00:00.000Z'
            }));

            await new Promise(setImmediate);

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('chat');
            expect(queued.platform).toBe('twitch');
            expect(queued.data.message).toEqual({
                text: 'testEmote test message testEmote hello world this is a message to everyone testEmote how are we today?',
                parts: [
                    {
                        type: 'emote',
                        platform: 'twitch',
                        emoteId: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                        imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
                    },
                    {
                        type: 'text',
                        text: ' test message '
                    },
                    {
                        type: 'emote',
                        platform: 'twitch',
                        emoteId: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                        imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
                    },
                    {
                        type: 'text',
                        text: ' hello world this is a message to everyone '
                    },
                    {
                        type: 'emote',
                        platform: 'twitch',
                        emoteId: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                        imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
                    },
                    {
                        type: 'text',
                        text: ' how are we today?'
                    }
                ]
            });
        } finally {
            platformEventRouter.dispose();
            await platform.cleanup();
        }
    });
});
