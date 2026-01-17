const { describe, it, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks, spyOn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');
const CommandCooldownService = require('../../../src/services/CommandCooldownService');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');
const testClock = require('../../helpers/test-clock');

describe('CommandCooldownService', () => {
    let service;
    let mockEventBus;
    let eventSubscriptions;
    let runtimeConstants;
    let dateNowSpy;

    beforeEach(() => {
        dateNowSpy = spyOn(Date, 'now').mockImplementation(() => testClock.now());
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

        runtimeConstants = createRuntimeConstantsFixture();
        service = new CommandCooldownService({
            eventBus: mockEventBus,
            logger: noOpLogger,
            runtimeConstants
        });
    });

    afterEach(() => {
        if (service) {
            service.dispose();
        }
        if (dateNowSpy) {
            dateNowSpy.mockRestore();
        }
        restoreAllMocks();
        clearAllMocks();
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

            expect(mockEventBus.emit).toHaveBeenCalledWith(
                'cooldown:heavy-detected',
                expect.objectContaining({
                    userId,
                    commandCount: threshold
                })
            );

            mockEventBus.emit.mockClear();
            const canExecute = service.checkUserCooldown(userId, platformCooldown, heavyCooldown);

            expect(canExecute).toBe(false);
            expect(mockEventBus.emit).toHaveBeenCalledWith(
                'cooldown:blocked',
                expect.objectContaining({
                    userId,
                    type: 'heavy',
                    remainingMs: expect.any(Number)
                })
            );
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
            expect(mockEventBus.emit).toHaveBeenCalledWith(
                'cooldown:global-blocked',
                expect.objectContaining({
                    commandName,
                    remainingMs: expect.any(Number)
                })
            );
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
        it('should load cooldown overrides from ConfigService when provided', () => {
            const overrides = { defaultCooldown: 30 };
            const updatedOverrides = { defaultCooldown: 120, heavyCommandThreshold: 7 };
            const mockConfigService = {
                get: createMockFn((section) => {
                    if (section === 'cooldowns') {
                        return overrides;
                    }
                    return null;
                })
            };

            service.dispose();
            service = new CommandCooldownService({
                eventBus: mockEventBus,
                logger: noOpLogger,
                configService: mockConfigService,
                runtimeConstants
            });

            expect(service.getStatus().config.defaultCooldown).toBe(30000);

            mockConfigService.get.mockImplementation((section) => {
                if (section === 'cooldowns') {
                    return updatedOverrides;
                }
                return null;
            });

            const handler = eventSubscriptions['config:changed'];
            expect(typeof handler).toBe('function');

            handler({ section: 'cooldowns' });

            const updatedStatus = service.getStatus();
            expect(updatedStatus.config.defaultCooldown).toBe(120000);
            expect(updatedStatus.config.heavyCommandThreshold).toBe(7);
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
            expect(mockEventBus.emit).toHaveBeenCalledWith(
                'cooldown:blocked',
                expect.objectContaining({
                    userId,
                    type: 'regular',
                    remainingMs: expect.any(Number)
                })
            );
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

            expect(mockEventBus.emit).toHaveBeenCalledWith(
                'cooldown:heavy-detected',
                expect.objectContaining({
                    userId,
                    commandCount: threshold,
                    windowMs: service.cooldownConfig.heavyCommandWindow
                })
            );
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
    });
});
