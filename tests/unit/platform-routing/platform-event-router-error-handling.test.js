
const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

describe('PlatformEventRouter error handling', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

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
const errorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };

        mockModule('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: createMockFn(() => errorHandler)
        }));

        const PlatformEventRouter = require('../../../src/services/PlatformEventRouter');

        const mockAppRuntime = {
            handleChatMessage: createMockFn(() => Promise.reject(thrownValue))
        };

        let subscriber;
        const eventBus = {
            subscribe: createMockFn((event, handler) => {
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
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        const router = new PlatformEventRouter({
            eventBus,
            runtime: mockAppRuntime,
            notificationManager: { handleNotification: createMockFn() },
            configService: { areNotificationsEnabled: createMockFn(() => true) },
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
