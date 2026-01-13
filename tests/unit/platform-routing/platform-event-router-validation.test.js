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

    it('routes platform chat messages with timestamps', async () => {
        const { router, runtime } = buildRouter();
        const timestamp = new Date().toISOString();

        await router.routeEvent({
            platform: 'twitch',
            type: 'platform:chat-message',
            data: {
                username: 'User',
                userId: 'u1',
                message: { text: 'hello' },
                timestamp
            }
        });

        expect(runtime.handleChatMessage).toHaveBeenCalledWith('twitch', expect.objectContaining({
            message: 'hello',
            timestamp
        }));
    });

    it('rejects monetization payloads missing required fields when not marked isError', async () => {
        const { router, runtime } = buildRouter();

        await expect(router.routeEvent({
            platform: 'tiktok',
            type: 'platform:gift',
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
            type: 'platform:gift',
            data: {
                username: 'gifter',
                userId: 'u3',
                isError: true,
                timestamp: new Date().toISOString()
            }
        });

        expect(runtime.handleGiftNotification).toHaveBeenCalledTimes(1);
    });

    it('routes gift notifications with canonical types', async () => {
        const { router, runtime } = buildRouter();
        const timestamp = new Date().toISOString();

        await router.routeEvent({
            platform: 'tiktok',
            type: 'platform:gift',
            data: {
                id: 'gift-1',
                username: 'gifter',
                userId: 'u9',
                giftType: 'rose',
                giftCount: 1,
                amount: 5,
                currency: 'coins',
                timestamp
            }
        });

        const [, , payload] = runtime.handleGiftNotification.mock.calls[0];
        expect(payload.type).toBe('platform:gift');
        expect(payload.timestamp).toBe(timestamp);
    });

    it('rejects short notification types at the routing boundary', async () => {
        const { router, runtime } = buildRouter();

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'gift',
            data: { username: 'legacy', userId: 'u99', timestamp: new Date().toISOString() }
        })).rejects.toThrow('Unsupported platform event type: gift');

        expect(runtime.handleGiftNotification).not.toHaveBeenCalled();
    });

    it('rejects monetization payloads missing timestamps', async () => {
        const { router, runtime } = buildRouter();

        await expect(router.routeEvent({
            platform: 'tiktok',
            type: 'platform:gift',
            data: {
                username: 'gifter',
                userId: 'u2',
                id: 'gift-2',
                giftType: 'rose',
                giftCount: 1,
                amount: 5,
                currency: 'coins'
            }
        })).rejects.toThrow('Notification payload requires ISO timestamp');

        expect(runtime.handleGiftNotification).not.toHaveBeenCalled();
    });

    it('normalizes userId to string when routing notifications', async () => {
        const { router, runtime } = buildRouter();

        await router.routeEvent({
            platform: 'twitch',
            type: 'platform:follow',
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
            type: 'platform:viewer-count',
            data: { count: 'nope', timestamp: new Date().toISOString() }
        })).rejects.toThrow('Viewer-count event requires numeric count');

        expect(runtime.updateViewerCount).not.toHaveBeenCalled();
    });

    it('rejects viewer-count events missing timestamps', async () => {
        const { router, runtime } = buildRouter();

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'platform:viewer-count',
            data: { count: 3 }
        })).rejects.toThrow('Viewer-count event requires ISO timestamp');

        expect(runtime.updateViewerCount).not.toHaveBeenCalled();
    });

    it('rejects chat messages with empty text after trimming', async () => {
        const { router, runtime } = buildRouter();

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'platform:chat-message',
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
