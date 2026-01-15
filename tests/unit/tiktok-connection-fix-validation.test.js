
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, unmockModule, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

const { initializeTestLogging, createTestUser, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { createMockLogger, createMockConfig } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');

// Initialize logging first
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    logPerformanceMetrics: true
});

// Unmock the TikTok platform to test the real implementation
unmockModule('../../src/platforms/tiktok');

// Mock logger utils to return our mock logger
mockModule('../../src/utils/logger-utils', () => ({
    getLazyLogger: createMockFn(),
    getLazyUnifiedLogger: createMockFn(),
    createNoopLogger: () => ({
        error: createMockFn(),
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn()
    }),
    getLoggerOrNoop: (logger) => logger || ({
        error: createMockFn(),
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn()
    })
}));

describe('TikTok Connection Fix Validation - Solution C', () => {
    let mockLogger, mockConfig, mockConnection, TikTokPlatform, mockDependencies;

    beforeEach(() => {
        mockLogger = createMockLogger('debug');
        
        mockConfig = createMockConfig({
            username: 'test_user',
            apiKey: 'test_api_key',
            enabled: true
        });

        // Mock TikTok Live Connector with proper connection state simulation
        mockConnection = {
            fetchIsLive: createMockFn().mockResolvedValue(true),
            waitUntilLive: createMockFn().mockResolvedValue(),
            connect: createMockFn().mockResolvedValue(),
            disconnect: createMockFn().mockResolvedValue(),
            removeAllListeners: createMockFn(),
            on: createMockFn(),
            getState: createMockFn().mockReturnValue({ isConnected: false })
        };

        // Import the actual TikTok platform for testing
        TikTokPlatform = require('../../src/platforms/tiktok').TikTokPlatform;
        
        // Mock dependencies
        mockDependencies = {
            TikTokWebSocketClient: createMockFn().mockImplementation(() => mockConnection),
            WebcastPushConnection: createMockFn(),
            WebcastEvent: {
                CHAT: 'chat',
                GIFT: 'gift',
                FOLLOW: 'follow',
                ROOM_USER: 'roomUser',
                ERROR: 'error',
                DISCONNECT: 'disconnect'
            },
            ControlEvent: {},
            retrySystem: {
                executeWithRetry: createMockFn().mockImplementation(async (fn) => await fn()),
                handleConnectionError: createMockFn(),
                handleConnectionSuccess: createMockFn(),
                resetRetryCount: createMockFn(),
                incrementRetryCount: createMockFn(),
                extractErrorMessage: createMockFn().mockImplementation(err => err?.message || 'Unknown error')
            },
            constants: {
                GRACE_PERIODS: { TIKTOK: 5000 }
            },
            logger: mockLogger,
            app: null
        };

        // Mock the unified logger that the real implementation uses
        const { getLazyUnifiedLogger, getLazyLogger } = require('../../src/utils/logger-utils');
        getLazyUnifiedLogger.mockReturnValue(mockLogger);
        getLazyLogger.mockReturnValue(mockLogger);
    });

    afterEach(() => {
        restoreAllMocks();
    
        restoreAllModuleMocks();});

    describe('Solution C Implementation Validation', () => {
        it('should prevent null pointer exceptions when connection is null', async () => {
            const platform = new TikTokPlatform(mockConfig, mockDependencies);
            
            platform.checkConnectionPrerequisites = createMockFn().mockReturnValue({
                canConnect: true,
                reason: 'All prerequisites met'
            });

            // Set a null connection to exercise ensureConnection
            platform.connection = null;
            
            expect(() => platform.connectionStateManager.ensureConnection()).not.toThrow();
            
            const connection = platform.connectionStateManager.ensureConnection();
            expect(connection).not.toBeNull();
            expect(typeof connection.connect).toBe('function');
        });

        it('should handle connection cleanup and recreation gracefully', async () => {
            const platform = new TikTokPlatform(mockConfig, mockDependencies);
            
            platform.checkConnectionPrerequisites = createMockFn().mockReturnValue({
                canConnect: true,
                reason: 'All prerequisites met'
            });

            await platform.initialize({});
            expect(platform.connection).not.toBeNull();
            
            await platform.cleanup();
            expect(platform.connection).toBeNull();

            await expect(platform.initialize({})).resolves.not.toThrow();
            expect(platform.connection).not.toBeNull();
        });

        it('should maintain connection state through the state manager', async () => {
            const platform = new TikTokPlatform(mockConfig, mockDependencies);
            
            expect(platform.connectionStateManager).toBeDefined();
            expect(platform.connectionFactory).toBeDefined();
            
            expect(platform.connectionStateManager.getState()).toBe('disconnected');
            expect(platform.connectionStateManager.isConnected()).toBe(false);
            
            const connectionInfo = platform.connectionStateManager.getConnectionInfo();
            expect(connectionInfo.platform).toBe('tiktok');
            expect(connectionInfo.state).toBe('disconnected');
            expect(connectionInfo.hasConnection).toBe(false);
        });

        it('should create connections using the factory pattern', async () => {
            const platform = new TikTokPlatform(mockConfig, mockDependencies);
            
            const connection = platform.connectionFactory.createConnection('tiktok', mockConfig, mockDependencies);
            expect(connection).not.toBeNull();
            expect(typeof connection.connect).toBe('function');
            
            expect(typeof connection.disconnect).toBe('function');
            expect(typeof connection.fetchIsLive).toBe('function');
            expect(typeof connection.on).toBe('function');
        });
    });
}, TEST_TIMEOUTS.FAST);
