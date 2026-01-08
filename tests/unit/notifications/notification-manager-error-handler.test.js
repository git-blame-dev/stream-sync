describe('NotificationManager error handling with createPlatformErrorHandler', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        jest.resetModules();
        process.env.NODE_ENV = originalEnv;
    });

    function createManagerWithFailingDisplayQueue() {
        process.env.NODE_ENV = 'test';

        const errorHandler = {
            handleEventProcessingError: jest.fn(),
            logOperationalError: jest.fn()
        };

        jest.doMock('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: jest.fn(() => errorHandler)
        }));

        const mockDisplayQueue = {
            addItem: jest.fn(() => { throw new Error('queue fail'); }),
            addToQueue: jest.fn(),
            processQueue: jest.fn(),
            isQueueEmpty: jest.fn().mockReturnValue(true),
            clearQueue: jest.fn()
        };

        const mockConfigService = {
            areNotificationsEnabled: jest.fn().mockReturnValue(true),
            getNotificationSettings: jest.fn().mockReturnValue({ enabled: true }),
            getTTSConfig: jest.fn().mockReturnValue({ enabled: false }),
            get: jest.fn((section) => {
                if (section !== 'general') {
                    return {};
                }
                return {
                    userSuppressionEnabled: false,
                    maxNotificationsPerUser: 5,
                    suppressionWindowMs: 60000,
                    suppressionDurationMs: 300000,
                    suppressionCleanupIntervalMs: 300000
                };
            }),
            isDebugEnabled: jest.fn().mockReturnValue(false)
        };

        const mockEventBus = { emit: jest.fn() };

        const NotificationManager = require('../../../src/notifications/NotificationManager');

        const manager = new NotificationManager({
            logger: { info: jest.fn(), debug: jest.fn(), warn: jest.fn(), error: jest.fn() },
            displayQueue: mockDisplayQueue,
            eventBus: mockEventBus,
            constants: require('../../../src/core/constants'),
            textProcessing: { formatChatMessage: jest.fn() },
            obsGoals: { processDonationGoal: jest.fn() },
            configService: mockConfigService,
            vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) }
        });

        return { manager, errorHandler, mockEventBus };
    }

    it('routes display queue failures through platform error handler and returns failure', async () => {
        const { manager, errorHandler, mockEventBus } = createManagerWithFailingDisplayQueue();

        const result = await manager.handleNotification('follow', 'tiktok', { username: 'User', userId: '1' });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            error: 'Display queue error',
            details: 'queue fail'
        }));

        expect(errorHandler.handleEventProcessingError).toHaveBeenCalled();
        const [error, eventType] = errorHandler.handleEventProcessingError.mock.calls[0];
        expect(error).toBeInstanceOf(Error);
        expect(error.message).toBe('queue fail');
        expect(eventType).toBe('display-queue');

        const processedEvents = mockEventBus.emit.mock.calls.filter(([event]) => event === 'notification:processed');
        expect(processedEvents).toHaveLength(0);
    });

    // VFX is emitted by DisplayQueue; NotificationManager no longer emits VFX commands directly.
});
