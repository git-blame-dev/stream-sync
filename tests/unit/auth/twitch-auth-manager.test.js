const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { noOpLogger } = require('../../helpers/mock-factories');

describe('TwitchAuthManager', () => {
    let TwitchAuthManager;
    let mockConfig;
    let MockTwitchAuthService;
    let MockTwitchAuthInitializer;
    let mockAuthServiceInstance;
    let mockAuthInitializerInstance;

    beforeEach(() => {
        mockConfig = {
            clientId: 'test-client-id',
            clientSecret: 'test-client-secret',
            accessToken: 'test-access-token',
            refreshToken: 'test-refresh-token',
            channel: 'test-channel'
        };

        mockAuthServiceInstance = {
            config: { ...mockConfig },
            userId: 123456789,
            tokenExpiresAt: 9999999999999,
            initialize: createMockFn().mockResolvedValue(),
            getAuthProvider: createMockFn().mockReturnValue({
                getAccessTokenForUser: createMockFn().mockResolvedValue('mock-token')
            }),
            getUserId: createMockFn().mockResolvedValue(123456789),
            getAccessToken: createMockFn().mockReturnValue('mock-access-token'),
            cleanup: createMockFn().mockResolvedValue(),
            isReady: createMockFn().mockReturnValue(true)
        };

        mockAuthInitializerInstance = {
            initializeAuthentication: createMockFn().mockResolvedValue(true),
            validateConfig: createMockFn(),
            cleanup: createMockFn().mockResolvedValue(),
            scheduleTokenRefresh: createMockFn(),
            ensureValidToken: createMockFn().mockResolvedValue(true),
            REFRESH_THRESHOLD_SECONDS: 300
        };

        MockTwitchAuthService = createMockFn().mockImplementation(() => mockAuthServiceInstance);
        MockTwitchAuthInitializer = createMockFn().mockImplementation(() => mockAuthInitializerInstance);

        TwitchAuthManager = require('../../../src/auth/TwitchAuthManager');
    });

    afterEach(() => {
        delete require.cache[require.resolve('../../../src/auth/TwitchAuthManager')];
    });

    function createManager(config = mockConfig, extraDeps = {}) {
        return TwitchAuthManager.getInstance(config, {
            logger: noOpLogger,
            TwitchAuthService: MockTwitchAuthService,
            TwitchAuthInitializer: MockTwitchAuthInitializer,
            ...extraDeps
        });
    }

    describe('Independent Instance Pattern', () => {
        test('should create independent instances when called multiple times', () => {
            const instance1 = createManager();
            const instance2 = createManager();

            expect(instance1).not.toBe(instance2);
            expect(instance1).toBeInstanceOf(TwitchAuthManager);
            expect(instance2).toBeInstanceOf(TwitchAuthManager);
        });

        test('should have resetInstance method for backward compatibility', () => {
            expect(typeof TwitchAuthManager.resetInstance).toBe('function');
            expect(() => TwitchAuthManager.resetInstance()).not.toThrow();
        });
    });

    describe('Lifecycle Management', () => {
        test('should start in UNINITIALIZED state', () => {
            const manager = createManager();
            expect(manager.getState()).toBe('UNINITIALIZED');
        });

        test('should transition to INITIALIZING state during initialization', async () => {
            const manager = createManager();

            const initPromise = manager.initialize();
            expect(manager.getState()).toBe('INITIALIZING');

            await initPromise;
        });

        test('should transition to READY state after successful initialization', async () => {
            const manager = createManager();

            await manager.initialize();
            expect(manager.getState()).toBe('READY');
        });

        test('should transition to ERROR state on initialization failure', async () => {
            const invalidConfig = { ...mockConfig, clientId: null };
            const manager = createManager(invalidConfig);

            await expect(manager.initialize()).rejects.toThrow();
            expect(manager.getState()).toBe('ERROR');
        });

        test('should not reinitialize if already READY', async () => {
            const manager = createManager();

            await manager.initialize();
            expect(manager.getState()).toBe('READY');

            await manager.initialize();
            expect(manager.getState()).toBe('READY');
        });
    });

    describe('Auth Provider Access', () => {
        test('should throw error when getting auth provider before initialization', () => {
            const manager = createManager();
            expect(() => manager.getAuthProvider()).toThrow('Authentication not initialized');
        });

        test('should return auth provider after successful initialization', async () => {
            const manager = createManager();

            await manager.initialize();
            const authProvider = manager.getAuthProvider();

            expect(authProvider).toBeDefined();
            expect(typeof authProvider.getAccessTokenForUser).toBe('function');
        });

        test('should return user ID after successful initialization', async () => {
            const manager = createManager();

            await manager.initialize();
            const userId = manager.getUserId();

            expect(userId).toBeDefined();
            expect(typeof userId).toBe('number');
        });

        test('should throw error when getting user ID before initialization', () => {
            const manager = createManager();
            expect(() => manager.getUserId()).toThrow('Authentication not initialized');
        });
    });

    describe('Error Handling and Recovery', () => {
        test('should allow reinitialization after error state', async () => {
            const invalidConfig = { ...mockConfig, clientId: null };
            const manager = createManager(invalidConfig);

            await expect(manager.initialize()).rejects.toThrow();
            expect(manager.getState()).toBe('ERROR');

            manager.updateConfig(mockConfig);
            await manager.initialize();
            expect(manager.getState()).toBe('READY');
        });

        test('should provide error details when in ERROR state', async () => {
            const invalidConfig = { ...mockConfig, clientId: null };
            const manager = createManager(invalidConfig);

            await expect(manager.initialize()).rejects.toThrow();

            const error = manager.getLastError();
            expect(error).toBeDefined();
            expect(error.message).toContain('clientId');
        });
    });

    describe('Configuration Management', () => {
        test('should validate configuration before initialization', () => {
            const invalidConfig = {};
            const manager = createManager(invalidConfig);

            expect(() => manager.validateConfig()).toThrow('Invalid configuration');
        });

        test('should allow config updates', () => {
            const manager = createManager();

            const newConfig = { ...mockConfig, accessToken: 'new-token' };
            manager.updateConfig(newConfig);

            expect(manager.getConfig().accessToken).toBe('new-token');
        });

        test('should reset state when config is updated', async () => {
            const manager = createManager();

            await manager.initialize();
            expect(manager.getState()).toBe('READY');

            manager.updateConfig({ ...mockConfig, accessToken: 'new-token' });
            expect(manager.getState()).toBe('UNINITIALIZED');
        });
    });
});
