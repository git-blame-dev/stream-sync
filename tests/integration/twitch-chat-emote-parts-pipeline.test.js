const { describe, test, expect } = require('bun:test');
const EventEmitter = require('events');

const PlatformEventRouter = require('../../src/services/PlatformEventRouter');
const ChatNotificationRouter = require('../../src/services/ChatNotificationRouter');
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

describe('Twitch emote chat parts pipeline (integration)', () => {
    test('preserves canonical message.parts from router to display queue', async () => {
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
                platform: 'twitch',
                type: PlatformEvents.CHAT_MESSAGE,
                data: {
                    username: 'test-chat-user-name',
                    userId: 'test-chat-user-id',
                    avatarUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0',
                    message: {
                        text: '',
                        parts: [
                            {
                                type: 'emote',
                                platform: 'twitch',
                                emoteId: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                                imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
                            }
                        ]
                    },
                    timestamp: '2024-01-01T00:00:00.000Z',
                    isMod: false,
                    isSubscriber: false,
                    isBroadcaster: false,
                    metadata: {}
                }
            });

            await new Promise(setImmediate);

            expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
            const queued = displayQueue.addItem.mock.calls[0][0];
            expect(queued.type).toBe('chat');
            expect(queued.platform).toBe('twitch');
            expect(queued.data.message).toBe('');
            expect(queued.data.messageParts).toEqual([
                {
                    type: 'emote',
                    platform: 'twitch',
                    emoteId: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                    imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
                }
            ]);
        } finally {
            platformEventRouter.dispose();
        }
    });
});
