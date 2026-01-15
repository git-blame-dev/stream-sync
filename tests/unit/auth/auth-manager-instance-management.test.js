
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
        scheduleTokenRefresh: createMockFn(),
        cleanup: createMockFn().mockResolvedValue()
    }));
});

function createAuthManagerInstance(context, config) {
    const TwitchAuthManager = require('../../../src/auth/TwitchAuthManager');
    
    // This should create a new instance for each context
    // Currently WILL FAIL because singleton pattern prevents multiple instances
    return TwitchAuthManager.getInstance(config, { context });
}

function createContextConfiguration(context, overrides = {}) {
    return {
        clientId: `${context}-client-id`,
        clientSecret: `${context}-client-secret`,
        accessToken: `${context}-access-token`,
        refreshToken: `${context}-refresh-token`,
        channel: `${context}-channel`,
        context: context,
        mockUserId: nextTestId(`${context}-user`),
        ...overrides
    };
}

function expectInstanceIndependence(instance1, instance2, context1, context2) {
    // Each instance should be independent
    expect(instance1).not.toBe(instance2);
    
    // Each should maintain its own context
    const config1 = instance1.getConfig();
    const config2 = instance2.getConfig();
    
    expect(config1.context).toBe(context1);
    expect(config2.context).toBe(context2);
    expect(config1.context).not.toBe(config2.context);
}

function expectProperLifecycleManagement(instance, expectedContext) {
    expect(instance.getState()).toBeDefined();
    expect(instance.getConfig().context).toBe(expectedContext);
    expect(typeof instance.initialize).toBe('function');
    expect(typeof instance.cleanup).toBe('function');
}

class InstanceTracker {
    constructor() {
        this.instances = new Map();
    }
    
    register(context, instance) {
        this.instances.set(context, instance);
    }
    
    get(context) {
        return this.instances.get(context);
    }
    
    async cleanupAll() {
        const cleanupPromises = Array.from(this.instances.values()).map(
            instance => instance.cleanup().catch(() => {}) // Ignore cleanup errors
        );
        await Promise.all(cleanupPromises);
        this.instances.clear();
    }
    
    getActiveContexts() {
        return Array.from(this.instances.keys());
    }
}

