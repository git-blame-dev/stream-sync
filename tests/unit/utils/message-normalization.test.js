const { describe, test, expect, beforeEach } = require('bun:test');

const testClock = require('../../helpers/test-clock');
const {
    normalizeMessage,
    normalizeYouTubeMessage,
    normalizeTikTokMessage,
    extractTwitchMessageData,
    extractTwitchMessageText,
    extractYouTubeMessageText,
    createFallbackMessage,
    validateNormalizedMessage
} = require('../../../src/utils/message-normalization');

beforeEach(() => {
    testClock.reset();
});

const buildTimestampService = () => ({
    extractTimestamp: (platform, data) => {
        if (platform === 'twitch') {
            const raw = data?.timestamp;
            if (!raw) {
                throw new Error('Missing twitch timestamp');
            }
            const numeric = Number(raw);
            if (Number.isFinite(numeric)) {
                return new Date(numeric).toISOString();
            }
            const parsed = Date.parse(raw);
            if (Number.isNaN(parsed)) {
                throw new Error('Invalid twitch timestamp');
            }
            return new Date(parsed).toISOString();
        }
        if (platform === 'youtube') {
            const raw = data?.timestamp ?? data?.timestamp_usec;
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
            const raw = data?.common?.clientSendTime ?? data?.common?.createTime ?? data?.timestamp;
            if (!raw) {
                throw new Error('Missing tiktok timestamp');
            }
            const numeric = Number(raw);
            if (Number.isFinite(numeric)) {
                return new Date(numeric).toISOString();
            }
            const parsed = Date.parse(raw);
            if (Number.isNaN(parsed)) {
                throw new Error('Invalid tiktok timestamp');
            }
            return new Date(parsed).toISOString();
        }
        throw new Error('Unsupported platform');
    }
});

