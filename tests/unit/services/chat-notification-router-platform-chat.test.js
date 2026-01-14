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

mockModule('../../../src/utils/message-normalization', () => ({
    validateNormalizedMessage: createMockFn().mockReturnValue({ isValid: true })
}));

mockModule('../../../src/utils/notification-builder', () => ({
    build: createMockFn((data) => data)
}));

const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');
const testClock = require('../../helpers/test-clock');

describe('ChatNotificationRouter platform chat behavior', () => {
    afterEach(() => {
        clearAllMocks();
        restoreAllModuleMocks();
    });
    const baseMessage = {
        message: 'Hello world',
        displayName: 'Viewer',
        username: 'viewer',
        userId: 'user-1',
        timestamp: new Date(testClock.now()).toISOString()
    };

    const createRouter = (overrides = {}) => {
        const runtime = {
            config: {
                general: { greetingsEnabled: true, messagesEnabled: true },
                tiktok: { messagesEnabled: true },
                twitch: { messagesEnabled: true },
                youtube: { messagesEnabled: true },
                tts: { deduplicationEnabled: true }
            },
            platformLifecycleService: {
                getPlatformConnectionTime: createMockFn().mockReturnValue(null)
            },
            displayQueue: {
                addItem: createMockFn()
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

    it('queues chat on TikTok when enabled', async () => {
        const { router, runtime } = createRouter();
        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'ni hao' });

        const queued = runtime.displayQueue.addItem.mock.calls.map((c) => c[0]).find((i) => i.type === 'chat');
        expect(queued).toBeDefined();
        expect(queued.platform).toBe('tiktok');
    });

    it('skips chat on Twitch when messages disabled for platform', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { messagesEnabled: true },
                    twitch: { messagesEnabled: false }
                },
                displayQueue: { addItem: createMockFn() }
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'hi' });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
        const { logChatMessageSkipped } = require('../../../src/utils/chat-logger');
        expect(logChatMessageSkipped).toHaveBeenCalledWith('twitch', expect.any(Object), 'messages disabled');
    });

    it('sanitizes Twitch chat payload with HTML and enqueues', async () => {
        const { router, runtime } = createRouter();
        await router.handleChatMessage('twitch', { ...baseMessage, message: '<b>Hi</b>' });

        const queued = runtime.displayQueue.addItem.mock.calls.map((c) => c[0]).find((i) => i.type === 'chat');
        expect(queued.data.message).toBe('Hi');
    });

    it('queues chat on YouTube when enabled', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('youtube', { ...baseMessage, username: 'ytuser', message: 'hello youtube' });

        expect(runtime.displayQueue.addItem).toHaveBeenCalledWith(
            expect.objectContaining({
                type: 'chat',
                platform: 'youtube',
                data: expect.objectContaining({ message: 'hello youtube' })
            })
        );
    });

    it('skips chat on YouTube when messages disabled for platform', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { messagesEnabled: true },
                    youtube: { messagesEnabled: false }
                },
                displayQueue: { addItem: createMockFn() }
            }
        });

        await router.handleChatMessage('youtube', { ...baseMessage, message: 'hello youtube' });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalledWith(expect.objectContaining({ type: 'chat' }));
        const { logChatMessageSkipped } = require('../../../src/utils/chat-logger');
        expect(logChatMessageSkipped).toHaveBeenCalledWith('youtube', expect.any(Object), 'messages disabled');
    });

    it('skips all platform chat when global messagesEnabled is false', async () => {
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { messagesEnabled: false },
                    tiktok: {},
                    twitch: {},
                    youtube: {}
                },
                displayQueue: { addItem: createMockFn() }
            }
        });

        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'blocked globally' });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalled();
        const { logChatMessageSkipped } = require('../../../src/utils/chat-logger');
        expect(logChatMessageSkipped).toHaveBeenCalledWith('tiktok', expect.any(Object), 'messages disabled');
    });

    it('defaults to allowing chat for unknown platforms when global toggle is on', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('unknownPlatform', { ...baseMessage, message: 'hello unknown' });

        const queued = runtime.displayQueue.addItem.mock.calls.map((c) => c[0]).find((i) => i.type === 'chat');
        expect(queued).toBeDefined();
        expect(queued.platform).toBe('unknownPlatform');
    });

    it('skips chat messages that are only whitespace', async () => {
        const { router, runtime } = createRouter();

        await router.handleChatMessage('tiktok', { ...baseMessage, message: '   ' });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalled();
        const { logChatMessageSkipped } = require('../../../src/utils/chat-logger');
        expect(logChatMessageSkipped).toHaveBeenCalledWith('tiktok', expect.any(Object), 'empty message');
    });

    it('skips chat sent before platform connection time', async () => {
        const connectionTime = testClock.now();
        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: { messagesEnabled: true, filterOldMessages: true },
                    tiktok: { messagesEnabled: true }
                },
                platformLifecycleService: {
                    getPlatformConnectionTime: createMockFn().mockReturnValue(connectionTime)
                },
                displayQueue: { addItem: createMockFn() }
            }
        });

        const oldTimestamp = new Date(connectionTime - 1000).toISOString();
        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'late arrival', timestamp: oldTimestamp });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalled();
        const { logChatMessageSkipped } = require('../../../src/utils/chat-logger');
        expect(logChatMessageSkipped).toHaveBeenCalledWith('tiktok', expect.any(Object), 'old message (sent before connection)');
    });
});
