const { createTwitchEventFactory } = require('../../../../src/platforms/twitch/events/twitch-event-factory');
const { PlatformEvents } = require('../../../../src/interfaces/PlatformEvents');

describe('Twitch event factory', () => {
    const fixedNow = '2025-01-01T00:00:00.000Z';
    const createFactory = (overrides = {}) => createTwitchEventFactory({
        platformName: 'twitch',
        generateCorrelationId: () => 'cid-fixed',
        ...overrides
    });

    test('creates follow event with normalized user and metadata', () => {
        const factory = createFactory();

        const event = factory.createFollowEvent({
            userId: 'u1',
            username: 'TestUser',
            timestamp: fixedNow
        });

        expect(event).toEqual(expect.objectContaining({
            type: PlatformEvents.FOLLOW,
            platform: 'twitch',
            username: 'TestUser',
            userId: 'u1',
            timestamp: fixedNow,
            metadata: {
                platform: 'twitch',
                correlationId: 'cid-fixed'
            }
        }));
    });

    test('creates paypiggy event with canonical months + renewal detection', () => {
        const factory = createFactory();

        const event = factory.createPaypiggyEvent({
            userId: 'u2',
            username: 'SubUser',
            months: '2',
            tier: '2000',
            isGift: true,
            message: 'Great stream',
            timestamp: fixedNow
        });

        expect(event).toEqual(expect.objectContaining({
            type: PlatformEvents.PAYPIGGY,
            platform: 'twitch',
            username: 'SubUser',
            userId: 'u2',
            tier: '2000',
            isGift: true,
            message: 'Great stream',
            months: 2,
            isRenewal: true,
            timestamp: fixedNow,
            metadata: {
                platform: 'twitch',
                correlationId: 'cid-fixed'
            }
        }));
    });

    test('creates paypiggy message event and keeps isGift false', () => {
        const factory = createFactory();

        const event = factory.createPaypiggyMessageEvent({
            userId: 'u3',
            username: 'ResubUser',
            tier: '1000',
            months: 2,
            message: 'Back again',
            isGift: false,
            timestamp: fixedNow
        });

        expect(event).toEqual(expect.objectContaining({
            type: PlatformEvents.PAYPIGGY,
            platform: 'twitch',
            tier: '1000',
            isGift: false,
            months: 2,
            isRenewal: true,
            message: 'Back again',
            timestamp: fixedNow
        }));
    });

    test('creates gift paypiggy event with normalized giftCount', () => {
        const factory = createFactory();

        const event = factory.createGiftPaypiggyEvent({
            userId: 'u4',
            username: 'GiftUser',
            giftCount: 10,
            tier: '1000',
            timestamp: fixedNow
        });

        expect(event).toEqual(expect.objectContaining({
            type: PlatformEvents.GIFTPAYPIGGY,
            platform: 'twitch',
            giftCount: 10,
            tier: '1000',
            isGift: true,
            timestamp: fixedNow
        }));
    });

    test('creates gift event and preserves cheermote info', () => {
        const factory = createFactory();

        const event = factory.createGiftEvent({
            userId: 'u5',
            username: 'CheerUser',
            giftType: 'bits',
            giftCount: 1,
            amount: 250,
            currency: 'bits',
            message: 'Nice!',
            id: 'cheer-id-1',
            repeatCount: 1,
            cheermoteInfo: { name: 'Cheer250' },
            isBits: true,
            timestamp: fixedNow
        });

        expect(event).toEqual(expect.objectContaining({
            type: PlatformEvents.GIFT,
            platform: 'twitch',
            giftType: 'bits',
            giftCount: 1,
            amount: 250,
            currency: 'bits',
            message: 'Nice!',
            id: 'cheer-id-1',
            repeatCount: 1,
            timestamp: fixedNow,
            cheermoteInfo: { name: 'Cheer250' },
            isBits: true,
            metadata: expect.objectContaining({
                platform: 'twitch',
                correlationId: 'cid-fixed'
            })
        }));
    });

    test('creates stream status events with deterministic timestamps', () => {
        const factory = createFactory();

        const online = factory.createStreamOnlineEvent({ timestamp: fixedNow });
        const offline = factory.createStreamOfflineEvent({ timestamp: fixedNow });

        expect(online).toEqual(expect.objectContaining({
            type: PlatformEvents.STREAM_STATUS,
            platform: 'twitch',
            isLive: true,
            timestamp: fixedNow
        }));

        expect(offline).toEqual(expect.objectContaining({
            type: PlatformEvents.STREAM_STATUS,
            platform: 'twitch',
            isLive: false,
            timestamp: fixedNow
        }));
    });
});
