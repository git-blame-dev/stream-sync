
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const testClock = require('../../helpers/test-clock');
const { nextTestId } = require('../../helpers/test-id');

// Initialize test logging FIRST
const { initializeTestLogging } = require('../../helpers/test-setup');
initializeTestLogging();

// Mock dependencies to prevent actual auth system access
mockModule('../../../src/auth/TwitchAuthService', () => {
    return createMockFn().mockImplementation((config, dependencies) => ({
        config: { ...config },
        userId: parseInt(config.mockUserId || '123456789'),
        initialize: createMockFn().mockResolvedValue(),
        getAccessToken: createMockFn().mockReturnValue(config.accessToken || 'mock-access-token'),
        cleanup: createMockFn().mockResolvedValue(),
        isReady: createMockFn().mockReturnValue(true)
    }));
});

mockModule('../../../src/auth/TwitchAuthInitializer', () => {
    return createMockFn().mockImplementation(() => ({
        initializeAuthentication: createMockFn().mockResolvedValue(true),
        ensureValidToken: createMockFn().mockResolvedValue(true),
        cleanup: createMockFn().mockResolvedValue()
    }));
});

function createTestConfiguration(testName, overrides = {}) {
    return {
        clientId: `test-client-${testName}`,
        clientSecret: `test-secret-${testName}`,
        accessToken: `test-token-${testName}`,
        refreshToken: `test-refresh-${testName}`,
        channel: `test-channel-${testName}`,
        testName: testName,
        mockUserId: nextTestId(`user-${testName}`),
        ...overrides
    };
}

function createTestAuthManager(testName, overrides = {}) {
    const config = createTestConfiguration(testName, overrides);
    const TwitchAuthManager = require('../../../src/auth/TwitchAuthManager');
    
    // This should create a new instance for this test
    // Currently WILL FAIL because getInstance() returns singleton
    return TwitchAuthManager.getInstance(config);
}

function expectCleanTestIsolation(authManager1, authManager2, testName1, testName2) {
    // Each test should have its own independent instance
    expect(authManager1).not.toBe(authManager2);
    
    // Each should have its test-specific configuration
    const config1 = authManager1.getConfig();
    const config2 = authManager2.getConfig();
    
    expect(config1.testName).toBe(testName1);
    expect(config2.testName).toBe(testName2);
    expect(config1.testName).not.toBe(config2.testName);
    
    // Configurations should be completely independent
    expect(config1.accessToken).not.toBe(config2.accessToken);
    expect(config1.channel).not.toBe(config2.channel);
}

function expectCleanTestState(authManager, expectedTestName) {
    // Accept either UNINITIALIZED (clean starting state) or READY (clean initialized state)
    const validStates = ['UNINITIALIZED', 'READY'];
    expect(validStates).toContain(authManager.getState());
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
                    manager.cleanup().catch(() => {}) // Ignore cleanup errors
                )
            );
            this.cleanupInstances = [];
        }
    };
}

