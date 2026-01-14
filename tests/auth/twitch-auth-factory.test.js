
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

// Initialize test logging FIRST
const { initializeTestLogging, createMockConfig } = require('../helpers/test-setup');
initializeTestLogging();

// Mock TwitchAuthManager to prevent actual auth system initialization
const registerAuthManagerMock = () => {
    mockModule('../../src/auth/TwitchAuthManager', () => {
        let currentConfig = {};
        let currentState = 'READY';

        const mockInstance = {
            initialize: createMockFn().mockResolvedValue(),
            getState: createMockFn().mockReturnValue('READY'),
            getConfig: createMockFn(() => currentConfig),
            updateConfig: createMockFn((config) => {
                currentConfig = { ...config };
            }),
            cleanup: createMockFn().mockImplementation(async () => {
                currentState = 'UNINITIALIZED';
                mockInstance.getState = createMockFn().mockReturnValue('UNINITIALIZED');
            }),
            getAuthProvider: createMockFn().mockResolvedValue({
                getAccessTokenForUser: createMockFn().mockResolvedValue('mock-token')
            }),
            getUserId: createMockFn().mockResolvedValue(123456789),
            getAccessToken: createMockFn().mockResolvedValue('mock-access-token'),
            getStatus: createMockFn().mockReturnValue({
                state: 'READY',
                hasAuthProvider: true,
                userId: 123456789,
                configValid: true,
                lastError: null
            })
        };

        return {
            getInstance: createMockFn().mockImplementation((config) => {
                currentConfig = { ...config };
                return mockInstance;
            }),
            resetInstance: createMockFn()
        };
    });
};

registerAuthManagerMock();

