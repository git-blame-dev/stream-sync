const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('Notification type normalization', () => {
    let items;
    let notificationManager;

    beforeEach(() => {
        items = [];

        const displayQueue = {
            addItem: async (item) => {
                items.push(item);
                return true;
            }
        };

        const eventBus = {
            emit: jest.fn(),
            subscribe: jest.fn(() => () => {})
        };

        const configService = {
            areNotificationsEnabled: () => true,
            isDebugEnabled: () => false,
            getPlatformConfig: () => true,
            getTTSConfig: () => ({ enabled: false }),
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
            }
        };

        notificationManager = new NotificationManager({
            logger: { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() },
            displayQueue,
            eventBus,
            constants: require('../../../src/core/constants'),
            textProcessing: { formatChatMessage: jest.fn() },
            obsGoals: { processDonationGoal: jest.fn() },
            configService,
            vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) },
            ttsService: { speak: jest.fn() }
        });
    });

    it('rejects mismatched payload types instead of enqueuing a follow notification', async () => {
        const result = await notificationManager.handleNotification('platform:follow', 'tiktok', {
            username: 'alice',
            userId: 'tiktok-1',
            type: 'platform:follow'
        });

        expect(result).toEqual(expect.objectContaining({
            success: false,
            error: 'Unknown notification type',
            notificationType: 'follow',
            platform: 'tiktok'
        }));
        expect(items).toHaveLength(0);
    });
});
