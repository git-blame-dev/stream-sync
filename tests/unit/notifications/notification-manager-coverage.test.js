const { describe, expect, it, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');
const { safeSetInterval } = require('../../../src/utils/timeout-validator');

const NotificationManager = require('../../../src/notifications/NotificationManager');

describe('NotificationManager coverage', () => {
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
        displayQueue: {
            enqueue: createMockFn(),
            addItem: createMockFn(),
            getQueueLength: createMockFn(() => 0)
        },
        eventBus: {
            on: createMockFn(),
            emit: createMockFn(),
            subscribe: createMockFn()
        },
        config: createConfigFixture({ general: { ttsEnabled: true }, tts: { enabled: true } }),
        constants: {
            PRIORITY_LEVELS: {
                DEFAULT: 0, FOLLOW: 1, GIFT: 2, ENVELOPE: 3, MEMBER: 4,
                CHEER: 5, RAID: 6, SHARE: 7, REDEMPTION: 8, GIFTPAYPIGGY: 9,
                COMMAND: 10, GREETING: 11, CHAT: 12
            },
            NOTIFICATION_CONFIGS: {
                'platform:gift': { settingKey: 'giftsEnabled', commandKey: 'gifts', hasSpecialProcessing: true },
                'platform:follow': { settingKey: 'followsEnabled', commandKey: 'follows', hasSpecialProcessing: false },
                'platform:paypiggy': { settingKey: 'paypiggyEnabled', commandKey: 'subscriptions', hasSpecialProcessing: true },
                'platform:raid': { settingKey: 'raidsEnabled', commandKey: 'raids', hasSpecialProcessing: false },
                'greeting': { settingKey: 'greetingsEnabled', commandKey: 'greetings', hasSpecialProcessing: false }
            }
        },
        textProcessing: { formatChatMessage: createMockFn() },
        obsGoals: { processDonationGoal: createMockFn() },
        vfxCommandService: {
            getVFXConfig: createMockFn(() => Promise.resolve(null)),
            executeCommand: createMockFn()
        },
        userTrackingService: {
            isFirstMessage: createMockFn(() => Promise.resolve(false)),
            markMessageSeen: createMockFn()
        },
        ...overrides
    });

    describe('handleAggregatedDonation', () => {
        it('does not throw when processing aggregated donation', () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            const aggregatedData = {
                userId: 'testUser123',
                username: 'testDonor',
                platform: 'tiktok',
                giftTypes: ['Rose', 'Heart'],
                totalGifts: 15,
                totalCoins: 500,
                message: 'Thank you!'
            };

            expect(() => manager.handleAggregatedDonation(aggregatedData)).not.toThrow();
        });
    });

    describe('cleanupSuppressionData', () => {
        it('removes entries with no recent activity', () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            manager.userNotificationSuppression.set('emptyUser', {
                notifications: [],
                suppressedUntil: null
            });

            manager.cleanupSuppressionData();

            expect(manager.userNotificationSuppression.has('emptyUser')).toBe(false);
        });

        it('does not throw when suppression map is empty', () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);
            manager.userNotificationSuppression.clear();

            expect(() => manager.cleanupSuppressionData()).not.toThrow();
        });

        it('iterates over all suppression entries', () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            manager.userNotificationSuppression.set('user1', {
                notifications: [],
                suppressedUntil: null
            });
            manager.userNotificationSuppression.set('user2', {
                notifications: [],
                suppressedUntil: null
            });

            manager.cleanupSuppressionData();

            expect(manager.userNotificationSuppression.size).toBe(0);
        });
    });

    describe('stopSuppressionCleanup', () => {
        it('clears cleanup interval when running', () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);
            manager.cleanupInterval = safeSetInterval(() => {}, 10000);

            manager.stopSuppressionCleanup();

            expect(manager.cleanupInterval).toBeNull();
        });

        it('handles already stopped state gracefully', () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);
            manager.cleanupInterval = null;

            expect(() => manager.stopSuppressionCleanup()).not.toThrow();
        });
    });

    describe('processVFXForNotification', () => {
        it('executes VFX command when service available', async () => {
            const executedCommands = [];
            const deps = createDeps({
                vfxCommandService: {
                    executeCommand: (cmd, ctx) => executedCommands.push({ cmd, ctx })
                }
            });
            const manager = new NotificationManager(deps);

            await manager.processVFXForNotification({
                type: 'platform:gift',
                platform: 'tiktok',
                username: 'testUser',
                vfxCommand: 'confetti'
            });

            expect(executedCommands.length).toBe(1);
            expect(executedCommands[0].cmd).toBe('confetti');
        });

        it('skips when no VFX command specified', async () => {
            const executedCommands = [];
            const deps = createDeps({
                vfxCommandService: {
                    executeCommand: (cmd, ctx) => executedCommands.push({ cmd, ctx })
                }
            });
            const manager = new NotificationManager(deps);

            await manager.processVFXForNotification({
                type: 'platform:gift',
                vfxCommand: null
            });

            expect(executedCommands.length).toBe(0);
        });

        it('handles VFX service errors gracefully', async () => {
            const deps = createDeps({
                vfxCommandService: {
                    executeCommand: () => { throw new Error('VFX error'); }
                }
            });
            const manager = new NotificationManager(deps);

            await expect(manager.processVFXForNotification({
                type: 'platform:gift',
                vfxCommand: 'broken'
            })).resolves.toBeUndefined();
        });
    });

    describe('processNotification', () => {
        it('does not throw when processing notification', async () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            await expect(manager.processNotification({
                type: 'platform:gift',
                platform: 'tiktok',
                data: { userId: 'test', username: 'testUser', giftType: 'Rose', giftCount: 1 }
            })).resolves.toBeUndefined();
        });

        it('skips disabled notification types without throwing', async () => {
            const deps = createDeps({
                config: createConfigFixture({ general: { giftsEnabled: false } })
            });
            const manager = new NotificationManager(deps);

            await expect(manager.processNotification({
                type: 'platform:gift',
                platform: 'tiktok',
                data: { userId: 'test', username: 'testUser' }
            })).resolves.toBeUndefined();
        });

        it('handles unknown notification type gracefully', async () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            await expect(manager.processNotification({
                type: 'unknown:type',
                platform: 'test',
                data: {}
            })).resolves.toBeUndefined();
        });

        it('handles missing data gracefully', async () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            await expect(manager.processNotification({
                type: 'platform:gift',
                platform: 'tiktok',
                data: null
            })).resolves.toBeUndefined();
        });
    });

    describe('getPriorityForType', () => {
        it('returns config priority when specified', () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            const priority = manager.getPriorityForType('platform:gift', { priority: 99 });

            expect(priority).toBe(99);
        });

        it('returns mapped priority for known types', () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            const priority = manager.getPriorityForType('platform:gift', {});

            expect(priority).toBe(deps.constants.PRIORITY_LEVELS.GIFT);
        });

        it('throws for unknown notification type', () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            expect(() => manager.getPriorityForType('unknown:type', {}))
                .toThrow('Missing priority mapping');
        });
    });

    describe('build', () => {
        it('delegates to NotificationBuilder.build', () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            const result = manager.build({
                type: 'platform:follow',
                platform: 'twitch',
                username: 'testUser'
            });

            expect(result).toBeDefined();
            expect(result.type).toBe('platform:follow');
        });
    });

    describe('handleNotification', () => {
        it('returns error for null data', async () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('platform:gift', 'tiktok', null);

            expect(result.success).toBe(false);
            expect(result.error).toContain('Invalid');
        });

        it('returns error for unsupported paid alias', async () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('subscription', 'twitch', { userId: 'test' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('alias');
        });

        it('returns error for unknown notification type', async () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('unknown:type', 'test', { userId: 'test' });

            expect(result.success).toBe(false);
            expect(result.error).toContain('Unknown');
        });

        it('returns error for type mismatch', async () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            const result = await manager.handleNotification('platform:gift', 'tiktok', {
                type: 'platform:follow',
                userId: 'test'
            });

            expect(result.success).toBe(false);
        });
    });

    describe('_isFirstMessage', () => {
        it('returns true for first message', async () => {
            const deps = createDeps({
                userTrackingService: {
                    isFirstMessage: createMockFn(() => Promise.resolve(true)),
                    markMessageSeen: createMockFn()
                }
            });
            const manager = new NotificationManager(deps);

            const result = await manager._isFirstMessage('user123');

            expect(result).toBe(true);
        });

        it('returns false for returning user', async () => {
            const deps = createDeps({
                userTrackingService: {
                    isFirstMessage: createMockFn(() => Promise.resolve(false)),
                    markMessageSeen: createMockFn()
                }
            });
            const manager = new NotificationManager(deps);

            const result = await manager._isFirstMessage('user123');

            expect(result).toBe(false);
        });

        it('throws when service unavailable', async () => {
            const deps = createDeps({ userTrackingService: null });
            const manager = new NotificationManager(deps);

            await expect(manager._isFirstMessage('user123')).rejects.toThrow('UserTrackingService');
        });
    });

    describe('_handleNotificationError', () => {
        it('logs error without throwing', () => {
            const deps = createDeps();
            const manager = new NotificationManager(deps);

            expect(() => manager._handleNotificationError(
                'Test error message',
                new Error('test'),
                { data: 'test' },
                { eventType: 'test' }
            )).not.toThrow();
        });
    });
});