describe('Message Normalization', () => {
    let timestampService;

    beforeEach(() => {
        timestampService = buildTimestampService();
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
                .toThrow('Missing YouTube chat item payload');
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
                common: { createTime: testClock.now() }
            };

            const normalized = normalizeTikTokMessage(data, 'tiktok', timestampService);

            expect(normalized).toMatchObject({
                platform: 'tiktok',
                userId: 'tiktokuser123',
                username: 'TikTokUser',
                message: 'Hello TikTok!',
                isMod: false,
                isSubscriber: false,
                isBroadcaster: false
            });
            expect(normalized.metadata).toMatchObject({
                profilePicture: 'avatar.jpg',
                numericId: 'tt-123'
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
                common: { createTime: testClock.now() }
            };

            expect(() => normalizeTikTokMessage(data, 'tiktok', nonStringTimestampService))
                .toThrow('Missing TikTok timestamp');
        });

        test('handles TikTok gift messages', () => {
            const giftTimestamp = new Date(testClock.now()).toISOString();
            const giftData = {
                user: {
                    userId: 'tt-gift-1',
                    uniqueId: 'giftuser',
                    nickname: 'GiftUser'
                },
                giftDetails: { giftName: 'Rose', diamondCount: 1 },
                repeatCount: 5,
                comment: 'Gift message',
                timestamp: giftTimestamp
            };

            const normalized = normalizeTikTokMessage(giftData, 'tiktok-gift', timestampService);

            expect(normalized).toMatchObject({
                platform: 'tiktok-gift',
                userId: 'giftuser',
                username: 'GiftUser'
            });
            expect(normalized.timestamp).toBe(giftTimestamp);
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
                common: { createTime: testClock.now() }
            };

            expect(() => normalizeTikTokMessage(incompleteData, 'tiktok', timestampService))
                .toThrow('userId');
        });

        test('uses fallback profilePicture data when profilePictureUrl is missing', () => {
            const data = {
                user: {
                    userId: 'tt-456',
                    uniqueId: 'tiktokuser456',
                    nickname: ' TikTok User ',
                    profilePicture: { url: ['avatar-fallback.jpg'] },
                    followRole: 'follower',
                    userBadges: ['badge-1']
                },
                comment: 'Hello TikTok fallback!',
                common: { createTime: testClock.now() }
            };

            const normalized = normalizeTikTokMessage(data, 'tiktok', timestampService);

            expect(normalized.metadata).toMatchObject({
                profilePicture: 'avatar-fallback.jpg',
                followRole: 'follower',
                userBadges: ['badge-1'],
                numericId: 'tt-456'
            });
        });
    });

    describe('when extracting Twitch message data', () => {
        test('extracts text and cheermote metadata from fragments', () => {
            const messageObj = {
                text: 'Cheer100 hello',
                fragments: [
                    { type: 'cheermote', text: 'Cheer100', cheermote: { prefix: 'Cheer', bits: 100 } },
                    { type: 'text', text: ' hello' }
                ]
            };

            const extracted = extractTwitchMessageData(messageObj);

            expect(extracted.textContent).toBe('hello');
            expect(extracted.cheermoteInfo).toMatchObject({
                prefix: 'Cheer',
                text: 'Cheer100',
                totalBits: 100
            });
        });

        test('returns empty output when fragments are missing', () => {
            const extracted = extractTwitchMessageData({ text: 'No fragments here' });

            expect(extracted.textContent).toBe('');
            expect(extracted.cheermoteInfo).toBeNull();
        });

        test('does not build cheermote info when fragments are incomplete', () => {
            const extracted = extractTwitchMessageData({
                fragments: [
                    { type: 'cheermote', text: 'Cheer50' },
                    { type: 'text', text: ' hello' }
                ]
            });

            expect(extracted.textContent).toBe('hello');
            expect(extracted.cheermoteInfo).toBeNull();
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

        test('handles YouTube message arrays with emoji shortcuts', () => {
            const messageObj = [
                { text: 'Hello ' },
                { emoji: { shortcuts: [':wave:'] } },
                { emojiText: '🌟' },
                { text: 'friend' }
            ];

            const extracted = extractYouTubeMessageText(messageObj);

            expect(extracted).toBe('Hello :wave:🌟friend');
        });

        test('handles YouTube message runs with emoji shortcuts', () => {
            const messageObj = {
                runs: [
                    { text: 'Welcome ' },
                    { emoji: { shortcuts: [':sparkle:'] } },
                    { text: 'home' }
                ]
            };

            const extracted = extractYouTubeMessageText(messageObj);

            expect(extracted).toBe('Welcome :sparkle:home');
        });

        test('handles YouTube message simpleText payloads', () => {
            const messageObj = { simpleText: 'Simple message' };

            const extracted = extractYouTubeMessageText(messageObj);

            expect(extracted).toBe('Simple message');
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

        test('returns null when username is whitespace', () => {
            const fallback = createFallbackMessage({
                platform: 'twitch',
                userId: 'user-3',
                username: '   ',
                message: 'hello',
                timestamp: '2025-01-02T03:04:05.000Z'
            });

            expect(fallback).toBeNull();
        });

        test('trims message and coerces userId to string', () => {
            const fallback = createFallbackMessage({
                platform: 'twitch',
                userId: 42,
                username: ' testuser ',
                message: ' hello ',
                timestamp: '2025-01-02T03:04:05.000Z'
            });

            expect(fallback).toMatchObject({
                userId: '42',
                username: 'testuser',
                message: 'hello'
            });
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

        test('returns issues when message is not an object', () => {
            const validation = validateNormalizedMessage(null);

            expect(validation.isValid).toBe(false);
            expect(validation.issues).toContain('Message is not an object');
        });

        test('detects invalid timestamp format', () => {
            const invalidMessage = {
                platform: 'twitch',
                userId: '123456789',
                username: 'testuser',
                message: 'Hello world!',
                timestamp: 'not-a-date',
                isMod: false,
                isSubscriber: false,
                isBroadcaster: false,
                metadata: {},
                rawData: {}
            };

            const validation = validateNormalizedMessage(invalidMessage);

            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Invalid timestamp format');
        });

        test('detects missing metadata', () => {
            const invalidMessage = {
                platform: 'twitch',
                userId: '123456789',
                username: 'testuser',
                message: 'Hello world!',
                timestamp: new Date(testClock.now()).toISOString(),
                isMod: false,
                isSubscriber: false,
                isBroadcaster: false,
                metadata: null,
                rawData: {}
            };

            const validation = validateNormalizedMessage(invalidMessage);

            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Missing or invalid metadata field');
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
        test('throws on unknown platform', () => {
            expect(() => normalizeMessage('unknown_platform', {}, 'test message'))
                .toThrow('Unsupported');
        });

        test('normalizes platform names in a case-insensitive way', () => {
            const timestampMs = testClock.now();
            const chatItem = {
                item: {
                    id: 'yt-case-1',
                    timestamp: timestampMs,
                    author: {
                        id: 'UCabc123',
                        name: 'CaseUser'
                    },
                    message: { text: 'Case check' }
                }
            };

            const normalized = normalizeMessage('YouTube', chatItem, 'YouTube', timestampService);

            expect(normalized.platform).toBe('youtube');
        });
    });

    describe('Timestamp Preservation Behavior', () => {
        describe('TikTok Timestamp Preservation', () => {
            test('preserves common.createTime from TikTok message data', () => {
                const originalTime = testClock.now() - (5 * 60 * 1000);
                const tikTokData = {
                    user: {
                        userId: 'tt-1',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    common: {
                        createTime: originalTime
                    },
                    comment: 'Test message with original timestamp'
                };

                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok', timestampService);

                const normalizedTime = new Date(normalized.timestamp).getTime();
                expect(normalizedTime).toBe(originalTime);
                expect(normalized.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
                expect(normalized.metadata.createTime).toBe(originalTime);
            });

            test('preserves common.clientSendTime when createTime is missing', () => {
                const originalTime = testClock.now() - (4 * 60 * 1000);
                const tikTokData = {
                    common: {
                        clientSendTime: String(originalTime)
                    },
                    user: {
                        userId: 'tt-2',
                        uniqueId: 'NestedUser',
                        nickname: 'Nested User'
                    },
                    comment: 'Common timestamp test'
                };

                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok', timestampService);

                const normalizedTime = new Date(normalized.timestamp).getTime();
                expect(normalizedTime).toBe(originalTime);
            });

            test('accepts timestamp field when common timestamps are missing', () => {
                const fallbackTime = new Date(testClock.now() - (3 * 60 * 1000)).toISOString();
                const tikTokData = {
                    timestamp: fallbackTime,
                    user: {
                        userId: 'tt-3',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    comment: 'Test message with fallback timestamp'
                };

                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok', timestampService);
                expect(normalized.timestamp).toBe(fallbackTime);
            });

            test('does not replace original timestamps with current time when available', () => {
                const oldTime = testClock.now() - (10 * 60 * 1000);
                const tikTokData = {
                    user: {
                        userId: 'tt-4',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    common: {
                        createTime: oldTime
                    },
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
                        timestamp_usec: (originalTimeMs * 1000).toString(),
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

        describe('Cross-Platform Timestamp Consistency', () => {
            test('handles timestamp preservation consistently across platforms', () => {
                const baseTime = testClock.now() - (5 * 60 * 1000);

                const tikTokData = {
                    user: {
                        userId: 'tt-5',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    common: {
                        createTime: baseTime
                    },
                    comment: 'TikTok message'
                };

                const youTubeData = {
                    item: {
                        timestamp_usec: (baseTime * 1000).toString(),
                        author: { name: 'TestUser', id: 'user123' },
                        message: { text: 'YouTube message' }
                    }
                };

                const normalizedTikTok = normalizeTikTokMessage(tikTokData, 'tiktok', timestampService);
                const normalizedYouTube = normalizeYouTubeMessage(youTubeData, 'youtube', timestampService);
                const tikTokTime = new Date(normalizedTikTok.timestamp).getTime();
                const youTubeTime = new Date(normalizedYouTube.timestamp).getTime();
                expect(tikTokTime).toBe(baseTime);
                expect(youTubeTime).toBe(baseTime);
                [normalizedTikTok, normalizedYouTube].forEach(normalized => {
                    expect(normalized.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
                });
            });
        });

        describe('Integration with TimestampExtractionService', () => {
            test('integrates with TimestampExtractionService when provided via dependency injection', () => {
                const mockTimestampService = {
                    extractTimestamp: (platform, data) => {
                        if (platform === 'tiktok' && data.common?.createTime) {
                            return new Date(data.common.createTime).toISOString();
                        }
                        if (platform === 'youtube' && data.timestamp_usec) {
                            return new Date(Math.floor(Number(data.timestamp_usec) / 1000)).toISOString();
                        }
                        if (platform === 'twitch' && data.timestamp) {
                            const parsed = Date.parse(data.timestamp);
                            return new Date(parsed).toISOString();
                        }
                        return null;
                    }
                };

                const originalTime = testClock.now() - (8 * 60 * 1000);
                const tikTokData = {
                    user: {
                        userId: 'tt-6',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    common: {
                        createTime: originalTime
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
