
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { noOpLogger } = require('../../helpers/mock-factories');

const TwitchAuthManager = require('../../../src/auth/TwitchAuthManager');

function createTestConfiguration(testName, overrides = {}) {
    return {
        clientId: `test-client-${testName}`,
        clientSecret: `test-secret-${testName}`,
        accessToken: `test-token-${testName}`,
        refreshToken: `test-refresh-${testName}`,
        channel: `test-channel-${testName}`,
        testName: testName,
        ...overrides
    };
}

function createTestAuthManager(testName, overrides = {}) {
    const config = createTestConfiguration(testName, overrides);
    return TwitchAuthManager.getInstance(config, {
        logger: noOpLogger
    });
}

function expectCleanTestIsolation(authManager1, authManager2, testName1, testName2) {
    expect(authManager1).not.toBe(authManager2);

    const config1 = authManager1.getConfig();
    const config2 = authManager2.getConfig();

    expect(config1.testName).toBe(testName1);
    expect(config2.testName).toBe(testName2);
    expect(config1.testName).not.toBe(config2.testName);
    expect(config1.accessToken).not.toBe(config2.accessToken);
    expect(config1.channel).not.toBe(config2.channel);
}

function expectCleanTestState(authManager, expectedTestName) {
    expect(authManager.getState()).toBe('UNINITIALIZED');
    expect(authManager.getLastError()).toBeNull();

    const config = authManager.getConfig();
    expect(config.testName).toBe(expectedTestName);
}

function setupAutomatedCleanup() {
    return {
        cleanupInstances: [],
        registerForCleanup: function(authManager) {
            this.cleanupInstances.push(authManager);
        },
        cleanup: async function() {
            await Promise.all(
                this.cleanupInstances.map(manager =>
                    manager.cleanup().catch(() => {})
                )
            );
            this.cleanupInstances = [];
        }
    };
}

