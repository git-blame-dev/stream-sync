
const { describe, test, expect, beforeEach, afterEach } = require('@jest/globals');

// Initialize test logging FIRST
const { initializeTestLogging } = require('../../helpers/test-setup');
initializeTestLogging();

// Mock dependencies to prevent actual auth system access
jest.mock('../../../src/auth/TwitchAuthService', () => {
    return jest.fn().mockImplementation((config, dependencies) => ({
        config: { ...config },
        userId: 123456789,
        initialize: jest.fn().mockResolvedValue(),
        getAccessToken: jest.fn().mockReturnValue(config.accessToken || 'mock-access-token'),
        cleanup: jest.fn().mockResolvedValue(),
        isReady: jest.fn().mockReturnValue(true)
    }));
});

jest.mock('../../../src/auth/TwitchAuthInitializer', () => {
    return jest.fn().mockImplementation(() => ({
        initializeAuthentication: jest.fn().mockResolvedValue(true),
        ensureValidToken: jest.fn().mockResolvedValue(true),
        cleanup: jest.fn().mockResolvedValue()
    }));
});

function createMockConfiguration(overrides = {}) {
    return {
        clientId: overrides.clientId || 'default-client-id',
        clientSecret: overrides.clientSecret || 'default-client-secret',
        accessToken: overrides.accessToken || 'default-access-token',
        refreshToken: overrides.refreshToken || 'default-refresh-token',
        channel: overrides.channel || 'default-channel',
        environment: overrides.environment || 'default',
        ...overrides
    };
}

function createAuthManager(config, dependencies = {}) {
    const TwitchAuthManager = require('../../../src/auth/TwitchAuthManager');
    
    // This should create a new instance, not return a singleton
    // Currently WILL FAIL because getInstance() ignores new config
    return TwitchAuthManager.getInstance(config, dependencies);
}

function expectConfigurationIsolation(authManager1, authManager2) {
    const config1 = authManager1.getConfig();
    const config2 = authManager2.getConfig();
    
    // Each should maintain its own configuration independently
    expect(config1).not.toBe(config2); // Different object references
    
    // Changes to one should not affect the other
    if (config1.accessToken !== config2.accessToken) {
        expect(config1.accessToken).not.toBe(config2.accessToken);
    }
    
    if (config1.environment !== config2.environment) {
        expect(config1.environment).not.toBe(config2.environment);
    }
}

function expectConfigurationMatch(authManager, expectedConfig) {
    const actualConfig = authManager.getConfig();
    
    expect(actualConfig.environment).toBe(expectedConfig.environment);
    expect(actualConfig.accessToken).toBe(expectedConfig.accessToken);
    expect(actualConfig.channel).toBe(expectedConfig.channel);
}

