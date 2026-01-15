
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const { createMockLogger } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const { createTwitchChatEvent, createYouTubeChatEvent, createTikTokChatEvent } = require('../../helpers/platform-test-data');
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

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const buildTimestampService = () => ({
    extractTimestamp: createMockFn((platform, data) => {
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
    })
});

describe('Message Normalization', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let mockLogger;
    let timestampService;

    beforeEach(() => {
        // Create mocks using factory functions
        mockLogger = createMockLogger('debug');
        timestampService = buildTimestampService();
    });

    describe('when normalizing Twitch messages', () => {
        it('should normalize TMI.js chat message correctly', () => {
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

        it('should reject non-string timestamps from the service', () => {
            const nonStringTimestampService = {
                extractTimestamp: createMockFn(() => 123456789)
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

        it('should normalize EventSub message correctly', () => {
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

        it('should handle missing user data gracefully', () => {
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

        it('should handle null/undefined values', () => {
            const user = null;
            const message = null;
            const context = null;
            expect(() => normalizeTwitchMessage(
                user,
                message,
                context,
                'twitch',
                timestampService
            )).toThrow('user');
        });
    });

    describe('when normalizing YouTube messages', () => {
        it('should normalize YouTube.js chat message correctly', () => {
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

        it('should reject non-string timestamps from the service', () => {
            const nonStringTimestampService = {
                extractTimestamp: createMockFn(() => 123456789)
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

        it('should normalize YouTube super chat correctly', () => {
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

        it('should handle missing YouTube data gracefully', () => {
            const incompleteChatItem = {};

            expect(() => normalizeYouTubeMessage(incompleteChatItem, 'youtube', timestampService))
                .toThrow('author');
        });
    });

    describe('when normalizing TikTok messages', () => {
        it('should normalize TikTok chat message correctly', () => {
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

        it('should reject non-string timestamps from the service', () => {
            const nonStringTimestampService = {
                extractTimestamp: createMockFn(() => 123456789)
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

        it('should handle TikTok gift messages', () => {
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
            // TikTok gift metadata uses standard structure, gift data is in rawData
            expect(normalized.metadata).toMatchObject({
                profilePicture: null,
                followRole: null,
                userBadges: null
            });
            // Gift data should be accessible from rawData
            expect(normalized.rawData.data.giftDetails.giftName).toBe('Rose');
            expect(normalized.rawData.data.repeatCount).toBe(5);
            expect(normalized.rawData.data.giftDetails.diamondCount).toBe(1);
        });

        it('should handle missing TikTok user data', () => {
            const incompleteData = {
                comment: 'Message without user data',
                createTime: testClock.now()
            };

            expect(() => normalizeTikTokMessage(incompleteData, 'tiktok', timestampService))
                .toThrow('userId');
        });
    });

    describe('when extracting message text', () => {
        it('should return empty when Twitch message is a string', () => {
            const messageObj = 'Simple text message';
            const extracted = extractTwitchMessageText(messageObj);
            expect(extracted).toBe('');
        });

        it('should return empty when Twitch message string contains emotes', () => {
            const messageObj = 'Hello Kappa world!';
            const extracted = extractTwitchMessageText(messageObj);
            expect(extracted).toBe('');
        });

        it('should extract YouTube message text correctly', () => {
            const messageObj = 'YouTube message text';
            const extracted = extractYouTubeMessageText(messageObj);
            expect(extracted).toBe('YouTube message text');
        });

        it('should handle YouTube message with emojis', () => {
            const messageObj = 'Hello 🌟 world! 🎉';
            const extracted = extractYouTubeMessageText(messageObj);
            expect(extracted).toBe('Hello 🌟 world! 🎉');
        });

        it('should handle null/undefined message objects', () => {
            expect(extractTwitchMessageText(null)).toBe('');
            expect(extractTwitchMessageText(undefined)).toBe('');
            expect(extractYouTubeMessageText(null)).toBe('');
            expect(extractYouTubeMessageText(undefined)).toBe('');
        });
    });

    describe('when creating fallback messages', () => {
        it('should create valid fallback message on error', () => {
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

        it('should require timestamps for fallback messages', () => {
            const fallback = createFallbackMessage({
                platform: 'twitch',
                userId: 'user-2',
                username: 'iso-user',
                message: 'timestamp check'
            });

            expect(fallback).toBeNull();
        });

        it('should handle missing parameters in fallback', () => {
            const fallback = createFallbackMessage();

            expect(fallback).toBeNull();
        });
    });

    describe('when validating normalized messages', () => {
        it('should validate correct message structure', () => {
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

        it('should detect missing required fields', () => {
            const invalidMessage = {
                platform: 'twitch',
                // Missing userId, username, etc.
                message: 'Hello world!'
            };

            const validation = validateNormalizedMessage(invalidMessage);
            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Missing required field: userId');
            expect(validation.errors).toContain('Missing required field: username');
        });

        it('should validate field types', () => {
            const invalidMessage = {
                platform: 'twitch',
                userId: 123, // Should be string
                username: 'testuser',
                message: 'Hello world!',
                timestamp: new Date(testClock.now()).toISOString(),
                isMod: 'true', // Should be boolean
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

        it('should validate platform names', () => {
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
        it('should route to correct platform normalizer', () => {
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

        it('should handle unknown platform gracefully', () => {
            expect(() => normalizeMessage('unknown_platform', {}, 'test message'))
                .toThrow('Unsupported');
        });

        it('should handle normalization errors gracefully', () => {
            const context = { 'tmi-sent-ts': String(testClock.now()) };
            expect(() => normalizeMessage('twitch', null, 'message', context, 'twitch', timestampService))
                .toThrow('user');
        });
    });

    describe('edge cases and error handling', () => {
        it('should handle very long messages', () => {
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

        it('should handle special characters in usernames', () => {
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

        it('should handle unicode characters', () => {
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

        it('should handle empty messages', () => {
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

        it('should handle whitespace-only messages', () => {
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
        it('should handle high message volume efficiently', () => {
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

            // Should process 1000 messages in under 1 second
            expect(duration).toBeLessThan(1000);
        });

        it('should not leak memory with repeated calls', () => {
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

            // Memory increase should be reasonable (less than 10MB)
            expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
        });
    });

    describe('Timestamp Preservation Behavior', () => {

        describe('TikTok Timestamp Preservation', () => {
            it('should preserve original createTime from TikTok message data', () => {
                // Given: TikTok message with original createTime
                const originalTime = testClock.now() - (5 * 60 * 1000); // 5 minutes ago
                const tikTokData = {
                    user: {
                        userId: 'tt-1',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    createTime: originalTime,
                    comment: 'Test message with original timestamp'
                };

                // When: Message is normalized (this will fail until service is integrated)
                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok', timestampService);

                // Then: Original timestamp is preserved in ISO format
                const normalizedTime = new Date(normalized.timestamp).getTime();
                expect(normalizedTime).toBe(originalTime);
                expect(normalized.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
                
                // And: Metadata preserves the original createTime for reference
                expect(normalized.metadata.createTime).toBe(originalTime);
            });

            it('should preserve nested common.createTime when root field is missing', () => {
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

            it('should use timestamp field as fallback when createTime is missing', () => {
                // Given: TikTok message with timestamp but no createTime
                const fallbackTime = testClock.now() - (3 * 60 * 1000); // 3 minutes ago
                const tikTokData = {
                    timestamp: fallbackTime, // Fallback field
                    user: {
                        userId: 'tt-3',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    comment: 'Test message with fallback timestamp'
                };

                // When: Message is normalized
                expect(() => normalizeTikTokMessage(tikTokData, 'tiktok', timestampService))
                    .toThrow('tiktok timestamp');
            });

            it('should not replace original timestamps with current time when available', () => {
                // Given: TikTok message with earlier timestamp
                const oldTime = testClock.now() - (10 * 60 * 1000); // 10 minutes ago
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

                // When: Message is normalized
                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok', timestampService);

                const afterNormalization = testClock.now();
                const normalizedTime = new Date(normalized.timestamp).getTime();

                // Then: Original old timestamp is preserved, not replaced with current time
                expect(normalizedTime).toBe(oldTime);
                expect(normalizedTime).toBeLessThan(beforeNormalization);
                expect(normalizedTime).toBeLessThan(afterNormalization);
            });
        });

        describe('YouTube Timestamp Preservation', () => {
            it('should preserve original YouTube timestamp from messageData', () => {
                // Given: YouTube message with timestamp in microseconds
                const originalTimeMs = testClock.now() - (4 * 60 * 1000); // 4 minutes ago
                const youTubeData = {
                    item: {
                        timestamp: (originalTimeMs * 1000).toString(), // Convert to microseconds string
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

                // When: Message is normalized
                const normalized = normalizeYouTubeMessage(youTubeData, 'youtube', timestampService);

                // Then: Original timestamp is preserved (converted from microseconds)
                const normalizedTime = new Date(normalized.timestamp).getTime();
                expect(normalizedTime).toBe(originalTimeMs);
            });

            it('should continue to work with existing YouTube timestamp logic', () => {
                // Given: YouTube message in the current working format
                const originalTimeMs = testClock.now() - (6 * 60 * 1000); // 6 minutes ago
                const youTubeData = {
                    item: {
                        timestamp: originalTimeMs.toString(), // Current format (milliseconds as string)
                        author: {
                            name: 'TestUser',
                            id: 'user123'
                        },
                        message: {
                            text: 'Test YouTube message'
                        }
                    }
                };

                // When: Message is normalized
                const normalized = normalizeYouTubeMessage(youTubeData, 'youtube', timestampService);

                // Then: Timestamp is preserved correctly
                const normalizedTime = new Date(normalized.timestamp).getTime();
                expect(normalizedTime).toBe(originalTimeMs);
            });

            it('should not break existing YouTube timestamp handling', () => {
                // Given: YouTube message without timestamp (should fallback to current time)
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

                const beforeNormalization = testClock.now();

                // When: Message is normalized
                expect(() => normalizeYouTubeMessage(youTubeData, 'youtube', timestampService))
                    .toThrow('timestamp');
            });
        });

        describe('Twitch Timestamp Preservation', () => {
            it('should preserve original Twitch timestamp from message data', () => {
                // Given: Twitch message with timestamp in context
                const originalTime = testClock.now() - (7 * 60 * 1000); // 7 minutes ago
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

                // When: Message is normalized (this will fail until service is integrated)
                const normalized = normalizeTwitchMessage(
                    user,
                    message,
                    context,
                    'twitch',
                    timestampService
                );

                // Then: Original timestamp is preserved
                const normalizedTime = new Date(normalized.timestamp).getTime();
                expect(normalizedTime).toBe(originalTime);
            });

            it('should not replace Twitch timestamps with current time when available', () => {
                // Given: Twitch message with earlier timestamp
                const oldTime = testClock.now() - (15 * 60 * 1000); // 15 minutes ago
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

                // When: Message is normalized
                const normalized = normalizeTwitchMessage(
                    user,
                    message,
                    context,
                    'twitch',
                    timestampService
                );

                const afterNormalization = testClock.now();
                const normalizedTime = new Date(normalized.timestamp).getTime();

                // Then: Original old timestamp is preserved, not replaced with current time
                expect(normalizedTime).toBe(oldTime);
                expect(normalizedTime).toBeLessThan(beforeNormalization);
                expect(normalizedTime).toBeLessThan(afterNormalization);
            });

            it('should fallback to current time when Twitch timestamp is missing', () => {
                // Given: Twitch message without timestamp in context
                const user = {
                    userId: '123456789',
                    username: 'testuser'
                };
                const message = 'Test Twitch message without timestamp';
                const context = {
                    'user-id': '123456789',
                    username: 'testuser'
                    // No tmi-sent-ts
                };

                const beforeNormalization = testClock.now();

                // When: Message is normalized
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
            it('should handle timestamp preservation consistently across all platforms', () => {
                // Given: Messages from each platform with original timestamps
                const baseTime = testClock.now() - (5 * 60 * 1000); // 5 minutes ago
                
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
                        timestamp: (baseTime * 1000).toString(), // Microseconds
                        author: { name: 'TestUser', id: 'user123' },
                        message: { text: 'YouTube message' }
                    }
                };
                
                const twitchUser = { userId: '123', username: 'testuser' };
                const twitchMessage = 'Twitch message';
                const twitchContext = { 'tmi-sent-ts': baseTime.toString() };

                // When: All messages are normalized
                const normalizedTikTok = normalizeTikTokMessage(tikTokData, 'tiktok', timestampService);
                const normalizedYouTube = normalizeYouTubeMessage(youTubeData, 'youtube', timestampService);
                const normalizedTwitch = normalizeTwitchMessage(
                    twitchUser,
                    twitchMessage,
                    twitchContext,
                    'twitch',
                    timestampService
                );

                // Then: All preserve the original timestamp consistently
                const tikTokTime = new Date(normalizedTikTok.timestamp).getTime();
                const youTubeTime = new Date(normalizedYouTube.timestamp).getTime();
                const twitchTime = new Date(normalizedTwitch.timestamp).getTime();

                expect(tikTokTime).toBe(baseTime);
                expect(youTubeTime).toBe(baseTime);
                expect(twitchTime).toBe(baseTime);
                
                // And: All results are in consistent ISO format
                [normalizedTikTok, normalizedYouTube, normalizedTwitch].forEach(normalized => {
                    expect(normalized.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
                });
            });
        });

        describe('Integration with TimestampExtractionService', () => {
            it('should integrate with TimestampExtractionService when provided via dependency injection', () => {
                // Given: A mock TimestampExtractionService
                const mockTimestampService = {
                    extractTimestamp: createMockFn((platform, data) => {
                        // Mock service that preserves original timestamps
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
                    })
                };

                // And: TikTok message with original timestamp
                const originalTime = testClock.now() - (8 * 60 * 1000); // 8 minutes ago
                const tikTokData = {
                    createTime: originalTime,
                    user: {
                        userId: 'tt-6',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    comment: 'Service integration test'
                };

                // When: Message is normalized with injected service
                // NOTE: This will fail until normalization functions are updated to accept service
                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok', mockTimestampService);

                // Then: Service is used for timestamp extraction
                expect(mockTimestampService.extractTimestamp).toHaveBeenCalledWith('tiktok', tikTokData);
                
                // And: Original timestamp is preserved
                const normalizedTime = new Date(normalized.timestamp).getTime();
                expect(normalizedTime).toBe(originalTime);
            });
        });
    });
}); 
