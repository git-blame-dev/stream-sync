
const EventEmitter = require('events');
const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager YouTube monetisation behavior', () => {
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

    it('enqueues paypiggy with member priority and renewal copy fields', async () => {
        await notificationManager.handleNotification('paypiggy', 'youtube', {
            username: 'MemberHero',
            userId: 'yt-user-1',
            membershipLevel: 'Member',
            months: 6,
            id: 'paypiggy-yt-1',
            timestamp: '2025-01-01T00:00:00.000Z'
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('paypiggy');
        expect(item.platform).toBe('youtube');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.MEMBER);
        expect(item.data.username).toBe('MemberHero');
        expect(item.data.userId).toBe('yt-user-1');
    });

    it('enqueues YouTube paid messages as gift with gift priority', async () => {
        await notificationManager.handleNotification('gift', 'youtube', {
            username: 'ChatHero',
            userId: 'yt-user-2',
            giftType: 'Super Chat',
            giftCount: 1,
            amount: 10,
            currency: 'USD',
            id: 'gift-yt-1',
            timestamp: '2025-01-01T00:00:00.000Z'
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('gift');
        expect(item.platform).toBe('youtube');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.GIFT);
    });

    it('enqueues Super Sticker as gift with gift priority', async () => {
        await notificationManager.handleNotification('gift', 'youtube', {
            username: 'StickerHero',
            userId: 'yt-user-3',
            giftType: 'Super Sticker',
            giftCount: 1,
            amount: 4.99,
            currency: 'USD',
            message: 'CoolSticker',
            id: 'gift-yt-2',
            timestamp: '2025-01-01T00:00:00.000Z'
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('gift');
        expect(item.platform).toBe('youtube');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.GIFT);
    });

    it('enqueues gift memberships with giftpaypiggy priority', async () => {
        await notificationManager.handleNotification('giftpaypiggy', 'youtube', {
            username: 'Gifter',
            userId: 'yt-user-4',
            giftCount: 3,
            id: 'giftpaypiggy-yt-1',
            timestamp: '2025-01-01T00:00:00.000Z'
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('giftpaypiggy');
        expect(item.platform).toBe('youtube');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.GIFTPAYPIGGY);
    });

    it('respects config gating and skips when notifications are disabled', async () => {
        configService.areNotificationsEnabled.mockReturnValue(false);

        await notificationManager.handleNotification('paypiggy', 'youtube', {
            username: 'GatedUser'
        });

        expect(displayQueue.addItem).not.toHaveBeenCalled();
    });
});
