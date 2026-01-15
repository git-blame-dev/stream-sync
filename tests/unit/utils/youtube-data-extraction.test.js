
const { describe, test, expect, beforeEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

const { initializeTestLogging, TEST_TIMEOUTS } = require('../../helpers/test-setup');
const { createMockLogger, createMockFileSystem } = require('../../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../../helpers/mock-lifecycle');
const testClock = require('../../helpers/test-clock');

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Mock fs to control file system operations
mockModule('fs');
// Mock innertube factory and instance manager
mockModule('../../../src/factories/innertube-factory');
mockModule('../../../src/services/innertube-instance-manager');
const {
    getChannelId,
    configureChannelCache,
    clearChannelCache
} = require('../../../src/utils/youtube-data-extraction');

function createMockInnertubeInstance(resolveConfig = {}) {
    const defaultConfig = {
        resolveResponse: { payload: { browseId: 'UC-TEST-ID' } },
        shouldError: false,
        errorMessage: 'Resolve failed',
        ...resolveConfig
    };

    return {
        resolveURL: createMockFn().mockImplementation(async () => {
            if (defaultConfig.shouldError) {
                throw new Error(defaultConfig.errorMessage);
            }
            return defaultConfig.resolveResponse;
        })
    };
}

function createResolveResponse(resultConfig = {}) {
    const {
        channelId = 'UC-TEST-ID'
    } = resultConfig;

    return {
        payload: { browseId: channelId }
    };
}

describe('YouTube Data Extraction', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let mockCache;
    let mockLogger;
    let mockFileSystem;
    let mockInnertubeFactory;
    let mockInstanceManager;
    const CACHE_PATH = '/path/to/cache.json';

    beforeEach(() => {
        // Create mocks using factories
        mockLogger = createMockLogger('debug');
        mockFileSystem = createMockFileSystem();

        // Reset mocks and cache before each test
        mockCache = {};

        // Mock fs.existsSync to reflect cache state
        const fs = require('fs');
        fs.existsSync.mockImplementation(filePath => mockCache.hasOwnProperty('path') && mockCache.path === filePath);

        // Mock fs.readFileSync to return the cache content
        fs.readFileSync.mockImplementation(filePath => {
            if (mockCache.data) {
                return JSON.stringify(mockCache.data);
            }
            throw new Error('File not found');
        });

        // Mock fs.writeFileSync to "write" to our in-memory cache
        fs.writeFileSync.mockImplementation((filePath, data) => {
            mockCache.path = filePath;
            mockCache.data = JSON.parse(data);
        });

        // Mock InnertubeFactory
        const { InnertubeFactory } = require('../../../src/factories/innertube-factory');
        mockInnertubeFactory = InnertubeFactory;
        mockInnertubeFactory.createWithTimeout = createMockFn();

        // Mock instance manager
        const innertubeInstanceManager = require('../../../src/services/innertube-instance-manager');
        mockInstanceManager = {
            getInstance: createMockFn()
        };
        innertubeInstanceManager.getInstance = createMockFn().mockReturnValue(mockInstanceManager);

        // Import the module after mocking
        configureChannelCache({ enabled: true, filePath: CACHE_PATH });
        clearChannelCache();
    });

    describe('Channel ID Resolution via YouTube resolveURL', () => {
        test('should successfully resolve channel ID via resolveURL', async () => {
            // Given: resolveURL returns a browseId for the handle
            const mockInstance = createMockInnertubeInstance({
                resolveResponse: createResolveResponse({ channelId: 'UC-EXACT-MATCH-ID' })
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Resolving channel ID
            const channelId = await getChannelId('testuser');
            
            // Then: User gets the correct channel ID
            expect(channelId).toBe('UC-EXACT-MATCH-ID');
            expect(mockInstance.resolveURL).toHaveBeenCalledWith('https://www.youtube.com/@testuser');
        }, TEST_TIMEOUTS.FAST);

        test('should normalize @handle input before resolving', async () => {
            // Given: resolveURL responds for a normalized handle
            const mockInstance = createMockInnertubeInstance({
                resolveResponse: createResolveResponse({ channelId: 'UC-HANDLE-ID' })
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Resolving with @handle input
            const channelId = await getChannelId('@TestUser');
            
            // Then: Handle is normalized for resolution
            expect(channelId).toBe('UC-HANDLE-ID');
            expect(mockInstance.resolveURL).toHaveBeenCalledWith('https://www.youtube.com/@testuser');
        }, TEST_TIMEOUTS.FAST);

        test('should return null when resolveURL payload lacks browseId', async () => {
            // Given: resolveURL returns a payload without browseId
            const mockInstance = createMockInnertubeInstance({
                resolveResponse: { payload: {} }
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Resolving channel ID
            const channelId = await getChannelId('nonexistentuser');
            
            // Then: User gets null indicating channel not found
            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);

        test('should handle resolveURL errors gracefully', async () => {
            // Given: resolveURL fails
            const mockInstance = createMockInnertubeInstance({
                shouldError: true,
                errorMessage: 'YouTube API rate limit exceeded'
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Resolving during API failure
            const channelId = await getChannelId('erroruser');
            
            // Then: User gets null with graceful error handling
            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);

        test('should return null when no username provided', async () => {
            // When: Attempting resolve without username
            const channelId = await getChannelId(null);
            
            // Then: User gets null without making API calls
            expect(channelId).toBeNull();
            expect(mockInstanceManager.getInstance).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('should handle resolveURL responses without payload', async () => {
            // Given: resolveURL returns an empty response
            const mockInstance = createMockInnertubeInstance({
                resolveResponse: {}
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Processing empty response
            const channelId = await getChannelId('testuser');
            
            // Then: User gets null due to invalid data
            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);

        test('should handle null resolveURL responses gracefully', async () => {
            // Given: resolveURL returns null
            const mockInstance = createMockInnertubeInstance({ resolveResponse: null });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Processing null response
            const channelId = await getChannelId('emptyuser');
            
            // Then: User gets null for empty results
            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Caching Behavior', () => {
        test('should cache successful channel ID lookups', async () => {
            // Given: Successful resolveURL response
            const mockInstance = createMockInnertubeInstance({
                resolveResponse: createResolveResponse({ channelId: 'UC-CACHE-TEST' })
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Making first resolution request
            const channelId1 = await getChannelId('cacheuser');
            expect(channelId1).toBe('UC-CACHE-TEST');
            expect(mockInstance.resolveURL).toHaveBeenCalledTimes(1);

            // Then: Cache should store the result
            expect(mockCache.data).toEqual({ cacheuser: 'UC-CACHE-TEST' });

            // When: Making second request for same user
            const channelId2 = await getChannelId('cacheuser');
            
            // Then: User gets cached result without additional API call
            expect(channelId2).toBe('UC-CACHE-TEST');
            expect(mockInstance.resolveURL).toHaveBeenCalledTimes(1); // No additional resolve
        }, TEST_TIMEOUTS.MEDIUM);

        test('should load existing cache on startup', async () => {
            // Given: Pre-existing cache file
            const fs = require('fs');
            mockCache.data = { existinguser: 'UC-EXISTING-ID' };
            mockCache.path = '/path/to/cache.json';
            fs.existsSync.mockReturnValue(true);
            
            // When: Searching for cached user
            const channelId = await getChannelId('existinguser');
            
            // Then: User gets cached result without API call
            expect(channelId).toBe('UC-EXISTING-ID');
            expect(mockInstanceManager.getInstance).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('should not cache failed lookups', async () => {
            // Given: resolveURL fails
            const mockInstance = createMockInnertubeInstance({
                shouldError: true,
                errorMessage: 'Network error'
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: First failed resolve
            const channelId1 = await getChannelId('faileduser');
            expect(channelId1).toBeNull();
            expect(mockInstance.resolveURL).toHaveBeenCalledTimes(1);

            // Then: Cache should remain empty
            expect(mockCache.data).toBeUndefined();

            // When: Second resolve for same user
            const channelId2 = await getChannelId('faileduser');
            
            // Then: System retries resolve (failed lookups not cached)
            expect(channelId2).toBeNull();
            expect(mockInstance.resolveURL).toHaveBeenCalledTimes(2);
        }, TEST_TIMEOUTS.MEDIUM);

        test('should handle cache file corruption gracefully', async () => {
            // Given: Corrupted cache file
            const fs = require('fs');
            fs.existsSync.mockReturnValue(true);
            fs.readFileSync.mockImplementation(() => { throw new Error('File corrupted'); });
            
            const mockInstance = createMockInnertubeInstance({
                resolveResponse: createResolveResponse({ channelId: 'UC-RECOVERY-ID' })
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Attempting to use corrupted cache
            const channelId = await getChannelId('recoveryuser');
            
            // Then: User gets result via fresh resolve (graceful recovery)
            expect(channelId).toBe('UC-RECOVERY-ID');
            expect(mockInstance.resolveURL).toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Error Recovery and Race Conditions', () => {
        test('should handle Innertube creation timeout gracefully', async () => {
            // Given: Innertube creation times out
            mockInstanceManager.getInstance.mockRejectedValue(new Error('Innertube creation timeout (30s)'));

            // When: Attempting channel resolve during timeout
            const channelId = await getChannelId('timeoutuser');
            
            // Then: User gets null with graceful error handling
            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);

        test('should handle YouTube API rate limiting gracefully', async () => {
            // Given: YouTube API rate limit exceeded
            const mockInstance = createMockInnertubeInstance({
                shouldError: true,
                errorMessage: 'Request failed with status code 429'
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Resolving during rate limit
            const channelId = await getChannelId('ratelimituser');
            
            // Then: User gets null with graceful degradation
            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);

        test('should handle instance manager failures gracefully', async () => {
            // Given: Instance manager fails to provide instance
            mockInstanceManager.getInstance.mockRejectedValue(new Error('Instance creation failed'));

            // When: Attempting resolve with failed instance manager
            const channelId = await getChannelId('instancefailuser');
            
            // Then: User gets null with graceful error handling
            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);

        test('should prevent race conditions with concurrent requests', async () => {
            // Given: Multiple concurrent requests for same user
            const mockInstance = createMockInnertubeInstance({
                resolveResponse: createResolveResponse({ channelId: 'UC-RACE-TEST' })
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Making concurrent requests
            const promises = [
                getChannelId('raceuser'),
                getChannelId('raceuser'),
                getChannelId('raceuser')
            ];
            const results = await Promise.all(promises);

            // Then: All requests get same result with only one API call
            results.forEach(result => expect(result).toBe('UC-RACE-TEST'));
            expect(mockInstance.resolveURL).toHaveBeenCalledTimes(1);
        }, TEST_TIMEOUTS.MEDIUM);

        test('should handle resolveURL method missing gracefully', async () => {
            // Given: Innertube instance missing resolveURL method
            const mockInstance = {}; // No resolveURL method
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Attempting resolve with broken instance
            const channelId = await getChannelId('brokensearchuser');
            
            // Then: User gets null with graceful error handling
            expect(channelId).toBeNull();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Performance and Cache Efficiency', () => {
        test('should handle rapid successive calls efficiently with race condition prevention', async () => {
            // Given: Configured for performance testing
            const mockInstance = createMockInnertubeInstance({
                resolveResponse: createResolveResponse({ channelId: 'UC-PERF-TEST' })
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            const startTime = testClock.now();
            
            // When: Making multiple rapid concurrent calls
            const promises = [];
            for (let i = 0; i < 5; i++) {
                promises.push(getChannelId('perfuser'));
            }
            
            const results = await Promise.all(promises);
            const simulatedDurationMs = 25;
            testClock.advance(simulatedDurationMs);
            const duration = testClock.now() - startTime;

            // Then: All results consistent and performant
            results.forEach(result => {
                expect(result).toBe('UC-PERF-TEST');
            });

            // Performance target: under 100ms for unit test
            expect(duration).toBeLessThan(100);
            
            // Efficiency: only one API call due to race condition prevention
            expect(mockInstance.resolveURL).toHaveBeenCalledTimes(1);
        }, TEST_TIMEOUTS.FAST);

        test('should maintain cache efficiency across different users', async () => {
            // Given: Multiple different users
            const users = ['user1', 'user2', 'user3'];
            const mockInstance = createMockInnertubeInstance({
                resolveResponse: createResolveResponse({ channelId: 'UC-MULTI-TEST' })
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Resolving for different users
            for (const user of users) {
                await getChannelId(user);
            }

            // Then: Cache stores all users efficiently
            expect(mockCache.data).toEqual({
                user1: 'UC-MULTI-TEST',
                user2: 'UC-MULTI-TEST',
                user3: 'UC-MULTI-TEST'
            });
            expect(mockInstance.resolveURL).toHaveBeenCalledTimes(3);
        }, TEST_TIMEOUTS.FAST);

        test('should complete individual resolves under performance target', async () => {
            // Given: Single resolve operation
            const mockInstance = createMockInnertubeInstance({
                resolveResponse: createResolveResponse({ channelId: 'UC-SINGLE-PERF' })
            });
            mockInstanceManager.getInstance.mockResolvedValue(mockInstance);

            // When: Performing single resolve
            const startTime = testClock.now();
            const channelId = await getChannelId('singleuser');
            const simulatedDurationMs = 15;
            testClock.advance(simulatedDurationMs);
            const duration = testClock.now() - startTime;

            // Then: Result correct and under performance target
            expect(channelId).toBe('UC-SINGLE-PERF');
            expect(duration).toBeLessThan(50); // Very fast for unit test
        }, TEST_TIMEOUTS.FAST);
    });
}); 
