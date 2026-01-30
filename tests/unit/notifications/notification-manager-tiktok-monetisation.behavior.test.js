
const { describe, expect, beforeEach, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');

const EventEmitter = require('events');
const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager TikTok monetisation behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    let displayQueue;
    let notificationManager;
    let config;

    const baseDependencies = () => ({
        logger: noOpLogger,
        displayQueue,
        eventBus: new EventEmitter(),
        constants: require('../../../src/core/constants'),
        textProcessing: { formatChatMessage: createMockFn() },
        obsGoals: { processDonationGoal: createMockFn() },
        config,
        vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
        ttsService: { speak: createMockFn() },
        userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
    });

    beforeEach(() => {
        displayQueue = { addItem: createMockFn() };
        config = createConfigFixture({
            general: {
                giftsEnabled: true,
                paypiggiesEnabled: true
            }
        });
        notificationManager = new NotificationManager(baseDependencies());
    });

    it('enqueues SUPER_FAN paypiggy with member priority', async () => {
        await notificationManager.handleNotification('platform:paypiggy', 'tiktok', {
            username: 'SuperFan',
            userId: 'tk-user-1',
            tier: 'superfan',
            level: 'S2',
            months: 2
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('platform:paypiggy');
        expect(item.platform).toBe('tiktok');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.MEMBER);
        expect(item.data.username).toBe('SuperFan');
    });

    it('enqueues coin gifts with gift priority', async () => {
        await notificationManager.handleNotification('platform:gift', 'tiktok', {
            username: 'CoinHero',
            userId: 'tk-user-2',
            giftType: 'Rose',
            giftCount: 3,
            amount: 150,
            currency: 'coins'
        });

        expect(displayQueue.addItem).toHaveBeenCalledTimes(1);
        const item = displayQueue.addItem.mock.calls[0][0];
        expect(item.type).toBe('platform:gift');
        expect(item.platform).toBe('tiktok');
        expect(item.priority).toBe(notificationManager.PRIORITY_LEVELS.GIFT);
        expect(item.data.username).toBe('CoinHero');
    });

    it('respects config gating and skips when notifications are disabled', async () => {
        const disabledConfig = createConfigFixture({
            general: { paypiggiesEnabled: false }
        });
        const disabledManager = new NotificationManager({
            logger: noOpLogger,
            displayQueue,
            eventBus: new EventEmitter(),
            constants: require('../../../src/core/constants'),
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() },
            config: disabledConfig,
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            ttsService: { speak: createMockFn() },
            userTrackingService: { isFirstMessage: createMockFn().mockResolvedValue(false) }
        });

        await disabledManager.handleNotification('platform:paypiggy', 'tiktok', {
            username: 'GatedUser'
        });

        expect(displayQueue.addItem).not.toHaveBeenCalled();
    });
});