describe('TwitchAuthManager Configuration Isolation', () => {
    let TwitchAuthManager;

    beforeEach(() => {
        // Clear module cache to ensure clean state
        jest.resetModules();
        
        // Re-initialize logging after module reset
        const { initializeTestLogging } = require('../../helpers/test-setup');
        initializeTestLogging();
        
        TwitchAuthManager = require('../../../src/auth/TwitchAuthManager');
    });

    afterEach(() => {
        // Clean up any singleton instances
        if (TwitchAuthManager && TwitchAuthManager.resetInstance) {
            TwitchAuthManager.resetInstance();
        }
    });

    describe('Independent Configuration Management', () => {
        test('should maintain independent configurations for different auth manager instances', async () => {
            // Given: Two different configurations for different contexts
            const prodConfig = createMockConfiguration({ 
                environment: 'production',
                accessToken: 'prod-token-123',
                channel: 'prod-channel'
            });
            const testConfig = createMockConfiguration({ 
                environment: 'test',
                accessToken: 'test-token-456',
                channel: 'test-channel'
            });
            
            // When: Creating auth managers with different configs
            const prodAuthManager = createAuthManager(prodConfig);
            const testAuthManager = createAuthManager(testConfig);
            
            // Then: Each should maintain its own configuration independently
            expectConfigurationMatch(prodAuthManager, prodConfig);
            expectConfigurationMatch(testAuthManager, testConfig);
            expectConfigurationIsolation(prodAuthManager, testAuthManager);
        });

        test('should allow configuration updates without affecting other instances', async () => {
            // Given: Two auth managers with different configurations
            const config1 = createMockConfiguration({ 
                environment: 'instance1',
                accessToken: 'token1' 
            });
            const config2 = createMockConfiguration({ 
                environment: 'instance2',
                accessToken: 'token2' 
            });
            
            const authManager1 = createAuthManager(config1);
            const authManager2 = createAuthManager(config2);
            
            // When: Updating configuration of one instance
            const updatedConfig1 = createMockConfiguration({ 
                environment: 'instance1-updated',
                accessToken: 'token1-updated' 
            });
            authManager1.updateConfig(updatedConfig1);
            
            // Then: Only the updated instance should reflect changes
            expectConfigurationMatch(authManager1, updatedConfig1);
            expectConfigurationMatch(authManager2, config2); // Should be unchanged
            expectConfigurationIsolation(authManager1, authManager2);
        });

        test('should support different authentication contexts simultaneously', async () => {
            // Given: Auth managers for different services/contexts
            const botConfig = createMockConfiguration({
                environment: 'bot-service',
                accessToken: 'bot-access-token',
                channel: 'bot-channel',
                clientId: 'bot-client-id'
            });
            const adminConfig = createMockConfiguration({
                environment: 'admin-service', 
                accessToken: 'admin-access-token',
                channel: 'admin-channel',
                clientId: 'admin-client-id'
            });
            
            // When: Creating managers for different contexts
            const botAuthManager = createAuthManager(botConfig);
            const adminAuthManager = createAuthManager(adminConfig);
            
            // Initialize both
            await botAuthManager.initialize();
            await adminAuthManager.initialize();
            
            // Then: Each should maintain independent authentication context
            expect(botAuthManager.getState()).toBe('READY');
            expect(adminAuthManager.getState()).toBe('READY');
            
            expectConfigurationMatch(botAuthManager, botConfig);
            expectConfigurationMatch(adminAuthManager, adminConfig);
            expectConfigurationIsolation(botAuthManager, adminAuthManager);
            
            // Each should provide its own access token
            const botToken = await botAuthManager.getAccessToken();
            const adminToken = await adminAuthManager.getAccessToken();
            
            expect(botToken).toBe('bot-access-token');
            expect(adminToken).toBe('admin-access-token');
            expect(botToken).not.toBe(adminToken);
        });
    });

    describe('Configuration State Independence', () => {
        test('should maintain independent state transitions for different instances', async () => {
            // Given: Two auth managers with different configurations
            const validConfig = createMockConfiguration({ environment: 'valid' });
            const invalidConfig = createMockConfiguration({ 
                environment: 'invalid',
                clientId: null // Invalid configuration
            });
            
            const validAuthManager = createAuthManager(validConfig);
            const invalidAuthManager = createAuthManager(invalidConfig);
            
            // When: One fails initialization, the other succeeds
            await validAuthManager.initialize();
            await expect(invalidAuthManager.initialize()).rejects.toThrow();
            
            // Then: States should be independent
            expect(validAuthManager.getState()).toBe('READY');
            expect(invalidAuthManager.getState()).toBe('ERROR');
            
            // Configurations should remain isolated
            expectConfigurationMatch(validAuthManager, validConfig);
            expectConfigurationMatch(invalidAuthManager, invalidConfig);
            expectConfigurationIsolation(validAuthManager, invalidAuthManager);
        });

        test('should allow independent recovery from error states', async () => {
            // Given: Two auth managers, one in error state
            const goodConfig = createMockConfiguration({ environment: 'good' });
            const badConfig = createMockConfiguration({ 
                environment: 'bad',
                clientId: null 
            });
            
            const goodAuthManager = createAuthManager(goodConfig);
            const badAuthManager = createAuthManager(badConfig);
            
            // Initialize good one, fail bad one
            await goodAuthManager.initialize();
            await expect(badAuthManager.initialize()).rejects.toThrow();
            
            expect(goodAuthManager.getState()).toBe('READY');
            expect(badAuthManager.getState()).toBe('ERROR');
            
            // When: Fixing the bad configuration
            const fixedConfig = createMockConfiguration({ environment: 'fixed' });
            badAuthManager.updateConfig(fixedConfig);
            await badAuthManager.initialize();
            
            // Then: Both should be ready with independent configurations
            expect(goodAuthManager.getState()).toBe('READY');
            expect(badAuthManager.getState()).toBe('READY');
            
            expectConfigurationMatch(goodAuthManager, goodConfig);
            expectConfigurationMatch(badAuthManager, fixedConfig);
            expectConfigurationIsolation(goodAuthManager, badAuthManager);
        });
    });

    describe('Resource Management Independence', () => {
        test('should cleanup instances independently without affecting others', async () => {
            // Given: Multiple initialized auth managers
            const config1 = createMockConfiguration({ environment: 'instance1' });
            const config2 = createMockConfiguration({ environment: 'instance2' });
            
            const authManager1 = createAuthManager(config1);
            const authManager2 = createAuthManager(config2);
            
            await authManager1.initialize();
            await authManager2.initialize();
            
            expect(authManager1.getState()).toBe('READY');
            expect(authManager2.getState()).toBe('READY');
            
            // When: Cleaning up one instance
            await authManager1.cleanup();
            
            // Then: Only the cleaned instance should be affected
            expect(authManager1.getState()).toBe('UNINITIALIZED');
            expect(authManager2.getState()).toBe('READY'); // Should remain ready
            
            // Configurations should remain isolated
            expectConfigurationMatch(authManager2, config2);
        });

        test('should support memory cleanup for each instance independently', async () => {
            // Given: Multiple auth managers with different configurations
            const configs = [
                createMockConfiguration({ environment: 'test1' }),
                createMockConfiguration({ environment: 'test2' }),
                createMockConfiguration({ environment: 'test3' })
            ];
            
            const authManagers = configs.map(config => createAuthManager(config));
            
            // Initialize all
            await Promise.all(authManagers.map(manager => manager.initialize()));
            
            // All should be ready
            authManagers.forEach(manager => {
                expect(manager.getState()).toBe('READY');
            });
            
            // When: Cleaning up specific instances
            await authManagers[0].cleanup();
            await authManagers[2].cleanup();
            
            // Then: Only cleaned instances should be affected
            expect(authManagers[0].getState()).toBe('UNINITIALIZED');
            expect(authManagers[1].getState()).toBe('READY'); // Should remain ready
            expect(authManagers[2].getState()).toBe('UNINITIALIZED');
            
            // Remaining instance should maintain its configuration
            expectConfigurationMatch(authManagers[1], configs[1]);
        });
    });
});