describe('TwitchAuthManager Instance Management', () => {
    let TwitchAuthManager;
    let instanceTracker;

    beforeEach(() => {
        // Clear module cache for clean state
        resetModules();
        
        // Re-initialize logging after module reset
        const { initializeTestLogging } = require('../../helpers/test-setup');
        initializeTestLogging();
        
        TwitchAuthManager = require('../../../src/auth/TwitchAuthManager');
        instanceTracker = new InstanceTracker();
    });

    afterEach(async () => {
        restoreAllMocks();
        // Clean up all tracked instances
        await instanceTracker.cleanupAll();
        
        // Reset singleton instances
        if (TwitchAuthManager && TwitchAuthManager.resetInstance) {
            TwitchAuthManager.resetInstance();
        
        restoreAllModuleMocks();}
    });

    describe('Multiple Instance Support', () => {
        test('should support creating multiple independent instances for different contexts', async () => {
            // Given: Different service contexts requiring authentication
            const botConfig = createContextConfiguration('bot-service');
            const adminConfig = createContextConfiguration('admin-panel');
            const analyticsConfig = createContextConfiguration('analytics-service');
            
            // When: Creating instances for each context
            const botInstance = createAuthManagerInstance('bot-service', botConfig);
            const adminInstance = createAuthManagerInstance('admin-panel', adminConfig);
            const analyticsInstance = createAuthManagerInstance('analytics-service', analyticsConfig);
            
            instanceTracker.register('bot-service', botInstance);
            instanceTracker.register('admin-panel', adminInstance);
            instanceTracker.register('analytics-service', analyticsInstance);
            
            // Then: Each should be independent and properly configured
            expectInstanceIndependence(botInstance, adminInstance, 'bot-service', 'admin-panel');
            expectInstanceIndependence(botInstance, analyticsInstance, 'bot-service', 'analytics-service');
            expectInstanceIndependence(adminInstance, analyticsInstance, 'admin-panel', 'analytics-service');
            
            expectProperLifecycleManagement(botInstance, 'bot-service');
            expectProperLifecycleManagement(adminInstance, 'admin-panel');
            expectProperLifecycleManagement(analyticsInstance, 'analytics-service');
        });

        test('should maintain independent authentication states across instances', async () => {
            // Given: Multiple instances for different purposes
            const primaryConfig = createContextConfiguration('primary-bot');
            const backupConfig = createContextConfiguration('backup-bot', {
                clientId: null // Invalid config to test error handling
            });
            
            const primaryInstance = createAuthManagerInstance('primary-bot', primaryConfig);
            const backupInstance = createAuthManagerInstance('backup-bot', backupConfig);
            
            instanceTracker.register('primary-bot', primaryInstance);
            instanceTracker.register('backup-bot', backupInstance);
            
            // When: Initializing both (one should succeed, one should fail)
            await primaryInstance.initialize();
            await expect(backupInstance.initialize()).rejects.toThrow();
            
            // Then: Each should maintain independent state
            expect(primaryInstance.getState()).toBe('READY');
            expect(backupInstance.getState()).toBe('ERROR');
            
            expectInstanceIndependence(primaryInstance, backupInstance, 'primary-bot', 'backup-bot');
            
            // Primary should have no error, backup should have error
            expect(primaryInstance.getLastError()).toBeNull();
            expect(backupInstance.getLastError()).toBeDefined();
        });

        test('should support different authentication contexts simultaneously', async () => {
            // Given: Different types of Twitch authentication needs
            const streamBotConfig = createContextConfiguration('stream-bot', {
                mockUserId: '111111111',
                accessToken: 'stream-bot-token'
            });
            const moderatorConfig = createContextConfiguration('moderator-tools', {
                mockUserId: '222222222',
                accessToken: 'moderator-token'
            });
            const viewerAnalyticsConfig = createContextConfiguration('viewer-analytics', {
                mockUserId: '333333333',
                accessToken: 'analytics-token'
            });
            
            // When: Creating instances for different auth contexts
            const streamBotInstance = createAuthManagerInstance('stream-bot', streamBotConfig);
            const moderatorInstance = createAuthManagerInstance('moderator-tools', moderatorConfig);
            const analyticsInstance = createAuthManagerInstance('viewer-analytics', viewerAnalyticsConfig);
            
            instanceTracker.register('stream-bot', streamBotInstance);
            instanceTracker.register('moderator-tools', moderatorInstance);
            instanceTracker.register('viewer-analytics', analyticsInstance);
            
            // Initialize all
            await streamBotInstance.initialize();
            await moderatorInstance.initialize();
            await analyticsInstance.initialize();
            
            // Then: Each should maintain its own authentication context
            expect(streamBotInstance.getUserId()).toBe(111111111);
            expect(moderatorInstance.getUserId()).toBe(222222222);
            expect(analyticsInstance.getUserId()).toBe(333333333);
            
            const streamToken = await streamBotInstance.getAccessToken();
            const moderatorToken = await moderatorInstance.getAccessToken();
            const analyticsToken = await analyticsInstance.getAccessToken();
            
            expect(streamToken).toBe('stream-bot-token');
            expect(moderatorToken).toBe('moderator-token');
            expect(analyticsToken).toBe('analytics-token');
            
            // All tokens should be different
            expect(streamToken).not.toBe(moderatorToken);
            expect(streamToken).not.toBe(analyticsToken);
            expect(moderatorToken).not.toBe(analyticsToken);
        });
    });

    describe('Instance Lifecycle Management', () => {
        test('should support independent initialization and cleanup cycles', async () => {
            // Given: Multiple instances with different lifecycle requirements
            const longRunningConfig = createContextConfiguration('long-running-service');
            const temporaryConfig = createContextConfiguration('temporary-task');
            const periodicConfig = createContextConfiguration('periodic-job');
            
            const longRunningInstance = createAuthManagerInstance('long-running-service', longRunningConfig);
            const temporaryInstance = createAuthManagerInstance('temporary-task', temporaryConfig);
            const periodicInstance = createAuthManagerInstance('periodic-job', periodicConfig);
            
            instanceTracker.register('long-running-service', longRunningInstance);
            instanceTracker.register('temporary-task', temporaryInstance);
            instanceTracker.register('periodic-job', periodicInstance);
            
            // When: Different lifecycle operations
            await longRunningInstance.initialize(); // Long-running stays active
            await temporaryInstance.initialize();
            await temporaryInstance.cleanup(); // Temporary is cleaned up quickly
            await periodicInstance.initialize(); // Periodic starts later
            
            // Then: Each should reflect its own lifecycle state
            expect(longRunningInstance.getState()).toBe('READY');
            expect(temporaryInstance.getState()).toBe('UNINITIALIZED');
            expect(periodicInstance.getState()).toBe('READY');
            
            expectInstanceIndependence(longRunningInstance, periodicInstance, 'long-running-service', 'periodic-job');
        });

        test('should support configuration updates without affecting other instances', async () => {
            // Given: Multiple active instances
            const serviceAConfig = createContextConfiguration('service-a');
            const serviceBConfig = createContextConfiguration('service-b');
            
            const serviceAInstance = createAuthManagerInstance('service-a', serviceAConfig);
            const serviceBInstance = createAuthManagerInstance('service-b', serviceBConfig);
            
            instanceTracker.register('service-a', serviceAInstance);
            instanceTracker.register('service-b', serviceBInstance);
            
            await serviceAInstance.initialize();
            await serviceBInstance.initialize();
            
            // When: Updating configuration for one service
            const updatedConfigA = createContextConfiguration('service-a', {
                accessToken: 'updated-token-for-a',
                channel: 'updated-channel-for-a'
            });
            serviceAInstance.updateConfig(updatedConfigA);
            
            // Then: Only the updated instance should reflect changes
            expect(serviceAInstance.getConfig().accessToken).toBe('updated-token-for-a');
            expect(serviceAInstance.getConfig().channel).toBe('updated-channel-for-a');
            expect(serviceAInstance.getState()).toBe('UNINITIALIZED'); // Should reset after config update
            
            // Service B should remain unchanged
            expect(serviceBInstance.getConfig().accessToken).toBe('service-b-access-token');
            expect(serviceBInstance.getConfig().channel).toBe('service-b-channel');
            expect(serviceBInstance.getState()).toBe('READY'); // Should remain ready
            
            expectInstanceIndependence(serviceAInstance, serviceBInstance, 'service-a', 'service-b');
        });

        test('should support selective cleanup without affecting active instances', async () => {
            // Given: Multiple instances for different services
            const instances = [];
            const contexts = ['service-1', 'service-2', 'service-3', 'service-4'];
            
            for (const context of contexts) {
                const config = createContextConfiguration(context);
                const instance = createAuthManagerInstance(context, config);
                instanceTracker.register(context, instance);
                await instance.initialize();
                instances.push(instance);
            }
            
            // All should be ready
            instances.forEach((instance, index) => {
                expect(instance.getState()).toBe('READY');
                expect(instance.getConfig().context).toBe(contexts[index]);
            });
            
            // When: Cleaning up specific instances (simulating services shutting down)
            await instances[1].cleanup(); // service-2
            await instances[3].cleanup(); // service-4
            
            // Then: Only cleaned instances should be affected
            expect(instances[0].getState()).toBe('READY');   // service-1: still active
            expect(instances[1].getState()).toBe('UNINITIALIZED'); // service-2: cleaned up
            expect(instances[2].getState()).toBe('READY');   // service-3: still active
            expect(instances[3].getState()).toBe('UNINITIALIZED'); // service-4: cleaned up
            
            // Active instances should maintain independence
            expectInstanceIndependence(instances[0], instances[2], 'service-1', 'service-3');
        });
    });

    describe('Resource Management and Memory Efficiency', () => {
        test('should support efficient resource management for multiple instances', async () => {
            // Given: Creating and managing multiple instances over time
            const instanceHistory = [];
            
            // When: Creating instances in batches and managing their lifecycle
            for (let batch = 0; batch < 3; batch++) {
                const batchInstances = [];
                
                // Create batch of instances
                for (let i = 0; i < 3; i++) {
                    const context = `batch-${batch}-instance-${i}`;
                    const config = createContextConfiguration(context);
                    const instance = createAuthManagerInstance(context, config);
                    
                    await instance.initialize();
                    expect(instance.getState()).toBe('READY');
                    
                    batchInstances.push(instance);
                    instanceHistory.push({ context, instance });
                }
                
                // Clean up previous batch (simulating rolling updates)
                if (batch > 0) {
                    const previousBatchStart = (batch - 1) * 3;
                    for (let i = 0; i < 3; i++) {
                        const previousInstance = instanceHistory[previousBatchStart + i].instance;
                        await previousInstance.cleanup();
                        expect(previousInstance.getState()).toBe('UNINITIALIZED');
                    }
                }
                
                // Current batch should remain active
                batchInstances.forEach((instance, index) => {
                    expect(instance.getState()).toBe('READY');
                    expect(instance.getConfig().context).toBe(`batch-${batch}-instance-${index}`);
                });
            }
            
            // Clean up remaining instances
            const finalBatchStart = 2 * 3;
            for (let i = 0; i < 3; i++) {
                const finalInstance = instanceHistory[finalBatchStart + i].instance;
                await finalInstance.cleanup();
            }
        });

        test('should prevent memory leaks when managing many instances', async () => {
            // Given: Creating many short-lived instances
            const shortLivedInstances = [];
            const instanceCount = 20;
            
            // When: Creating, using, and cleaning up many instances
            for (let i = 0; i < instanceCount; i++) {
                const context = `short-lived-${i}`;
                const config = createContextConfiguration(context);
                const instance = createAuthManagerInstance(context, config);
                
                await instance.initialize();
                expect(instance.getState()).toBe('READY');
                
                // Immediately clean up to test memory management
                await instance.cleanup();
                expect(instance.getState()).toBe('UNINITIALIZED');
                
                shortLivedInstances.push(instance);
            }
            
            // Then: All instances should be properly cleaned up
            shortLivedInstances.forEach((instance, index) => {
                expect(instance.getState()).toBe('UNINITIALIZED');
                expect(instance.getConfig().context).toBe(`short-lived-${index}`);
            });
            
            // Create final instance to verify clean state
            const finalConfig = createContextConfiguration('final-test');
            const finalInstance = createAuthManagerInstance('final-test', finalConfig);
            instanceTracker.register('final-test', finalInstance);
            
            await finalInstance.initialize();
            expect(finalInstance.getState()).toBe('READY');
            expect(finalInstance.getConfig().context).toBe('final-test');
        });

        test('should support concurrent instance management without interference', async () => {
            // Given: Multiple instances being managed concurrently
            const concurrentContexts = [
                'concurrent-auth-1',
                'concurrent-auth-2', 
                'concurrent-auth-3',
                'concurrent-auth-4'
            ];
            
            // When: Creating and managing instances concurrently
            const instancePromises = concurrentContexts.map(async (context) => {
                const config = createContextConfiguration(context);
                const instance = createAuthManagerInstance(context, config);
                
                await instance.initialize();
                
                // Simulate some work
                const simulatedDelayMs = 5;
                await waitForDelay(simulatedDelayMs);
                testClock.advance(simulatedDelayMs);
                
                // Update configuration
                const updatedConfig = createContextConfiguration(context, {
                    accessToken: `updated-${context}-token`
                });
                instance.updateConfig(updatedConfig);
                
                return { context, instance };
            });
            
            const results = await Promise.all(instancePromises);
            
            // Then: Each should maintain its own state correctly
            results.forEach(({ context, instance }) => {
                expect(instance.getConfig().context).toBe(context);
                expect(instance.getConfig().accessToken).toBe(`updated-${context}-token`);
                expect(instance.getState()).toBe('UNINITIALIZED'); // After config update
                
                instanceTracker.register(context, instance);
            });
            
            // Verify independence between all instances
            for (let i = 0; i < results.length; i++) {
                for (let j = i + 1; j < results.length; j++) {
                    expectInstanceIndependence(
                        results[i].instance,
                        results[j].instance,
                        results[i].context,
                        results[j].context
                    );
                }
            }
        });
    });
});