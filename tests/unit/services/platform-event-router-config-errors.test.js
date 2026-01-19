const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

describe('PlatformEventRouter config gating error handling', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const buildRouter = ({ configService, runtime, notificationManager, logger }) => new PlatformEventRouter({
        runtime,
        notificationManager,
        configService,
        logger,
        eventBus: {
            subscribe: createMockFn(() => () => {}),
            emit: createMockFn()
        }
    });

    it('throws when config toggle checks fail for follow notifications', async () => {
        const configService = {
            areNotificationsEnabled: createMockFn(() => {
                throw new Error('toggle fail');
            })
        };
        const runtime = {
            handleFollowNotification: createMockFn().mockResolvedValue(true)
        };

        const router = buildRouter({ configService, runtime, notificationManager: {}, logger: noOpLogger });

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'platform:follow',
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
        const configService = {
            areNotificationsEnabled: createMockFn(() => {
                throw new Error('toggle fail');
            })
        };
        const notificationManager = {
            handleNotification: createMockFn().mockResolvedValue({ success: true })
        };

        const router = buildRouter({ configService, runtime: {}, notificationManager, logger: noOpLogger });

        await expect(router.routeEvent({
            platform: 'youtube',
            type: 'custom-event',
            data: { username: 'User', userId: 'user-1' }
        })).rejects.toThrow('Unsupported platform event type: custom-event');
        expect(notificationManager.handleNotification).not.toHaveBeenCalled();
        expect(configService.areNotificationsEnabled).not.toHaveBeenCalled();
    });

    it('routes unknown types even when config service is present', async () => {
        const configService = {
            areNotificationsEnabled: createMockFn(() => false)
        };
        const notificationManager = {
            handleNotification: createMockFn().mockResolvedValue({ success: true })
        };

        const router = buildRouter({ configService, runtime: {}, notificationManager, logger: noOpLogger });

        await expect(router.routeEvent({
            platform: 'youtube',
            type: 'unknown-type',
            data: { username: 'User', userId: 'user-2' }
        })).rejects.toThrow('Unsupported platform event type: unknown-type');
        expect(notificationManager.handleNotification).not.toHaveBeenCalled();
        expect(configService.areNotificationsEnabled).not.toHaveBeenCalled();
    });

    it('consults config service for chat events and routes when enabled', async () => {
        const configService = {
            areNotificationsEnabled: createMockFn(() => true)
        };
        const runtime = {
            handleChatMessage: createMockFn().mockResolvedValue(true)
        };

        const router = buildRouter({ configService, runtime, notificationManager: {}, logger: noOpLogger });

        await router.routeEvent({
            platform: 'twitch',
            type: 'platform:chat-message',
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
        const configService = {
            areNotificationsEnabled: createMockFn(() => {
                throw new Error('toggle fail');
            })
        };
        const runtime = {
            handleChatMessage: createMockFn().mockResolvedValue(true)
        };

        const router = buildRouter({ configService, runtime, notificationManager: {}, logger: noOpLogger });

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'platform:chat-message',
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
        const configService = {
            areNotificationsEnabled: createMockFn(() => {
                throw new Error('toggle fail');
            })
        };
        const runtime = {
            handleFollowNotification: createMockFn().mockResolvedValue(true),
            handleRaidNotification: createMockFn().mockResolvedValue(true)
        };

        const router = buildRouter({ configService, runtime, notificationManager: {}, logger: noOpLogger });

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'platform:follow',
            data: { username: 'Follower', userId: 'f1', timestamp: new Date().toISOString(), metadata: {} }
        })).rejects.toThrow('toggle fail');
        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'platform:raid',
            data: { username: 'Raider', userId: 'r1', viewerCount: 10, timestamp: new Date().toISOString(), metadata: {} }
        })).rejects.toThrow('toggle fail');
        expect(runtime.handleFollowNotification).not.toHaveBeenCalled();
        expect(runtime.handleRaidNotification).not.toHaveBeenCalled();
    });

    it('throws when config toggle check fails for gifts', async () => {
        const configService = {
            areNotificationsEnabled: createMockFn(() => {
                throw new Error('toggle fail');
            })
        };
        const runtime = {
            handleGiftNotification: createMockFn().mockResolvedValue(true)
        };

        const router = buildRouter({ configService, runtime, notificationManager: {}, logger: noOpLogger });

        await expect(router.routeEvent({
            platform: 'tiktok',
            type: 'platform:gift',
            data: { username: 'Gifter', userId: 'g1', coins: 50, timestamp: new Date().toISOString(), metadata: {} }
        })).rejects.toThrow('toggle fail');
        expect(runtime.handleGiftNotification).not.toHaveBeenCalled();
    });

    it('throws when config toggle check fails for envelopes', async () => {
        const configService = {
            areNotificationsEnabled: createMockFn(() => {
                throw new Error('toggle fail');
            })
        };
        const runtime = {
            handleEnvelopeNotification: createMockFn().mockResolvedValue(true)
        };

        const router = buildRouter({ configService, runtime, notificationManager: {}, logger: noOpLogger });

        await expect(router.routeEvent({
            platform: 'tiktok',
            type: 'platform:envelope',
            data: { id: 'e1', username: 'User', userId: 'e1', timestamp: new Date().toISOString(), metadata: {} }
        })).rejects.toThrow('toggle fail');
        expect(runtime.handleEnvelopeNotification).not.toHaveBeenCalled();
    });

    it('routes unknown types without gating even when config service exists', async () => {
        const configService = {
            areNotificationsEnabled: createMockFn()
        };
        const notificationManager = {
            handleNotification: createMockFn().mockResolvedValue({ success: true })
        };

        const router = buildRouter({ configService, runtime: {}, notificationManager, logger: noOpLogger });

        await expect(router.routeEvent({
            platform: 'youtube',
            type: 'unknown-type',
            data: { username: 'User', userId: 'user-4' }
        })).rejects.toThrow('Unsupported platform event type: unknown-type');
        expect(notificationManager.handleNotification).not.toHaveBeenCalled();
        expect(configService.areNotificationsEnabled).not.toHaveBeenCalled();
    });

    it('requires config service for gift routing', async () => {
        const runtime = {
            handleGiftNotification: createMockFn().mockResolvedValue(true)
        };
        expect(() => buildRouter({ configService: null, runtime, notificationManager: {}, logger: noOpLogger }))
            .toThrow('PlatformEventRouter requires eventBus, runtime, notificationManager, configService, and logger');
    });

    it('requires notification manager for routed events', async () => {
        const configService = {
            areNotificationsEnabled: createMockFn(() => true)
        };
        expect(() => buildRouter({ configService, runtime: {}, notificationManager: null, logger: noOpLogger }))
            .toThrow('PlatformEventRouter requires eventBus, runtime, notificationManager, configService, and logger');
    });

    it('handles unsubscribe errors during dispose without throwing', () => {
        const configService = {
            areNotificationsEnabled: createMockFn(() => true)
        };
        const router = new PlatformEventRouter({
            runtime: {},
            notificationManager: {},
            configService,
            logger: noOpLogger,
            eventBus: {
                subscribe: createMockFn(() => () => {
                    throw new Error('unsubscribe boom');
                })
            }
        });

        expect(() => router.dispose()).not.toThrow();
    });
});
