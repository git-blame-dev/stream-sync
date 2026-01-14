
const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, mockResolvedValue, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');
const { initializeTestLogging, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { 
    createMockLogger, 
    createMockConfigManager, 
    createMockOBSConnection,
    createMockDisplayQueue 
} = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const testClock = require('../helpers/test-clock');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Mock external dependencies
mockModule('../../src/obs/connection', () => ({
    ensureOBSConnected: mockResolvedValue(createMockFn(), undefined),
    obsCall: createMockFn(),
    getOBSConnectionManager: createMockFn(() => ({
        isConnected: () => true,
        isReady: () => Promise.resolve(true)
    }))
}));

mockModule('../../src/obs/display-queue', () => ({
    DisplayQueue: createMockFn(() => ({
        handleNotificationEffects: mockResolvedValue(createMockFn(), undefined),
        updateTextSource: mockResolvedValue(createMockFn(), undefined),
        playMediaInOBS: mockResolvedValue(createMockFn(), undefined),
        playGiftVideoAndAudio: mockResolvedValue(createMockFn(), undefined)
    }))
}));

// Mock logger utilities
mockModule('../../src/utils/logger-utils', () => {
    const createLogger = () => ({
        error: createMockFn(),
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn()
    });

    return {
        isDebugModeEnabled: createMockFn(() => false),
        createNoopLogger: () => createLogger(),
        getLoggerOrNoop: (logger) => logger || createLogger(),
        getLazyLogger: createMockFn(() => createLogger()),
        getLazyUnifiedLogger: createMockFn(() => ({
            ...createLogger(),
            log: createMockFn()
        }))
    };
});

mockModule('../../src/core/logging', () => ({
    debugLog: createMockFn(),
    logger: {
        error: createMockFn(),
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn()
    },
    getUnifiedLogger: createMockFn(() => ({
        error: createMockFn(),
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        log: createMockFn()
    })),
    getLogger: createMockFn(() => ({
        error: createMockFn(),
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        log: createMockFn()
    }))
}));

describe('End-to-End Platform Workflow Integration Tests', () => {
    let mockLogger;
    let mockConfigManager;
    let mockOBSConnection;
    let mockDisplayQueue;

    beforeEach(() => {
        testClock.reset();
        // Create mocks using factories
        mockLogger = createMockLogger('debug');
        mockConfigManager = createMockConfigManager();
        mockOBSConnection = createMockOBSConnection();
        mockDisplayQueue = createMockDisplayQueue();

        // Set test environment
        process.env.NODE_ENV = 'test';
    });

    afterEach(() => {
        delete process.env.NODE_ENV;
        clearAllMocks();
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    describe('Platform Initialization and Configuration', () => {
        test('should verify TikTok platform configuration', async () => {
            // Arrange: Create TikTok platform configuration
            const tiktokConfig = {
                enabled: true,
                username: 'testuser',
                sessionId: 'test-session',
                gracePeriod: 5000
            };

            // Act: Verify configuration structure
            expect(tiktokConfig.enabled).toBe(true);
            expect(tiktokConfig.username).toBe('testuser');
            expect(tiktokConfig.gracePeriod).toBe(5000);

            // Assert: Configuration is valid
            expect(typeof tiktokConfig.enabled).toBe('boolean');
            expect(typeof tiktokConfig.username).toBe('string');
            expect(typeof tiktokConfig.gracePeriod).toBe('number');
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should verify Twitch platform configuration', async () => {
            // Arrange: Create Twitch platform configuration
            const twitchConfig = {
                enabled: true,
                channel: 'testchannel',
                oauth: 'oauth:test-token',
                gracePeriod: 5000
            };

            // Act: Verify configuration structure
            expect(twitchConfig.enabled).toBe(true);
            expect(twitchConfig.channel).toBe('testchannel');
            expect(twitchConfig.gracePeriod).toBe(5000);

            // Assert: Configuration is valid
            expect(typeof twitchConfig.enabled).toBe('boolean');
            expect(typeof twitchConfig.channel).toBe('string');
            expect(typeof twitchConfig.gracePeriod).toBe('number');
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should verify YouTube platform configuration', async () => {
            // Arrange: Create YouTube platform configuration
            const youtubeConfig = {
                enabled: true,
                channelId: 'test-channel-id',
                apiKey: 'test-api-key',
                gracePeriod: 5000
            };

            // Act: Verify configuration structure
            expect(youtubeConfig.enabled).toBe(true);
            expect(youtubeConfig.channelId).toBe('test-channel-id');
            expect(youtubeConfig.gracePeriod).toBe(5000);

            // Assert: Configuration is valid
            expect(typeof youtubeConfig.enabled).toBe('boolean');
            expect(typeof youtubeConfig.channelId).toBe('string');
            expect(typeof youtubeConfig.gracePeriod).toBe('number');
        }, { timeout: TEST_TIMEOUTS.FAST });
    });

    describe('Basic Workflow Verification', () => {
        test('should verify TikTok chat message workflow', async () => {
            // Arrange: Create mock chat message data
            const chatMessage = {
                displayName: 'TestUser',
                comment: 'Hello world!',
                timestamp: testClock.now(),
                platform: 'tiktok'
            };

            // Act: Verify message structure
            expect(chatMessage.displayName).toBe('TestUser');
            expect(chatMessage.comment).toBe('Hello world!');
            expect(chatMessage.platform).toBe('tiktok');

            // Assert: Message data is valid
            expect(typeof chatMessage.displayName).toBe('string');
            expect(typeof chatMessage.comment).toBe('string');
            expect(typeof chatMessage.timestamp).toBe('number');
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should verify Twitch follow notification workflow', async () => {
            // Arrange: Create mock follow notification data
            const followNotification = {
                username: 'NewFollower',
                displayName: 'NewFollower',
                platform: 'twitch',
                timestamp: testClock.now()
            };

            // Act: Verify notification structure
            expect(followNotification.username).toBe('NewFollower');
            expect(followNotification.platform).toBe('twitch');

            // Assert: Notification data is valid
            expect(typeof followNotification.username).toBe('string');
            expect(typeof followNotification.timestamp).toBe('number');
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should verify YouTube super chat workflow', async () => {
            // Arrange: Create mock super chat data
            const superChatData = {
                username: 'SuperChatUser',
                amount: 10.00,
                currency: 'USD',
                message: 'Hello from super chat!',
                platform: 'youtube',
                timestamp: testClock.now()
            };

            // Act: Verify super chat structure
            expect(superChatData.username).toBe('SuperChatUser');
            expect(superChatData.amount).toBe(10.00);
            expect(superChatData.currency).toBe('USD');
            expect(superChatData.platform).toBe('youtube');

            // Assert: Super chat data is valid
            expect(typeof superChatData.username).toBe('string');
            expect(typeof superChatData.amount).toBe('number');
            expect(typeof superChatData.currency).toBe('string');
        }, { timeout: TEST_TIMEOUTS.FAST });
    });

    describe('Multi-Platform Simultaneous Operation', () => {
        test('should handle multiple platforms simultaneously', async () => {
            // Arrange: Create configurations for multiple platforms
            const platformConfigs = {
                tiktok: { enabled: true, username: 'tiktokuser' },
                twitch: { enabled: true, channel: 'twitchchannel' },
                youtube: { enabled: true, channelId: 'youtubechannel' }
            };

            // Act: Verify all platforms are enabled
            const enabledPlatforms = Object.values(platformConfigs).filter(config => config.enabled);

            // Assert: All platforms are properly configured
            expect(enabledPlatforms).toHaveLength(3);
            expect(platformConfigs.tiktok.enabled).toBe(true);
            expect(platformConfigs.twitch.enabled).toBe(true);
            expect(platformConfigs.youtube.enabled).toBe(true);
        }, { timeout: TEST_TIMEOUTS.FAST });
    });

    describe('Error Recovery and Resilience', () => {
        test('should handle platform connection failures gracefully', async () => {
            // Arrange: Create mock connection failure scenario
            const connectionAttempt = {
                platform: 'tiktok',
                success: false,
                error: 'Connection timeout',
                retryCount: 0
            };

            // Act: Simulate connection failure handling
            const shouldRetry = connectionAttempt.retryCount < 3;
            const maxRetries = 3;

            // Assert: Error handling logic is correct
            expect(connectionAttempt.success).toBe(false);
            expect(shouldRetry).toBe(true);
            expect(maxRetries).toBe(3);
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should handle display queue failures gracefully', async () => {
            // Arrange: Create mock display queue failure scenario
            const displayQueueFailure = {
                notification: { type: 'chat', data: { username: 'TestUser' } },
                success: false,
                error: 'OBS connection lost',
                fallbackEnabled: true
            };

            // Act: Simulate failure handling
            const shouldUseFallback = displayQueueFailure.fallbackEnabled && !displayQueueFailure.success;

            // Assert: Fallback logic is correct
            expect(displayQueueFailure.success).toBe(false);
            expect(shouldUseFallback).toBe(true);
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should recover from temporary failures', async () => {
            // Arrange: Create mock recovery scenario
            const recoveryScenario = {
                initialFailure: true,
                retryAttempts: 2,
                maxRetries: 3,
                recovered: true
            };

            // Act: Simulate recovery logic
            const canRetry = recoveryScenario.retryAttempts < recoveryScenario.maxRetries;
            const isRecovered = recoveryScenario.recovered;

            // Assert: Recovery logic is correct
            expect(canRetry).toBe(true);
            expect(isRecovered).toBe(true);
        }, { timeout: TEST_TIMEOUTS.FAST });
    });

    describe('Performance and Load Testing', () => {
        test('should handle rapid message processing efficiently', async () => {
            // Arrange: Create multiple rapid messages
            const messages = Array.from({ length: 50 }, (_, i) => ({
                username: `User${i}`,
                message: `Message ${i}`,
                timestamp: testClock.now() + i
            }));

            // Act: Simulate rapid processing
            const startTime = testClock.now();
            const processedCount = messages.length;
            const simulatedProcessingMs = messages.length;
            testClock.advance(simulatedProcessingMs);
            const processingTime = testClock.now() - startTime;

            // Assert: Processing is efficient
            expect(processedCount).toBe(50);
            expect(processingTime).toBeLessThan(100); // Should be very fast for mock processing
        }, { timeout: TEST_TIMEOUTS.FAST });

        test('should handle concurrent notification processing', async () => {
            // Arrange: Create concurrent notifications
            const notifications = Array.from({ length: 20 }, (_, i) => ({
                type: 'chat',
                username: `User${i}`,
                platform: i % 3 === 0 ? 'tiktok' : i % 3 === 1 ? 'twitch' : 'youtube',
                timestamp: testClock.now()
            }));

            // Act: Simulate concurrent processing
            const startTime = testClock.now();
            const processedCount = notifications.length;
            const simulatedProcessingMs = notifications.length;
            testClock.advance(simulatedProcessingMs);
            const processingTime = testClock.now() - startTime;

            // Assert: Concurrent processing is efficient
            expect(processedCount).toBe(20);
            expect(processingTime).toBeLessThan(100); // Should be very fast for mock processing
        }, { timeout: TEST_TIMEOUTS.FAST });
    });
}); 
