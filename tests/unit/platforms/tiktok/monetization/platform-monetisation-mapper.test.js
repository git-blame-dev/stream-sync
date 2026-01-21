const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { mockModule, restoreAllModuleMocks, resetModules } = require('../../../../helpers/bun-module-mocks');
const { restoreAllMocks } = require('../../../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../../../helpers/mock-factories');

const EventEmitter = require('events');
const { TikTokPlatform } = require('../../../../../src/platforms/tiktok');
const { PlatformEvents } = require('../../../../../src/interfaces/PlatformEvents');
const { createTikTokEventFactory } = require('../../../../../src/platforms/tiktok/events/event-factory');

describe('TikTokPlatform monetisation mapping', () => {
    let platform;
    let emitted;

    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
        resetModules();
    });

    beforeEach(() => {
        emitted = [];
        const eventBus = {
            emit: (evt, payload) => emitted.push({ evt, payload })
        };

        platform = new TikTokPlatform(
            { username: 'tester', enabled: false },
            {
                logger: noOpLogger,
                eventBus,
                observerFactory: () => new EventEmitter(),
                TikTokWebSocketClient: function () {},
                WebcastEvent: function () {},
                ControlEvent: function () {}
            }
        );

        platform.eventFactory = createTikTokEventFactory({
            platformName: 'tiktok',
            getTimestamp: (data) => data.timestamp || '2024-01-01T00:00:00Z',
            normalizeUserData: (data) => platform._normalizeUserData(data),
            getPlatformMessageId: (data) => platform._getPlatformMessageId(data),
            buildEventMetadata: (metadata) => platform._buildEventMetadata(metadata)
        });

        platform.emit = (evt, payload) => emitted.push({ evt, payload });
    });

    it('emits paypiggy with normalized user and provided metadata', () => {
        const handler = platform.eventFactory.createSubscription({
            user: { userId: 'u1', uniqueId: 'memberuser' },
            message: 'Thanks for the support!',
            tier: 'basic',
            months: 1,
            timestamp: '2024-01-01T00:00:00Z'
        });

        platform.emit('platform:event', handler);

        const paypiggyEvent = emitted.find(e => e.evt === 'platform:event')?.payload;
        expect(paypiggyEvent.type).toBe(PlatformEvents.PAYPIGGY);
        expect(paypiggyEvent.userId).toBe('u1');
        expect(paypiggyEvent.username).toBe('memberuser');
        expect(paypiggyEvent.tier).toBe('basic');
        expect(paypiggyEvent.months).toBe(1);
        expect(paypiggyEvent.message).toBe('Thanks for the support!');
    });

    it('emits superfan paypiggy with superfan tier', () => {
        const handler = platform.eventFactory.createSuperfan({
            user: { userId: 'sf1', uniqueId: 'superfanuser' },
            timestamp: '2024-01-01T00:00:00Z'
        });

        platform.emit('platform:event', handler);

        const paypiggyEvent = emitted.find(e => e.evt === 'platform:event')?.payload;
        expect(paypiggyEvent.type).toBe(PlatformEvents.PAYPIGGY);
        expect(paypiggyEvent.tier).toBe('superfan');
    });

    it('does not default tier, months, or message when missing', () => {
        const handler = platform.eventFactory.createSubscription({
            user: { userId: 'u2', uniqueId: 'plainmember' },
            timestamp: '2024-01-01T00:00:00Z'
        });

        platform.emit('platform:event', handler);

        const paypiggyEvent = emitted.find(e => e.evt === 'platform:event')?.payload;
        expect(paypiggyEvent.type).toBe(PlatformEvents.PAYPIGGY);
        expect(paypiggyEvent.userId).toBe('u2');
        expect(paypiggyEvent.username).toBe('plainmember');
        expect(paypiggyEvent.tier).toBeUndefined();
        expect(paypiggyEvent.months).toBeUndefined();
        expect(paypiggyEvent.message).toBeUndefined();
    });

    it('emits gift with coin normalization', () => {
        const handler = platform.eventFactory.createGift({
            platform: 'tiktok',
            userId: 'g1',
            username: 'giftuser',
            giftType: 'Rose',
            giftCount: 2,
            amount: 500,
            currency: 'coins',
            unitAmount: 250,
            repeatCount: 2,
            timestamp: '2024-01-01T00:00:00Z',
            id: 'gift-msg-1'
        });

        platform.emit('platform:event', handler);

        const giftEvent = emitted.find(e => e.evt === 'platform:event')?.payload;
        expect(giftEvent.type).toBe(PlatformEvents.GIFT);
        expect(giftEvent.giftType).toBe('Rose');
        expect(giftEvent.giftCount).toBe(2);
        expect(giftEvent.amount).toBe(500);
        expect(giftEvent.currency).toBe('coins');
        expect(giftEvent.username).toBe('giftuser');
    });
});
