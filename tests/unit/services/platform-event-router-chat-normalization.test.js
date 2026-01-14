const { describe, it, expect, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
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
        const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const configService = { areNotificationsEnabled: createMockFn(() => true) };
        const notificationManager = { handleNotification: createMockFn() };
        return { router: new PlatformEventRouter({ runtime, eventBus, notificationManager, configService, logger }), runtime };
    };

    it('flattens nested user/message fields so chat handler receives username', async () => {
        const { router, runtime } = createRouter();

        const event = {
            ...baseEvent,
            data: {
                username: 'ExampleUser',
                userId: '13945',
                message: { text: 'It is not blackmail' },
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
        expect(normalized.username).toBe('ExampleUser');
        expect(normalized.userId).toBe('13945');
        expect(normalized.message).toBe('It is not blackmail');
        expect(normalized.timestamp).toBe('2025-11-20T12:18:40.192Z');
        expect(normalized.isMod).toBe(false);
        expect(normalized.isSubscriber).toBe(false);
    });

    it('handles string message payloads and falls back to top-level fields', async () => {
        const { router, runtime } = createRouter();

        const event = {
            ...baseEvent,
            data: {
                userId: 'abc123',
                username: 'stringuser',
                message: { text: 'Plain text message' },
                timestamp: '2025-11-20T14:00:00.000Z',
                isMod: true,
                metadata: {}
            }
        };

        await router.routeEvent(event);

        expect(runtime.handleChatMessage).toHaveBeenCalledTimes(1);
        const [, normalized] = runtime.handleChatMessage.mock.calls[0];
        expect(normalized.username).toBe('stringuser');
        expect(normalized.userId).toBe('abc123');
        expect(normalized.message).toBe('Plain text message');
        expect(normalized.timestamp).toBe('2025-11-20T14:00:00.000Z');
        expect(normalized.isMod).toBe(true);
    });
});
