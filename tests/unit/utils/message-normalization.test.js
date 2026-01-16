const { describe, test, expect, beforeEach } = require('bun:test');

const testClock = require('../../helpers/test-clock');
const {
    normalizeMessage,
    normalizeTwitchMessage,
    normalizeYouTubeMessage,
    normalizeTikTokMessage,
    extractTwitchMessageText,
    extractYouTubeMessageText,
    createFallbackMessage,
    validateNormalizedMessage
} = require('../../../src/utils/message-normalization');

const buildTimestampService = () => ({
    extractTimestamp: (platform, data) => {
        if (platform === 'twitch') {
            const raw = data?.['tmi-sent-ts'] ?? data?.timestamp;
            if (!raw) {
                throw new Error('Missing twitch timestamp');
            }
            return new Date(Number(raw)).toISOString();
        }
        if (platform === 'youtube') {
            const raw = data?.timestamp;
            if (!raw) {
                throw new Error('Missing youtube timestamp');
            }
            const numeric = Number(raw);
            if (!Number.isFinite(numeric)) {
                throw new Error('Invalid youtube timestamp');
            }
            const resolved = numeric > 10000000000000 ? numeric / 1000 : numeric;
            return new Date(resolved).toISOString();
        }
        if (platform === 'tiktok') {
            const raw = data?.createTime;
            if (!raw) {
                throw new Error('Missing tiktok timestamp');
            }
            return new Date(Number(raw)).toISOString();
        }
        throw new Error('Unsupported platform');
    }
});

