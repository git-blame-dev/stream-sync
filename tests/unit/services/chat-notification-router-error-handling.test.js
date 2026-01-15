const { describe, it, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const actualMessageNormalization = require('../../../src/utils/message-normalization');

describe('ChatNotificationRouter error handling', () => {
    const baseMessage = {
        message: 'Hello world',
        displayName: 'Viewer',
        username: 'viewer',
        userId: 'user-1',
        timestamp: new Date().toISOString()
    };

    afterEach(() => {
        resetModules();
        clearAllMocks();
        restoreAllModuleMocks();
    });

    const setupRouterWithThrowingQueue = (thrownValue) => {
        const errorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };

        mockModule('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: createMockFn(() => errorHandler)
        }));

        mockModule('../../../src/utils/chat-logger', () => ({
            logChatMessageWithConfig: createMockFn(),
            logChatMessageSkipped: createMockFn()
        }));

        mockModule('../../../src/utils/monetization-detector', () => ({
            detectMonetization: createMockFn().mockReturnValue({ detected: false, timingMs: 1 })
        }));

        mockModule('../../../src/utils/message-normalization', () => ({
            ...actualMessageNormalization,
            validateNormalizedMessage: createMockFn().mockReturnValue({ isValid: true })
        }));

        mockModule('../../../src/utils/notification-builder', () => ({
            build: createMockFn((data) => data)
        }));

        const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');

        const runtime = {
            config: {
                general: { messagesEnabled: true, greetingsEnabled: true },
                tts: { deduplicationEnabled: true },
                twitch: {}
            },
            platformLifecycleService: {
                getPlatformConnectionTime: createMockFn().mockReturnValue(null)
            },
            displayQueue: {
                addItem: createMockFn(() => {
                    throw thrownValue;
                })
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
            isFirstMessage: createMockFn().mockReturnValue(false)
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

        return { router, runtime, errorHandler };
    };

    it('routes display queue failures through platform error handler', async () => {
        const thrownError = new Error('queue fail');
        const { router, errorHandler } = setupRouterWithThrowingQueue(thrownError);

        await expect(router.handleChatMessage('twitch', baseMessage)).resolves.toBeUndefined();

        expect(errorHandler.handleEventProcessingError).toHaveBeenCalledWith(
            thrownError,
            'chat-routing',
            null,
            expect.stringContaining('queue fail')
        );
        expect(errorHandler.logOperationalError).not.toHaveBeenCalled();
    });

    it('logs operational errors when non-Error values surface during routing', async () => {
        const thrownValue = 'string failure';
        const { router, errorHandler } = setupRouterWithThrowingQueue(thrownValue);

        await expect(router.handleChatMessage('twitch', baseMessage)).resolves.toBeUndefined();

        expect(errorHandler.logOperationalError).toHaveBeenCalledWith(
            expect.stringContaining('string failure'),
            'chat-router',
            thrownValue
        );
        expect(errorHandler.handleEventProcessingError).not.toHaveBeenCalled();
    });
});