describe('TwitchAuthManager Test Isolation', () => {
    let TwitchAuthManager;
    let testCleanup;

    beforeEach(() => {
        // Clear module cache for complete isolation
        resetModules();
        
        // Re-initialize logging after module reset
        const { initializeTestLogging } = require('../../helpers/test-setup');
        initializeTestLogging();
        
        TwitchAuthManager = require('../../../src/auth/TwitchAuthManager');
        testCleanup = setupAutomatedCleanup();
    });

    afterEach(async () => {
        restoreAllMocks();
        // Clean up all test instances
        await testCleanup.cleanup();
        
        // Reset singleton instances
        if (TwitchAuthManager && TwitchAuthManager.resetInstance) {
            TwitchAuthManager.resetInstance();
        
        restoreAllModuleMocks();}
    });

    describe('Test Environment Isolation', () => {
        test('should provide clean, isolated instances for each test', async () => {
            // Given: Creating auth managers in this specific test
            const authManager1 = createTestAuthManager('test-isolation-1');
            const authManager2 = createTestAuthManager('test-isolation-2');
            
            testCleanup.registerForCleanup(authManager1);
            testCleanup.registerForCleanup(authManager2);
            
            // Then: Each should be independent and clean
            expectCleanTestState(authManager1, 'test-isolation-1');
            expectCleanTestState(authManager2, 'test-isolation-2');
            expectCleanTestIsolation(authManager1, authManager2, 'test-isolation-1', 'test-isolation-2');
        });

        test('should not inherit state from previous test runs', async () => {
            // Given: This test should start completely clean
            const authManager = createTestAuthManager('clean-state-test');
            testCleanup.registerForCleanup(authManager);
            
            // Then: Should have clean initial state regardless of previous tests
            expectCleanTestState(authManager, 'clean-state-test');
            
            // Initialize and modify state
            await authManager.initialize();
            expect(authManager.getState()).toBe('READY');
            
            // Update configuration
            const newConfig = createTestConfiguration('clean-state-test', { 
                accessToken: 'modified-token' 
            });
            authManager.updateConfig(newConfig);
            expect(authManager.getConfig().accessToken).toBe('modified-token');
        });

        test('should maintain isolation when tests run concurrently', async () => {
            // Given: Multiple auth managers created for parallel testing
            const testNames = ['concurrent-1', 'concurrent-2', 'concurrent-3'];
            const authManagers = testNames.map(name => {
                const manager = createTestAuthManager(name);
                testCleanup.registerForCleanup(manager);
                return manager;
            });
            
            // When: All are initialized concurrently
            await Promise.all(authManagers.map(manager => manager.initialize()));
            
            // Then: Each should maintain its own state independently
            authManagers.forEach((manager, index) => {
                expect(manager.getState()).toBe('READY');
                expect(manager.getConfig().testName).toBe(testNames[index]);
            });
            
            // Verify complete isolation between all instances
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
        test('should support independent error states for different test scenarios', async () => {
            // Given: Test scenarios with different outcomes
            const validConfig = createTestConfiguration('valid-scenario');
            const invalidConfig = createTestConfiguration('invalid-scenario', { 
                clientId: null // Invalid configuration
            });
            
            const validManager = createTestAuthManager('valid-scenario', validConfig);
            const invalidManager = createTestAuthManager('invalid-scenario', invalidConfig);
            
            testCleanup.registerForCleanup(validManager);
            testCleanup.registerForCleanup(invalidManager);
            
            // When: One succeeds, one fails
            await validManager.initialize();
            await expect(invalidManager.initialize()).rejects.toThrow();
            
            // Then: Each should maintain independent test state
            expect(validManager.getState()).toBe('READY');
            expect(invalidManager.getState()).toBe('ERROR');
            
            expectCleanTestIsolation(validManager, invalidManager, 'valid-scenario', 'invalid-scenario');
            
            // Error should be isolated to the failing instance
            expect(validManager.getLastError()).toBeNull();
            expect(invalidManager.getLastError()).toBeDefined();
        });

        test('should support independent configuration updates in test environments', async () => {
            // Given: Multiple test instances with different initial configurations
            const manager1 = createTestAuthManager('update-test-1');
            const manager2 = createTestAuthManager('update-test-2');
            
            testCleanup.registerForCleanup(manager1);
            testCleanup.registerForCleanup(manager2);
            
            await manager1.initialize();
            await manager2.initialize();
            
            // When: Updating configurations independently
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
            
            // Then: Each should reflect only its own updates
            expect(manager1.getConfig().accessToken).toBe('updated-token-1');
            expect(manager1.getConfig().channel).toBe('updated-channel-1');
            
            expect(manager2.getConfig().accessToken).toBe('updated-token-2');
            expect(manager2.getConfig().channel).toBe('updated-channel-2');
            
            expectCleanTestIsolation(manager1, manager2, 'update-test-1', 'update-test-2');
        });

        test('should support independent user ID management for test scenarios', async () => {
            // Given: Different test users for different scenarios
            const user1Config = createTestConfiguration('user-test-1', { 
                mockUserId: '111111111' 
            });
            const user2Config = createTestConfiguration('user-test-2', { 
                mockUserId: '222222222' 
            });
            
            const manager1 = createTestAuthManager('user-test-1', user1Config);
            const manager2 = createTestAuthManager('user-test-2', user2Config);
            
            testCleanup.registerForCleanup(manager1);
            testCleanup.registerForCleanup(manager2);
            
            // When: Both are initialized
            await manager1.initialize();
            await manager2.initialize();
            
            // Then: Each should maintain its own user context
            const userId1 = manager1.getUserId();
            const userId2 = manager2.getUserId();
            
            expect(userId1).toBe(111111111);
            expect(userId2).toBe(222222222);
            expect(userId1).not.toBe(userId2);
            
            expectCleanTestIsolation(manager1, manager2, 'user-test-1', 'user-test-2');
        });
    });

    describe('Memory Management for Test Environments', () => {
        test('should support proper cleanup without affecting other test instances', async () => {
            // Given: Multiple test instances
            const manager1 = createTestAuthManager('cleanup-test-1');
            const manager2 = createTestAuthManager('cleanup-test-2');
            const manager3 = createTestAuthManager('cleanup-test-3');
            
            // Don't register manager2 for auto-cleanup to test manual cleanup
            testCleanup.registerForCleanup(manager1);
            testCleanup.registerForCleanup(manager3);
            
            await manager1.initialize();
            await manager2.initialize();
            await manager3.initialize();
            
            // All should be ready
            expect(manager1.getState()).toBe('READY');
            expect(manager2.getState()).toBe('READY');
            expect(manager3.getState()).toBe('READY');
            
            // When: Manually cleaning up one instance
            await manager2.cleanup();
            
            // Then: Only the cleaned instance should be affected
            expect(manager1.getState()).toBe('READY');
            expect(manager2.getState()).toBe('UNINITIALIZED');
            expect(manager3.getState()).toBe('READY');
            
            // Other instances should maintain their test isolation
            expectCleanTestIsolation(manager1, manager3, 'cleanup-test-1', 'cleanup-test-3');
        });

        test('should prevent memory leaks between test runs', async () => {
            // Given: Creating and destroying multiple instances within a test
            const instanceConfigs = [
                createTestConfiguration('memory-test-1'),
                createTestConfiguration('memory-test-2'),
                createTestConfiguration('memory-test-3')
            ];
            
            const instances = [];
            
            // When: Creating, using, and cleaning up instances
            for (const config of instanceConfigs) {
                const manager = createTestAuthManager(config.testName, config);
                await manager.initialize();
                expect(manager.getState()).toBe('READY');
                
                instances.push(manager);
                
                // Clean up immediately to test memory management
                await manager.cleanup();
                expect(manager.getState()).toBe('UNINITIALIZED');
            }
            
            // Then: All instances should be properly cleaned up
            instances.forEach(manager => {
                expect(manager.getState()).toBe('UNINITIALIZED');
            });
            
            // Create one final instance to verify clean slate
            const finalManager = createTestAuthManager('memory-final-test');
            testCleanup.registerForCleanup(finalManager);
            
            await finalManager.initialize();
            expect(finalManager.getState()).toBe('READY');
            expectCleanTestState(finalManager, 'memory-final-test');
        });

        test('should support stress testing with multiple isolated instances', async () => {
            // Given: Creating many isolated instances for stress testing
            const instanceCount = 10;
            const managers = [];
            
            // When: Creating multiple isolated instances
            for (let i = 0; i < instanceCount; i++) {
                const manager = createTestAuthManager(`stress-test-${i}`);
                testCleanup.registerForCleanup(manager);
                managers.push(manager);
            }
            
            // Initialize all concurrently
            await Promise.all(managers.map(manager => manager.initialize()));
            
            // Then: All should be independent and ready
            managers.forEach((manager, index) => {
                expect(manager.getState()).toBe('READY');
                expect(manager.getConfig().testName).toBe(`stress-test-${index}`);
            });
            
            // Verify isolation between all pairs
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