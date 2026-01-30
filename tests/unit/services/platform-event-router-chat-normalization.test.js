const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');
const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

describe('PlatformEventRouter chat normalization', () => {
    afterEach(() => {
        clearAllMocks();
    });

    const platform = 'twitch';
    const baseEvent = {
        platform,
        type: 'platform:chat-message',
        data: {}
    };

    const createRouter = (runtimeOverrides = {}) => {
        const runtime = {
            handleChatMessage: createMockFn(),
            ...runtimeOverrides
        };
        const eventBus = { subscribe: createMockFn(() => createMockFn()), emit: createMockFn() };
        const config = createConfigFixture({ general: { messagesEnabled: true } });
        const notificationManager = { handleNotification: createMockFn() };
        return { router: new PlatformEventRouter({ runtime, eventBus, notificationManager, config, logger: noOpLogger }), runtime };
    };

    it('flattens nested user/message fields so chat handler receives username', async () => {
        const { router, runtime } = createRouter();

        const event = {
            ...baseEvent,
            data: {
                username: 'testUsername',
                userId: 'testUserId',
                message: { text: 'testMessageText' },
                timestamp: '2025-11-20T12:18:40.192Z',
                isMod: false,
                isSubscriber: false,
                metadata: { isMod: false, isSubscriber: false }
            }
        };

        await router.routeEvent(event);

        expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
        const [calledPlatform, normalized] = runtime.handleChatMessage.mock.calls[0];
        expect(calledPlatform).toBe(platform);
        expect(normalized.username).toBe('testUsername');
        expect(normalized.userId).toBe('testUserId');
        expect(normalized.message).toBe('testMessageText');
        expect(normalized.timestamp).toBe('2025-11-20T12:18:40.192Z');
        expect(normalized.isMod).toBe(false);
        expect(normalized.isSubscriber).toBe(false);
    });

    it('handles string message payloads and falls back to top-level fields', async () => {
        const { router, runtime } = createRouter();

        const event = {
            ...baseEvent,
            data: {
                userId: 'testUserId123',
                username: 'testStringUser',
                message: { text: 'testPlainMessage' },
                timestamp: '2025-11-20T14:00:00.000Z',
                isMod: true,
                metadata: {}
            }
        };

        await router.routeEvent(event);

        expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
        const [, normalized] = runtime.handleChatMessage.mock.calls[0];
        expect(normalized.username).toBe('testStringUser');
        expect(normalized.userId).toBe('testUserId123');
        expect(normalized.message).toBe('testPlainMessage');
        expect(normalized.timestamp).toBe('2025-11-20T14:00:00.000Z');
        expect(normalized.isMod).toBe(true);
    });
});
