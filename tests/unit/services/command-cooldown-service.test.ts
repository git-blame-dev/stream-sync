const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const { CommandCooldownService } = require('../../../src/services/CommandCooldownService.ts');
const { createConfigFixture } = require('../../helpers/config-fixture');
const testClock = require('../../helpers/test-clock');

describe('CommandCooldownService', () => {
    let service;
    let mockEventBus;
    let eventSubscriptions;
    let testConfig;

    beforeEach(() => {
        eventSubscriptions = {};

        mockEventBus = {
            emit: createMockFn(),
            subscribe: createMockFn((eventName, handler) => {
                eventSubscriptions[eventName] = handler;
                return () => {
                    delete eventSubscriptions[eventName];
                };
            })
        };

        testConfig = createConfigFixture();
        service = new CommandCooldownService({
            eventBus: mockEventBus,
            logger: noOpLogger,
            config: testConfig
        });
    });

    afterEach(() => {
        if (service) {
            service.dispose();
        }
        restoreAllMocks();
        clearAllMocks();
    });

    it('should require config when constructing the service', () => {
        expect(() => new CommandCooldownService({
            eventBus: mockEventBus,
            logger: noOpLogger
        })).toThrow('CommandCooldownService requires config');
    });

    describe('Per-User Command Cooldowns', () => {
        it('should allow command execution when no cooldown is active', () => {
            const userId = 'user123';
            const platformCooldown = 60000;
            const heavyCooldown = 300000;

            const canExecute = service.checkUserCooldown(userId, platformCooldown, heavyCooldown);

            expect(canExecute).toBe(true);
        });

        it('should block command execution during cooldown period', () => {
            const userId = 'user123';
            const platformCooldown = 60000;
            const heavyCooldown = 300000;

            service.updateUserCooldown(userId);
            const canExecute = service.checkUserCooldown(userId, platformCooldown, heavyCooldown);

            expect(canExecute).toBe(false);
            const status = service.getCooldownStatus(userId);
            expect(status.timeSinceLastCommand).toBeLessThan(platformCooldown);
            expect(status.lastCommandTime).toBeGreaterThan(0);
        });

        it('should allow command after cooldown period expires', () => {
            const userId = 'user123';
            const platformCooldown = 100;
            const heavyCooldown = 300000;

            service.updateUserCooldown(userId);
            testClock.advance(platformCooldown + 1);

            const canExecute = service.checkUserCooldown(userId, platformCooldown, heavyCooldown);
            expect(canExecute).toBe(true);
        });

        it('should track different cooldowns for different users', () => {
            const userA = 'userA';
            const userB = 'userB';
            const platformCooldown = 60000;
            const heavyCooldown = 300000;

            service.updateUserCooldown(userA);

            const canUserBExecute = service.checkUserCooldown(userB, platformCooldown, heavyCooldown);
            const canUserAExecute = service.checkUserCooldown(userA, platformCooldown, heavyCooldown);

            expect(canUserBExecute).toBe(true);
            expect(canUserAExecute).toBe(false);
        });
    });

    describe('Heavy Command Detection', () => {
        it('should detect heavy command usage when threshold is exceeded', () => {
            const userId = 'user123';
            const platformCooldown = 1000;
            const heavyCooldown = 5000;

            service.updateUserCooldown(userId);
            service.updateUserCooldown(userId);
            service.updateUserCooldown(userId);
            service.updateUserCooldown(userId);

            const canExecute = service.checkUserCooldown(userId, platformCooldown, heavyCooldown);

            expect(canExecute).toBe(false);
            const status = service.getCooldownStatus(userId);
            expect(status.isHeavyLimit).toBe(true);
            expect(status.commandCount).toBeGreaterThanOrEqual(4);
        });

        it('should apply heavy command cooldown after detection', () => {
            const userId = 'spamUser';
            const platformCooldown = 0;
            const heavyCooldown = 5000;
            const threshold = service.cooldownConfig.heavyCommandThreshold;

            for (let i = 0; i < threshold; i++) {
                service.updateUserCooldown(userId);
            }

            const heavyDetectedEvents = mockEventBus.emit.mock.calls.filter(
                ([eventName]: [string]) => eventName === 'cooldown:heavy-detected'
            );
            expect(heavyDetectedEvents).toHaveLength(1);
            expect(heavyDetectedEvents[0][1]).toEqual(expect.objectContaining({
                userId,
                commandCount: threshold
            }));

            mockEventBus.emit.mockClear();
            const canExecute = service.checkUserCooldown(userId, platformCooldown, heavyCooldown);

            expect(canExecute).toBe(false);
            const heavyBlockedEvents = mockEventBus.emit.mock.calls.filter(
                ([eventName]: [string]) => eventName === 'cooldown:blocked'
            );
            expect(heavyBlockedEvents).toHaveLength(1);
            expect(heavyBlockedEvents[0][1]).toEqual(expect.objectContaining({
                userId,
                type: 'heavy',
                remainingMs: expect.any(Number)
            }));
        });

        it('should reset heavy command status after cooldown period', () => {
            const userId = 'cooldownUser';
            const heavyCooldown = 1000;
            const threshold = service.cooldownConfig.heavyCommandThreshold;

            for (let i = 0; i < threshold; i++) {
                service.updateUserCooldown(userId);
            }

            service.userLastCommand.set(userId, testClock.now() - heavyCooldown - 10);

            const canExecute = service.checkUserCooldown(userId, 0, heavyCooldown);

            expect(canExecute).toBe(true);
            expect(service.getCooldownStatus(userId).isHeavyLimit).toBe(false);
        });

        it('should not count commands older than time window', () => {
            const userId = 'windowUser';
            service.cooldownConfig.heavyCommandThreshold = 2;
            service.cooldownConfig.heavyCommandWindow = 1000;

            const staleTimestamp = testClock.now() - 5000;
            service.userCommandTimestamps.set(userId, [staleTimestamp, staleTimestamp - 100]);

            service.updateUserCooldown(userId);

            const timestamps = service.userCommandTimestamps.get(userId);
            expect(timestamps.length).toBe(1);
            expect(service.getCooldownStatus(userId).isHeavyLimit).toBe(false);
        });
    });

    describe('Global Command Cooldowns', () => {
        it('should prevent same command from being spammed globally', () => {
            const commandName = '!hello';
            service.updateGlobalCooldown(commandName);

            const canExecute = service.checkGlobalCooldown(commandName, 60000);

            expect(canExecute).toBe(false);
            const globalBlockedEvents = mockEventBus.emit.mock.calls.filter(
                ([eventName]: [string]) => eventName === 'cooldown:global-blocked'
            );
            expect(globalBlockedEvents).toHaveLength(1);
            expect(globalBlockedEvents[0][1]).toEqual(expect.objectContaining({
                commandName,
                remainingMs: expect.any(Number)
            }));
        });

        it('should allow different commands during global cooldown', () => {
            service.updateGlobalCooldown('!hello');

            const canExecute = service.checkGlobalCooldown('!hug', 60000);

            expect(canExecute).toBe(true);
        });

        it('should reset global cooldown after expiration', () => {
            const commandName = '!hello';
            service.globalCommandCooldowns.set(commandName, testClock.now() - 120000);

            const canExecute = service.checkGlobalCooldown(commandName, 60000);

            expect(canExecute).toBe(true);
        });
    });

    describe('Cooldown Configuration', () => {
        it('should load cooldown overrides from config when provided', () => {
            const customConfig = createConfigFixture({
                cooldowns: { 
                    defaultCooldownMs: 30000,
                    heavyCommandThreshold: 7
                }
            });

            service.dispose();
            service = new CommandCooldownService({
                eventBus: mockEventBus,
                logger: noOpLogger,
                config: customConfig
            });

            expect(service.getStatus().config.defaultCooldown).toBe(30000);
            expect(service.getStatus().config.heavyCommandThreshold).toBe(7);
        });

        it('should report service status metrics for observability', () => {
            service.updateUserCooldown('userA');
            service.updateUserCooldown('userB');
            service.updateUserCooldown('userB');
            service.updateUserCooldown('userB');
            service.updateUserCooldown('userB');
            service.updateGlobalCooldown('!boom');

            const status = service.getStatus();
            expect(status.activeUsers).toBe(2);
            expect(status.heavyLimitUsers).toBeGreaterThanOrEqual(1);
            expect(status.globalCommandsTracked).toBe(1);
            expect(status.config.defaultCooldown).toBeGreaterThan(0);
            expect(status.lastConfigRefresh).toBeTruthy();
        });

        it('should apply config overrides from cooldown config events', () => {
            eventSubscriptions['config:changed']({
                section: 'cooldowns',
                value: {
                    defaultCooldown: 2,
                    heavyCommandCooldown: 3,
                    heavyCommandThreshold: 4,
                    heavyCommandWindow: 5,
                    globalCooldown: 6,
                    maxEntries: 7
                }
            });

            const status = service.getStatus();
            expect(status.config.defaultCooldown).toBe(2000);
            expect(status.config.heavyCommandCooldown).toBe(3000);
            expect(status.config.heavyCommandThreshold).toBe(4);
            expect(status.config.heavyCommandWindow).toBe(5000);
            expect(status.config.globalCooldown).toBe(6000);
            expect(status.config.maxEntries).toBe(7);
        });

        it('should keep fallback values for invalid config overrides', () => {
            const baseline = service.getStatus().config;

            service.loadCooldownConfig({
                defaultCooldown: 0,
                heavyCommandCooldown: -1,
                heavyCommandThreshold: 0,
                heavyCommandWindow: -5,
                globalCooldown: 0,
                maxEntries: -1
            });

            const updated = service.getStatus().config;
            expect(updated.defaultCooldown).toBe(baseline.defaultCooldown);
            expect(updated.heavyCommandCooldown).toBe(baseline.heavyCommandCooldown);
            expect(updated.heavyCommandThreshold).toBe(baseline.heavyCommandThreshold);
            expect(updated.heavyCommandWindow).toBe(baseline.heavyCommandWindow);
            expect(updated.globalCooldown).toBe(baseline.globalCooldown);
            expect(updated.maxEntries).toBe(baseline.maxEntries);
        });
    });

    describe('Event-Driven Integration', () => {
        it('should emit cooldown-blocked event when command is on cooldown', () => {
            const userId = 'eventUser';
            const platformCooldown = 1000;
            const heavyCooldown = 3000;

            service.updateUserCooldown(userId);
            mockEventBus.emit.mockClear();

            const canExecute = service.checkUserCooldown(userId, platformCooldown, heavyCooldown);

            expect(canExecute).toBe(false);
            const blockedEvents = mockEventBus.emit.mock.calls.filter(
                ([eventName]: [string]) => eventName === 'cooldown:blocked'
            );
            expect(blockedEvents).toHaveLength(1);
            expect(blockedEvents[0][1]).toEqual(expect.objectContaining({
                userId,
                type: 'regular',
                remainingMs: expect.any(Number)
            }));
        });

        it('should update user cooldown timestamp when command executed', () => {
            const userId = 'user123';
            const beforeTime = testClock.now();

            service.updateUserCooldown(userId);
            const afterTime = testClock.now();

            const status = service.getCooldownStatus(userId);
            expect(status.lastCommandTime).toBeGreaterThanOrEqual(beforeTime);
            expect(status.lastCommandTime).toBeLessThanOrEqual(afterTime);
            expect(status.timeSinceLastCommand).toBeGreaterThanOrEqual(0);
            expect(status.timeSinceLastCommand).toBeLessThanOrEqual(afterTime - beforeTime + 10);
        });

        it('should emit heavy-command-detected event when threshold exceeded', () => {
            const userId = 'heavyEventUser';
            const threshold = service.cooldownConfig.heavyCommandThreshold;

            for (let i = 0; i < threshold; i++) {
                service.updateUserCooldown(userId);
            }

            const heavyDetectedEvents = mockEventBus.emit.mock.calls.filter(
                ([eventName]: [string]) => eventName === 'cooldown:heavy-detected'
            );
            expect(heavyDetectedEvents).toHaveLength(1);
            expect(heavyDetectedEvents[0][1]).toEqual(expect.objectContaining({
                userId,
                commandCount: threshold,
                windowMs: service.cooldownConfig.heavyCommandWindow
            }));
        });
    });

    describe('Memory Management', () => {
        it('should cleanup old cooldown entries to prevent memory leaks', () => {
            service.cooldownConfig.maxEntries = 2;

            service.userCommandTimestamps.set('user1', [testClock.now()]);
            service.userCommandTimestamps.set('user2', [testClock.now()]);
            service.userCommandTimestamps.set('user3', [testClock.now()]);

            service.cleanupExpiredCooldowns();

            expect(service.userCommandTimestamps.size).toBeLessThanOrEqual(2);
        });

        it('should remove expired cooldowns during cleanup', () => {
            const expiredCommand = '!slow';
            service.globalCommandCooldowns.set(expiredCommand, testClock.now() - 700000);

            service.cleanupExpiredCooldowns();

            expect(service.globalCommandCooldowns.has(expiredCommand)).toBe(false);
        });
    });

    describe('Resource Cleanup', () => {
        it('should dispose resources when service stops', () => {
            const userId = 'user123';
            service.updateUserCooldown(userId);

            service.dispose();

            const status = service.getCooldownStatus(userId);
            expect(status.commandCount).toBe(0);
        });

        it('should reset an individual user cooldown and emit reset event', () => {
            const userId = 'reset-user';
            service.updateUserCooldown(userId);
            mockEventBus.emit.mockClear();

            service.resetUserCooldown(userId);

            const status = service.getCooldownStatus(userId);
            expect(status.commandCount).toBe(0);
            expect(status.lastCommandTime).toBe(0);
            const resetEvents = mockEventBus.emit.mock.calls.filter(
                ([eventName]: [string]) => eventName === 'cooldown:reset'
            );
            expect(resetEvents).toHaveLength(1);
            expect(resetEvents[0][1]).toEqual(expect.objectContaining({ userId }));
        });
    });
});
