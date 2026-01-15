const { describe, test, expect, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

describe('NotificationManager error handling with createPlatformErrorHandler', () => {
    const originalEnv = process.env.NODE_ENV;

    afterEach(() => {
        restoreAllMocks();
process.env.NODE_ENV = originalEnv;
    
        restoreAllModuleMocks();});

    function createManagerWithFailingDisplayQueue() {
        process.env.NODE_ENV = 'test';

        const errorHandler = {
            handleEventProcessingError: createMockFn(),
            logOperationalError: createMockFn()
        };

        mockModule('../../../src/utils/platform-error-handler', () => ({
            createPlatformErrorHandler: createMockFn(() => errorHandler)
        }));

        const mockDisplayQueue = {
            addItem: createMockFn(() => { throw new Error('queue fail'); }),
            addToQueue: createMockFn(),
            processQueue: createMockFn(),
            isQueueEmpty: createMockFn().mockReturnValue(true),
            clearQueue: createMockFn()
        };

        const mockConfigService = {
            areNotificationsEnabled: createMockFn().mockReturnValue(true),
            getNotificationSettings: createMockFn().mockReturnValue({ enabled: true }),
            getTTSConfig: createMockFn().mockReturnValue({ enabled: false }),
            get: createMockFn((section) => {
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
            isDebugEnabled: createMockFn().mockReturnValue(false)
        };

        const mockEventBus = { emit: createMockFn() };

        const NotificationManager = require('../../../src/notifications/NotificationManager');

        const manager = new NotificationManager({
            logger: { info: createMockFn(), debug: createMockFn(), warn: createMockFn(), error: createMockFn() },
            displayQueue: mockDisplayQueue,
            eventBus: mockEventBus,
            constants: require('../../../src/core/constants'),
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() },
            configService: mockConfigService,
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) }
        });

        return { manager, errorHandler, mockEventBus };
    }

    it('routes display queue failures through platform error handler and returns failure', async () => {
        const { manager, errorHandler, mockEventBus } = createManagerWithFailingDisplayQueue();

        const result = await manager.handleNotification('platform:follow', 'tiktok', { username: 'User', userId: '1' });

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
