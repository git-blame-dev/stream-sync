
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

// Initialize test logging FIRST
const { initializeTestLogging } = require('../helpers/test-setup');
initializeTestLogging();

// Mock dependencies to prevent actual auth system access
const registerAuthMocks = () => {
    mockModule('../../src/auth/TwitchAuthService', () => {
        return createMockFn().mockImplementation((config) => ({
            config: config || {
                accessToken: 'mock-access-token',
                refreshToken: 'mock-refresh-token',
                clientId: 'test-client-id',
                clientSecret: 'test-client-secret'
            },
            userId: 123456789, // Property, not a method
            initialize: createMockFn().mockResolvedValue(),
            getAuthProvider: createMockFn().mockReturnValue({
                getAccessTokenForUser: createMockFn().mockResolvedValue('mock-token')
            }),
            getUserId: createMockFn().mockResolvedValue(123456789),
            getAccessToken: createMockFn().mockResolvedValue('mock-access-token'),
            cleanup: createMockFn().mockResolvedValue(),
            isReady: createMockFn().mockReturnValue(true)
        }));
    });

    mockModule('../../src/auth/TwitchAuthInitializer', () => {
        return createMockFn().mockImplementation(() => ({
            initializeAuthentication: createMockFn().mockResolvedValue(true),
            validateConfig: createMockFn(),
            cleanup: createMockFn().mockResolvedValue()
        }));
    });
};

registerAuthMocks();