describe('TwitchAuthManager Test Isolation', () => {
    let testCleanup;

    beforeEach(() => {
        testCleanup = setupAutomatedCleanup();
    });

    afterEach(async () => {
        await testCleanup.cleanup();
        TwitchAuthManager.resetInstance();
    });

    describe('Test Environment Isolation', () => {
        test('should provide clean, isolated instances for each test', () => {
            const authManager1 = createTestAuthManager('test-isolation-1');
            const authManager2 = createTestAuthManager('test-isolation-2');

            testCleanup.registerForCleanup(authManager1);
            testCleanup.registerForCleanup(authManager2);

            expectCleanTestState(authManager1, 'test-isolation-1');
            expectCleanTestState(authManager2, 'test-isolation-2');
            expectCleanTestIsolation(authManager1, authManager2, 'test-isolation-1', 'test-isolation-2');
        });

        test('should not inherit state from previous test runs', () => {
            const authManager = createTestAuthManager('clean-state-test');
            testCleanup.registerForCleanup(authManager);

            expectCleanTestState(authManager, 'clean-state-test');
            const newConfig = createTestConfiguration('clean-state-test', {
                accessToken: 'modified-token'
            });
            authManager.updateConfig(newConfig);
            expect(authManager.getConfig().accessToken).toBe('modified-token');
        });

        test('should maintain isolation when instances are created concurrently', async () => {
            const testNames = ['concurrent-1', 'concurrent-2', 'concurrent-3'];
            const authManagers = testNames.map(name => {
                const manager = createTestAuthManager(name);
                testCleanup.registerForCleanup(manager);
                return manager;
            });
            authManagers.forEach((manager, index) => {
                expect(manager.getState()).toBe('UNINITIALIZED');
                expect(manager.getConfig().testName).toBe(testNames[index]);
            });
            for (let i = 0; i < authManagers.length; i++) {
                for (let j = i + 1; j < authManagers.length; j++) {
                    expectCleanTestIsolation(
                        authManagers[i],
                        authManagers[j],
                        testNames[i],
                        testNames[j]
                    );
                }
            }
        });
    });

    describe('Test State Management', () => {
        test('should support independent error states via configuration validation', () => {
            const validConfig = createTestConfiguration('valid-scenario');
            const invalidConfig = createTestConfiguration('invalid-scenario', {
                clientId: null
            });

            const validManager = createTestAuthManager('valid-scenario', validConfig);
            const invalidManager = createTestAuthManager('invalid-scenario', invalidConfig);

            testCleanup.registerForCleanup(validManager);
            testCleanup.registerForCleanup(invalidManager);
            expect(validManager.getState()).toBe('UNINITIALIZED');
            expect(invalidManager.getState()).toBe('UNINITIALIZED');
            expect(validManager.getLastError()).toBeNull();
            expect(invalidManager.getLastError()).toBeNull();

            expectCleanTestIsolation(validManager, invalidManager, 'valid-scenario', 'invalid-scenario');
        });

        test('should support independent configuration updates in test environments', () => {
            const manager1 = createTestAuthManager('update-test-1');
            const manager2 = createTestAuthManager('update-test-2');

            testCleanup.registerForCleanup(manager1);
            testCleanup.registerForCleanup(manager2);
            const newConfig1 = createTestConfiguration('update-test-1', {
                accessToken: 'updated-token-1',
                channel: 'updated-channel-1'
            });
            const newConfig2 = createTestConfiguration('update-test-2', {
                accessToken: 'updated-token-2',
                channel: 'updated-channel-2'
            });

            manager1.updateConfig(newConfig1);
            manager2.updateConfig(newConfig2);
            expect(manager1.getConfig().accessToken).toBe('updated-token-1');
            expect(manager1.getConfig().channel).toBe('updated-channel-1');

            expect(manager2.getConfig().accessToken).toBe('updated-token-2');
            expect(manager2.getConfig().channel).toBe('updated-channel-2');

            expectCleanTestIsolation(manager1, manager2, 'update-test-1', 'update-test-2');
        });

        test('should support independent configuration for different test users', () => {
            const user1Config = createTestConfiguration('user-test-1', {
                accessToken: 'user1-token'
            });
            const user2Config = createTestConfiguration('user-test-2', {
                accessToken: 'user2-token'
            });

            const manager1 = createTestAuthManager('user-test-1', user1Config);
            const manager2 = createTestAuthManager('user-test-2', user2Config);

            testCleanup.registerForCleanup(manager1);
            testCleanup.registerForCleanup(manager2);
            expect(manager1.getConfig().accessToken).toBe('user1-token');
            expect(manager2.getConfig().accessToken).toBe('user2-token');

            expectCleanTestIsolation(manager1, manager2, 'user-test-1', 'user-test-2');
        });
    });

    describe('Memory Management for Test Environments', () => {
        test('should support proper cleanup without affecting other test instances', async () => {
            const manager1 = createTestAuthManager('cleanup-test-1');
            const manager2 = createTestAuthManager('cleanup-test-2');
            const manager3 = createTestAuthManager('cleanup-test-3');

            testCleanup.registerForCleanup(manager1);
            testCleanup.registerForCleanup(manager3);

            expect(manager1.getState()).toBe('UNINITIALIZED');
            expect(manager2.getState()).toBe('UNINITIALIZED');
            expect(manager3.getState()).toBe('UNINITIALIZED');
            await manager2.cleanup();
            expect(manager1.getState()).toBe('UNINITIALIZED');
            expect(manager2.getState()).toBe('UNINITIALIZED');
            expect(manager3.getState()).toBe('UNINITIALIZED');
            expectCleanTestIsolation(manager1, manager3, 'cleanup-test-1', 'cleanup-test-3');
        });

        test('should prevent memory leaks between test runs', async () => {
            const instanceConfigs = [
                createTestConfiguration('memory-test-1'),
                createTestConfiguration('memory-test-2'),
                createTestConfiguration('memory-test-3')
            ];

            const instances = [];
            for (const config of instanceConfigs) {
                const manager = createTestAuthManager(config.testName, config);
                expect(manager.getState()).toBe('UNINITIALIZED');

                instances.push(manager);

                await manager.cleanup();
                expect(manager.getState()).toBe('UNINITIALIZED');
            }
            instances.forEach(manager => {
                expect(manager.getState()).toBe('UNINITIALIZED');
            });
            const finalManager = createTestAuthManager('memory-final-test');
            testCleanup.registerForCleanup(finalManager);

            expect(finalManager.getState()).toBe('UNINITIALIZED');
            expectCleanTestState(finalManager, 'memory-final-test');
        });

        test('should support stress testing with multiple isolated instances', () => {
            const instanceCount = 10;
            const managers = [];
            for (let i = 0; i < instanceCount; i++) {
                const manager = createTestAuthManager(`stress-test-${i}`);
                testCleanup.registerForCleanup(manager);
                managers.push(manager);
            }
            managers.forEach((manager, index) => {
                expect(manager.getState()).toBe('UNINITIALIZED');
                expect(manager.getConfig().testName).toBe(`stress-test-${index}`);
            });
            for (let i = 0; i < managers.length; i++) {
                for (let j = i + 1; j < managers.length; j++) {
                    expectCleanTestIsolation(
                        managers[i],
                        managers[j],
                        `stress-test-${i}`,
                        `stress-test-${j}`
                    );
                }
            }
        });
    });
});
