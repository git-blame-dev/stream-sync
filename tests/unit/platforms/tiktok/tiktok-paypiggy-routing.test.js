jest.unmock('../../../../src/platforms/tiktok');

const { TikTokPlatform } = require('../../../../src/platforms/tiktok');
const { createMockTikTokPlatformDependencies } = require('../../../helpers/mock-factories');
const testClock = require('../../../helpers/test-clock');

describe('TikTok paypiggy routing', () => {
    const baseConfig = { enabled: true, username: 'paypiggy_tester' };

    const createPlatform = () => new TikTokPlatform(baseConfig, {
        ...createMockTikTokPlatformDependencies(),
        timestampService: { extractTimestamp: jest.fn(() => new Date(testClock.now()).toISOString()) }
    });

    test('emits paypiggy for subscription events with nested identity', async () => {
        const platform = createPlatform();
        const paypiggyEvents = [];
        platform.handlers = {
            ...platform.handlers,
            onPaypiggy: (data) => paypiggyEvents.push(data)
        };

        await platform._handleStandardEvent('paypiggy', {
            user: { userId: 'tt-sub-1', uniqueId: 'subscriber_one' },
            message: 'hello there',
            createTime: testClock.now()
        }, {
            factoryMethod: 'createSubscription',
            emitType: 'paypiggy'
        });

        expect(paypiggyEvents).toHaveLength(1);
        expect(paypiggyEvents[0].userId).toBe('tt-sub-1');
        expect(paypiggyEvents[0].username).toBe('subscriber_one');
        expect(paypiggyEvents[0].tier).toBeUndefined();
    });

    test('emits paypiggy for superfan events with nested identity', async () => {
        const platform = createPlatform();
        const paypiggyEvents = [];
        platform.handlers = {
            ...platform.handlers,
            onPaypiggy: (data) => paypiggyEvents.push(data)
        };

        await platform._handleStandardEvent('paypiggy', {
            user: { userId: 'tt-super-1', uniqueId: 'superfan_one' },
            message: 'superfan here',
            createTime: testClock.now()
        }, {
            factoryMethod: 'createSuperfan',
            emitType: 'paypiggy'
        });

        expect(paypiggyEvents).toHaveLength(1);
        expect(paypiggyEvents[0].userId).toBe('tt-super-1');
        expect(paypiggyEvents[0].username).toBe('superfan_one');
        expect(paypiggyEvents[0].tier).toBe('superfan');
    });
});
