const { describe, test, expect, it, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

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

const noOpLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe('NotificationManager paypiggy normalization', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    it('processes canonical paypiggy notifications with paypiggy priority and VFX command', async () => {
        const displayQueue = createDisplayQueueStub();
        const manager = new NotificationManager({
            displayQueue,
            eventBus: { emit: createMockFn(), subscribe: createMockFn() },
            configService: createConfigServiceStub(),
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue({ commandKey: 'paypiggies' }) },
            logger: noOpLogger,
            constants,
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() }
        });

        await manager.handleNotification('platform:paypiggy', 'tiktok', {
            username: 'PaidFan',
            userId: 'sub_123',
            platform: 'tiktok'
        });

        expect(displayQueue.items).toHaveLength(1);
        const queued = displayQueue.items[0];
        expect(queued.priority).toBe(constants.PRIORITY_LEVELS.MEMBER);
        expect(queued.vfxConfig?.commandKey).toBe('paypiggies');
        expect(queued.type).toBe('platform:paypiggy');
        expect(queued.data.type).toBe('platform:paypiggy');
        expect(queued.data.displayMessage).toContain('subscribed');
    });

    it('handles paypiggy notifications through canonical path', async () => {
        const displayQueue = createDisplayQueueStub();
        const manager = new NotificationManager({
            displayQueue,
            eventBus: { emit: createMockFn(), subscribe: createMockFn() },
            configService: createConfigServiceStub(),
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue({ commandKey: 'paypiggies' }) },
            logger: noOpLogger,
            constants,
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() }
        });

        await manager.handleNotification('platform:paypiggy', 'tiktok', {
            username: 'AliasFreeSub',
            userId: 'alias_free_sub'
        });

        expect(displayQueue.items).toHaveLength(1);
        const queued = displayQueue.items[0];
        expect(queued.type).toBe('platform:paypiggy');
        expect(queued.data.type).toBe('platform:paypiggy');
        expect(queued.data.username).toBe('AliasFreeSub');
    });

    it('rejects subscription alias inputs instead of auto-normalizing', async () => {
        const displayQueue = createDisplayQueueStub();
        const manager = new NotificationManager({
            displayQueue,
            eventBus: { emit: createMockFn(), subscribe: createMockFn() },
            configService: createConfigServiceStub(),
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue({ commandKey: 'paypiggies' }) },
            logger: noOpLogger,
            constants,
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() }
        });

        const result = await manager.handleNotification('subscription', 'twitch', {
            username: 'AliasUser',
            userId: 'alias_123'
        });

        expect(result.success).toBe(false);
        expect(displayQueue.items).toHaveLength(0);
    });

    it('rejects membership alias inputs instead of auto-normalizing', async () => {
        const displayQueue = createDisplayQueueStub();
        const manager = new NotificationManager({
            displayQueue,
            eventBus: { emit: createMockFn(), subscribe: createMockFn() },
            configService: createConfigServiceStub(),
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue({ commandKey: 'paypiggies' }) },
            logger: noOpLogger,
            constants,
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() }
        });

        const result = await manager.handleNotification('membership', 'youtube', {
            username: 'AliasMember',
            userId: 'alias_member'
        });

        expect(result.success).toBe(false);
        expect(displayQueue.items).toHaveLength(0);
    });

    it('rejects subscribe alias inputs instead of auto-normalizing', async () => {
        const displayQueue = createDisplayQueueStub();
        const manager = new NotificationManager({
            displayQueue,
            eventBus: { emit: createMockFn(), subscribe: createMockFn() },
            configService: createConfigServiceStub(),
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue({ commandKey: 'paypiggies' }) },
            logger: noOpLogger,
            constants,
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() }
        });

        const result = await manager.handleNotification('subscribe', 'twitch', {
            username: 'AliasSub',
            userId: 'alias_sub'
        });

        expect(result.success).toBe(false);
        expect(displayQueue.items).toHaveLength(0);
    });

    it('rejects supporter alias inputs instead of auto-normalizing', async () => {
        const displayQueue = createDisplayQueueStub();
        const manager = new NotificationManager({
            displayQueue,
            eventBus: { emit: createMockFn(), subscribe: createMockFn() },
            configService: createConfigServiceStub(),
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue({ commandKey: 'paypiggies' }) },
            logger: noOpLogger,
            constants,
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() }
        });

        const result = await manager.handleNotification('supporter', 'twitch', {
            username: 'SupporterAlias',
            userId: 'supporter_123'
        });

        expect(result.success).toBe(false);
        expect(displayQueue.items).toHaveLength(0);
    });

    it('rejects superfan alias inputs and requires canonical paypiggy with tier instead', async () => {
        const displayQueue = createDisplayQueueStub();
        const manager = new NotificationManager({
            displayQueue,
            eventBus: { emit: createMockFn(), subscribe: createMockFn() },
            configService: createConfigServiceStub(),
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue({ commandKey: 'paypiggies' }) },
            logger: noOpLogger,
            constants,
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() }
        });

        const result = await manager.handleNotification('superfan', 'tiktok', {
            username: 'SuperFanUser',
            userId: 'sf_123'
        });

        expect(result.success).toBe(false);
        expect(displayQueue.items).toHaveLength(0);

        await manager.handleNotification('platform:paypiggy', 'tiktok', {
            username: 'SuperFanUser',
            userId: 'sf_123',
            tier: 'superfan'
        });

        expect(displayQueue.items).toHaveLength(1);
        expect(displayQueue.items[0].data.type).toBe('platform:paypiggy');
        expect(displayQueue.items[0].data.tier).toBe('superfan');
    });

    it('fails when ConfigService is missing (fail-fast)', async () => {
        const displayQueue = createDisplayQueueStub();
        const originalEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        expect(() => new NotificationManager({
            displayQueue,
            eventBus: { emit: createMockFn(), subscribe: createMockFn() },
            vfxCommandService: { getVFXConfig: createMockFn().mockResolvedValue(null) },
            logger: noOpLogger,
            constants,
            textProcessing: { formatChatMessage: createMockFn() },
            obsGoals: { processDonationGoal: createMockFn() }
        })).toThrow('NotificationManager requires ConfigService dependency');
        process.env.NODE_ENV = originalEnv;
    });

    it('rejects monetization alias types instead of remapping', async () => {
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

        const result = await manager.handleNotification('superchat', 'youtube', {
            username: 'SuperChatter',
            userId: 'sc-1'
        });

        expect(result).toEqual(expect.objectContaining({ success: false, error: 'Unknown notification type' }));
        expect(displayQueue.items).toHaveLength(0);
    });
});
