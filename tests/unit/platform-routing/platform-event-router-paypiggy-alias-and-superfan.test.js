
const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

describe('PlatformEventRouter paypiggy months handling', () => {
    let runtime;
    let configService;

    const buildRouter = () => new PlatformEventRouter({
        eventBus: { subscribe: jest.fn(() => jest.fn()), emit: jest.fn() },
        runtime,
        notificationManager: { handleNotification: jest.fn() },
        configService,
        logger: { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} }
    });

    beforeEach(() => {
        runtime = {
            handlePaypiggyNotification: jest.fn()
        };
        configService = {
            areNotificationsEnabled: jest.fn().mockReturnValue(true)
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
