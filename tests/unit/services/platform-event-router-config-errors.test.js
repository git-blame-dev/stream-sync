const { describe, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');

const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

describe('PlatformEventRouter config gating error handling', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const buildRouter = ({ config, runtime, notificationManager, logger }) => new PlatformEventRouter({
        runtime,
        notificationManager,
        config,
        logger,
        eventBus: {
            subscribe: createMockFn(() => () => {}),
            emit: createMockFn()
        }
    });

    it('throws when config is missing required notification setting', async () => {
        const config = createConfigFixture({ general: { followsEnabled: undefined } });
        delete config.general.followsEnabled;
        const runtime = {
            handleFollowNotification: createMockFn().mockResolvedValue(true)
        };

        const router = buildRouter({ config, runtime, notificationManager: {}, logger: noOpLogger });

        await expect(router.routeEvent({
            platform: 'twitch',
            type: 'platform:follow',
            data: {
                username: 'Follower',
                userId: '123',
                timestamp: new Date().toISOString(),
                metadata: {}
            }
        })).rejects.toThrow('Missing notification config');
        expect(runtime.handleFollowNotification).not.toHaveBeenCalled();
    });

    it('routes unknown types without notification gating', async () => {
        const config = createConfigFixture();
        const notificationManager = {
            handleNotification: createMockFn().mockResolvedValue({ success: true })
        };

        const router = buildRouter({ config, runtime: {}, notificationManager, logger: noOpLogger });

        await expect(router.routeEvent({
            platform: 'youtube',
            type: 'custom-event',
            data: { username: 'User', userId: 'user-1' }
        })).rejects.toThrow('Unsupported platform event type: custom-event');
        expect(notificationManager.handleNotification).not.toHaveBeenCalled();
    });

    it('routes unknown types even when config is present', async () => {
        const config = createConfigFixture({ general: { followsEnabled: false, giftsEnabled: false } });
        const notificationManager = {
            handleNotification: createMockFn().mockResolvedValue({ success: true })
        };

        const router = buildRouter({ config, runtime: {}, notificationManager, logger: noOpLogger });

        await expect(router.routeEvent({
            platform: 'youtube',
            type: 'unknown-type',
            data: { username: 'User', userId: 'user-2' }
        })).rejects.toThrow('Unsupported platform event type: unknown-type');
        expect(notificationManager.handleNotification).not.toHaveBeenCalled();
    });

    it('consults config for chat events and routes when enabled', async () => {
        const config = createConfigFixture({ general: { messagesEnabled: true } });
        const runtime = {
            handleChatMessage: createMockFn().mockResolvedValue(true)
        };

        const router = buildRouter({ config, runtime, notificationManager: {}, logger: noOpLogger });

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

        expect(runtime.handleChatMessage).toHaveBeenCalledWith('twitch', expect.objectContaining({ message: 'hi' }));
    });

    it('blocks chat routing when config disables messages', async () => {
        const config = createConfigFixture({ general: { messagesEnabled: false } });
        const runtime = {
            handleChatMessage: createMockFn().mockResolvedValue(true)
        };

        const router = buildRouter({ config, runtime, notificationManager: {}, logger: noOpLogger });

        await router.routeEvent({
            platform: 'twitch',
            type: 'platform:chat-message',
            data: {
                username: 'Chatter',
                message: { text: 'hi' },
                userId: 'user-4',
                timestamp: new Date().toISOString(),
                metadata: {}
            }
        });
        expect(runtime.handleChatMessage).not.toHaveBeenCalled();
    });

    it('blocks follow/raid routing when config disables them', async () => {
        const config = createConfigFixture({ general: { followsEnabled: false, raidsEnabled: false } });
        const runtime = {
            handleFollowNotification: createMockFn().mockResolvedValue(true),
            handleRaidNotification: createMockFn().mockResolvedValue(true)
        };

        const router = buildRouter({ config, runtime, notificationManager: {}, logger: noOpLogger });

        await router.routeEvent({
            platform: 'twitch',
            type: 'platform:follow',
            data: { username: 'Follower', userId: 'f1', timestamp: new Date().toISOString(), metadata: {} }
        });
        await router.routeEvent({
            platform: 'twitch',
            type: 'platform:raid',
            data: { username: 'Raider', userId: 'r1', viewerCount: 10, timestamp: new Date().toISOString(), metadata: {} }
        });
        expect(runtime.handleFollowNotification).not.toHaveBeenCalled();
        expect(runtime.handleRaidNotification).not.toHaveBeenCalled();
    });

    it('blocks gift routing when config disables gifts', async () => {
        const config = createConfigFixture({ general: { giftsEnabled: false } });
        const runtime = {
            handleGiftNotification: createMockFn().mockResolvedValue(true)
        };

        const router = buildRouter({ config, runtime, notificationManager: {}, logger: noOpLogger });

        await router.routeEvent({
            platform: 'tiktok',
            type: 'platform:gift',
            data: { username: 'Gifter', userId: 'g1', id: 'gift-1', giftType: 'rose', giftCount: 1, amount: 50, currency: 'coins', timestamp: new Date().toISOString(), metadata: {} }
        });
        expect(runtime.handleGiftNotification).not.toHaveBeenCalled();
    });

    it('blocks envelope routing when config disables gifts', async () => {
        const config = createConfigFixture({ general: { giftsEnabled: false } });
        const runtime = {
            handleEnvelopeNotification: createMockFn().mockResolvedValue(true)
        };

        const router = buildRouter({ config, runtime, notificationManager: {}, logger: noOpLogger });

        await router.routeEvent({
            platform: 'tiktok',
            type: 'platform:envelope',
            data: { id: 'e1', username: 'User', userId: 'e1', timestamp: new Date().toISOString(), metadata: {} }
        });
        expect(runtime.handleEnvelopeNotification).not.toHaveBeenCalled();
    });

    it('routes unknown types without gating even when config exists', async () => {
        const config = createConfigFixture();
        const notificationManager = {
            handleNotification: createMockFn().mockResolvedValue({ success: true })
        };

        const router = buildRouter({ config, runtime: {}, notificationManager, logger: noOpLogger });

        await expect(router.routeEvent({
            platform: 'youtube',
            type: 'unknown-type',
            data: { username: 'User', userId: 'user-4' }
        })).rejects.toThrow('Unsupported platform event type: unknown-type');
        expect(notificationManager.handleNotification).not.toHaveBeenCalled();
    });

    it('requires config for gift routing', async () => {
        const runtime = {
            handleGiftNotification: createMockFn().mockResolvedValue(true)
        };
        expect(() => buildRouter({ config: null, runtime, notificationManager: {}, logger: noOpLogger }))
            .toThrow('PlatformEventRouter requires eventBus, runtime, notificationManager, config, and logger');
    });

    it('requires notification manager for routed events', async () => {
        const config = createConfigFixture();
        expect(() => buildRouter({ config, runtime: {}, notificationManager: null, logger: noOpLogger }))
            .toThrow('PlatformEventRouter requires eventBus, runtime, notificationManager, config, and logger');
    });

    it('handles unsubscribe errors during dispose without throwing', () => {
        const config = createConfigFixture();
        const router = new PlatformEventRouter({
            runtime: {},
            notificationManager: {},
            config,
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
