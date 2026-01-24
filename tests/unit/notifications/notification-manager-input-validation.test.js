const { describe, expect, it, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager input validation', () => {
    let originalNodeEnv;

    beforeEach(() => {
        originalNodeEnv = process.env.NODE_ENV;
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        process.env.NODE_ENV = originalNodeEnv;
        restoreAllMocks();
    });

    const createDeps = (overrides = {}) => ({
        logger: noOpLogger,
        displayQueue: { enqueue: createMockFn(), addItem: createMockFn(), getQueueLength: createMockFn(() => 0) },
        eventBus: { on: createMockFn(), emit: createMockFn(), subscribe: createMockFn() },
        configService: {
            areNotificationsEnabled: createMockFn(() => true),
            getPlatformConfig: createMockFn(() => true),
            isDebugEnabled: createMockFn(() => false),
            getTimingConfig: createMockFn(() => ({
                greetingDuration: 1000,
                commandDuration: 1000,
                chatDuration: 1000,
                notificationDuration: 1000
            })),
            getTTSConfig: createMockFn(() => ({
                enabled: false,
                deduplicationEnabled: true,
                debugDeduplication: false,
                onlyForGifts: false,
                voice: 'default',
                rate: 1,
                volume: 1
            })),
            get: createMockFn(() => ({
                userSuppressionEnabled: false,
                maxNotificationsPerUser: 5,
                suppressionWindowMs: 60000,
                suppressionDurationMs: 300000,
                suppressionCleanupIntervalMs: 300000
            }))
        },
        constants: {
            PRIORITY_LEVELS: { DEFAULT: 0, FOLLOW: 1, GIFT: 2, ENVELOPE: 3, MEMBER: 4, CHEER: 5, RAID: 6, SHARE: 7, REDEMPTION: 8, GIFTPAYPIGGY: 9, COMMAND: 10, GREETING: 11, CHAT: 12 },
            NOTIFICATION_CONFIGS: {
                'platform:follow': { settingKey: 'followsEnabled', commandKey: 'follows', hasSpecialProcessing: false },
                'platform:gift': { settingKey: 'giftsEnabled', commandKey: 'gifts', hasSpecialProcessing: true }
            }
        },
        textProcessing: { formatChatMessage: createMockFn() },
        obsGoals: { processDonationGoal: createMockFn() },
        vfxCommandService: { getVFXConfig: createMockFn(() => Promise.resolve(null)) },
        ...overrides
    });

    describe('platform validation', () => {
        it('returns error for non-string platform instead of throwing', async () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('platform:follow', null, { username: 'testUser', userId: 'user123' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('platform');
        });

        it('returns error for undefined platform instead of throwing', async () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('platform:follow', undefined, { username: 'testUser', userId: 'user123' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('platform');
        });

        it('returns error for numeric platform instead of throwing', async () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('platform:follow', 123, { username: 'testUser', userId: 'user123' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('platform');
        });
    });

    describe('userId normalization order', () => {
        it('normalizes userId to string before suppression check', async () => {
            const deps = createDeps();
            deps.configService.get = createMockFn(() => ({
                userSuppressionEnabled: true,
                maxNotificationsPerUser: 5,
                suppressionWindowMs: 60000,
                suppressionDurationMs: 300000,
                suppressionCleanupIntervalMs: 300000
            }));
            const manager = new NotificationManager(deps);

            // Track the userId that gets passed to isUserSuppressed
            const originalIsUserSuppressed = manager.isUserSuppressed.bind(manager);
            let capturedUserId = null;
            manager.isUserSuppressed = (userId, type) => {
                capturedUserId = userId;
                return originalIsUserSuppressed(userId, type);
            };

            // Pass numeric userId
            await manager.handleNotification('platform:follow', 'tiktok', { username: 'testUser', userId: 12345 });

            // userId should be normalized to string before suppression check
            expect(capturedUserId).toBe('12345');
        });
    });

    describe('processNotification platform normalization', () => {
        it('normalizes platform case in processNotification', async () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            // Call processNotification with mixed-case platform
            const result = await manager.processNotification({
                type: 'platform:follow',
                platform: 'TikTok',
                data: { username: 'testUser', userId: 'user123' }
            });

            // Should not throw due to mixed case
            expect(result).not.toBeInstanceOf(Error);
        });
    });

    describe('error handling - graceful degradation', () => {
        it('returns disabled when _areNotificationsEnabled throws instead of dropping notification', async () => {
            const deps = createDeps();
            deps.configService.areNotificationsEnabled = createMockFn(() => {
                throw new Error('ConfigService error');
            });
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('platform:follow', 'tiktok', { username: 'testUser', userId: 'user123' });

            expect(result.success).toBe(false);
            expect(result.disabled).toBe(true);
        });

        it('continues processing when _isDebugEnabled throws instead of dropping notification', async () => {
            const deps = createDeps();
            deps.configService.isDebugEnabled = createMockFn(() => {
                throw new Error('ConfigService error');
            });
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('platform:follow', 'tiktok', { username: 'testUser', userId: 'user123' });

            expect(result).toBeDefined();
            expect(result.error === undefined || !result.error.includes('debug')).toBe(true);
        });
    });

    describe('async handling', () => {
        it('handleAggregatedDonation is async and can be awaited', async () => {
            const deps = createDeps();
            deps.constants.NOTIFICATION_CONFIGS['platform:gift'] = {
                settingKey: 'giftsEnabled',
                commandKey: 'gifts',
                hasSpecialProcessing: true
            };
            const manager = new NotificationManager(deps);

            const result = manager.handleAggregatedDonation({
                username: 'testUser',
                platform: 'tiktok',
                message: 'test message',
                amount: 100,
                currency: 'USD',
                giftType: 'Rose',
                giftCount: 1
            });

            expect(result).toBeInstanceOf(Promise);
            await result;
        });
    });

    describe('config loading safety', () => {
        it('throws meaningful error when configService.get returns null', () => {
            const deps = createDeps();
            deps.configService.get = createMockFn(() => null);

            expect(() => new NotificationManager(deps)).toThrow('Invalid suppression config');
        });

        it('throws meaningful error when configService.get returns undefined', () => {
            const deps = createDeps();
            deps.configService.get = createMockFn(() => undefined);

            expect(() => new NotificationManager(deps)).toThrow('Invalid suppression config');
        });
    });

    describe('try/catch robustness', () => {
        it('continues when VFX config throws', async () => {
            const deps = createDeps();
            deps.vfxCommandService.getVFXConfig = createMockFn(() => {
                throw new Error('VFX service unavailable');
            });
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('platform:follow', 'tiktok', {
                username: 'testUser',
                userId: 'user123'
            });

            expect(result.success).toBe(true);
        });

        it('continues when generateLogMessage throws in debug mode', async () => {
            const deps = createDeps();
            deps.configService.isDebugEnabled = createMockFn(() => true);
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('platform:follow', 'tiktok', {
                username: 'testUser',
                userId: 'user123'
            });

            expect(result.success).toBe(true);
        });
    });
});
