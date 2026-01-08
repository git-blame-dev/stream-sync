
jest.mock('../../../src/utils/chat-logger', () => ({
    logChatMessageWithConfig: jest.fn(),
    logChatMessageSkipped: jest.fn()
}));

jest.mock('../../../src/utils/monetization-detector', () => ({
    detectMonetization: jest.fn().mockReturnValue({ detected: false, timingMs: 1 })
}));

jest.mock('../../../src/utils/message-normalization', () => ({
    validateNormalizedMessage: jest.fn().mockReturnValue({ isValid: true })
}));

jest.mock('../../../src/utils/notification-builder', () => ({
    build: jest.fn((data) => data)
}));

const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');

describe('ChatNotificationRouter lingering/priority/TTS', () => {
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
                addItem: jest.fn()
            },
            platformLifecycleService: {
                getPlatformConnectionTime: jest.fn().mockReturnValue(null)
            },
            commandCooldownService: {
                checkUserCooldown: jest.fn().mockReturnValue(true),
                checkGlobalCooldown: jest.fn().mockReturnValue(true),
                updateUserCooldown: jest.fn(),
                updateGlobalCooldown: jest.fn()
            },
            userTrackingService: {
                isFirstMessage: jest.fn().mockReturnValue(false)
            },
            commandParser: {
                getVFXConfig: jest.fn().mockReturnValue(null)
            },
            isFirstMessage: jest.fn().mockReturnValue(false),
            ...overrides.runtime
        };
        const logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
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
                isFirstMessage: jest.fn().mockReturnValue(true)
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
                isFirstMessage: jest.fn().mockReturnValue(true)
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
