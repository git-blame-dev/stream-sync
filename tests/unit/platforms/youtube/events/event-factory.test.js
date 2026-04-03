const { PlatformEvents } = require('../../../../../src/interfaces/PlatformEvents');
const { DEFAULT_AVATAR_URL } = require('../../../../../src/constants/avatar');

const FALLBACK_AVATAR_URL = DEFAULT_AVATAR_URL;

describe('YouTube event factory behavior', () => {
    it('builds chat-connected events with deterministic timestamp', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            nowIso: () => '2024-01-01T00:00:00.000Z',
            generateCorrelationId: () => 'corr-ignored'
        });

        const event = eventFactory.createChatConnectedEvent({
            videoId: 'video-123',
            connectionId: 'youtube-video-123',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(event).toEqual({
            type: PlatformEvents.CHAT_CONNECTED,
            platform: 'youtube',
            videoId: 'video-123',
            connectionId: 'youtube-video-123',
            timestamp: '2024-01-01T00:00:00.000Z'
        });
    });

    it('builds chat-message events matching the platform contract', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            nowIso: () => '2024-01-01T00:00:00.000Z',
            generateCorrelationId: () => 'corr-123'
        });

        const event = eventFactory.createChatMessageEvent({
            userId: 'user-id',
            authorChannelId: 'author-channel-id',
            username: 'user',
            authorName: 'user-alt',
            displayName: 'User',
            message: 'Hello world',
            timestamp: '2024-01-01T00:00:00.111Z',
            videoId: 'vid-1',
            isMod: false,
            isOwner: false,
            isVerified: true
        });

        expect(event.type).toBe(PlatformEvents.CHAT_MESSAGE);
        expect(event.platform).toBe('youtube');
        expect(event.username).toBe('user');
        expect(event.userId).toBe('user-id');
        expect(event.message).toEqual({ text: 'Hello world' });
        expect(event.timestamp).toBe('2024-01-01T00:00:00.111Z');
        expect(event.isMod).toBe(false);
        expect(event.isPaypiggy).toBe(false);
        expect(event.isBroadcaster).toBe(false);
        expect(event.metadata).toEqual({
            platform: 'youtube',
            videoId: 'vid-1',
            isMod: false,
            isOwner: false,
            isVerified: true,
            correlationId: 'corr-123'
        });
    });

    it('uses canonical message.parts from message object', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            generateCorrelationId: () => 'corr-parts-1'
        });

        const event = eventFactory.createChatMessageEvent({
            userId: 'test-user-id',
            username: 'test-user',
            avatarUrl: 'https://example.invalid/test-youtube-avatar-with-parts.jpg',
            videoId: 'test-video-id-with-parts',
            isMod: true,
            isOwner: false,
            isVerified: true,
            message: {
                text: '',
                parts: [
                    {
                        type: 'emote',
                        emoteId: ' UC_TEST_EMOTE_200/TEST_EMOTE_200 ',
                        imageUrl: ' https://yt3.ggpht.example.invalid/test-200=w48-h48-c-k-nd '
                    }
                ]
            },
            timestamp: '2024-01-01T00:00:00.111Z'
        });

        expect(event.message).toEqual({
            text: '',
            parts: [
                {
                    type: 'emote',
                    platform: 'youtube',
                    emoteId: 'UC_TEST_EMOTE_200/TEST_EMOTE_200',
                    imageUrl: 'https://yt3.ggpht.example.invalid/test-200=w48-h48-c-k-nd'
                }
            ]
        });
        expect(event.avatarUrl).toBe('https://example.invalid/test-youtube-avatar-with-parts.jpg');
        expect(event.metadata).toEqual({
            platform: 'youtube',
            videoId: 'test-video-id-with-parts',
            isMod: true,
            isOwner: false,
            isVerified: true,
            correlationId: 'corr-parts-1'
        });
    });

    it('emits text-only message when canonical message.parts is unavailable', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            generateCorrelationId: () => 'corr-parts-2'
        });

        const event = eventFactory.createChatMessageEvent({
            userId: 'test-user-id',
            username: 'test-user',
            message: {
                text: 'hello'
            },
            timestamp: '2024-01-01T00:00:00.111Z'
        });

        expect(event.message).toEqual({ text: 'hello' });
    });

    it('filters invalid message parts and preserves no-parts shape when all are invalid', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            generateCorrelationId: () => 'corr-parts-3'
        });

        const event = eventFactory.createChatMessageEvent({
            userId: 'test-user-id',
            username: 'test-user',
            message: {
                text: 'test',
                parts: [
                    { type: 'text', text: '' },
                    { type: 'emote', emoteId: '   ', imageUrl: 'https://yt3.ggpht.example.invalid/invalid=w48-h48-c-k-nd' }
                ]
            },
            timestamp: '2024-01-01T00:00:00.111Z'
        });

        expect(event.message).toEqual({ text: 'test' });
    });

    it('supports text sources from string message and object message.text', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            generateCorrelationId: () => 'corr-parts-4'
        });

        const fromString = eventFactory.createChatMessageEvent({
            userId: 'test-user-id-a',
            username: 'test-user-a',
            message: 'string message',
            timestamp: '2024-01-01T00:00:00.111Z'
        });
        const fromObject = eventFactory.createChatMessageEvent({
            userId: 'test-user-id-b',
            username: 'test-user-b',
            message: { text: 'object message' },
            timestamp: '2024-01-01T00:00:00.222Z'
        });

        expect(fromString.message).toEqual({ text: 'string message' });
        expect(fromObject.message).toEqual({ text: 'object message' });
    });

    it('preserves avatarUrl on chat-message events', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            generateCorrelationId: () => 'corr-avatar-chat'
        });

        const event = eventFactory.createChatMessageEvent({
            userId: 'user-id',
            username: 'user',
            message: 'Hello world',
            avatarUrl: 'https://example.invalid/youtube-chat-avatar.jpg',
            timestamp: '2024-01-01T00:00:00.111Z'
        });

        expect(event.avatarUrl).toBe('https://example.invalid/youtube-chat-avatar.jpg');
    });

    it('emits canonical badgeImages on chat-message events', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            generateCorrelationId: () => 'corr-badges-chat'
        });

        const event = eventFactory.createChatMessageEvent({
            userId: 'test-user-id-badge',
            username: 'test-user-badge',
            message: 'Hello world',
            badgeImages: [
                { imageUrl: '   ', source: 'youtube', label: 'invalid' },
                { imageUrl: ' https://example.invalid/member-s32.png ', source: 'youtube', label: 'Member (6 months)' },
                { imageUrl: 'https://example.invalid/member-s32.png', source: 'youtube', label: 'Member (6 months)' },
                { imageUrl: 'https://example.invalid/member-s16.png', source: 'youtube', label: 'Member (6 months)' }
            ],
            timestamp: '2024-01-01T00:00:00.111Z'
        });

        expect(event.badgeImages).toEqual([
            { imageUrl: 'https://example.invalid/member-s32.png', source: 'youtube', label: 'Member (6 months)' },
            { imageUrl: 'https://example.invalid/member-s16.png', source: 'youtube', label: 'Member (6 months)' }
        ]);
    });

    it('rejects chat-message events missing timestamp', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            nowIso: () => '2024-01-01T00:00:00.000Z',
            generateCorrelationId: () => 'corr-123'
        });

        expect(() => eventFactory.createChatMessageEvent({
            userId: 'user-id',
            authorChannelId: 'author-channel-id',
            username: 'user',
            authorName: 'user-alt',
            displayName: 'User',
            message: 'Hello world',
            videoId: 'vid-1',
            isMod: false,
            isOwner: false,
            isVerified: false
        })).toThrow('YouTube chat message event requires timestamp');
    });

    it('rejects chat-message events missing canonical identity fields', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            generateCorrelationId: () => 'corr-identity'
        });

        expect(() => eventFactory.createChatMessageEvent({
            userId: '',
            username: '   ',
            message: 'Hello world',
            timestamp: '2024-01-01T00:00:00.111Z'
        })).toThrow('YouTube event payload requires userId and username');
    });

    it('allows degraded chat events when metadata.missingFields marks missing identity and timestamp', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            generateCorrelationId: () => 'corr-youtube-missing-identity'
        });

        const event = eventFactory.createChatMessageEvent({
            message: {
                text: 'partial youtube chat message'
            },
            metadata: {
                missingFields: ['userId', 'username', 'timestamp']
            }
        });

        expect(event.username).toBe('Unknown Username');
        expect(event.userId).toBeUndefined();
        expect(event.timestamp).toBeUndefined();
        expect(event.message).toEqual({ text: 'partial youtube chat message' });
        expect(event.metadata.missingFields).toEqual(['userId', 'username', 'timestamp']);
    });

    it('allows degraded chat events with unknown-message placeholder when message is marked missing', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            generateCorrelationId: () => 'corr-youtube-missing-message'
        });

        const event = eventFactory.createChatMessageEvent({
            metadata: {
                missingFields: ['message', 'userId', 'username', 'timestamp']
            }
        });

        expect(event.username).toBe('Unknown Username');
        expect(event.userId).toBeUndefined();
        expect(event.timestamp).toBeUndefined();
        expect(event.message).toEqual({ text: 'Unknown Message' });
        expect(event.metadata.missingFields).toEqual(['message', 'userId', 'username', 'timestamp']);
    });

    it('builds viewer-count events matching the current YouTube payload shape', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            nowIso: () => '2024-01-01T00:00:00.000Z',
            generateCorrelationId: () => 'corr-999'
        });

        const event = eventFactory.createViewerCountEvent({
            count: 12,
            streamId: 'stream-2',
            streamViewerCount: 7,
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(event).toEqual({
            type: PlatformEvents.VIEWER_COUNT,
            platform: 'youtube',
            count: 12,
            streamId: 'stream-2',
            streamViewerCount: 7,
            timestamp: '2024-01-01T00:00:00.000Z',
            metadata: {
                platform: 'youtube',
                correlationId: 'corr-999'
            }
        });
    });

    it('builds error events with metadata and context', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            nowIso: () => '2024-01-01T00:00:00.000Z',
            generateCorrelationId: () => 'corr-error'
        });

        const error = new Error('Boom');
        error.name = 'BoomError';

        const event = eventFactory.createErrorEvent({
            error,
            context: { operation: 'connect' },
            recoverable: false,
            videoId: 'video-1',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(event).toEqual({
            type: PlatformEvents.ERROR,
            platform: 'youtube',
            error: {
                message: 'Boom',
                name: 'BoomError'
            },
            context: { operation: 'connect' },
            recoverable: false,
            timestamp: '2024-01-01T00:00:00.000Z',
            metadata: {
                platform: 'youtube',
                videoId: 'video-1',
                correlationId: 'corr-error'
            }
        });
    });

    it('builds gift events with monetization fields', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            generateCorrelationId: () => 'corr-ignored'
        });

        const event = eventFactory.createGiftEvent({
            username: 'SuperChatUser',
            userId: 'user-123',
            id: 'gift-123',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 10,
            currency: 'USD',
            message: 'Thanks!',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(event).toEqual({
            type: PlatformEvents.GIFT,
            platform: 'youtube',
            username: 'SuperChatUser',
            userId: 'user-123',
            avatarUrl: FALLBACK_AVATAR_URL,
            id: 'gift-123',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 10,
            currency: 'USD',
            message: 'Thanks!',
            timestamp: '2024-01-01T00:00:00.000Z'
        });
    });

    it('preserves avatarUrl on gift events', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory();

        const event = eventFactory.createGiftEvent({
            username: 'SuperChatUser',
            userId: 'user-123',
            id: 'gift-123',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 10,
            currency: 'USD',
            avatarUrl: 'https://example.invalid/youtube-gift-avatar.jpg',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(event.avatarUrl).toBe('https://example.invalid/youtube-gift-avatar.jpg');
    });

    it('builds giftpaypiggy events with optional id', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            generateCorrelationId: () => 'corr-ignored'
        });

        const event = eventFactory.createGiftPaypiggyEvent({
            username: 'GiftGiver',
            userId: 'user-456',
            id: 'giftpay-456',
            giftCount: 5,
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(event).toEqual({
            type: PlatformEvents.GIFTPAYPIGGY,
            platform: 'youtube',
            username: 'GiftGiver',
            userId: 'user-456',
            avatarUrl: FALLBACK_AVATAR_URL,
            giftCount: 5,
            id: 'giftpay-456',
            timestamp: '2024-01-01T00:00:00.000Z'
        });
    });

    it('preserves avatarUrl on giftpaypiggy events', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory();

        const event = eventFactory.createGiftPaypiggyEvent({
            username: 'GiftGiver',
            userId: 'user-456',
            giftCount: 5,
            avatarUrl: 'https://example.invalid/youtube-giftpaypiggy-avatar.jpg',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(event.avatarUrl).toBe('https://example.invalid/youtube-giftpaypiggy-avatar.jpg');
    });

    it('builds paypiggy events with membership metadata', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory({
            generateCorrelationId: () => 'corr-ignored'
        });

        const event = eventFactory.createPaypiggyEvent({
            username: 'MemberUser',
            userId: 'user-789',
            membershipLevel: 'Gold',
            months: 3,
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(event).toEqual({
            type: PlatformEvents.PAYPIGGY,
            platform: 'youtube',
            username: 'MemberUser',
            userId: 'user-789',
            avatarUrl: FALLBACK_AVATAR_URL,
            membershipLevel: 'Gold',
            months: 3,
            timestamp: '2024-01-01T00:00:00.000Z'
        });
    });

    it('preserves avatarUrl on paypiggy events', () => {
        const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

        const eventFactory = createYouTubeEventFactory();

        const event = eventFactory.createPaypiggyEvent({
            username: 'MemberUser',
            userId: 'user-789',
            avatarUrl: 'https://example.invalid/youtube-paypiggy-avatar.jpg',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        expect(event.avatarUrl).toBe('https://example.invalid/youtube-paypiggy-avatar.jpg');
    });

    describe('createViewerCountEvent validation', () => {
        it('rejects non-numeric count values', () => {
            const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

            const eventFactory = createYouTubeEventFactory({
                generateCorrelationId: () => 'corr-ignored'
            });

            expect(() => eventFactory.createViewerCountEvent({
                count: 'not-a-number',
                streamId: 'stream-1',
                timestamp: '2024-01-01T00:00:00.000Z'
            })).toThrow('YouTube viewer count event requires numeric count');
        });

        it('rejects NaN count values', () => {
            const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

            const eventFactory = createYouTubeEventFactory({
                generateCorrelationId: () => 'corr-ignored'
            });

            expect(() => eventFactory.createViewerCountEvent({
                count: NaN,
                streamId: 'stream-1',
                timestamp: '2024-01-01T00:00:00.000Z'
            })).toThrow('YouTube viewer count event requires numeric count');
        });

        it('rejects Infinity count values', () => {
            const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

            const eventFactory = createYouTubeEventFactory({
                generateCorrelationId: () => 'corr-ignored'
            });

            expect(() => eventFactory.createViewerCountEvent({
                count: Infinity,
                streamId: 'stream-1',
                timestamp: '2024-01-01T00:00:00.000Z'
            })).toThrow('YouTube viewer count event requires numeric count');
        });

        it('accepts numeric string count values via coercion', () => {
            const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

            const eventFactory = createYouTubeEventFactory({
                generateCorrelationId: () => 'corr-999'
            });

            const event = eventFactory.createViewerCountEvent({
                count: '42',
                streamId: 'stream-1',
                timestamp: '2024-01-01T00:00:00.000Z'
            });

            expect(event.count).toBe(42);
        });

        it('accepts zero count', () => {
            const { createYouTubeEventFactory } = require('../../../../../src/platforms/youtube/events/event-factory');

            const eventFactory = createYouTubeEventFactory({
                generateCorrelationId: () => 'corr-999'
            });

            const event = eventFactory.createViewerCountEvent({
                count: 0,
                streamId: 'stream-1',
                timestamp: '2024-01-01T00:00:00.000Z'
            });

            expect(event.count).toBe(0);
        });
    });
});
