
const { describe, test, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

describe('PlatformEventRouter paypiggy months handling', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let runtime;
    let configService;

    const buildRouter = () => new PlatformEventRouter({
        eventBus: { subscribe: createMockFn(() => createMockFn()), emit: createMockFn() },
        runtime,
        notificationManager: { handleNotification: createMockFn() },
        configService,
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    });

    beforeEach(() => {
        runtime = {
            handlePaypiggyNotification: createMockFn()
        };
        configService = {
            areNotificationsEnabled: createMockFn().mockReturnValue(true)
        };
    });

    it('passes through superfan tier and months to paypiggy handler', async () => {
        const router = buildRouter();

        await router.routeEvent({
            platform: 'tiktok',
            type: 'platform:paypiggy',
            data: {
                username: 'SuperFanUser',
                userId: 'sf-1',
                timestamp: new Date().toISOString(),
                metadata: {},
                tier: 'superfan',
                months: 3,
                membershipLevel: 'Ultra'
            }
        });

        expect(runtime.handlePaypiggyNotification).toHaveBeenCalledTimes(1);
        const [_platform, username, payload] = runtime.handlePaypiggyNotification.mock.calls[0];
        expect(_platform).toBe('tiktok');
        expect(username).toBe('SuperFanUser');
        expect(payload.tier).toBe('superfan');
        expect(payload.months).toBe(3);
        expect(payload.membershipLevel).toBe('Ultra');
        expect(payload.sourceType).toBe('platform:paypiggy');
    });

    it('passes through months without aliasing for Twitch paypiggy events', async () => {
        const router = buildRouter();

        await router.routeEvent({
            platform: 'twitch',
            type: 'platform:paypiggy',
            data: {
                username: 'MonthsUser',
                userId: 'user-3',
                timestamp: new Date().toISOString(),
                metadata: {},
                months: 6
            }
        });

        expect(runtime.handlePaypiggyNotification).toHaveBeenCalledTimes(1);
        const [_platform, username, payload] = runtime.handlePaypiggyNotification.mock.calls[0];
        expect(_platform).toBe('twitch');
        expect(username).toBe('MonthsUser');
        expect(payload.months).toBe(6);
    });
});
