const { PlatformEvents, PlatformEventValidator } = require('../../../../../src/interfaces/PlatformEvents');
const { DEFAULT_AVATAR_URL } = require('../../../../../src/constants/avatar');

describe('TikTok event factory behavior', () => {
    it('includes boolean fields in chat message events', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            generateCorrelationId: () => 'corr-chat-123'
        });

        const event = eventFactory.createChatMessage({}, {
            normalizedData: {
                userId: 'test-user-id',
                username: 'test-username',
                message: 'test message',
                avatarUrl: 'https://example.invalid/tiktok-chat-avatar.jpg',
                timestamp: '2026-01-30T12:00:00.000Z',
                isMod: true,
                isPaypiggy: false,
                isBroadcaster: true
            }
        });

        expect(event.type).toBe(PlatformEvents.CHAT_MESSAGE);
        expect(event.platform).toBe('tiktok');
        expect(event.isMod).toBe(true);
        expect(event.isPaypiggy).toBe(false);
        expect(event.isBroadcaster).toBe(true);
        expect(event.avatarUrl).toBe('https://example.invalid/tiktok-chat-avatar.jpg');
    });

    it('accepts canonical message object text for chat message events', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            generateCorrelationId: () => 'corr-chat-object-123'
        });

        const event = eventFactory.createChatMessage({}, {
            normalizedData: {
                userId: 'test-user-id',
                username: 'test-username',
                message: {
                    text: '  test object message  '
                },
                timestamp: '2026-01-30T12:00:00.000Z'
            }
        });

        expect(event.message).toEqual({
            text: 'test object message'
        });
    });

    it('emits canonical badgeImages for chat message events', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            generateCorrelationId: () => 'corr-chat-badges-123'
        });

        const event = eventFactory.createChatMessage({}, {
            normalizedData: {
                userId: 'test-user-id',
                username: 'test-username',
                message: {
                    text: 'test message'
                },
                badgeImages: [
                    { imageUrl: '   ', source: 'tiktok', label: 'invalid' },
                    { imageUrl: ' https://example.invalid/badge-1.png ', source: 'tiktok', label: 'Level 22' },
                    { imageUrl: 'https://example.invalid/badge-1.png', source: 'tiktok', label: 'Level 22' },
                    { imageUrl: 'https://example.invalid/badge-2.png', source: 'tiktok', label: 'Fans' }
                ],
                timestamp: '2026-01-30T12:00:00.000Z'
            }
        });

        expect(event.badgeImages).toEqual([
            { imageUrl: 'https://example.invalid/badge-1.png', source: 'tiktok', label: 'Level 22' },
            { imageUrl: 'https://example.invalid/badge-2.png', source: 'tiktok', label: 'Fans' }
        ]);
    });

    it('preserves avatarUrl on gift events', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            getPlatformMessageId: () => 'test-msg-id-1'
        });

        const event = eventFactory.createGift({
            userId: 'test-user-id',
            username: 'test-username',
            avatarUrl: 'https://example.invalid/tiktok-gift-avatar.jpg',
            giftImageUrl: 'https://example.invalid/tiktok-gifts/rose.webp',
            giftType: 'Rose',
            giftCount: 1,
            amount: 1,
            unitAmount: 1,
            currency: 'coins',
            timestamp: '2026-01-30T12:00:00.000Z'
        });

        expect(event.avatarUrl).toBe('https://example.invalid/tiktok-gift-avatar.jpg');
        expect(event.giftImageUrl).toBe('https://example.invalid/tiktok-gifts/rose.webp');
    });

    it('preserves avatarUrl on follow events', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok'
        });

        const event = eventFactory.createFollow({
            userId: 'test-user-id',
            username: 'test-username',
            avatarUrl: 'https://example.invalid/tiktok-follow-avatar.jpg',
            timestamp: '2026-01-30T12:00:00.000Z'
        });

        expect(event.avatarUrl).toBe('https://example.invalid/tiktok-follow-avatar.jpg');
    });

    it('emits fallback avatarUrl for follow events when payload avatar is missing', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok'
        });

        const event = eventFactory.createFollow({
            userId: 'test-user-id',
            username: 'test-username',
            timestamp: '2026-01-30T12:00:00.000Z'
        });

        expect(event.avatarUrl).toBe(DEFAULT_AVATAR_URL);
    });

    it('emits fallback avatarUrl for gift events when payload avatar is missing', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            getPlatformMessageId: () => 'test-msg-id-fallback'
        });

        const event = eventFactory.createGift({
            userId: 'test-user-id',
            username: 'test-username',
            giftType: 'Rose',
            giftCount: 1,
            amount: 1,
            unitAmount: 1,
            currency: 'coins',
            timestamp: '2026-01-30T12:00:00.000Z'
        });

        expect(event.avatarUrl).toBe(DEFAULT_AVATAR_URL);
    });

    it('defaults boolean fields to false when not provided', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            generateCorrelationId: () => 'corr-chat-456'
        });

        const event = eventFactory.createChatMessage({}, {
            normalizedData: {
                userId: 'test-user-id',
                username: 'test-username',
                message: 'test message',
                timestamp: '2026-01-30T12:00:00.000Z'
            }
        });

        expect(event.isMod).toBe(false);
        expect(event.isPaypiggy).toBe(false);
        expect(event.isBroadcaster).toBe(false);
    });

    it('builds error events with top-level timestamp', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            generateCorrelationId: () => 'corr-error-123'
        });

        const error = new Error('Connection failed');
        error.name = 'ConnectionError';

        const event = eventFactory.createError(error, { operation: 'connect' });

        expect(event.type).toBe(PlatformEvents.ERROR);
        expect(event.platform).toBe('tiktok');
        expect(event.error).toEqual({
            message: 'Connection failed',
            name: 'ConnectionError'
        });
        expect(event.context).toEqual({
            operation: 'connect',
            correlationId: 'corr-error-123'
        });
        expect(event.recoverable).toBe(true);
        expect(event.timestamp).toBeDefined();
        expect(typeof event.timestamp).toBe('string');
        expect(event.metadata.timestamp).toBeUndefined();
    });

    it('produces connection lifecycle events that satisfy platform schemas', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            generateCorrelationId: () => 'corr-connection-123'
        });
        const validator = new PlatformEventValidator();

        const connected = eventFactory.createConnection('test-connection-id');
        const disconnected = eventFactory.createDisconnection('stream ended', true);

        expect(validator.validate(connected)).toEqual({ valid: true, errors: [] });
        expect(validator.validate(disconnected)).toEqual({ valid: true, errors: [] });
    });

    it('rejects chat events when text is empty and message parts are missing', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            generateCorrelationId: () => 'corr-chat-empty-123'
        });

        expect(() => eventFactory.createChatMessage({}, {
            normalizedData: {
                userId: 'test-user-id',
                username: 'test-username',
                message: '   ',
                timestamp: '2026-01-30T12:00:00.000Z'
            }
        })).toThrow('Missing TikTok message text');
    });

    it('emits canonical message.parts for emote-only chat payloads', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            generateCorrelationId: () => 'corr-chat-parts-only'
        });

        const event = eventFactory.createChatMessage({}, {
            normalizedData: {
                userId: 'test-user-id',
                username: 'test-username',
                message: {
                    text: '',
                    parts: [
                        {
                            type: 'emote',
                            platform: 'tiktok',
                            emoteId: '1234512345',
                            imageUrl: 'https://example.invalid/tiktok-emote.webp'
                        }
                    ]
                },
                timestamp: '2026-01-30T12:00:00.000Z'
            }
        });

        expect(event.message).toEqual({
            text: '',
            parts: [
                {
                    type: 'emote',
                    platform: 'tiktok',
                    emoteId: '1234512345',
                    imageUrl: 'https://example.invalid/tiktok-emote.webp'
                }
            ]
        });
    });

    it('creates subscription paypiggy event with canonical payload fields', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok'
        });

        const event = eventFactory.createSubscription({
            user: {
                userId: '7000000000000000000',
                uniqueId: 'test_subscriber',
                nickname: 'TestSubscriber',
                profilePicture: {
                    url: ['https://example.invalid/sub-avatar.webp']
                }
            },
            tier: 'tier-1',
            months: 3,
            message: 'happy to support',
            timestamp: '2026-01-30T12:00:00.000Z'
        });

        expect(event).toEqual(expect.objectContaining({
            type: PlatformEvents.PAYPIGGY,
            platform: 'tiktok',
            username: 'TestSubscriber',
            userId: 'test_subscriber',
            avatarUrl: DEFAULT_AVATAR_URL,
            tier: 'tier-1',
            months: 3,
            message: 'happy to support'
        }));
    });

    it('creates superfan paypiggy event with superfan tier', () => {
        const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

        const eventFactory = createTikTokEventFactory({
            platformName: 'tiktok'
        });

        const event = eventFactory.createSuperfan({
            user: {
                userId: '7000000000000000001',
                uniqueId: 'test_superfan',
                nickname: 'TestSuperfan'
            },
            months: 2,
            message: 'superfan hype',
            timestamp: '2026-01-30T12:00:00.000Z'
        });

        expect(event).toEqual(expect.objectContaining({
            type: PlatformEvents.PAYPIGGY,
            platform: 'tiktok',
            username: 'TestSuperfan',
            userId: 'test_superfan',
            tier: 'superfan',
            months: 2,
            message: 'superfan hype'
        }));
    });
});
