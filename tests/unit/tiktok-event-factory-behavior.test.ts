import { afterEach, describe, expect, it } from 'bun:test';
import { createRequire } from 'node:module';

import { createMockFn, restoreAllMocks } from '../helpers/bun-mock-utils';

const nodeRequire = createRequire(import.meta.url);

type LoggerLike = {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};

const { noOpLogger } = nodeRequire('../helpers/mock-factories') as {
    noOpLogger: LoggerLike;
};
const logging = nodeRequire('../../src/core/logging') as {
    initializeLoggingConfig: (config: Record<string, unknown>) => void;
};
logging.initializeLoggingConfig({ logging: { console: { enabled: false }, file: { enabled: false } } });

type TikTokChatEvent = {
    type: string;
    platform: string;
    userId: string;
    username: string;
    message: Record<string, unknown>;
    metadata: {
        platform: string;
        correlationId: string;
    };
    timestamp: string;
    badgeImages?: Array<{
        imageUrl: string;
        source: string;
        label: string;
    }>;
};

const { TikTokPlatform } = nodeRequire('../../src/platforms/tiktok') as {
    TikTokPlatform: new (
        config: Record<string, unknown>,
        deps: Record<string, unknown>
    ) => { eventFactory: { createChatMessage: (payload: Record<string, unknown>) => TikTokChatEvent } };
};
const testClock = nodeRequire('../helpers/test-clock') as {
    now: () => number;
};

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

    it('extracts and forwards canonical badgeImages from raw TikTok chat payload', () => {
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
            comment: 'test chat message',
            user: {
                userId: 'test-user-id-1',
                uniqueId: 'test-user-unique-id-1',
                nickname: 'test-user-display-name',
                badges: [
                    {
                        text: { defaultPattern: 'Level 22' },
                        combine: {
                            icon: {
                                url: [
                                    'https://example.invalid/level-22-p16.png',
                                    'https://example.invalid/level-22-p19.png'
                                ]
                            }
                        }
                    },
                    {
                        text: { defaultPattern: 'Fans Level 36' },
                        combine: {
                            icon: {
                                url: [
                                    'https://example.invalid/fans-36-p16.png',
                                    'https://example.invalid/fans-36-p19.png'
                                ]
                            }
                        }
                    },
                    {
                        text: { defaultPattern: 'Moderator' },
                        combine: {
                            icon: {
                                url: [
                                    'https://example.invalid/moderator-p16.png',
                                    'https://example.invalid/moderator-p19.png'
                                ]
                            }
                        }
                    }
                ]
            },
            common: { createTime: testClock.now() }
        };

        const event = platform.eventFactory.createChatMessage(rawChat);

        expect(event.badgeImages).toEqual([
            {
                imageUrl: 'https://example.invalid/level-22-p16.png',
                source: 'tiktok',
                label: 'Level 22'
            },
            {
                imageUrl: 'https://example.invalid/fans-36-p16.png',
                source: 'tiktok',
                label: 'Fans Level 36'
            },
            {
                imageUrl: 'https://example.invalid/moderator-p16.png',
                source: 'tiktok',
                label: 'Moderator'
            }
        ]);
    });
});
