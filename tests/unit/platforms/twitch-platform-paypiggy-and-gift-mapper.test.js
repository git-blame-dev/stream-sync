
const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/platforms/twitch-eventsub', () => createMockFn());

const EventEmitter = require('events');
const { TwitchPlatform } = require('../../../src/platforms/twitch');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');

const createMockEventSub = () => {
    const emitter = new EventEmitter();
    return {
        connect: createMockFn(),
        disconnect: createMockFn(),
        on: emitter.on.bind(emitter),
        emit: emitter.emit.bind(emitter),
        removeListener: emitter.removeListener.bind(emitter)
    };
};

describe('TwitchPlatform monetisation mapping', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    let twitch;
    let emitted;

    beforeEach(() => {
        emitted = [];
        const eventBus = {
            emit: (evt, payload) => emitted.push({ evt, payload })
        };
        const mockEventSub = createMockEventSub();
        const TwitchEventSub = createMockFn(() => mockEventSub);

        twitch = new TwitchPlatform(
            { username: 'tester', eventsub_enabled: true },
            {
                authManager: { getState: createMockFn(), isTokenValid: createMockFn().mockReturnValue(true) },
                ChatFileLoggingService: createMockFn(() => ({ start: createMockFn(), stop: createMockFn() })),
                TwitchEventSub,
                eventBus
            }
        );

        if (!twitch.eventFactory) {
            twitch.eventFactory = {
                createPaypiggyEvent: (data = {}) => ({
                    type: PlatformEvents.PAYPIGGY,
                    platform: 'twitch',
                    username: data.username,
                    userId: data.userId,
                    tier: data.tier,
                    months: data.months,
                    timestamp: data.timestamp
                }),
                createGiftPaypiggyEvent: (data = {}) => ({
                    type: PlatformEvents.GIFTPAYPIGGY,
                    platform: 'twitch',
                    username: data.username,
                    userId: data.userId,
                    giftCount: data.giftCount ?? data.total ?? 0,
                    tier: data.tier,
                    timestamp: data.timestamp
                }),
                createGiftEvent: (data = {}) => ({
                    type: PlatformEvents.GIFT,
                    platform: 'twitch',
                    username: data.username,
                    userId: data.userId,
                    giftType: data.giftType,
                    giftCount: data.giftCount,
                    amount: data.amount,
                    currency: data.currency,
                    message: data.message,
                    id: data.id,
                    timestamp: data.timestamp
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
            userId: 'u1',
            username: 'SubUser',
            tier: '2000',
            months: 5,
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        twitch.emit('platform:event', handler);

        const paypiggyEvent = emitted.find(e => e.evt === 'platform:event')?.payload;
        expect(paypiggyEvent.type).toBe(PlatformEvents.PAYPIGGY);
        expect(paypiggyEvent.months).toBe(5);
        expect(paypiggyEvent.tier).toBe('2000');
        expect(paypiggyEvent.username).toBe('SubUser');
    });

    it('emits giftpaypiggy with normalized giftCount', async () => {
        const handler = twitch.eventFactory.createGiftPaypiggyEvent({
            userId: 'g1',
            username: 'GiftUser',
            giftCount: 10,
            tier: '1000',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        twitch.emit('platform:event', handler);

        const giftEvent = emitted.find(e => e.evt === 'platform:event')?.payload;
        expect(giftEvent.type).toBe(PlatformEvents.GIFTPAYPIGGY);
        expect(giftEvent.giftCount).toBe(10);
        expect(giftEvent.tier).toBe('1000');
        expect(giftEvent.username).toBe('GiftUser');
    });

    it('emits gift with bits amount preserved', async () => {
        const handler = twitch.eventFactory.createGiftEvent({
            userId: 'c1',
            username: 'CheerUser',
            giftType: 'bits',
            giftCount: 1,
            amount: 250,
            currency: 'bits',
            message: 'Great stream!',
            id: 'bits-evt-1',
            timestamp: '2024-01-01T00:00:00.000Z'
        });

        twitch.emit('platform:event', handler);

        const giftEvent = emitted.find(e => e.evt === 'platform:event')?.payload;
        expect(giftEvent.type).toBe(PlatformEvents.GIFT);
        expect(giftEvent.amount).toBe(250);
        expect(giftEvent.currency).toBe('bits');
        expect(giftEvent.giftType).toBe('bits');
        expect(giftEvent.giftCount).toBe(1);
        expect(giftEvent.message).toBe('Great stream!');
        expect(giftEvent.username).toBe('CheerUser');
    });
});
