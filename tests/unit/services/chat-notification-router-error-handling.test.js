describe('ChatNotificationRouter error handling', () => {
    const baseMessage = {
        message: 'Hello world',
        displayName: 'Viewer',
        username: 'viewer',
        userId: 'user-1',
        timestamp: new Date().toISOString()
    };

    afterEach(() => {
        jest.resetModules();
    });

    const setupRouterWithThrowingQueue = (thrownValue) => {
        const errorHandler = {
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        };

        jest.doMock('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: jest.fn(() => errorHandler)
        }));

        jest.doMock('../../../src/utils/chat-logger', () => ({
            logChatMessageWithConfig: jest.fn(),
            logChatMessageSkipped: jest.fn()
        }));

        jest.doMock('../../../src/utils/monetization-detector', () => ({
            detectMonetization: jest.fn().mockReturnValue({ detected: false, timingMs: 1 })
        }));

        jest.doMock('../../../src/utils/message-normalization', () => ({
            validateNormalizedMessage: jest.fn().mockReturnValue({ isValid: true })
        }));

        jest.doMock('../../../src/utils/notification-builder', () => ({
            build: jest.fn((data) => data)
        }));

        const ChatNotificationRouter = require('../../../src/services/ChatNotificationRouter');

        const runtime = {
            config: {
                general: { messagesEnabled: true, greetingsEnabled: true },
                tts: { deduplicationEnabled: true },
                twitch: {}
            },
            platformLifecycleService: {
                getPlatformConnectionTime: jest.fn().mockReturnValue(null)
            },
            displayQueue: {
                addItem: jest.fn(() => {
                    throw thrownValue;
                })
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
            isFirstMessage: jest.fn().mockReturnValue(false)
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
