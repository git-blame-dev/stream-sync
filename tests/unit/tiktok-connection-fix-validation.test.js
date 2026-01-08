
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
jest.unmock('../../src/platforms/tiktok');

// Mock logger utils to return our mock logger
jest.mock('../../src/utils/logger-utils', () => ({
    getLazyLogger: jest.fn(),
    getLazyUnifiedLogger: jest.fn(),
    createNoopLogger: () => ({
        error: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn()
    }),
    getLoggerOrNoop: (logger) => logger || ({
        error: jest.fn(),
        debug: jest.fn(),
        info: jest.fn(),
        warn: jest.fn()
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
            fetchIsLive: jest.fn().mockResolvedValue(true),
            waitUntilLive: jest.fn().mockResolvedValue(),
            connect: jest.fn().mockResolvedValue(),
            disconnect: jest.fn().mockResolvedValue(),
            removeAllListeners: jest.fn(),
            on: jest.fn(),
            getState: jest.fn().mockReturnValue({ isConnected: false })
        };

        // Import the actual TikTok platform for testing
        TikTokPlatform = require('../../src/platforms/tiktok').TikTokPlatform;
        
        // Mock dependencies
        mockDependencies = {
            TikTokWebSocketClient: jest.fn().mockImplementation(() => mockConnection),
            WebcastPushConnection: jest.fn(),
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
                executeWithRetry: jest.fn().mockImplementation(async (fn) => await fn()),
                handleConnectionError: jest.fn(),
                handleConnectionSuccess: jest.fn(),
                resetRetryCount: jest.fn(),
                incrementRetryCount: jest.fn(),
                extractErrorMessage: jest.fn().mockImplementation(err => err?.message || 'Unknown error')
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
        jest.restoreAllMocks();
    });

    describe('Solution C Implementation Validation', () => {
        it('should prevent null pointer exceptions when connection is null', async () => {
            // SETUP: Platform instance
            const platform = new TikTokPlatform(mockConfig, mockDependencies);
            
            platform.checkConnectionPrerequisites = jest.fn().mockReturnValue({
                canConnect: true,
                reason: 'All prerequisites met'
            });

            // FORCE: Set connection to null (simulating the bug condition)
            platform.connection = null;
            
            // EXECUTE: Ensure connection - this should NOT crash
            // Solution C should recreate the connection automatically
            expect(() => platform.connectionStateManager.ensureConnection()).not.toThrow();
            
            // VERIFY: Connection should be recreated
            const connection = platform.connectionStateManager.ensureConnection();
            expect(connection).not.toBeNull();
            expect(typeof connection.connect).toBe('function');
        });

        it('should handle connection cleanup and recreation gracefully', async () => {
            // SETUP: Platform with working connection
            const platform = new TikTokPlatform(mockConfig, mockDependencies);
            
            platform.checkConnectionPrerequisites = jest.fn().mockReturnValue({
                canConnect: true,
                reason: 'All prerequisites met'
            });

            // STEP 1: Create initial connection
            await platform.initialize({});
            expect(platform.connection).not.toBeNull();
            
            // STEP 2: Cleanup (this nullifies connection)
            await platform.cleanup();
            expect(platform.connection).toBeNull();

            // STEP 3: Reconnect should work without issues
            await expect(platform.initialize({})).resolves.not.toThrow();
            expect(platform.connection).not.toBeNull();
        });

        it('should maintain connection state through the state manager', async () => {
            // SETUP: Platform instance
            const platform = new TikTokPlatform(mockConfig, mockDependencies);
            
            // VERIFY: State manager is properly initialized
            expect(platform.connectionStateManager).toBeDefined();
            expect(platform.connectionFactory).toBeDefined();
            
            // VERIFY: Initial state is disconnected
            expect(platform.connectionStateManager.getState()).toBe('disconnected');
            expect(platform.connectionStateManager.isConnected()).toBe(false);
            
            // VERIFY: Connection info is properly tracked
            const connectionInfo = platform.connectionStateManager.getConnectionInfo();
            expect(connectionInfo.platform).toBe('tiktok');
            expect(connectionInfo.state).toBe('disconnected');
            expect(connectionInfo.hasConnection).toBe(false);
        });

        it('should create connections using the factory pattern', async () => {
            // SETUP: Platform instance
            const platform = new TikTokPlatform(mockConfig, mockDependencies);
            
            // VERIFY: Factory can create connections
            const connection = platform.connectionFactory.createConnection('tiktok', mockConfig, mockDependencies);
            expect(connection).not.toBeNull();
            expect(typeof connection.connect).toBe('function');
            
            // VERIFY: Factory adds missing methods for compatibility
            expect(typeof connection.disconnect).toBe('function');
            expect(typeof connection.fetchIsLive).toBe('function');
            expect(typeof connection.on).toBe('function');
        });
    });
}, TEST_TIMEOUTS.FAST);
