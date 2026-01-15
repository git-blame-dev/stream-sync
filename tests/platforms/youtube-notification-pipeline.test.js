
const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { YouTubePlatform } = require('../../src/platforms/youtube');
const { createYouTubeSuperChatEvent } = require('../helpers/youtube-test-data');
const { createMockPlatformDependencies, createMockConfig } = require('../helpers/test-setup');

describe('YouTube monetized notification pipeline', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const baseConfig = createMockConfig('youtube', {
        enabled: true,
        username: 'notification-test',
        apiKey: 'notification-key'
    });

    const createPlatform = () => new YouTubePlatform(baseConfig, {
        ...createMockPlatformDependencies('youtube'),
        streamDetectionService: {
            detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
        }
    });

    test('emits a single gift event for SuperChats through the unified pipeline', async () => {
        const youtubePlatform = createPlatform();
        const giftEvents = [];
        youtubePlatform.handlers = {
            ...youtubePlatform.handlers,
            onGift: (event) => giftEvents.push(event)
        };

        const superChat = createYouTubeSuperChatEvent(10, 'USD', {
            item: {
                author: {
                    id: 'youtube-user-1',
                    name: 'SuperChatUser'
                },
                message: {
                    runs: [{ text: 'Thanks for the amazing content! Keep it up!' }]
                }
            }
        });

        await youtubePlatform.handleChatMessage(superChat);
        await new Promise((resolve) => setImmediate(resolve));

        expect(giftEvents).toHaveLength(1);
        expect(giftEvents[0]).toMatchObject({
            platform: 'youtube',
            type: 'platform:gift',
            username: 'SuperChatUser',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 10,
            currency: 'USD'
        });
        expect(giftEvents[0].message).toBe('Thanks for the amazing content! Keep it up!');
        expect(giftEvents[0].userId).toBeTruthy();
        expect(giftEvents[0].id).toBeTruthy();
    });

});
