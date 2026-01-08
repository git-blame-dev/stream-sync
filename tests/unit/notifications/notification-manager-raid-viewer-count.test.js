
const EventEmitter = require('events');
const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager raid viewer count fallback', () => {
    const createManager = () => {
        const logger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        const displayQueue = {
            addToQueue: jest.fn(),
            processQueue: jest.fn(),
            isQueueEmpty: jest.fn().mockReturnValue(true),
            clearQueue: jest.fn()
        };

        const configService = {
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
            areNotificationsEnabled: jest.fn().mockReturnValue(true),
            isDebugEnabled: jest.fn().mockReturnValue(false)
        };

        return new NotificationManager({
            logger,
            displayQueue,
            eventBus: new EventEmitter(),
            configService,
            constants: require('../../../src/core/constants'),
            textProcessing: { formatChatMessage: jest.fn() },
            obsGoals: { processDonationGoal: jest.fn() },
            vfxCommandService: { executeCommand: jest.fn().mockResolvedValue({ success: true }) },
            ttsService: { speak: jest.fn().mockResolvedValue({ success: true }) },
            userTrackingService: { isFirstMessage: jest.fn().mockResolvedValue(false) }
        });
    };

    test('throws when raid viewer count is missing', () => {
        const manager = createManager();
        expect(() => manager.generateLogMessage('raid', { username: 'MysteryRaider' }))
            .toThrow('Raid log message requires viewerCount');
    });
});
