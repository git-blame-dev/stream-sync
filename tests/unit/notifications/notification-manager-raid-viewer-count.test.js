const { describe, test, expect, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const EventEmitter = require('events');
const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager raid viewer count fallback', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const createManager = () => {
        const displayQueue = {
            addToQueue: createMockFn(),
            processQueue: createMockFn(),
            isQueueEmpty: createMockFn().mockReturnValue(true),
            clearQueue: createMockFn()
        };

        const configService = {
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
            areNotificationsEnabled: createMockFn().mockReturnValue(true),
            isDebugEnabled: createMockFn().mockReturnValue(false)
        };

        return new NotificationManager({
            logger: noOpLogger,
            displayQueue,
            eventBus: new EventEmitter(),
            configService,
            constants: require('../../../src/core/constants'),
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() },
            vfxCommandService: { executeCommand: createMockFn().mockResolvedValue({ success: true }) },
            ttsService: { speak: createMockFn().mockResolvedValue({ success: true }) },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });
    };

    test('throws when raid viewer count is missing', () => {
        const manager = createManager();
        expect(() => manager.generateLogMessage('platform:raid', { username: 'MysteryRaider' }))
            .toThrow('Raid log message requires viewerCount');
    });
});
