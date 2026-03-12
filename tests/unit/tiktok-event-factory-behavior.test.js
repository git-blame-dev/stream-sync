const { describe, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const logging = require('../../src/core/logging');
logging.initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: false } } });

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
        expect(event.userId).toBe('user123');
        expect(event.username).toBe('StreamerFan');
        expect(event.message).toEqual({ text: 'hi there' });
        expect(event.metadata.platform).toBe('tiktok');
        expect(event.metadata.correlationId).toBeDefined();
        expect(event.timestamp).toBeDefined();
    });

    it('builds emote-only chat events with canonical message.parts', () => {
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
            user: {
                userId: 'tt-user-2',
                uniqueId: 'user234',
                nickname: 'EmoteFan'
            },
            common: { createTime: testClock.now() }
        };

        const event = platform.eventFactory.createChatMessage(rawChat);

        expect(event.message).toEqual({
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
    });
});
