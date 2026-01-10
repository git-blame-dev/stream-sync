const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

describe('PlatformEventRouter validation', () => {
    const buildRouter = (overrides = {}) => {
        const runtime = {
            handleChatMessage: jest.fn(),
            handleGiftNotification: jest.fn(),
            handlePaypiggyNotification: jest.fn(),
            handleGiftPaypiggyNotification: jest.fn(),
            handleRaidNotification: jest.fn(),
            handleShareNotification: jest.fn(),
            handleFollowNotification: jest.fn(),
            updateViewerCount: jest.fn(),
            ...overrides.runtime
        };
        const configService = {
            areNotificationsEnabled: jest.fn(() => true),
            ...overrides.configService
        };
        const notificationManager = {
            handleNotification: jest.fn(),
            ...overrides.notificationManager
        };
        const eventBus = {
            subscribe: jest.fn(() => jest.fn()),
            emit: jest.fn()
        };
        const logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        return {
            router: new PlatformEventRouter({
                runtime,
                eventBus,
                notificationManager,
                configService,
                logger
            }),
            runtime,
            notificationManager
        };
    };

    it('rejects paid alias event types', async () => {
        const { router, runtime } = buildRouter();

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'subscription',
            data: {
                username: 'SubUser',
                userId: 'u1',
                timestamp: new Date().toISOString()
            }
        })).rejects.toThrow('Unsupported paid alias event type: subscription');

        expect(runtime.handlePaypiggyNotification).not.toHaveBeenCalled();
    });

    it('rejects monetization payloads missing required fields when not marked isError', async () => {
        const { router, runtime } = buildRouter();

        await expect(router.routeEvent({
            platform: 'tiktok',
            type: 'gift',
            data: {
                username: 'gifter',
                userId: 'u2',
                amount: 50,
                currency: 'coins',
                timestamp: new Date().toISOString()
            }
        })).rejects.toThrow('Notification payload requires id, giftType, giftCount, amount, and currency');

        expect(runtime.handleGiftNotification).not.toHaveBeenCalled();
    });

    it('allows monetization payloads with isError even when fields are missing', async () => {
        const { router, runtime } = buildRouter();

        await router.routeEvent({
            platform: 'tiktok',
            type: 'gift',
            data: {
                username: 'gifter',
                userId: 'u3',
                isError: true,
                timestamp: new Date().toISOString()
            }
        });

        expect(runtime.handleGiftNotification).toHaveBeenCalledTimes(1);
    });

    it('normalizes userId to string when routing notifications', async () => {
        const { router, runtime } = buildRouter();

        await router.routeEvent({
            platform: 'twitch',
            type: 'follow',
            data: {
                username: 'Follower',
                userId: 12345,
                timestamp: new Date().toISOString()
            }
        });

        const [, , payload] = runtime.handleFollowNotification.mock.calls[0];
        expect(payload.userId).toBe('12345');
    });

    it('rejects viewer-count events with non-finite counts', async () => {
        const { router, runtime } = buildRouter();

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'viewer-count',
            data: { count: 'nope' }
        })).rejects.toThrow('Viewer-count event requires numeric count');

        expect(runtime.updateViewerCount).not.toHaveBeenCalled();
    });

    it('rejects chat messages with empty text after trimming', async () => {
        const { router, runtime } = buildRouter();

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'chat',
            data: {
                username: 'User',
                userId: 'u4',
                message: { text: '   ' },
                timestamp: new Date().toISOString()
            }
        })).rejects.toThrow('Chat event requires non-empty message text');

        expect(runtime.handleChatMessage).not.toHaveBeenCalled();
    });
});