describe('TwitchAuthFactory', () => {
    let TwitchAuthFactory;
    let mockConfig;

    beforeEach(() => {
        // Clear any existing singleton instances
        resetModules();
        registerAuthManagerMock();

        // Re-initialize logging after module reset
        const { initializeTestLogging } = require('../helpers/test-setup');
        initializeTestLogging();

        mockConfig = {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            channel: 'test-channel'
        };
    });

    afterEach(() => {
        // Clean up singleton instances between tests
        try {
            const TwitchAuthManager = require('../../src/auth/TwitchAuthManager');
            if (TwitchAuthManager && TwitchAuthManager.resetInstance) {
                TwitchAuthManager.resetInstance();
            }
        } catch (error) {
            // Ignore cleanup errors
        }
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    describe('Factory Creation and Dependency Injection', () => {
        test('should create factory with configuration', () => {
            TwitchAuthFactory = require('../../src/auth/TwitchAuthFactory');
            
            const factory = new TwitchAuthFactory(mockConfig);
            
            expect(factory).toBeDefined();
            expect(factory.getConfig()).toEqual(mockConfig);
        });

        test('should allow configuration updates', () => {
            TwitchAuthFactory = require('../../src/auth/TwitchAuthFactory');
            
            const factory = new TwitchAuthFactory(mockConfig);
            const newConfig = { ...mockConfig, accessToken: 'new-token' };
            
            factory.updateConfig(newConfig);
            
            expect(factory.getConfig().accessToken).toBe('new-token');
        });

        test('should validate required configuration fields', () => {
            TwitchAuthFactory = require('../../src/auth/TwitchAuthFactory');
            
            const invalidConfig = { clientId: 'test' }; // Missing required fields
            
            expect(() => new TwitchAuthFactory(invalidConfig)).toThrow('Invalid configuration');
        });
    });

    describe('Auth Manager Instance Management', () => {
        beforeEach(() => {
            TwitchAuthFactory = require('../../src/auth/TwitchAuthFactory');
        });

        test('should create TwitchAuthManager instance', () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            const authManager = factory.createAuthManager();
            
            expect(authManager).toBeDefined();
            expect(typeof authManager.initialize).toBe('function');
            expect(typeof authManager.getState).toBe('function');
        });

        test('should return singleton instance from auth manager', () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            const authManager1 = factory.createAuthManager();
            const authManager2 = factory.createAuthManager();
            
            expect(authManager1).toBe(authManager2);
        });

        test('should pass factory config to auth manager', () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            const authManager = factory.createAuthManager();
            
            expect(authManager.getConfig()).toEqual(mockConfig);
        });

        test('should handle auth manager creation errors gracefully', () => {
            // Use valid config but make the auth manager throw an error
            const factory = new TwitchAuthFactory(mockConfig);
            
            // Mock getInstance to throw an error for this test
            const TwitchAuthManager = require('../../src/auth/TwitchAuthManager');
            TwitchAuthManager.getInstance.mockImplementationOnce(() => {
                throw new Error('Auth manager creation failed');
            });
            
            expect(() => factory.createAuthManager()).toThrow('Auth manager creation failed');
        });
    });

    describe('Dependency Injection Patterns', () => {
        beforeEach(() => {
            TwitchAuthFactory = require('../../src/auth/TwitchAuthFactory');
        });

        test('should provide initialized auth manager', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            const authManager = await factory.getInitializedAuthManager();
            
            expect(authManager.getState()).toBe('READY');
        });

        test('should cache initialized instance', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            const authManager1 = await factory.getInitializedAuthManager();
            const authManager2 = await factory.getInitializedAuthManager();
            
            expect(authManager1).toBe(authManager2);
            expect(authManager1.getState()).toBe('READY');
        });

        test('should reinitialize when config changes', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            const authManager1 = await factory.getInitializedAuthManager();
            expect(authManager1.getState()).toBe('READY');
            
            // Update config
            factory.updateConfig({ ...mockConfig, accessToken: 'new-token' });
            
            const authManager2 = await factory.getInitializedAuthManager();
            expect(authManager2.getState()).toBe('READY');
            expect(authManager2.getConfig().accessToken).toBe('new-token');
        });
    });

    describe('Auth Provider Access', () => {
        beforeEach(() => {
            TwitchAuthFactory = require('../../src/auth/TwitchAuthFactory');
        });

        test('should provide auth provider directly', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            const authProvider = await factory.getAuthProvider();
            
            expect(authProvider).toBeDefined();
            expect(typeof authProvider.getAccessTokenForUser).toBe('function');
        });

        test('should provide user ID directly', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            const userId = await factory.getUserId();
            
            expect(userId).toBeDefined();
            expect(typeof userId).toBe('number');
        });

        test('should provide access token directly', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            const accessToken = await factory.getAccessToken();
            
            expect(accessToken).toBeDefined();
            expect(typeof accessToken).toBe('string');
        });
    });

    describe('Error Handling and Recovery', () => {
        beforeEach(() => {
            TwitchAuthFactory = require('../../src/auth/TwitchAuthFactory');
        });

        test('should handle initialization failures gracefully', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            // Mock the auth manager to reject initialization
            const TwitchAuthManager = require('../../src/auth/TwitchAuthManager');
            const mockManager = TwitchAuthManager.getInstance();
            
            // Make it appear uninitialized so initialize() will be called
            mockManager.getState.mockReturnValueOnce('UNINITIALIZED');
            mockManager.initialize.mockRejectedValueOnce(new Error('Initialization failed'));
            
            await expect(factory.getInitializedAuthManager()).rejects.toThrow('Initialization failed');
        });

        test('should allow retry after failure', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            // Mock the auth manager to fail first, then succeed
            const TwitchAuthManager = require('../../src/auth/TwitchAuthManager');
            const mockManager = TwitchAuthManager.getInstance();
            
            // First call: return UNINITIALIZED so initialize is called, then it fails
            mockManager.getState.mockReturnValueOnce('UNINITIALIZED');
            mockManager.initialize.mockRejectedValueOnce(new Error('First attempt failed'));
            
            // First attempt should fail
            await expect(factory.getInitializedAuthManager()).rejects.toThrow('First attempt failed');
            
            // Second attempt: return UNINITIALIZED again, then success
            mockManager.getState.mockReturnValueOnce('UNINITIALIZED').mockReturnValue('READY');
            mockManager.initialize.mockResolvedValueOnce();
            
            // Update to valid config and retry
            factory.updateConfig(mockConfig);
            const authManager = await factory.getInitializedAuthManager();
            
            expect(authManager.getState()).toBe('READY');
        });

        test('should provide error details from last failure', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            // Mock the auth manager to fail
            const TwitchAuthManager = require('../../src/auth/TwitchAuthManager');
            const mockManager = TwitchAuthManager.getInstance();
            
            // Make it appear uninitialized and fail
            mockManager.getState.mockReturnValueOnce('UNINITIALIZED');
            mockManager.initialize.mockRejectedValueOnce(new Error('Test failure'));
            
            await expect(factory.getInitializedAuthManager()).rejects.toThrow('Test failure');
            
            const status = factory.getStatus();
            // After error, factory should capture error state (lastError may be null if auth manager status overrides it)
            expect(factory.lastError).toBeDefined();
            expect(factory.lastError.message).toBe('Test failure');
        });
    });

    describe('Status and Health Monitoring', () => {
        beforeEach(() => {
            TwitchAuthFactory = require('../../src/auth/TwitchAuthFactory');
        });

        test('should provide comprehensive status information', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            const authManager = await factory.getInitializedAuthManager();
            const status = factory.getStatus();
            
            expect(status).toHaveProperty('state');
            expect(status).toHaveProperty('hasAuthProvider');
            expect(status).toHaveProperty('userId');
            expect(status).toHaveProperty('configValid');
            expect(status).toHaveProperty('lastError');
            
            expect(status.state).toBe('READY');
            expect(status.hasAuthProvider).toBe(true);
            expect(status.configValid).toBe(true);
        });

        test('should indicate factory readiness', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            expect(factory.isReady()).toBe(false);
            
            await factory.getInitializedAuthManager();
            
            expect(factory.isReady()).toBe(true);
        });
    });

    describe('Resource Management and Cleanup', () => {
        beforeEach(() => {
            TwitchAuthFactory = require('../../src/auth/TwitchAuthFactory');
        });

        test('should have cleanup method', () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            expect(typeof factory.cleanup).toBe('function');
        });

        test('should cleanup auth manager on factory cleanup', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            const authManager = await factory.getInitializedAuthManager();
            expect(authManager.getState()).toBe('READY');
            
            await factory.cleanup();
            
            // After cleanup, state should be reset
            expect(authManager.getState()).toBe('UNINITIALIZED');
        });

        test('should handle cleanup when no manager exists', async () => {
            const factory = new TwitchAuthFactory(mockConfig);
            
            // Should not throw when cleaning up empty factory
            await expect(factory.cleanup()).resolves.not.toThrow();
        });
    });
});
