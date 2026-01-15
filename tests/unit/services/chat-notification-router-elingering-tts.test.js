const { describe, it, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/utils/chat-logger', () => ({
    logChatMessageWithConfig: createMockFn(),
    logChatMessageSkipped: createMockFn()
}));

mockModule('../../../src/utils/monetization-detector', () => ({
    detectMonetization: createMockFn().mockReturnValue({ detected: false, timingMs: 1 })
}));

const actualMessageNormalization = require('../../../src/utils/message-normalization');
mockModule('../../../src/utils/message-normalization', () => ({
    ...actualMessageNormalization,
    validateNormalizedMessage: createMockFn().mockReturnValue({ isValid: true })
}));

mockModule('../../../src/utils/notification-builder', () => ({
    build: createMockFn((data) => data)
}));

const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');

describe('ChatNotificationRouter lingering/priority/TTS', () => {
    afterEach(() => {
        clearAllMocks();
        restoreAllModuleMocks();
    });
    const baseMessage = {
        message: 'Hello world',
        displayName: 'Viewer',
        username: 'viewer',
        userId: 'user-1',
        timestamp: new Date().toISOString()
    };

    const createRouter = (overrides = {}) => {
        const runtime = {
            config: {
                general: { greetingsEnabled: true, messagesEnabled: true },
                tts: { deduplicationEnabled: true },
                twitch: {}
            },
            displayQueue: {
                addItem: createMockFn()
            },
            platformLifecycleService: {
                getPlatformConnectionTime: createMockFn().mockReturnValue(null)
            },
            commandCooldownService: {
                checkUserCooldown: createMockFn().mockReturnValue(true),
                checkGlobalCooldown: createMockFn().mockReturnValue(true),
                updateUserCooldown: createMockFn(),
                updateGlobalCooldown: createMockFn()
            },
            userTrackingService: {
                isFirstMessage: createMockFn().mockReturnValue(false)
            },
            commandParser: {
                getVFXConfig: createMockFn().mockReturnValue(null)
            },
            isFirstMessage: createMockFn().mockReturnValue(false),
            ...overrides.runtime
        };
        const logger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        const router = new ChatNotificationRouter({
            runtime,
            logger
        });

        return { router, runtime };
    };

    it('queues chat with priority lower than greeting when first message', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                isFirstMessage: createMockFn().mockReturnValue(true)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'first message' });

        const calls = runtime.displayQueue.addItem.mock.calls.map((c) => c[0]);
        expect(calls[0].type).toBe('chat');
        expect(calls[1].type).toBe('greeting');
        expect(calls[0].priority || 0).toBeLessThanOrEqual(calls[1].priority || Infinity);
    });

    it('does not enqueue greeting when platform greeting disabled', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { greetingsEnabled: true, messagesEnabled: true },
                    twitch: { greetingsEnabled: false }
                },
                isFirstMessage: createMockFn().mockReturnValue(true)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'first' });

        const types = runtime.displayQueue.addItem.mock.calls.map((c) => c[0].type);
        expect(types).toEqual(['chat']);
    });

    it('skips monetization detection errors by allowing chat enqueue', async () => {
        const { router, runtime } = createRouter();
        const MonetizationDetector = require('../../../src/utils/monetization-detector');
        MonetizationDetector.detectMonetization.mockImplementation(() => {
            throw new Error('detector failure');
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'hello' });

        const queuedChat = runtime.displayQueue.addItem.mock.calls.map((c) => c[0]).find((i) => i.type === 'chat');
        expect(queuedChat).toBeDefined();
        expect(queuedChat.data.monetizationDetectionError).toBeUndefined();
    });
});
