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
const testClock = require('../../helpers/test-clock');

describe('ChatNotificationRouter platform chat behavior', () => {
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
                getPlatformConnectionTime: jest.fn().mockReturnValue(null)
            },
            displayQueue: {
                addItem: jest.fn()
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
                displayQueue: { addItem: jest.fn() }
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
                displayQueue: { addItem: jest.fn() }
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
                displayQueue: { addItem: jest.fn() }
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
                    getPlatformConnectionTime: jest.fn().mockReturnValue(connectionTime)
                },
                displayQueue: { addItem: jest.fn() }
            }
        });

        const oldTimestamp = new Date(connectionTime - 1000).toISOString();
        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'late arrival', timestamp: oldTimestamp });

        expect(runtime.displayQueue.addItem).not.toHaveBeenCalled();
        const { logChatMessageSkipped } = require('../../../src/utils/chat-logger');
        expect(logChatMessageSkipped).toHaveBeenCalledWith('tiktok', expect.any(Object), 'old message (sent before connection)');
    });
});
