
const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

describe('PlatformEventRouter config gating error handling', () => {
    const buildRouter = ({ configService, runtime, notificationManager, logger }) => new PlatformEventRouter({
        runtime,
        notificationManager,
        configService,
        logger,
        eventBus: {
            subscribe: jest.fn(() => () => {}),
            emit: jest.fn()
        }
    });

    it('throws when config toggle checks fail for follow notifications', async () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const configService = {
            areNotificationsEnabled: jest.fn(() => {
                throw new Error('toggle fail');
            })
        };
        const runtime = {
            handleFollowNotification: jest.fn().mockResolvedValue(true)
        };

        const router = buildRouter({ configService, runtime, notificationManager: {}, logger });

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'follow',
            data: {
                username: 'Follower',
                userId: '123',
                timestamp: new Date().toISOString(),
                metadata: {}
            }
        })).rejects.toThrow('toggle fail');
        expect(runtime.handleFollowNotification).not.toHaveBeenCalled();
    });

    it('routes unknown types without notification gating', async () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const configService = {
            areNotificationsEnabled: jest.fn(() => {
                throw new Error('toggle fail');
            })
        };
        const notificationManager = {
            handleNotification: jest.fn().mockResolvedValue({ success: true })
        };

        const router = buildRouter({ configService, runtime: {}, notificationManager, logger });

        await expect(router.routeEvent({
            platform: 'youtube',
            type: 'custom-event',
            data: { username: 'User', userId: 'user-1' }
        })).resolves.toBeUndefined();
        expect(notificationManager.handleNotification).toHaveBeenCalledWith(
            'custom-event',
            'youtube',
            expect.objectContaining({ username: 'User', userId: 'user-1' })
        );
        expect(configService.areNotificationsEnabled).not.toHaveBeenCalled();
    });

    it('routes unknown types even when config service is present', async () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const configService = {
            areNotificationsEnabled: jest.fn(() => false)
        };
        const notificationManager = {
            handleNotification: jest.fn().mockResolvedValue({ success: true })
        };

        const router = buildRouter({ configService, runtime: {}, notificationManager, logger });

        await expect(router.routeEvent({
            platform: 'youtube',
            type: 'unknown-type',
            data: { username: 'User', userId: 'user-2' }
        })).resolves.toBeUndefined();
        expect(notificationManager.handleNotification).toHaveBeenCalledWith(
            'unknown-type',
            'youtube',
            expect.objectContaining({ username: 'User', userId: 'user-2' })
        );
        expect(configService.areNotificationsEnabled).not.toHaveBeenCalled();
    });

    it('consults config service for chat events and routes when enabled', async () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const configService = {
            areNotificationsEnabled: jest.fn(() => true)
        };
        const runtime = {
            handleChatMessage: jest.fn().mockResolvedValue(true)
        };

        const router = buildRouter({ configService, runtime, notificationManager: {}, logger });

        await router.routeEvent({
            platform: 'twitch',
            type: 'chat',
            data: {
                username: 'Chatter',
                message: { text: 'hi' },
                userId: 'user-3',
                timestamp: new Date().toISOString(),
                metadata: {}
            }
        });

        expect(configService.areNotificationsEnabled).toHaveBeenCalledWith('messagesEnabled', 'twitch');
        expect(runtime.handleChatMessage).toHaveBeenCalledWith('twitch', expect.objectContaining({ message: 'hi' }));
    });

    it('continues chat routing when config toggle check throws', async () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const configService = {
            areNotificationsEnabled: jest.fn(() => {
                throw new Error('toggle fail');
            })
        };
        const runtime = {
            handleChatMessage: jest.fn().mockResolvedValue(true)
        };

        const router = buildRouter({ configService, runtime, notificationManager: {}, logger });

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'chat',
            data: {
                username: 'Chatter',
                message: { text: 'hi' },
                userId: 'user-4',
                timestamp: new Date().toISOString(),
                metadata: {}
            }
        })).rejects.toThrow('toggle fail');
        expect(runtime.handleChatMessage).not.toHaveBeenCalled();
    });

    it('continues follow/raid routing when config toggle check throws', async () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const configService = {
            areNotificationsEnabled: jest.fn(() => {
                throw new Error('toggle fail');
            })
        };
        const runtime = {
            handleFollowNotification: jest.fn().mockResolvedValue(true),
            handleRaidNotification: jest.fn().mockResolvedValue(true)
        };

        const router = buildRouter({ configService, runtime, notificationManager: {}, logger });

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'follow',
            data: { username: 'Follower', userId: 'f1', timestamp: new Date().toISOString(), metadata: {} }
        })).rejects.toThrow('toggle fail');
        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'raid',
            data: { username: 'Raider', userId: 'r1', viewerCount: 10, timestamp: new Date().toISOString(), metadata: {} }
        })).rejects.toThrow('toggle fail');
        expect(runtime.handleFollowNotification).not.toHaveBeenCalled();
        expect(runtime.handleRaidNotification).not.toHaveBeenCalled();
    });

    it('throws when config toggle check fails for gifts', async () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const configService = {
            areNotificationsEnabled: jest.fn(() => {
                throw new Error('toggle fail');
            })
        };
        const runtime = {
            handleGiftNotification: jest.fn().mockResolvedValue(true)
        };

        const router = buildRouter({ configService, runtime, notificationManager: {}, logger });

        await expect(router.routeEvent({
            platform: 'tiktok',
            type: 'gift',
            data: { username: 'Gifter', userId: 'g1', coins: 50, timestamp: new Date().toISOString(), metadata: {} }
        })).rejects.toThrow('toggle fail');
        expect(runtime.handleGiftNotification).not.toHaveBeenCalled();
    });

    it('throws when config toggle check fails for envelopes', async () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const configService = {
            areNotificationsEnabled: jest.fn(() => {
                throw new Error('toggle fail');
            })
        };
        const runtime = {
            handleEnvelopeNotification: jest.fn().mockResolvedValue(true)
        };

        const router = buildRouter({ configService, runtime, notificationManager: {}, logger });

        await expect(router.routeEvent({
            platform: 'tiktok',
            type: 'envelope',
            data: { id: 'e1', username: 'User', userId: 'e1', timestamp: new Date().toISOString(), metadata: {} }
        })).rejects.toThrow('toggle fail');
        expect(runtime.handleEnvelopeNotification).not.toHaveBeenCalled();
    });

    it('routes unknown types without gating even when config service exists', async () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const configService = {
            areNotificationsEnabled: jest.fn()
        };
        const notificationManager = {
            handleNotification: jest.fn().mockResolvedValue({ success: true })
        };

        const router = buildRouter({ configService, runtime: {}, notificationManager, logger });

        await expect(router.routeEvent({
            platform: 'youtube',
            type: 'unknown-type',
            data: { username: 'User', userId: 'user-4' }
        })).resolves.toBeUndefined();
        expect(notificationManager.handleNotification).toHaveBeenCalledWith(
            'unknown-type',
            'youtube',
            expect.objectContaining({ username: 'User', userId: 'user-4' })
        );
        expect(configService.areNotificationsEnabled).not.toHaveBeenCalled();
    });

    it('requires config service for gift routing', async () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const runtime = {
            handleGiftNotification: jest.fn().mockResolvedValue(true)
        };
        expect(() => buildRouter({ configService: null, runtime, notificationManager: {}, logger }))
            .toThrow('PlatformEventRouter requires eventBus, runtime, notificationManager, configService, and logger');
    });

    it('requires notification manager for routed events', async () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const configService = {
            areNotificationsEnabled: jest.fn(() => true)
        };
        expect(() => buildRouter({ configService, runtime: {}, notificationManager: null, logger }))
            .toThrow('PlatformEventRouter requires eventBus, runtime, notificationManager, configService, and logger');
    });

    it('logs unsubscribe errors during dispose without throwing', () => {
        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const configService = {
            areNotificationsEnabled: jest.fn(() => true)
        };
        const router = new PlatformEventRouter({
            runtime: {},
            notificationManager: {},
            configService,
            logger,
            eventBus: {
                subscribe: jest.fn(() => () => {
                    throw new Error('unsubscribe boom');
                })
            }
        });

        expect(() => router.dispose()).not.toThrow();
        expect(logger.warn).toHaveBeenCalledWith(
            'Error unsubscribing platform:event handler: unsubscribe boom',
            'PlatformEventRouter'
        );
    });
});
