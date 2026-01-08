
const EventEmitter = require('events');
const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager TikTok monetisation behavior', () => {
    let displayQueue;
    let notificationManager;
    let configService;

    const baseDependencies = () => ({
        logger: {
            info: jest.fn(),
            debug: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        },
        displayQueue,
        eventBus: new EventEmitter(),
        constants: require('../../../src/core/constants'),
        textProcessing: { formatChatMessage: jest.fn() },
        obsGoals: { processDonationGoal: jest.fn() },
        configService,
        vfxCommandService: { getVFXConfig: jest.fn().mockResolvedValue(null) },
        ttsService: { speak: jest.fn() },
        userTrackingService: { isFirstMessage: jest.fn().mockResolvedValue(false) }
    });

    beforeEach(() => {
        displayQueue = { addItem: jest.fn() };
        configService = {
            areNotificationsEnabled: jest.fn().mockReturnValue(true),
            isEnabled: jest.fn().mockReturnValue(true),
            getNotificationSettings: jest.fn().mockReturnValue({ enabled: true, duration: 5000 }),
            getPlatformConfig: jest.fn().mockReturnValue({ notificationsEnabled: true }),
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
            isDebugEnabled: jest.fn().mockReturnValue(false),
            getTTSConfig: jest.fn().mockReturnValue({ enabled: false })
        };
        notificationManager = new NotificationManager(baseDependencies());
    });

    it('enqueues SUPER_FAN paypiggy with member priority', async () => {
        await notificationManager.handleNotification('paypiggy', 'tiktok', {
            username: 'SuperFan',
            userId: 'tk-user-1',
            isSuperfan: true,
            level: 'S2',
            months: 2
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('paypiggy');
        expect(item.platform).toBe('tiktok');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.MEMBER);
        expect(item.data.username).toBe('SuperFan');
    });

    it('enqueues coin gifts with gift priority', async () => {
        await notificationManager.handleNotification('gift', 'tiktok', {
            username: 'CoinHero',
            userId: 'tk-user-2',
            giftType: 'Rose',
            giftCount: 3,
            amount: 150,
            currency: 'coins'
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('gift');
        expect(item.platform).toBe('tiktok');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.GIFT);
        expect(item.data.username).toBe('CoinHero');
    });

    it('respects config gating and skips when notifications are disabled', async () => {
        configService.areNotificationsEnabled.mockReturnValue(false);

        await notificationManager.handleNotification('paypiggy', 'tiktok', {
            username: 'GatedUser'
        });

        expect(displayQueue.addItem).not.toHaveBeenCalled();
    });
});
