const { describe, test, expect, beforeEach } = require('bun:test');

const testClock = require('../../helpers/test-clock');
const {
    normalizeYouTubeMessage,
    normalizeTikTokMessage,
    buildTwitchMessageParts,
    extractTwitchMessageData,
    extractYouTubeMessageText,
    validateNormalizedMessage
} = require('../../../src/utils/message-normalization');

beforeEach(() => {
    testClock.reset();
});

describe('Message Normalization', () => {

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
                        is_moderator: false,
                        badges: []
                    },
                    message: { text: 'Hello YouTube!' }
                }
            };

            const normalized = normalizeYouTubeMessage(chatItem, 'youtube');

            expect(normalized).toMatchObject({
                platform: 'youtube',
                userId: 'UC123456789',
                username: 'youtubeuser',
                message: 'Hello YouTube!',
                isMod: false,
                isSubscriber: false,
                isBroadcaster: false
            });
            expect(normalized.metadata).toMatchObject({
                uniqueId: 'yt-message-123',
                isSuperChat: false
            });
        });

        test('maps canonical avatarUrl from author thumbnail', () => {
            const timestampMs = testClock.now();
            const chatItem = {
                item: {
                    id: 'yt-avatar-123',
                    timestamp: timestampMs,
                    author: {
                        id: 'UCavatar123',
                        name: 'avataruser',
                        is_moderator: false,
                        badges: [],
                        thumbnails: [{ url: 'https://example.invalid/youtube-chat-avatar.jpg' }]
                    },
                    message: { text: 'Hello avatar' }
                }
            };

            const normalized = normalizeYouTubeMessage(chatItem, 'youtube');

            expect(normalized.avatarUrl).toBe('https://example.invalid/youtube-chat-avatar.jpg');
        });

        test('trims YouTube author thumbnail URLs before mapping avatarUrl', () => {
            const timestampMs = testClock.now();
            const chatItem = {
                item: {
                    id: 'yt-avatar-trim-123',
                    timestamp: timestampMs,
                    author: {
                        id: 'UCtrim123',
                        name: 'trimuser',
                        is_moderator: false,
                        badges: [],
                        thumbnails: [{ url: '  https://example.invalid/youtube-chat-avatar-trim.jpg  ' }]
                    },
                    message: { text: 'Hello avatar trim' }
                }
            };

            const normalized = normalizeYouTubeMessage(chatItem, 'youtube');

            expect(normalized.avatarUrl).toBe('https://example.invalid/youtube-chat-avatar-trim.jpg');
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
                        is_moderator: false,
                        badges: []
                    },
                    superchat: {
                        amount: 5.00,
                        currency: 'USD',
                        message: 'Super chat message!'
                    }
                }
            };

            const normalized = normalizeYouTubeMessage(superChatItem, 'youtube');

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

            expect(() => normalizeYouTubeMessage(incompleteChatItem, 'youtube'))
                .toThrow('Missing YouTube chat item payload');
        });

        test('detects moderator from is_moderator field', () => {
            const timestampMs = testClock.now();
            const chatItem = {
                item: {
                    id: 'yt-mod-123',
                    timestamp: timestampMs,
                    author: {
                        id: 'UCmod123',
                        name: 'testModerator',
                        is_moderator: true,
                        badges: []
                    },
                    message: { text: 'Mod message' }
                }
            };

            const normalized = normalizeYouTubeMessage(chatItem, 'youtube');

            expect(normalized.isMod).toBe(true);
            expect(normalized.isBroadcaster).toBe(false);
        });

        test('detects broadcaster from OWNER badge', () => {
            const timestampMs = testClock.now();
            const chatItem = {
                item: {
                    id: 'yt-owner-123',
                    timestamp: timestampMs,
                    author: {
                        id: 'UCowner123',
                        name: 'testChannel',
                        is_moderator: false,
                        badges: [
                            { type: 'LiveChatAuthorBadge', icon_type: 'OWNER', tooltip: 'Owner' }
                        ]
                    },
                    message: { text: 'Owner message' }
                }
            };

            const normalized = normalizeYouTubeMessage(chatItem, 'youtube');

            expect(normalized.isBroadcaster).toBe(true);
            expect(normalized.isMod).toBe(false);
        });

        test('detects channel member from member badge tooltip', () => {
            const timestampMs = testClock.now();
            const chatItem = {
                item: {
                    id: 'yt-member-check',
                    timestamp: timestampMs,
                    author: {
                        id: 'UCuser123',
                        name: 'testUser',
                        is_moderator: false,
                        badges: [
                            { type: 'LiveChatAuthorBadge', tooltip: 'Member (1 month)' }
                        ]
                    },
                    message: { text: 'Member message' }
                }
            };

            const normalized = normalizeYouTubeMessage(chatItem, 'youtube');

            expect(normalized.isSubscriber).toBe(true);
        });

        test('detects new member from badge tooltip', () => {
            const timestampMs = testClock.now();
            const chatItem = {
                item: {
                    id: 'yt-new-member',
                    timestamp: timestampMs,
                    author: {
                        id: 'UCnew123',
                        name: 'newMember',
                        is_moderator: false,
                        badges: [
                            { type: 'LiveChatAuthorBadge', tooltip: 'New member' }
                        ]
                    },
                    message: { text: 'New member message' }
                }
            };

            const normalized = normalizeYouTubeMessage(chatItem, 'youtube');

            expect(normalized.isSubscriber).toBe(true);
        });

        test('returns false for isSubscriber when no member badge present', () => {
            const timestampMs = testClock.now();
            const chatItem = {
                item: {
                    id: 'yt-no-member',
                    timestamp: timestampMs,
                    author: {
                        id: 'UCuser456',
                        name: 'regularUser',
                        is_moderator: false,
                        badges: [
                            { type: 'LiveChatAuthorBadge', icon_type: 'VERIFIED', tooltip: 'Verified' }
                        ]
                    },
                    message: { text: 'Regular message' }
                }
            };

            const normalized = normalizeYouTubeMessage(chatItem, 'youtube');

            expect(normalized.isSubscriber).toBe(false);
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

            const normalized = normalizeTikTokMessage(data, 'tiktok');

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

            const normalized = normalizeTikTokMessage(giftData, 'tiktok-gift');

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

            expect(() => normalizeTikTokMessage(incompleteData, 'tiktok'))
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

            const normalized = normalizeTikTokMessage(data, 'tiktok');

            expect(normalized.metadata).toMatchObject({
                profilePicture: 'avatar-fallback.jpg',
                followRole: 'follower',
                userBadges: ['badge-1'],
                numericId: 'tt-456'
            });
        });

        test('normalizes emote-only TikTok chat into canonical metadata.messageParts', () => {
            const data = {
                user: {
                    userId: 'tt-789',
                    uniqueId: 'tiktokuser789',
                    nickname: 'TikTokEmoteUser'
                },
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
                common: { createTime: testClock.now() }
            };

            const normalized = normalizeTikTokMessage(data, 'tiktok');

            expect(normalized.message).toBe('');
            expect(normalized.metadata.messageParts).toEqual([
                {
                    type: 'emote',
                    platform: 'tiktok',
                    emoteId: '1234512345123451234',
                    imageUrl: 'https://example.invalid/tiktok-emote.webp',
                    placeInComment: 0
                }
            ]);
        });

        test('normalizes mixed TikTok text and emote content into ordered message parts', () => {
            const data = {
                user: {
                    userId: 'tt-790',
                    uniqueId: 'tiktokuser790',
                    nickname: 'TikTokMixedUser'
                },
                comment: 'hi all',
                emotes: [
                    {
                        placeInComment: 2,
                        emote: {
                            emoteId: '1234512346',
                            image: {
                                imageUrl: 'https://example.invalid/tiktok-emote-2.webp'
                            }
                        }
                    }
                ],
                common: { createTime: testClock.now() }
            };

            const normalized = normalizeTikTokMessage(data, 'tiktok');

            expect(normalized.message).toBe('hi all');
            expect(normalized.metadata.messageParts).toEqual([
                {
                    type: 'text',
                    text: 'hi'
                },
                {
                    type: 'emote',
                    platform: 'tiktok',
                    emoteId: '1234512346',
                    imageUrl: 'https://example.invalid/tiktok-emote-2.webp',
                    placeInComment: 2
                },
                {
                    type: 'text',
                    text: ' all'
                }
            ]);
        });

        test('adjusts insertion indexes for sequential emotes placed beyond comment length', () => {
            const data = {
                user: {
                    userId: 'tt-791',
                    uniqueId: 'tiktokuser791',
                    nickname: 'TikTokSequentialEmotes'
                },
                comment: 'I watched your LIVE for 100 minutes!',
                emotes: [
                    {
                        placeInComment: 36,
                        emote: {
                            emoteId: '12345123456',
                            image: {
                                imageUrl: 'https://example.invalid/milestone-1.webp'
                            }
                        }
                    },
                    {
                        placeInComment: 37,
                        emote: {
                            emoteId: '12345123457',
                            image: {
                                imageUrl: 'https://example.invalid/milestone-2.webp'
                            }
                        }
                    },
                    {
                        placeInComment: 38,
                        emote: {
                            emoteId: '12345123458',
                            image: {
                                imageUrl: 'https://example.invalid/milestone-3.webp'
                            }
                        }
                    }
                ],
                common: { createTime: testClock.now() }
            };

            const normalized = normalizeTikTokMessage(data, 'tiktok');

            expect(normalized.metadata.messageParts).toEqual([
                {
                    type: 'text',
                    text: 'I watched your LIVE for 100 minutes!'
                },
                {
                    type: 'emote',
                    platform: 'tiktok',
                    emoteId: '12345123456',
                    imageUrl: 'https://example.invalid/milestone-1.webp',
                    placeInComment: 36
                },
                {
                    type: 'emote',
                    platform: 'tiktok',
                    emoteId: '12345123457',
                    imageUrl: 'https://example.invalid/milestone-2.webp',
                    placeInComment: 37
                },
                {
                    type: 'emote',
                    platform: 'tiktok',
                    emoteId: '12345123458',
                    imageUrl: 'https://example.invalid/milestone-3.webp',
                    placeInComment: 38
                }
            ]);
        });

        test('keeps text slicing stable when multiple emotes share the same placement index', () => {
            const data = {
                user: {
                    userId: 'tt-792',
                    uniqueId: 'tiktokuser792',
                    nickname: 'TikTokSharedPlacement'
                },
                comment: 'abc',
                emotes: [
                    {
                        placeInComment: 1,
                        emote: {
                            emoteId: '12345123',
                            image: {
                                imageUrl: 'https://example.invalid/shared-1.webp'
                            }
                        }
                    },
                    {
                        placeInComment: 1,
                        emote: {
                            emoteId: '12345124',
                            image: {
                                imageUrl: 'https://example.invalid/shared-2.webp'
                            }
                        }
                    }
                ],
                common: { createTime: testClock.now() }
            };

            const normalized = normalizeTikTokMessage(data, 'tiktok');

            expect(normalized.metadata.messageParts).toEqual([
                {
                    type: 'text',
                    text: 'a'
                },
                {
                    type: 'emote',
                    platform: 'tiktok',
                    emoteId: '12345123',
                    imageUrl: 'https://example.invalid/shared-1.webp',
                    placeInComment: 1
                },
                {
                    type: 'emote',
                    platform: 'tiktok',
                    emoteId: '12345124',
                    imageUrl: 'https://example.invalid/shared-2.webp',
                    placeInComment: 1
                },
                {
                    type: 'text',
                    text: 'bc'
                }
            ]);
        });
    });

    describe('when extracting Twitch message data', () => {
        test('builds canonical Twitch message parts using animated dark 3.0 emote URLs', () => {
            const parts = buildTwitchMessageParts({
                fragments: [
                    {
                        type: 'emote',
                        text: 'testEmote',
                        emote: {
                            id: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                            format: ['static', 'animated']
                        }
                    },
                    {
                        type: 'text',
                        text: ' test message '
                    },
                    {
                        type: 'emote',
                        text: 'testEmote',
                        emote: {
                            id: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                            format: ['static', 'animated']
                        }
                    }
                ]
            });

            expect(parts).toEqual([
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
                }
            ]);
        });

        test('ignores invalid Twitch emote fragments without throwing', () => {
            const parts = buildTwitchMessageParts({
                fragments: [
                    {
                        type: 'emote',
                        text: 'invalid-id',
                        emote: {
                            id: '   ',
                            format: ['animated']
                        }
                    },
                    {
                        type: 'emote',
                        text: 'invalid-format',
                        emote: {
                            id: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                            format: []
                        }
                    },
                    {
                        type: 'text',
                        text: ' hello world '
                    }
                ]
            });

            expect(parts).toEqual([
                {
                    type: 'text',
                    text: ' hello world '
                }
            ]);
        });

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
                { text: 'friend' }
            ];

            const extracted = extractYouTubeMessageText(messageObj);

            expect(extracted).toBe('Hello :wave:friend');
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
            expect(extractYouTubeMessageText(null)).toBe('');
            expect(extractYouTubeMessageText(undefined)).toBe('');
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

        test('returns errors when message is not an object', () => {
            const validation = validateNormalizedMessage(null);

            expect(validation.isValid).toBe(false);
            expect(validation.errors).toContain('Message is not an object');
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

    describe('Timestamp Preservation Behavior', () => {
        describe('TikTok Timestamp Preservation', () => {
            test('preserves common.createTime from TikTok message data', () => {
                const originalTime = testClock.now() - (5 * 60 * 1000);
                const tikTokData = {
                    user: {
                        userId: '1234',
                        uniqueId: 'TestUser',
                        nickname: 'Test User'
                    },
                    common: {
                        createTime: originalTime
                    },
                    comment: 'Test message with original timestamp'
                };

                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok');

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

                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok');

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

                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok');
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

                const normalized = normalizeTikTokMessage(tikTokData, 'tiktok');

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

                const normalized = normalizeYouTubeMessage(youTubeData, 'youtube');

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

                const normalized = normalizeYouTubeMessage(youTubeData, 'youtube');

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

                expect(() => normalizeYouTubeMessage(youTubeData, 'youtube'))
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

                const normalizedTikTok = normalizeTikTokMessage(tikTokData, 'tiktok');
                const normalizedYouTube = normalizeYouTubeMessage(youTubeData, 'youtube');
                const tikTokTime = new Date(normalizedTikTok.timestamp).getTime();
                const youTubeTime = new Date(normalizedYouTube.timestamp).getTime();
                expect(tikTokTime).toBe(baseTime);
                expect(youTubeTime).toBe(baseTime);
                [normalizedTikTok, normalizedYouTube].forEach(normalized => {
                    expect(normalized.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
                });
            });
        });

    });
});
