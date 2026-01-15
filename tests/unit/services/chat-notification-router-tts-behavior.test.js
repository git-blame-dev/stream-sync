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

describe('ChatNotificationRouter TTS behavior', () => {
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
                general: {
                    greetingsEnabled: true,
                    messagesEnabled: true,
                    tts: { deduplicationEnabled: true }
                },
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
            gracefulExitService: null,
            commandParser: {
                getVFXConfig: createMockFn().mockReturnValue(null)
            },
            vfxService: null,
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
                displayQueue: { addItem: createMockFn() },
                platformLifecycleService: { getPlatformConnectionTime: createMockFn().mockReturnValue(null) },
                commandCooldownService: {
                    checkUserCooldown: createMockFn().mockReturnValue(true),
                    checkGlobalCooldown: createMockFn().mockReturnValue(true),
                    updateUserCooldown: createMockFn(),
                    updateGlobalCooldown: createMockFn()
                },
                userTrackingService: { isFirstMessage: createMockFn().mockReturnValue(false) },
                commandParser: { getVFXConfig: createMockFn().mockReturnValue(null) },
                isFirstMessage: createMockFn().mockReturnValue(false)
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

        const logger = { debug: createMockFn(), info: createMockFn(), warn: createMockFn(), error: createMockFn() };
        const { router, runtime } = createRouter({ runtime: {}, logger });

        await router.handleChatMessage('tiktok', { ...baseMessage, message: 'cheer100' });

        const built = require('../../../src/utils/notification-builder').build;
        expect(built).toHaveBeenCalledWith(expect.objectContaining({ skipChatTTS: false }));
        const queuedChat = runtime.displayQueue.addItem.mock.calls.map(c => c[0]).find(i => i.type === 'chat');
        expect(queuedChat).toBeDefined();
    });
});
