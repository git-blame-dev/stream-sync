
const EventEmitter = require('events');
const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager Twitch monetisation behavior', () => {
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

    it('enqueues paypiggy with member priority and sanitized payload', async () => {
        await notificationManager.handleNotification('paypiggy', 'twitch', {
            username: 'SubHero',
            userId: 'user-1',
            tier: '1000',
            months: 3
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('paypiggy');
        expect(item.platform).toBe('twitch');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.MEMBER);
        expect(item.data.username).toBe('SubHero');
        expect(item.data.userId).toBe('user-1');
    });

    it('enqueues gift subs with giftpaypiggy priority', async () => {
        await notificationManager.handleNotification('giftpaypiggy', 'twitch', {
            username: 'GiftHero',
            userId: 'user-2',
            tier: '1000',
            giftCount: 5
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('giftpaypiggy');
        expect(item.platform).toBe('twitch');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.GIFTPAYPIGGY);
        expect(item.data.username).toBe('GiftHero');
    });

    it('enqueues bits as gifts with gift priority', async () => {
        await notificationManager.handleNotification('gift', 'twitch', {
            username: 'BitsHero',
            userId: 'user-3',
            isBits: true,
            bits: 500,
            giftType: 'bits',
            giftCount: 1,
            amount: 500,
            currency: 'bits',
            repeatCount: 1
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('gift');
        expect(item.platform).toBe('twitch');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.GIFT);
        expect(item.data.username).toBe('BitsHero');
    });

    it('respects config gating and skips when notifications are disabled', async () => {
        configService.areNotificationsEnabled.mockReturnValue(false);

        await notificationManager.handleNotification('paypiggy', 'twitch', {
            username: 'GatedUser'
        });

        expect(displayQueue.addItem).not.toHaveBeenCalled();
    });
});
