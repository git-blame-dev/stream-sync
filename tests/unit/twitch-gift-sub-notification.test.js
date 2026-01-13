
const { initializeTestLogging } = require('../helpers/test-setup');
initializeTestLogging();

const { createMockLogger, createMockDisplayQueue } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const { expectNoTechnicalArtifacts } = require('../helpers/assertion-helpers');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { createTextProcessingManager } = require('../../src/utils/text-processing');

setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

describe('Twitch gift subscriptions', () => {
    let mockLogger;
    let mockDisplayQueue;
    let notificationManager;

    const createManager = () => {
        const mockEventBus = { emit: jest.fn(), on: jest.fn(), off: jest.fn() };
        const mockConfigService = {
            areNotificationsEnabled: jest.fn().mockReturnValue(true),
            getPlatformConfig: jest.fn().mockReturnValue(true),
            get: jest.fn((section) => {
                if (section === 'general') {
                    return {
                        enabled: true,
                        giftsEnabled: true,
                        debugEnabled: true,
                        userSuppressionEnabled: false,
                        maxNotificationsPerUser: 5,
                        suppressionWindowMs: 60000,
                        suppressionDurationMs: 300000,
                        suppressionCleanupIntervalMs: 300000
                    };
                }
                return {};
            }),
            isDebugEnabled: jest.fn().mockReturnValue(false),
            getTTSConfig: jest.fn().mockReturnValue({ enabled: false })
        };
        const constants = require('../../src/core/constants');
        const textProcessing = createTextProcessingManager({ logger: mockLogger });
        const obsGoals = require('../../src/obs/goals').getDefaultGoalsManager();
        const vfxCommandService = { getVFXConfig: jest.fn().mockResolvedValue(null) };
        return new NotificationManager({
            displayQueue: mockDisplayQueue,
            logger: mockLogger,
            eventBus: mockEventBus,
            configService: mockConfigService,
            constants,
            textProcessing,
            obsGoals,
            vfxCommandService
        });
    };

    beforeEach(() => {
        mockLogger = createMockLogger('debug', { captureConsole: true });
        mockDisplayQueue = createMockDisplayQueue({ length: 0 });
        notificationManager = createManager();
    });

    it('renders gifter and count in display and TTS output', async () => {
        const twitchGiftPaypiggyData = {
            userId: '123456789',
            username: 'GiftUser',
            displayName: 'GiftUser',
            tier: '1000',
            giftCount: 5,
            cumulativeTotal: 7,
            isAnonymous: false
        };

        const result = await notificationManager.handleNotification('platform:giftpaypiggy', 'twitch', twitchGiftPaypiggyData);

        expect(result).toEqual(expect.objectContaining({ success: true }));
        expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);

        const queueItem = mockDisplayQueue.addItem.mock.calls[0][0];
        const notificationData = queueItem.data;

        expect(queueItem.type).toBe('giftpaypiggy');
        expect(notificationData.platform).toBe('twitch');
        expect(notificationData.displayMessage).toContain('GiftUser');
        expect(notificationData.displayMessage).toMatch(/gift|sub/i);
        expect(notificationData.displayMessage).toMatch(/5|five/i);
        expect(notificationData.displayMessage).not.toContain('unknown');

        expect(notificationData.ttsMessage).toContain('GiftUser');
        expect(notificationData.ttsMessage).toMatch(/5|five/i);
        expect(notificationData.ttsMessage).toMatch(/gift|sub/i);
        expect(notificationData.ttsMessage).not.toContain('unknown');

        expectNoTechnicalArtifacts(notificationData.displayMessage);
        expectNoTechnicalArtifacts(notificationData.ttsMessage);
    });

    it('avoids placeholders when gift fields are incomplete', async () => {
        const minimalGiftPaypiggyData = {
            userId: '123456789',
            username: 'GiftUser',
            giftCount: 2
        };

        const result = await notificationManager.handleNotification('platform:giftpaypiggy', 'twitch', minimalGiftPaypiggyData);

        expect(result).toEqual(expect.objectContaining({ success: true }));
        expect(mockDisplayQueue.addItem).toHaveBeenCalledTimes(1);

        const queueItem = mockDisplayQueue.addItem.mock.calls[0][0];
        const notificationData = queueItem.data;

        expect(notificationData.displayMessage).toContain('GiftUser');
        expect(notificationData.displayMessage).toMatch(/2|two/i);
        expect(notificationData.displayMessage).not.toMatch(/\{.*\}/);
        expect(notificationData.displayMessage).not.toContain('undefined');
        expect(notificationData.displayMessage).not.toContain('null');

        expectNoTechnicalArtifacts(notificationData.displayMessage);
    });
});
