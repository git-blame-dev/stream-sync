
const { describe, test, expect, beforeEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const EventEmitter = require('events');
const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager Twitch monetisation behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let displayQueue;
    let notificationManager;
    let configService;

    const baseDependencies = () => ({
        logger: {
            info: createMockFn(),
            debug: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        },
        displayQueue,
        eventBus: new EventEmitter(),
        constants: require('../../../src/core/constants'),
        textProcessing: { formatChatMessage: createMockFn() },
        obsGoals: { processDonationGoal: createMockFn() },
        configService,
        vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
        ttsService: { speak: createMockFn() },
        userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
    });

    beforeEach(() => {
        displayQueue = { addItem: createMockFn() };
        configService = {
            areNotificationsEnabled: createMockFn().mockReturnValue(true),
            isEnabled: createMockFn().mockReturnValue(true),
            getNotificationSettings: createMockFn().mockReturnValue({ enabled: true, duration: 5000 }),
            getPlatformConfig: createMockFn().mockReturnValue({ notificationsEnabled: true }),
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
            isDebugEnabled: createMockFn().mockReturnValue(false),
            getTTSConfig: createMockFn().mockReturnValue({ enabled: false })
        };
        notificationManager = new NotificationManager(baseDependencies());
    });

    it('enqueues paypiggy with member priority and sanitized payload', async () => {
        await notificationManager.handleNotification('platform:paypiggy', 'twitch', {
            username: 'SubHero',
            userId: 'user-1',
            tier: '1000',
            months: 3
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('platform:paypiggy');
        expect(item.platform).toBe('twitch');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.MEMBER);
        expect(item.data.username).toBe('SubHero');
        expect(item.data.userId).toBe('user-1');
    });

    it('enqueues gift subs with giftpaypiggy priority', async () => {
        await notificationManager.handleNotification('platform:giftpaypiggy', 'twitch', {
            username: 'GiftHero',
            userId: 'user-2',
            tier: '1000',
            giftCount: 5
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('platform:giftpaypiggy');
        expect(item.platform).toBe('twitch');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.GIFTPAYPIGGY);
        expect(item.data.username).toBe('GiftHero');
    });

    it('enqueues bits as gifts with gift priority', async () => {
        await notificationManager.handleNotification('platform:gift', 'twitch', {
            username: 'BitsHero',
            userId: 'user-3',
            bits: 500,
            giftType: 'bits',
            giftCount: 1,
            amount: 500,
            currency: 'bits',
            repeatCount: 1
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('platform:gift');
        expect(item.platform).toBe('twitch');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.GIFT);
        expect(item.data.username).toBe('BitsHero');
    });

    it('respects config gating and skips when notifications are disabled', async () => {
        configService.areNotificationsEnabled.mockReturnValue(false);

        await notificationManager.handleNotification('platform:paypiggy', 'twitch', {
            username: 'GatedUser'
        });

        expect(displayQueue.addItem).not.toHaveBeenCalled();
    });
});
