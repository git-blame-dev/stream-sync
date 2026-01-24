const { PlatformEvents } = require('../../../../../src/interfaces/PlatformEvents');

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
        expect(event.isSubscriber).toBe(false);
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
            id: 'gift-123',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 10,
            currency: 'USD',
            message: 'Thanks!',
            timestamp: '2024-01-01T00:00:00.000Z'
        });
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
            giftCount: 5,
            id: 'giftpay-456',
            timestamp: '2024-01-01T00:00:00.000Z'
        });
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
            membershipLevel: 'Gold',
            months: 3,
            timestamp: '2024-01-01T00:00:00.000Z'
        });
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
