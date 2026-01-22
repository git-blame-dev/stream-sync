const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const logging = require('../../src/core/logging');
logging.setConfigValidator(() => ({ logging: {} }));

const { TikTokPlatform } = require('../../src/platforms/tiktok');
const testClock = require('../helpers/test-clock');

describe('TikTok eventFactory chat message behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('builds a normalized chat event from raw TikTok data', () => {
        const connectionFactory = {
            createConnection: () => ({
                connect: createMockFn(),
                on: createMockFn(),
                emit: createMockFn(),
                removeAllListeners: createMockFn()
            })
        };
        const platform = new TikTokPlatform(
            { enabled: false },
            {
                WebcastEvent: {},
                ControlEvent: {},
                logger: noOpLogger,
                connectionFactory,
                timestampService: {
                    extractTimestamp: createMockFn(() => new Date(testClock.now()).toISOString())
                }
            }
        );

        const rawChat = {
            comment: 'hi there',
            user: {
                userId: 'tt-user-1',
                uniqueId: 'user123',
                nickname: 'StreamerFan'
            },
            common: { createTime: testClock.now() }
        };

        const event = platform.eventFactory.createChatMessage(rawChat);

        expect(event.type).toBe('platform:chat-message');
        expect(event.platform).toBe('tiktok');
        expect(event.userId).toBe('tt-user-1');
        expect(event.username).toBe('user123');
        expect(event.message).toEqual({ text: 'hi there' });
        expect(event.metadata.platform).toBe('tiktok');
        expect(event.metadata.correlationId).toBeDefined();
        expect(event.timestamp).toBeDefined();
    });
});
