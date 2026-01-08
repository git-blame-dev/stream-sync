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

describe('ChatNotificationRouter TTS behavior', () => {
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
                general: {
                    greetingsEnabled: true,
                    messagesEnabled: true,
                    tts: { deduplicationEnabled: true }
                },
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
            gracefulExitService: null,
            commandParser: {
                getVFXConfig: jest.fn().mockReturnValue(null)
            },
            vfxService: null,
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

        return { router, runtime, logger };
    };

    it('sets skipChatTTS when deduplication detects monetization', async () => {
        const { router, runtime } = createRouter();
        const MonetizationDetector = require('../../../src/utils/monetization-detector');
        MonetizationDetector.detectMonetization.mockReturnValue({ detected: true, timingMs: 1 });

        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'cheer100 great stream' });

        const built = require('../../../src/utils/notification-builder').build;
        expect(built).toHaveBeenCalledWith(expect.objectContaining({ skipChatTTS: true }));
        const queuedChat = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
    });

    it('enqueues chat without skipChatTTS when monetization not detected', async () => {
        const { router, runtime } = createRouter();
        const MonetizationDetector = require('../../../src/utils/monetization-detector');
        MonetizationDetector.detectMonetization.mockReturnValue({ detected: false, timingMs: 1 });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'hello there' });

        const built = require('../../../src/utils/notification-builder').build;
        expect(built).toHaveBeenCalledWith(expect.objectContaining({ skipChatTTS: undefined }));
        const queuedChat = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
    });

    it('does not deduplicate when config disables TTS deduplication', async () => {
        const MonetizationDetector = require('../../../src/utils/monetization-detector');
        MonetizationDetector.detectMonetization.mockReturnValue({ detected: true, timingMs: 1 });

        const { router, runtime } = createRouter({
            runtime: {
                config: {
                    general: {
                        greetingsEnabled: true,
                        messagesEnabled: true
                    },
                    tts: { deduplicationEnabled: false }
                },
                displayQueue: { addItem: jest.fn() },
                platformLifecycleService: { getPlatformConnectionTime: jest.fn().mockReturnValue(null) },
                commandCooldownService: {
                    checkUserCooldown: jest.fn().mockReturnValue(true),
                    checkGlobalCooldown: jest.fn().mockReturnValue(true),
                    updateUserCooldown: jest.fn(),
                    updateGlobalCooldown: jest.fn()
                },
                userTrackingService: { isFirstMessage: jest.fn().mockReturnValue(false) },
                commandParser: { getVFXConfig: jest.fn().mockReturnValue(null) },
                isFirstMessage: jest.fn().mockReturnValue(false)
            }
        });

        await router.handleChatMessage('twitch', { ...baseMessage, message: 'bits 100' });

        expect(MonetizationDetector.detectMonetization).not.toHaveBeenCalled();
        const built = require('../../../src/utils/notification-builder').build;
        expect(built).toHaveBeenCalledWith(expect.objectContaining({ skipChatTTS: undefined }));
        const queuedChat = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
    });

    it('logs and continues when monetization detection throws', async () => {
        const MonetizationDetector = require('../../../src/utils/monetization-detector');
        MonetizationDetector.detectMonetization.mockImplementation(() => {
            throw new Error('detect failed');
        });

        const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() };
        const { router, runtime } = createRouter({ runtime: {}, logger });

        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'cheer100' });

        const built = require('../../../src/utils/notification-builder').build;
        expect(built).toHaveBeenCalledWith(expect.objectContaining({ skipChatTTS: false }));
        const queuedChat = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
    });
});