describe('TwitchAuthManager', () => {
    let TwitchAuthManager;
    let mockConfig;

    beforeEach(() => {
        // Clear any existing singleton instances
        resetModules();
        registerAuthMocks();

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
        // Clean up singleton instance between tests
        if (TwitchAuthManager && TwitchAuthManager.resetInstance) {
            TwitchAuthManager.resetInstance();
        }
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    describe('Independent Instance Pattern', () => {
        test('should create independent instances when called multiple times', () => {
            TwitchAuthManager = require('../../src/auth/TwitchAuthManager');
            
            const instance1 = TwitchAuthManager.getInstance(mockConfig);
            const instance2 = TwitchAuthManager.getInstance(mockConfig);
            
            // Should create independent instances, not singleton
            expect(instance1).not.toBe(instance2);
            expect(instance1).toBeInstanceOf(TwitchAuthManager);
            expect(instance2).toBeInstanceOf(TwitchAuthManager);
        });

        test('should create independent instances across different import contexts', () => {
            TwitchAuthManager = require('../../src/auth/TwitchAuthManager');
            const instance1 = TwitchAuthManager.getInstance(mockConfig);
            
            // Simulate importing from another module
            delete require.cache[require.resolve('../../src/auth/TwitchAuthManager')];
            const TwitchAuthManager2 = require('../../src/auth/TwitchAuthManager');
            const instance2 = TwitchAuthManager2.getInstance(mockConfig);
            
            // Should be independent instances, not the same
            expect(instance1).not.toBe(instance2);
            expect(instance1).toBeInstanceOf(TwitchAuthManager);
            expect(instance2).toBeInstanceOf(TwitchAuthManager2);
        });

        test('should have resetInstance method for backward compatibility', () => {
            TwitchAuthManager = require('../../src/auth/TwitchAuthManager');
            
            expect(typeof TwitchAuthManager.resetInstance).toBe('function');
            // Should be a no-op now with independent instances
            expect(() => TwitchAuthManager.resetInstance()).not.toThrow();
        });
    });

    describe('Lifecycle Management', () => {
        beforeEach(() => {
            TwitchAuthManager = require('../../src/auth/TwitchAuthManager');
        });

        test('should start in UNINITIALIZED state', () => {
            const manager = TwitchAuthManager.getInstance(mockConfig);
            
            expect(manager.getState()).toBe('UNINITIALIZED');
        });

        test('should transition to INITIALIZING state during initialization', async () => {
            const manager = TwitchAuthManager.getInstance(mockConfig);
            
            const initPromise = manager.initialize();
            expect(manager.getState()).toBe('INITIALIZING');
            
            await initPromise;
        });

        test('should transition to READY state after successful initialization', async () => {
            const manager = TwitchAuthManager.getInstance(mockConfig);
            
            await manager.initialize();
            expect(manager.getState()).toBe('READY');
        });

        test('should transition to ERROR state on initialization failure', async () => {
            const invalidConfig = { ...mockConfig, clientId: null };
            const manager = TwitchAuthManager.getInstance(invalidConfig);
            
            await expect(manager.initialize()).rejects.toThrow();
            expect(manager.getState()).toBe('ERROR');
        });

        test('should not reinitialize if already READY', async () => {
            const manager = TwitchAuthManager.getInstance(mockConfig);
            
            await manager.initialize();
            expect(manager.getState()).toBe('READY');
            
            // Second initialization should not change state
            await manager.initialize();
            expect(manager.getState()).toBe('READY');
        });
    });

    describe('Auth Provider Access', () => {
        beforeEach(() => {
            TwitchAuthManager = require('../../src/auth/TwitchAuthManager');
        });

        test('should throw error when getting auth provider before initialization', () => {
            const manager = TwitchAuthManager.getInstance(mockConfig);
            
            expect(() => manager.getAuthProvider()).toThrow('Authentication not initialized');
        });

        test('should return auth provider after successful initialization', async () => {
            const manager = TwitchAuthManager.getInstance(mockConfig);
            
            await manager.initialize();
            const authProvider = manager.getAuthProvider();
            
            expect(authProvider).toBeDefined();
            expect(typeof authProvider.getAccessTokenForUser).toBe('function');
        });

        test('should return user ID after successful initialization', async () => {
            const manager = TwitchAuthManager.getInstance(mockConfig);
            
            await manager.initialize();
            const userId = manager.getUserId();
            
            expect(userId).toBeDefined();
            expect(typeof userId).toBe('number');
        });

        test('should throw error when getting user ID before initialization', () => {
            const manager = TwitchAuthManager.getInstance(mockConfig);
            
            expect(() => manager.getUserId()).toThrow('Authentication not initialized');
        });
    });

    describe('Error Handling and Recovery', () => {
        beforeEach(() => {
            TwitchAuthManager = require('../../src/auth/TwitchAuthManager');
        });

        test('should allow reinitialization after error state', async () => {
            const invalidConfig = { ...mockConfig, clientId: null };
            const manager = TwitchAuthManager.getInstance(invalidConfig);
            
            await expect(manager.initialize()).rejects.toThrow();
            expect(manager.getState()).toBe('ERROR');
            
            // Should allow retry with valid config
            manager.updateConfig(mockConfig);
            await manager.initialize();
            expect(manager.getState()).toBe('READY');
        });

        test('should provide error details when in ERROR state', async () => {
            const invalidConfig = { ...mockConfig, clientId: null };
            const manager = TwitchAuthManager.getInstance(invalidConfig);
            
            await expect(manager.initialize()).rejects.toThrow();
            
            const error = manager.getLastError();
            expect(error).toBeDefined();
            expect(error.message).toContain('clientId');
        });
    });

    describe('Configuration Management', () => {
        beforeEach(() => {
            TwitchAuthManager = require('../../src/auth/TwitchAuthManager');
        });

        test('should validate configuration before initialization', () => {
            const invalidConfig = {};
            const manager = TwitchAuthManager.getInstance(invalidConfig);
            
            expect(() => manager.validateConfig()).toThrow('Invalid configuration');
        });

        test('should allow config updates', () => {
            const manager = TwitchAuthManager.getInstance(mockConfig);
            
            const newConfig = { ...mockConfig, accessToken: 'new-token' };
            manager.updateConfig(newConfig);
            
            expect(manager.getConfig().accessToken).toBe('new-token');
        });

        test('should reset state when config is updated', async () => {
            const manager = TwitchAuthManager.getInstance(mockConfig);
            
            await manager.initialize();
            expect(manager.getState()).toBe('READY');
            
            manager.updateConfig({ ...mockConfig, accessToken: 'new-token' });
            expect(manager.getState()).toBe('UNINITIALIZED');
        });
    });
});