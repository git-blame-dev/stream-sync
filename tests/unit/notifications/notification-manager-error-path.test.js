const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const NotificationManager = require('../../../src/notifications/NotificationManager');
const constants = require('../../../src/core/constants');

const createDisplayQueueStub = () => {
    const items = [];
    return {
        items,
        addItem: (item) => items.push(item),
        getQueueLength: () => items.length
    };
};

const createConfigServiceStub = () => ({
    areNotificationsEnabled: () => true,
    getPlatformConfig: () => ({}),
    getNotificationSettings: () => ({ enabled: true }),
    isEnabled: () => true,
    get: (section) => {
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
    },
    getTimingConfig: () => ({}),
    isDebugEnabled: () => false,
    getTTSConfig: () => ({ enabled: false })
});

describe('NotificationManager monetization error path', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('queues gift error notifications with placeholder values', async () => {
        const displayQueue = createDisplayQueueStub();
        const manager = new NotificationManager({
            displayQueue,
            eventBus: { emit: createMockFn(), subscribe: createMockFn() },
            configService: createConfigServiceStub(),
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            logger: noOpLogger,
            constants,
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() }
        });

        const result = await manager.handleNotification('platform:gift', 'twitch', {
            username: 'Unknown User',
            userId: 'unknown',
            giftType: 'Unknown gift',
            giftCount: 0,
            amount: 0,
            currency: 'unknown',
            isError: true
        });

        expect(result).toEqual(expect.objectContaining({ success: true }));
        expect(displayQueue.items).toHaveLength(1);
        const queued = displayQueue.items[0];
        expect(queued.data.isError).toBe(true);
        expect(queued.data.displayMessage).toMatch(/error/i);
        expect(queued.data.ttsMessage).toMatch(/error/i);
        expect(queued.data.logMessage).toMatch(/error/i);
    });
});
