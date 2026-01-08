
const CommandCooldownService = require('../../../src/services/CommandCooldownService');
const { createRuntimeConstantsFixture } = require('../../helpers/runtime-constants-fixture');

describe('CommandCooldownService', () => {
    let service;
    let mockEventBus;
    let mockLogger;
    let eventSubscriptions;
    let runtimeConstants;

    beforeEach(() => {
        eventSubscriptions = {};

        // Create mock EventBus with subscribe support
        mockEventBus = {
            emit: jest.fn(),
            subscribe: jest.fn((eventName, handler) => {
                eventSubscriptions[eventName] = handler;
                return () => {
                    delete eventSubscriptions[eventName];
                };
            })
        };

        // Create mock Logger
        mockLogger = {
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };

        // Create service instance
        runtimeConstants = createRuntimeConstantsFixture();
        service = new CommandCooldownService({
            eventBus: mockEventBus,
            logger: mockLogger,
            runtimeConstants
        });
    });

    afterEach(() => {
        // Clean up service
        if (service) {
            service.dispose();
        }
    });

    describe('Per-User Command Cooldowns', () => {
        it('should allow command execution when no cooldown is active', () => {
            // Given: CommandCooldownService with no active cooldowns
            const userId = 'user123';
            const platformCooldown = 60000; // 60 seconds
            const heavyCooldown = 300000; // 5 minutes

            // When: Cooldown is checked for user
            const canExecute = service.checkUserCooldown(userId, platformCooldown, heavyCooldown);

            // Then: Command should be allowed
            expect(canExecute).toBe(true);
        });

        it('should block command execution during cooldown period', () => {
            // Given: User executed command
            const userId = 'user123';
            const platformCooldown = 60000;
            const heavyCooldown = 300000;

            service.updateUserCooldown(userId);

            // When: User tries to execute another command immediately
            const canExecute = service.checkUserCooldown(userId, platformCooldown, heavyCooldown);

            // Then: Command should be blocked
            expect(canExecute).toBe(false);
            // And: User's cooldown status should reflect they are on cooldown
            const status = service.getCooldownStatus(userId);
            expect(status.timeSinceLastCommand).toBeLessThan(platformCooldown);
            expect(status.lastCommandTime).toBeGreaterThan(0);
        });

        it('should allow command after cooldown period expires', () => {
            jest.useFakeTimers();

            try {
                const userId = 'user123';
                const platformCooldown = 100; // 100ms for fast test
                const heavyCooldown = 300000;

                service.updateUserCooldown(userId);

                jest.advanceTimersByTime(platformCooldown + 1);

                const canExecute = service.checkUserCooldown(userId, platformCooldown, heavyCooldown);
                expect(canExecute).toBe(true);
            } finally {
                jest.useRealTimers();
            }
        });

        it('should track different cooldowns for different users', () => {
            // Given: User A is on cooldown
            const userA = 'userA';
            const userB = 'userB';
            const platformCooldown = 60000;
            const heavyCooldown = 300000;

            service.updateUserCooldown(userA);

            // When: User B tries to execute command
            const canUserBExecute = service.checkUserCooldown(userB, platformCooldown, heavyCooldown);
            const canUserAExecute = service.checkUserCooldown(userA, platformCooldown, heavyCooldown);

            // Then: User B's command should execute
            expect(canUserBExecute).toBe(true);
            // And: User A's cooldown should remain active
            expect(canUserAExecute).toBe(false);
        });
    });

    describe('Heavy Command Detection', () => {
        it('should detect heavy command usage when threshold is exceeded', () => {
            // Given: User executes multiple commands rapidly
            const userId = 'user123';
            const platformCooldown = 1000;
            const heavyCooldown = 5000;

            // Execute 4 commands (threshold is 4)
            service.updateUserCooldown(userId);
            service.updateUserCooldown(userId);
            service.updateUserCooldown(userId);
            service.updateUserCooldown(userId);

            // When: User tries to execute another command
            const canExecute = service.checkUserCooldown(userId, platformCooldown, heavyCooldown);

            // Then: Heavy command cooldown should activate
            expect(canExecute).toBe(false);
            // And: User's cooldown status should show heavy limit is active
            const status = service.getCooldownStatus(userId);
            expect(status.isHeavyLimit).toBe(true);
            expect(status.commandCount).toBeGreaterThanOrEqual(4);
        });

        it('should apply heavy command cooldown after detection', () => {
            const userId = 'spamUser';
            const platformCooldown = 0;
            const heavyCooldown = 5000;

            // Trigger heavy limit
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

            // Force heavy limit
            const threshold = service.cooldownConfig.heavyCommandThreshold;
            for (let i = 0; i < threshold; i++) {
                service.updateUserCooldown(userId);
            }

            // Simulate cooldown expiry
            service.userLastCommand.set(userId, Date.now() - heavyCooldown - 10);

            const canExecute = service.checkUserCooldown(userId, 0, heavyCooldown);

            expect(canExecute).toBe(true);
            expect(service.getCooldownStatus(userId).isHeavyLimit).toBe(false);
        });

        it('should not count commands older than time window', () => {
            const userId = 'windowUser';
            service.cooldownConfig.heavyCommandThreshold = 2;
            service.cooldownConfig.heavyCommandWindow = 1000;

            const staleTimestamp = Date.now() - 5000;
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
            service.globalCommandCooldowns.set(
                commandName,
                Date.now() - 120000
            );

            const canExecute = service.checkGlobalCooldown(commandName, 60000);

            expect(canExecute).toBe(true);
        });
    });

    describe('Cooldown Configuration', () => {
        it('should load cooldown overrides from ConfigService when provided', () => {
            const mockConfigService = {
                get: jest.fn((section) => {
                    if (section === 'cooldowns') {
                        return {
                            defaultCooldown: 45, // seconds
                            heavyCommandThreshold: 6
                        };
                    }
                    return null;
                })
            };

            service.dispose();
            service = new CommandCooldownService({
                eventBus: mockEventBus,
                logger: mockLogger,
                configService: mockConfigService,
                runtimeConstants
            });

            const status = service.getStatus();
            expect(status.config.defaultCooldown).toBe(45000);
            expect(status.config.heavyCommandThreshold).toBe(6);
            expect(mockConfigService.get).toHaveBeenCalledWith('cooldowns');
        });

        it('should refresh cooldown configuration when config change events reference cooldowns', () => {
            const overrides = { defaultCooldown: 30 };
            const updatedOverrides = { defaultCooldown: 120, heavyCommandThreshold: 7 };
            const mockConfigService = {
                get: jest.fn((section) => {
                    if (section === 'cooldowns') {
                        return overrides;
                    }
                    return null;
                })
            };

            service.dispose();
            service = new CommandCooldownService({
                eventBus: mockEventBus,
                logger: mockLogger,
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
            // Given: User executes command
            const userId = 'user123';
            const beforeTime = Date.now();

            // When: Cooldown is updated
            service.updateUserCooldown(userId);
            const afterTime = Date.now();

            // Then: User's last command time should be recorded
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

            service.userCommandTimestamps.set('user1', [Date.now()]);
            service.userCommandTimestamps.set('user2', [Date.now()]);
            service.userCommandTimestamps.set('user3', [Date.now()]);

            service.cleanupExpiredCooldowns();

            expect(service.userCommandTimestamps.size).toBeLessThanOrEqual(2);
        });

        it('should remove expired cooldowns during cleanup', () => {
            const expiredCommand = '!slow';
            service.globalCommandCooldowns.set(expiredCommand, Date.now() - 700000);

            service.cleanupExpiredCooldowns();

            expect(service.globalCommandCooldowns.has(expiredCommand)).toBe(false);
        });
    });

    describe('Resource Cleanup', () => {
        it('should dispose resources when service stops', () => {
            // Given: Active CommandCooldownService with active cooldowns
            const userId = 'user123';
            service.updateUserCooldown(userId);

            // When: dispose() is called
            service.dispose();

            // Then: Service should clean up resources
            const status = service.getCooldownStatus(userId);
            expect(status.commandCount).toBe(0);
        });
    });
});
