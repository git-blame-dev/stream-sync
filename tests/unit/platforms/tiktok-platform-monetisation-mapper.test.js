const { describe, it, expect, beforeEach, afterEach } = require('bun:test');
const { mockModule, restoreAllModuleMocks, resetModules } = require('../../helpers/bun-module-mocks');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const EventEmitter = require('events');
const { TikTokPlatform } = require('../../../src/platforms/tiktok');
const { PlatformEvents } = require('../../../src/interfaces/PlatformEvents');

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

        if (!platform.eventFactory) {
            platform.eventFactory = {
                createSubscription: (data = {}) => ({
                    platform: 'tiktok',
                    type: PlatformEvents.PAYPIGGY,
                    username: data.user?.uniqueId,
                    userId: data.user?.userId,
                    tier: data.tier,
                    months: data.months,
                    message: typeof data.message === 'string' ? data.message : undefined
                }),
                createSuperfan: (data = {}) => ({
                    platform: 'tiktok',
                    type: PlatformEvents.PAYPIGGY,
                    tier: 'superfan',
                    username: data.user?.uniqueId,
                    userId: data.user?.userId
                }),
                createGift: (data = {}) => ({
                    platform: 'tiktok',
                    type: PlatformEvents.GIFT,
                    giftType: data.giftType || data.giftDetails?.giftName || 'gift',
                    giftCount: data.repeatCount,
                    amount: (data.giftDetails?.diamondCount ?? data.coinValue ?? 0) * (data.repeatCount ?? 0),
                    currency: 'coins',
                    username: data.user?.uniqueId,
                    userId: data.user?.userId
                })
            };
        }

        platform.emit = (evt, payload) => emitted.push({ evt, payload });
    });

    it('emits paypiggy with normalized user and provided metadata', () => {
        const handler = platform.eventFactory.createSubscription({
            user: { userId: 'u1', uniqueId: 'memberuser' },
            message: 'Thanks for the support!',
            tier: 'basic',
            months: 1
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
            user: { userId: 'sf1', uniqueId: 'superfanuser' }
        });

        platform.emit('platform:event', handler);

        const paypiggyEvent = emitted.find(e => e.evt === 'platform:event')?.payload;
        expect(paypiggyEvent.type).toBe(PlatformEvents.PAYPIGGY);
        expect(paypiggyEvent.tier).toBe('superfan');
    });

    it('does not default tier, months, or message when missing', () => {
        const handler = platform.eventFactory.createSubscription({
            user: { userId: 'u2', uniqueId: 'plainmember' }
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
            user: { userId: 'g1', uniqueId: 'giftuser' },
            giftDetails: { giftName: 'Rose', diamondCount: 250, giftType: 0 },
            giftType: 'Rose',
            giftCount: 2,
            amount: 500,
            currency: 'coins',
            unitAmount: 250,
            repeatCount: 2,
            timestamp: '2024-01-01T00:00:00Z',
            msgId: 'gift-msg-1'
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