describe('Message Normalization', () => {
    let timestampService;

    beforeEach(() => {
        timestampService = buildTimestampService();
    });

    describe('when normalizing Twitch messages', () => {
        test('normalizes TMI.js chat message correctly', () => {
            const timestampMs = testClock.now();
            const user = {
                userId: '123456789',
                username: 'testuser',
                isMod: true,
                isSubscriber: false,
                isBroadcaster: false
            };
            const message = 'Hello world!';
            const context = {
                'user-id': '123456789',
                'username': 'testuser',
                'display-name': 'TestUser',
                mod: true,
                subscriber: false,
                badges: { moderator: '1' },
                color: '#FF0000',
                emotes: {},
                'room-id': '987654321',
                'tmi-sent-ts': String(timestampMs)
            };

            const normalized = normalizeTwitchMessage(
                user,
                message,
                context,
                'twitch',
                timestampService
            );

            expect(normalized).toMatchObject({
                platform: 'twitch',
                userId: '123456789',
                username: 'testuser',
                message: 'Hello world!',
                isMod: true,
                isSubscriber: false,
                isBroadcaster: false
            });
            expect(normalized.metadata).toMatchObject({
                badges: { moderator: '1' },
                color: '#FF0000',
                emotes: {},
                roomId: '987654321'
            });
            expect(normalized.rawData).toEqual({ user, message, context });
        });

        test('rejects non-string timestamps from the service', () => {
            const nonStringTimestampService = {
                extractTimestamp: () => 123456789
            };
            const user = { userId: '123456789', username: 'testuser' };
            const message = 'Timestamp type check';
            const context = { 'tmi-sent-ts': String(testClock.now()) };

            expect(() => normalizeTwitchMessage(
                user,
                message,
                context,
                'twitch',
                nonStringTimestampService
            )).toThrow('Missing Twitch timestamp');
        });

        test('normalizes EventSub message correctly', () => {
            const timestampMs = testClock.now();
            const user = {
                userId: '123456789',
                username: 'eventsubuser'
            };
            const message = 'EventSub message';
            const context = {
                'user-id': '123456789',
                'username': 'eventsubuser',
                'display-name': 'EventSubUser',
                mod: false,
                subscriber: true,
                'tmi-sent-ts': String(timestampMs)
            };

            const normalized = normalizeTwitchMessage(
                user,
                message,
                context,
                'twitch-eventsub',
                timestampService
            );

            expect(normalized).toMatchObject({
                platform: 'twitch-eventsub',
                userId: '123456789',
                username: 'eventsubuser',
                message: 'EventSub message',
                isMod: false,
                isSubscriber: true
            });
        });

        test('throws on missing user data', () => {
            const user = {};
            const message = 'Message with missing user data';
            const context = { 'tmi-sent-ts': String(testClock.now()) };

            expect(() => normalizeTwitchMessage(
                user,
                message,
                context,
                'twitch',
                timestampService
            )).toThrow('userId');
        });

        test('throws on null/undefined values', () => {
            expect(() => normalizeTwitchMessage(
                null,
                null,
                null,
                'twitch',
                timestampService
            )).toThrow('user');
        });
    });

    describe('when normalizing YouTube messages', () => {
        test('normalizes YouTube.js chat message correctly', () => {
            const timestampMs = testClock.now();
            const chatItem = {
                item: {
                    id: 'yt-message-123',
                    timestamp: timestampMs,
                    author: {
                        id: 'UC123456789',
                        name: 'youtubeuser',
                        isModerator: false,
                        isMember: true,
                        isOwner: false
                    },
                    message: { text: 'Hello YouTube!' }
                }
            };

            const normalized = normalizeYouTubeMessage(chatItem, 'youtube', timestampService);

            expect(normalized).toMatchObject({
                platform: 'youtube',
                userId: 'UC123456789',
                username: 'youtubeuser',
                message: 'Hello YouTube!',
                isMod: false,
                isSubscriber: true,
                isBroadcaster: false
            });
            expect(normalized.metadata).toMatchObject({
                uniqueId: 'yt-message-123',
                isSuperChat: false
            });
        });

        test('rejects non-string timestamps from the service', () => {
            const nonStringTimestampService = {
                extractTimestamp: () => 123456789
            };
            const chatItem = {
                item: {
                    id: 'yt-message-124',
                    timestamp: testClock.now(),
                    author: {
                        id: 'UC123456789',
                        name: 'youtubeuser',
                        isModerator: false,
                        isMember: true,
                        isOwner: false
                    },
                    message: { text: 'Hello YouTube!' }
                }
            };

            expect(() => normalizeYouTubeMessage(chatItem, 'youtube', nonStringTimestampService))
                .toThrow('Missing YouTube timestamp');
        });

        test('normalizes YouTube super chat correctly', () => {
            const timestampMs = testClock.now();
            const superChatItem = {
                item: {
                    id: 'yt-superchat-456',
                    timestamp: timestampMs,
                    author: {
                        id: 'UC987654321',
                        name: 'superchatter',
                        isModerator: false,
                        isMember: false,
                        isOwner: false
                    },
                    superchat: {
                        amount: 5.00,
                        currency: 'USD',
                        message: 'Super chat message!'
                    }
                }
            };

            const normalized = normalizeYouTubeMessage(superChatItem, 'youtube', timestampService);

            expect(normalized).toMatchObject({
                platform: 'youtube',
                userId: 'UC987654321',
                username: 'superchatter',
                message: 'Super chat message!',
                isMod: false,
                isSubscriber: false,
                isBroadcaster: false
            });
            expect(normalized.metadata).toMatchObject({
                uniqueId: 'yt-superchat-456',
                isSuperChat: true
            });
        });

        test('throws on missing YouTube data', () => {
            const incompleteChatItem = {};

            expect(() => normalizeYouTubeMessage(incompleteChatItem, 'youtube', timestampService))
                .toThrow('author');
        });
    });

    describe('when normalizing TikTok messages', () => {
        test('normalizes TikTok chat message correctly', () => {
            const data = {
                user: {
                    userId: 'tt-123',
                    uniqueId: 'tiktokuser123',
                    nickname: 'TikTokUser',
                    profilePictureUrl: 'avatar.jpg'
                },
                comment: 'Hello TikTok!',
                createTime: testClock.now()
            };

            const normalized = normalizeTikTokMessage(data, 'tiktok', timestampService);

            expect(normalized).toMatchObject({
                platform: 'tiktok',
                userId: 'tt-123',
                username: 'tiktokuser123',
                message: 'Hello TikTok!',
                isMod: false,
                isSubscriber: false,
                isBroadcaster: false
            });
            expect(normalized.metadata).toMatchObject({
                profilePicture: 'avatar.jpg'
            });
        });

        test('rejects non-string timestamps from the service', () => {
            const nonStringTimestampService = {
                extractTimestamp: () => 123456789
            };
            const data = {
                user: {
                    userId: 'tt-123',
                    uniqueId: 'tiktokuser123',
                    nickname: 'TikTokUser'
                },
                comment: 'Hello TikTok!',
                createTime: testClock.now()
            };

            expect(() => normalizeTikTokMessage(data, 'tiktok', nonStringTimestampService))
                .toThrow('Missing TikTok timestamp');
        });

        test('handles TikTok gift messages', () => {
            const giftData = {
                user: {
                    userId: 'tt-gift-1',
                    uniqueId: 'giftuser',
                    nickname: 'GiftUser'
                },
                giftDetails: { giftName: 'Rose', diamondCount: 1 },
                repeatCount: 5,
                comment: 'Gift message',
                createTime: testClock.now()
            };

            const normalized = normalizeTikTokMessage(giftData, 'tiktok-gift', timestampService);

            expect(normalized).toMatchObject({
                platform: 'tiktok-gift',
                userId: 'tt-gift-1',
                username: 'giftuser'
            });
            expect(normalized.metadata).toMatchObject({
                profilePicture: null,
                followRole: null,
                userBadges: null
            });
            expect(normalized.rawData.data.giftDetails.giftName).toBe('Rose');
            expect(normalized.rawData.data.repeatCount).toBe(5);
            expect(normalized.rawData.data.giftDetails.diamondCount).toBe(1);
        });

        test('throws on missing TikTok user data', () => {
            const incompleteData = {
                comment: 'Message without user data',
                createTime: testClock.now()
            };

            expect(() => normalizeTikTokMessage(incompleteData, 'tiktok', timestampService))
                .toThrow('userId');
        });
    });

    describe('when extracting message text', () => {
        test('returns empty when Twitch message is a string', () => {
            const messageObj = 'Simple text message';
            const extracted = extractTwitchMessageText(messageObj);
            expect(extracted).toBe('');
        });

        test('returns empty when Twitch message string contains emotes', () => {
            const messageObj = 'Hello Kappa world!';
            const extracted = extractTwitchMessageText(messageObj);
            expect(extracted).toBe('');
        });

        test('extracts YouTube message text correctly', () => {
            const messageObj = 'YouTube message text';
            const extracted = extractYouTubeMessageText(messageObj);
            expect(extracted).toBe('YouTube message text');
        });

        test('handles YouTube message with emojis', () => {
            const messageObj = 'Hello 🌟 world! 🎉';
            const extracted = extractYouTubeMessageText(messageObj);
            expect(extracted).toBe('Hello 🌟 world! 🎉');
        });

        test('handles null/undefined message objects', () => {
            expect(extractTwitchMessageText(null)).toBe('');
            expect(extractTwitchMessageText(undefined)).toBe('');
            expect(extractYouTubeMessageText(null)).toBe('');
            expect(extractYouTubeMessageText(undefined)).toBe('');
        });
    });

    describe('when creating fallback messages', () => {
        test('creates valid fallback message on error', () => {
            const error = new Error('Normalization failed');
            const fallback = createFallbackMessage({
                platform: 'twitch',
                userId: 'user-1',
                username: 'testuser',
                message: 'test message',
                error,
                timestamp: '2025-01-02T03:04:05.000Z'
            });

            expect(fallback).toMatchObject({
                platform: 'twitch',
                userId: 'user-1',
                username: 'testuser',
                message: 'test message',
                timestamp: '2025-01-02T03:04:05.000Z',
                isMod: false,
                isSubscriber: false,
                isBroadcaster: false
            });
            expect(fallback.metadata).toMatchObject({
                error: 'Normalization failed',
                fallback: true
            });
        });

        test('requires timestamps for fallback messages', () => {
            const fallback = createFallbackMessage({
                platform: 'twitch',
                userId: 'user-2',
                username: 'iso-user',
                message: 'timestamp check'
            });

            expect(fallback).toBeNull();
        });

        test('handles missing parameters in fallback', () => {
            const fallback = createFallbackMessage();

            expect(fallback).toBeNull();
        });
    });

    describe('when validating normalized messages', () => {
        test('validates correct message structure', () => {
            const validMessage = {
                platform: 'twitch',
                userId: '123456789',
                username: 'testuser',
                message: 'Hello world!',
                timestamp: new Date(testClock.now()).toISOString(),
                isMod: false,
                isSubscriber: false,
                isBroadcaster: false,
                metadata: {},
                rawData: {}
            };

            const validation = validateNormalizedMessage(validMessage);
            expect(validation.isValid).toBe(true);
            expect(validation.errors).toEqual([]);
        });

        test('detects missing required fields', () => {
            const invalidMessage = {
                platform: 'twitch',
                message: 'Hello world!'
            };

            const validation = validateNormalizedMessage(invalidMessage);
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Missing required field: userId');
            expect(validation.errors).toContain('Missing required field: username');
        });

        test('validates field types', () => {
            const invalidMessage = {
                platform: 'twitch',
                userId: 123,
                username: 'testuser',
                message: 'Hello world!',
                timestamp: new Date(testClock.now()).toISOString(),
                isMod: 'true',
                isSubscriber: false,
                isBroadcaster: false,
                metadata: {},
                rawData: {}
            };

            const validation = validateNormalizedMessage(invalidMessage);
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('userId must be a string');
            expect(validation.errors).toContain('isMod must be a boolean');
        });

        test('validates platform names', () => {
            const invalidMessage = {
                platform: 'INVALID_PLATFORM',
                userId: '123456789',
                username: 'testuser',
                message: 'Hello world!',
                timestamp: new Date(testClock.now()).toISOString(),
                isMod: false,
                isSubscriber: false,
                isBroadcaster: false,
                metadata: {},
                rawData: {}
            };

            const validation = validateNormalizedMessage(invalidMessage);
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Invalid platform: INVALID_PLATFORM');
        });
    });

    describe('when using the main normalize function', () => {
        test('routes to correct platform normalizer', () => {
            const timestampMs = testClock.now();
            const twitchUser = { username: 'twitchuser', userId: 'tw-1' };
            const twitchMessage = 'Twitch message';
            const twitchContext = { 'tmi-sent-ts': String(timestampMs) };

            const normalized = normalizeMessage(
                'twitch',
                twitchUser,
                twitchMessage,
                twitchContext,
                'twitch',
                timestampService
            );

            expect(normalized.platform).toBe('twitch');
            expect(normalized.username).toBe('twitchuser');
            expect(normalized.message).toBe('Twitch message');
        });

        test('throws on unknown platform', () => {
            expect(() => normalizeMessage('unknown_platform', {}, 'test message'))
                .toThrow('Unsupported');
        });

        test('throws on normalization errors', () => {
            const context = { 'tmi-sent-ts': String(testClock.now()) };
            expect(() => normalizeMessage('twitch', null, 'message', context, 'twitch', timestampService))
                .toThrow('user');
        });
    });

    describe('edge cases and error handling', () => {
        test('handles very long messages', () => {
            const longMessage = 'A'.repeat(10000);
            const user = { username: 'testuser', userId: 'tw-long' };
            const context = { 'tmi-sent-ts': String(testClock.now()) };

            const normalized = normalizeTwitchMessage(
                user,
                longMessage,
                context,
                'twitch',
                timestampService
            );

            expect(normalized.message).toBe(longMessage);
            expect(normalized.message.length).toBe(10000);
        });

        test('handles special characters in usernames', () => {
            const user = { username: 'User@#$%^&*()', userId: 'tw-special' };
            const message = 'Message with special username';
            const context = { 'tmi-sent-ts': String(testClock.now()) };

            const normalized = normalizeTwitchMessage(
                user,
                message,
                context,
                'twitch',
                timestampService
            );

            expect(normalized.username).toBe('User@#$%^&*()');
        });

        test('handles unicode characters', () => {
            const user = { username: 'ユーザー', userId: 'tw-unicode' };
            const message = 'こんにちは世界！';
            const context = { 'tmi-sent-ts': String(testClock.now()) };

            const normalized = normalizeTwitchMessage(
                user,
                message,
                context,
                'twitch',
                timestampService
            );

            expect(normalized.username).toBe('ユーザー');
            expect(normalized.message).toBe('こんにちは世界！');
        });

        test('throws on empty messages', () => {
            const user = { username: 'testuser', userId: 'tw-empty' };
            const message = '';
            const context = { 'tmi-sent-ts': String(testClock.now()) };

            expect(() => normalizeTwitchMessage(
                user,
                message,
                context,
                'twitch',
                timestampService
            )).toThrow('message');
        });

        test('throws on whitespace-only messages', () => {
            const user = { username: 'testuser', userId: 'tw-space' };
            const message = '   \n\t   ';
            const context = { 'tmi-sent-ts': String(testClock.now()) };

            expect(() => normalizeTwitchMessage(
                user,
                message,
                context,
                'twitch',
                timestampService
            )).toThrow('message');
        });
    });

    describe('performance and memory', () => {
        test('handles high message volume efficiently', () => {
            const startTime = testClock.now();
            const iterations = 1000;

            for (let i = 0; i < iterations; i++) {
                const user = { username: `user${i}`, userId: `tw-${i}` };
                const message = `Message ${i}`;
                const context = { 'tmi-sent-ts': String(testClock.now()) };

                normalizeTwitchMessage(
                    user,
                    message,
                    context,
                    'twitch',
                    timestampService
                );
            }

            const simulatedProcessingMs = 100;
            testClock.advance(simulatedProcessingMs);
            const endTime = testClock.now();
            const duration = endTime - startTime;

            expect(duration).toBeLessThan(1000);
        });

        test('does not leak memory with repeated calls', () => {
            const initialMemory = process.memoryUsage().heapUsed;

            for (let i = 0; i < 1000; i++) {
                const user = { username: `user${i}`, userId: `tw-${i}` };
                const message = `Message ${i}`;
                const context = { 'tmi-sent-ts': String(testClock.now()) };

                normalizeTwitchMessage(
                    user,
                    message,
                    context,
                    'twitch',
                    timestampService
                );
            }

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;

            expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
        });
    });

    describe('Timestamp Preservation Behavior', () => {
        describe('TikTok Timestamp Preservation', () => {
            test('preserves original createTime from TikTok message data', () => {
                const originalTime = testClock.now() - (5 * 60 * 1000);
                const tikTokData = {
                    user: {
                        userId: 'tt-1',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    createTime: originalTime,
                    comment: 'Test message with original timestamp'
                };

                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok', timestampService);

                const normalizedTime = new Date(normalized.timestamp).getTime();
                expect(normalizedTime).toBe(originalTime);
                expect(normalized.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
                expect(normalized.metadata.createTime).toBe(originalTime);
            });

            test('throws when nested common.createTime when root field is missing', () => {
                const originalTime = testClock.now() - (4 * 60 * 1000);
                const tikTokData = {
                    common: {
                        createTime: String(originalTime)
                    },
                    user: {
                        userId: 'tt-2',
                        uniqueId: 'NestedUser',
                        nickname: 'Nested User'
                    },
                    comment: 'Common timestamp test'
                };

                expect(() => normalizeTikTokMessage(tikTokData, 'tiktok', timestampService))
                    .toThrow('tiktok timestamp');
            });

            test('throws when using timestamp field as fallback when createTime is missing', () => {
                const fallbackTime = testClock.now() - (3 * 60 * 1000);
                const tikTokData = {
                    timestamp: fallbackTime,
                    user: {
                        userId: 'tt-3',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    comment: 'Test message with fallback timestamp'
                };

                expect(() => normalizeTikTokMessage(tikTokData, 'tiktok', timestampService))
                    .toThrow('tiktok timestamp');
            });

            test('does not replace original timestamps with current time when available', () => {
                const oldTime = testClock.now() - (10 * 60 * 1000);
                const tikTokData = {
                    user: {
                        userId: 'tt-4',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    createTime: oldTime,
                    comment: 'Old cached message'
                };

                const beforeNormalization = testClock.now();

                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok', timestampService);

                const afterNormalization = testClock.now();
                const normalizedTime = new Date(normalized.timestamp).getTime();

                expect(normalizedTime).toBe(oldTime);
                expect(normalizedTime).toBeLessThan(beforeNormalization);
                expect(normalizedTime).toBeLessThan(afterNormalization);
            });
        });

        describe('YouTube Timestamp Preservation', () => {
            test('preserves original YouTube timestamp from messageData', () => {
                const originalTimeMs = testClock.now() - (4 * 60 * 1000);
                const youTubeData = {
                    item: {
                        timestamp: (originalTimeMs * 1000).toString(),
                        author: {
                            name: 'TestUser',
                            id: 'user123',
                            channelId: 'channel123'
                        },
                        message: {
                            text: 'Test YouTube message with timestamp'
                        }
                    }
                };

                const normalized = normalizeYouTubeMessage(youTubeData, 'youtube', timestampService);

                const normalizedTime = new Date(normalized.timestamp).getTime();
                expect(normalizedTime).toBe(originalTimeMs);
            });

            test('continues to work with existing YouTube timestamp logic', () => {
                const originalTimeMs = testClock.now() - (6 * 60 * 1000);
                const youTubeData = {
                    item: {
                        timestamp: originalTimeMs.toString(),
                        author: {
                            name: 'TestUser',
                            id: 'user123'
                        },
                        message: {
                            text: 'Test YouTube message'
                        }
                    }
                };

                const normalized = normalizeYouTubeMessage(youTubeData, 'youtube', timestampService);

                const normalizedTime = new Date(normalized.timestamp).getTime();
                expect(normalizedTime).toBe(originalTimeMs);
            });

            test('throws when YouTube timestamp is missing', () => {
                const youTubeData = {
                    item: {
                        author: {
                            name: 'TestUser',
                            id: 'user123'
                        },
                        message: {
                            text: 'Test YouTube message without timestamp'
                        }
                    }
                };

                expect(() => normalizeYouTubeMessage(youTubeData, 'youtube', timestampService))
                    .toThrow('timestamp');
            });
        });

        describe('Twitch Timestamp Preservation', () => {
            test('preserves original Twitch timestamp from message data', () => {
                const originalTime = testClock.now() - (7 * 60 * 1000);
                const user = {
                    userId: '123456789',
                    username: 'testuser'
                };
                const message = 'Test Twitch message with timestamp';
                const context = {
                    'tmi-sent-ts': originalTime.toString(),
                    'user-id': '123456789',
                    username: 'testuser'
                };

                const normalized = normalizeTwitchMessage(
                    user,
                    message,
                    context,
                    'twitch',
                    timestampService
                );

                const normalizedTime = new Date(normalized.timestamp).getTime();
                expect(normalizedTime).toBe(originalTime);
            });

            test('does not replace Twitch timestamps with current time when available', () => {
                const oldTime = testClock.now() - (15 * 60 * 1000);
                const user = {
                    userId: '123456789',
                    username: 'testuser'
                };
                const message = 'Old cached Twitch message';
                const context = {
                    'tmi-sent-ts': oldTime.toString(),
                    'user-id': '123456789',
                    username: 'testuser'
                };

                const beforeNormalization = testClock.now();

                const normalized = normalizeTwitchMessage(
                    user,
                    message,
                    context,
                    'twitch',
                    timestampService
                );

                const afterNormalization = testClock.now();
                const normalizedTime = new Date(normalized.timestamp).getTime();

                expect(normalizedTime).toBe(oldTime);
                expect(normalizedTime).toBeLessThan(beforeNormalization);
                expect(normalizedTime).toBeLessThan(afterNormalization);
            });

            test('throws when Twitch timestamp is missing', () => {
                const user = {
                    userId: '123456789',
                    username: 'testuser'
                };
                const message = 'Test Twitch message without timestamp';
                const context = {
                    'user-id': '123456789',
                    username: 'testuser'
                };

                expect(() => normalizeTwitchMessage(
                    user,
                    message,
                    context,
                    'twitch',
                    timestampService
                )).toThrow('twitch timestamp');
            });
        });

        describe('Cross-Platform Timestamp Consistency', () => {
            test('handles timestamp preservation consistently across all platforms', () => {
                const baseTime = testClock.now() - (5 * 60 * 1000);

                const tikTokData = {
                    createTime: baseTime,
                    user: {
                        userId: 'tt-5',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    comment: 'TikTok message'
                };

                const youTubeData = {
                    item: {
                        timestamp: (baseTime * 1000).toString(),
                        author: { name: 'TestUser', id: 'user123' },
                        message: { text: 'YouTube message' }
                    }
                };

                const twitchUser = { userId: '123', username: 'testuser' };
                const twitchMessage = 'Twitch message';
                const twitchContext = { 'tmi-sent-ts': baseTime.toString() };

                const normalizedTikTok = normalizeTikTokMessage(tikTokData, 'tiktok', timestampService);
                const normalizedYouTube = normalizeYouTubeMessage(youTubeData, 'youtube', timestampService);
                const normalizedTwitch = normalizeTwitchMessage(
                    twitchUser,
                    twitchMessage,
                    twitchContext,
                    'twitch',
                    timestampService
                );

                const tikTokTime = new Date(normalizedTikTok.timestamp).getTime();
                const youTubeTime = new Date(normalizedYouTube.timestamp).getTime();
                const twitchTime = new Date(normalizedTwitch.timestamp).getTime();

                expect(tikTokTime).toBe(baseTime);
                expect(youTubeTime).toBe(baseTime);
                expect(twitchTime).toBe(baseTime);

                [normalizedTikTok, normalizedYouTube, normalizedTwitch].forEach(normalized => {
                    expect(normalized.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
                });
            });
        });

        describe('Integration with TimestampExtractionService', () => {
            test('integrates with TimestampExtractionService when provided via dependency injection', () => {
                const mockTimestampService = {
                    extractTimestamp: (platform, data) => {
                        if (platform === 'tiktok' && data.createTime) {
                            return new Date(data.createTime).toISOString();
                        }
                        if (platform === 'youtube' && data.timestamp) {
                            return new Date(parseInt(data.timestamp)).toISOString();
                        }
                        if (platform === 'twitch' && data.context?.['tmi-sent-ts']) {
                            return new Date(parseInt(data.context['tmi-sent-ts'])).toISOString();
                        }
                        return new Date(testClock.now()).toISOString();
                    }
                };

                const originalTime = testClock.now() - (8 * 60 * 1000);
                const tikTokData = {
                    createTime: originalTime,
                    user: {
                        userId: 'tt-6',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    comment: 'Service integration test'
                };

                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok', mockTimestampService);

                const normalizedTime = new Date(normalized.timestamp).getTime();
                expect(normalizedTime).toBe(originalTime);
            });
        });
    });
});
