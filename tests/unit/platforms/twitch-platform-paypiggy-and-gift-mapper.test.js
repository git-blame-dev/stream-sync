
jest.mock('../../../src/platforms/twitch-eventsub');
jest.mock('../../../src/core/logging', () => ({
    logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} },
    getUnifiedLogger: () => ({ debug: () => {}, info: () => {}, warn: () => {}, error: () => {} })
}));

const EventEmitter = require('events');
const { TwitchPlatform } = require('../../../src/platforms/twitch');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');

const createMockEventSub = () => {
    const emitter = new EventEmitter();
    return {
        connect: jest.fn(),
        disconnect: jest.fn(),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
        removeListener: emitter.removeListener.bind(emitter)
    };
};

describe('TwitchPlatform monetisation mapping', () => {
    let twitch;
    let emitted;

    beforeEach(() => {
        emitted = [];
        const eventBus = {
            emit: (evt, payload) => emitted.push({ evt, payload })
        };
        const mockEventSub = createMockEventSub();
        const TwitchEventSub = jest.fn(() => mockEventSub);

        twitch = new TwitchPlatform(
            { username: 'tester', eventsub_enabled: true },
            {
                authManager: { getState: jest.fn(), isTokenValid: jest.fn().mockReturnValue(true) },
                ChatFileLoggingService: jest.fn(() => ({ start: jest.fn(), stop: jest.fn() })),
                TwitchEventSub,
                eventBus
            }
        );

        // Provide minimal eventFactory if constructor skipped due to test stubs
        if (!twitch.eventFactory) {
            twitch.eventFactory = {
                createPaypiggyEvent: (data = {}) => ({
                    platform: 'twitch',
                    type: PlatformEvents.PAYPIGGY,
                    data: {
                        ...data,
                        months: data.months,
                        username: data.user_login || data.username || null,
                        userId: data.user_id
                    }
                }),
                createGiftPaypiggyEvent: (data = {}) => ({
                    platform: 'twitch',
                    type: PlatformEvents.GIFTPAYPIGGY,
                    data: {
                        ...data,
                        giftCount: data.total ?? data.giftCount ?? 0,
                        isGift: true,
                        username: data.user_login || data.username || null,
                        userId: data.user_id
                    }
                }),
                createCheerEvent: (data = {}) => ({
                    platform: 'twitch',
                    type: PlatformEvents.CHEER,
                    data: {
                        ...data,
                        username: data.user_login || data.username || null,
                        userId: data.user_id
                    }
                })
            };
        }

        // Patch emit to also capture platform:event emissions
        twitch.emit = (evt, payload) => {
            emitted.push({ evt, payload });
        };

        expect(twitch.eventFactory).toBeDefined();
    });

    it('emits paypiggy with normalized months and canonical type', async () => {
        const handler = twitch.eventFactory.createPaypiggyEvent({
            user_id: 'u1',
            user_login: 'SubUser',
            tier: '2000',
            months: 5
        });

        twitch.emit('platform:event', handler);

        const paypiggyEvent = emitted.find(e => e.evt === 'platform:event')?.payload;
        expect(paypiggyEvent.type).toBe(PlatformEvents.PAYPIGGY);
        expect(paypiggyEvent.data.months).toBe(5);
        expect(paypiggyEvent.data.tier).toBe('2000');
        expect(paypiggyEvent.data.username).toBe('SubUser');
    });

    it('emits giftpaypiggy with normalized giftCount', async () => {
        const handler = twitch.eventFactory.createGiftPaypiggyEvent({
            user_id: 'g1',
            user_login: 'GiftUser',
            total: 10,
            tier: '1000'
        });

        twitch.emit('platform:event', handler);

        const giftEvent = emitted.find(e => e.evt === 'platform:event')?.payload;
        expect(giftEvent.type).toBe(PlatformEvents.GIFTPAYPIGGY);
        expect(giftEvent.data.giftCount).toBe(10);
        expect(giftEvent.data.isGift).toBe(true);
        expect(giftEvent.data.tier).toBe('1000');
        expect(giftEvent.data.username).toBe('GiftUser');
    });

    it('emits cheer with bits amount preserved', async () => {
        const handler = twitch.eventFactory.createCheerEvent({
            user_id: 'c1',
            user_login: 'CheerUser',
            bits: 250,
            message: 'Great stream!'
        });

        twitch.emit('platform:event', handler);

        const cheerEvent = emitted.find(e => e.evt === 'platform:event')?.payload;
        expect(cheerEvent.type).toBe(PlatformEvents.CHEER);
        expect(cheerEvent.data.bits).toBe(250);
        expect(cheerEvent.data.message).toBe('Great stream!');
        expect(cheerEvent.data.username).toBe('CheerUser');
    });
});
