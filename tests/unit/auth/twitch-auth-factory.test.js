const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');

const TwitchAuthFactory = require('../../../src/auth/TwitchAuthFactory');

const createMockTwitchAuthManager = () => {
    let currentConfig = {};
    let currentState = 'READY';

    const mockInstance = {
        initialize: createMockFn().mockResolvedValue(),
        getState: createMockFn(() => currentState),
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
        resetInstance: createMockFn(),
        _mockInstance: mockInstance
    };
};

describe('TwitchAuthFactory', () => {
    let configFixture;
    let mockTwitchAuthManager;

    beforeEach(() => {
        mockTwitchAuthManager = createMockTwitchAuthManager();

        configFixture = {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            channel: 'test-channel'
        };
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('Factory Creation and Dependency Injection', () => {
        test('should create factory with configuration', () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            expect(factory).toBeDefined();
            expect(factory.getConfig()).toEqual(configFixture);
        });

        test('should allow configuration updates', () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });
            const newConfig = { ...configFixture, accessToken: 'new-token' };

            factory.updateConfig(newConfig);

            expect(factory.getConfig().accessToken).toBe('new-token');
        });

        test('should validate required configuration fields', () => {
            const invalidConfig = { clientId: 'test' };

            expect(() => new TwitchAuthFactory(invalidConfig, { TwitchAuthManager: mockTwitchAuthManager })).toThrow('Invalid configuration');
        });
    });

    describe('Auth Manager Instance Management', () => {
        test('should create TwitchAuthManager instance', () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            const authManager = factory.createAuthManager();

            expect(authManager).toBeDefined();
            expect(typeof authManager.initialize).toBe('function');
            expect(typeof authManager.getState).toBe('function');
        });

        test('should return singleton instance from auth manager', () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            const authManager1 = factory.createAuthManager();
            const authManager2 = factory.createAuthManager();

            expect(authManager1).toBe(authManager2);
        });

        test('should pass factory config to auth manager', () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            const authManager = factory.createAuthManager();

            expect(authManager.getConfig()).toEqual(configFixture);
        });

        test('should handle auth manager creation errors gracefully', () => {
            mockTwitchAuthManager.getInstance.mockImplementationOnce(() => {
                throw new Error('Auth manager creation failed');
            });

            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            expect(() => factory.createAuthManager()).toThrow('Auth manager creation failed');
        });
    });

    describe('Dependency Injection Patterns', () => {
        test('should provide initialized auth manager', async () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            const authManager = await factory.getInitializedAuthManager();

            expect(authManager.getState()).toBe('READY');
        });

        test('should cache initialized instance', async () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            const authManager1 = await factory.getInitializedAuthManager();
            const authManager2 = await factory.getInitializedAuthManager();

            expect(authManager1).toBe(authManager2);
            expect(authManager1.getState()).toBe('READY');
        });

        test('should reinitialize when config changes', async () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            const authManager1 = await factory.getInitializedAuthManager();
            expect(authManager1.getState()).toBe('READY');

            factory.updateConfig({ ...configFixture, accessToken: 'new-token' });

            const authManager2 = await factory.getInitializedAuthManager();
            expect(authManager2.getState()).toBe('READY');
            expect(authManager2.getConfig().accessToken).toBe('new-token');
        });
    });

    describe('Auth Provider Access', () => {
        test('should provide auth provider directly', async () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            const authProvider = await factory.getAuthProvider();

            expect(authProvider).toBeDefined();
            expect(typeof authProvider.getAccessTokenForUser).toBe('function');
        });

        test('should provide user ID directly', async () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            const userId = await factory.getUserId();

            expect(userId).toBeDefined();
            expect(typeof userId).toBe('number');
        });

        test('should provide access token directly', async () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            const accessToken = await factory.getAccessToken();

            expect(accessToken).toBeDefined();
            expect(typeof accessToken).toBe('string');
        });
    });

    describe('Error Handling and Recovery', () => {
        test('should handle initialization failures gracefully', async () => {
            mockTwitchAuthManager._mockInstance.getState.mockReturnValueOnce('UNINITIALIZED');
            mockTwitchAuthManager._mockInstance.initialize.mockRejectedValueOnce(new Error('Initialization failed'));

            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            await expect(factory.getInitializedAuthManager()).rejects.toThrow('Initialization failed');
        });

        test('should allow retry after failure', async () => {
            const mockManager = mockTwitchAuthManager._mockInstance;

            mockManager.getState.mockReturnValueOnce('UNINITIALIZED');
            mockManager.initialize.mockRejectedValueOnce(new Error('First attempt failed'));

            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            await expect(factory.getInitializedAuthManager()).rejects.toThrow('First attempt failed');

            mockManager.getState.mockReturnValueOnce('UNINITIALIZED').mockReturnValue('READY');
            mockManager.initialize.mockResolvedValueOnce();

            factory.updateConfig(configFixture);
            const authManager = await factory.getInitializedAuthManager();

            expect(authManager.getState()).toBe('READY');
        });

        test('should provide error details from last failure', async () => {
            mockTwitchAuthManager._mockInstance.getState.mockReturnValueOnce('UNINITIALIZED');
            mockTwitchAuthManager._mockInstance.initialize.mockRejectedValueOnce(new Error('Test failure'));

            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            await expect(factory.getInitializedAuthManager()).rejects.toThrow('Test failure');

            expect(factory.lastError).toBeDefined();
            expect(factory.lastError.message).toBe('Test failure');
        });
    });

    describe('Status and Health Monitoring', () => {
        test('should provide comprehensive status information', async () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            await factory.getInitializedAuthManager();
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
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            expect(factory.isReady()).toBe(false);

            await factory.getInitializedAuthManager();

            expect(factory.isReady()).toBe(true);
        });
    });

    describe('Resource Management and Cleanup', () => {
        test('should have cleanup method', () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            expect(typeof factory.cleanup).toBe('function');
        });

        test('should cleanup auth manager on factory cleanup', async () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            const authManager = await factory.getInitializedAuthManager();
            expect(authManager.getState()).toBe('READY');

            await factory.cleanup();

            expect(authManager.getState()).toBe('UNINITIALIZED');
        });

        test('should handle cleanup when no manager exists', async () => {
            const factory = new TwitchAuthFactory(configFixture, { TwitchAuthManager: mockTwitchAuthManager });

            await factory.cleanup();
        });
    });
});
