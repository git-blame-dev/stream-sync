const { describe, expect, it, beforeEach, afterEach } = require('bun:test');
export {};
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');
const { PRIORITY_LEVELS } = require('../../../src/core/constants');

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
        config: createConfigFixture(),
        constants: {
            PRIORITY_LEVELS,
            NOTIFICATION_CONFIGS: {
                'platform:follow': { settingKey: 'followsEnabled', commandKey: 'follows' },
                'platform:gift': { settingKey: 'giftsEnabled', commandKey: 'gifts' }
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
        it('returns disabled when notifications disabled in config', async () => {
            const deps = createDeps();
            deps.config = createConfigFixture({ general: { followsEnabled: false } });
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('platform:follow', 'tiktok', { username: 'testUser', userId: 'user123' });

            expect(result.success).toBe(false);
            expect(result.disabled).toBe(true);
        });

        it('continues processing when debug disabled in config', async () => {
            const deps = createDeps();
            deps.config = createConfigFixture({ general: { debugEnabled: false } });
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
                commandKey: 'gifts'
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
        it('throws meaningful error when config is null', () => {
            const deps = createDeps();
            deps.config = null;

            expect(() => new NotificationManager(deps)).toThrow('config');
        });

        it('throws meaningful error when config is undefined', () => {
            const deps = createDeps();
            deps.config = undefined;

            expect(() => new NotificationManager(deps)).toThrow('config');
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

        it('continues when debug enabled in config', async () => {
            const deps = createDeps();
            deps.config = createConfigFixture({ general: { debugEnabled: true } });
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('platform:follow', 'tiktok', {
                username: 'testUser',
                userId: 'user123'
            });

            expect(result.success).toBe(true);
        });
    });
});
