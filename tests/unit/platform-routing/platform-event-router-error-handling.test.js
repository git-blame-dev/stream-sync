
describe('PlatformEventRouter error handling', () => {
    const baseEvent = {
        platform: 'twitch',
        type: 'platform:chat-message',
        data: {
            username: 'User',
            message: { text: 'hi' },
            userId: 'user-1',
            timestamp: new Date().toISOString(),
            metadata: {}
        }
    };

    const buildRouter = (thrownValue) => {
        jest.resetModules();

        const errorHandler = {
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        };

        jest.doMock('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: jest.fn(() => errorHandler)
        }));

        const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

        const mockAppRuntime = {
            handleChatMessage: jest.fn(() => Promise.reject(thrownValue))
        };

        let subscriber;
        const eventBus = {
            subscribe: jest.fn((event, handler) => {
                subscriber = handler;
                return () => {};
            }),
            emit: async (event, payload) => {
                if (subscriber) {
                    await subscriber(payload);
                }
            }
        };

        const logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        const router = new PlatformEventRouter({
            eventBus,
            runtime: mockAppRuntime,
            notificationManager: { handleNotification: jest.fn() },
            configService: { areNotificationsEnabled: jest.fn(() => true) },
            logger
        });

        return { router, mockAppRuntime, errorHandler, eventBus };
    };

    it('routes handler errors through createPlatformErrorHandler', async () => {
        const thrownError = new Error('route boom');
        const { errorHandler, eventBus } = buildRouter(thrownError);

        await eventBus.emit('platform:event', baseEvent);

        expect(errorHandler.handleEventProcessingError).toHaveBeenCalledWith(
            thrownError,
            'platform:chat-message',
            null,
            expect.stringContaining('route boom')
        );
        expect(errorHandler.logOperationalError).not.toHaveBeenCalled();
    });

    it('logs operational errors for non-Error handler failures', async () => {
        const thrownValue = 'string failure';
        const { errorHandler, eventBus } = buildRouter(thrownValue);

        await eventBus.emit('platform:event', baseEvent);

        expect(errorHandler.logOperationalError).toHaveBeenCalledWith(
            expect.stringContaining('string failure'),
            'PlatformEventRouter',
            thrownValue
        );
        expect(errorHandler.handleEventProcessingError).not.toHaveBeenCalled();
    });
});
