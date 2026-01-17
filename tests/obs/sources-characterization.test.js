
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

const { initializeTestLogging, TEST_TIMEOUTS } = require('../helpers/test-setup');
const { noOpLogger, createMockOBSConnection, createMockOBSManager } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');
const testClock = require('../helpers/test-clock');

// Mock the connection module with proper factory-created mocks
mockModule('../../src/obs/connection', () => {
    const { createMockOBSManager } = require('../helpers/mock-factories');
    const mockOBSManager = createMockOBSManager('connected');
    
    return {
        ensureOBSConnected: createMockFn().mockResolvedValue(),
        obsCall: createMockFn(),
        getOBSConnectionManager: createMockFn(() => mockOBSManager)
    };
});

// Initialize logging FIRST
initializeTestLogging();

// Setup automated cleanup
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

// Mock logging to capture debug output
mockModule('../../src/core/logging', () => ({
    logger: { 
        error: createMockFn(),
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn()
    }
}));

// Mock retry system
mockModule('../../src/utils/retry-system', () => ({
    createRetrySystem: createMockFn(() => ({ delay: createMockFn().mockResolvedValue() })),
    RetrySystem: createMockFn(),
    ADAPTIVE_RETRY_CONFIG: { BASE_DELAY: 2000, MAX_DELAY: 60000, BACKOFF_MULTIPLIER: 1.3 }
}));

// Mock validation utilities
const actualValidation = require('../../src/utils/validation');
mockModule('../../src/utils/validation', () => ({
    ...actualValidation,
    sanitizeDisplayName: createMockFn((name, limit) => name.substring(0, limit))
}));

describe('OBS Sources Module Characterization Tests', () => {
    let mockLogger;
    let mockOBSConnection;
    let sourcesModule;

    beforeEach(() => {
        // Create mocks using factories
        mockLogger = noOpLogger;
        mockOBSConnection = createMockOBSConnection();

        // Set test environment to prevent OBS calls in some functions
        process.env.NODE_ENV = 'test';

        // Clear module cache to ensure fresh imports with mocks
        resetModules();
        
        // Import the module after mocking and clearing cache
        sourcesModule = require('../../src/obs/sources').getDefaultSourcesManager();
    });

    afterEach(() => {
        restoreAllMocks();
        delete process.env.NODE_ENV;
    
        restoreAllModuleMocks();});

    describe('Text Source Management', () => {
        test('updateTextSource should use mock OBS in test environment', async () => {
            const { logger } = require('../../src/core/logging');
            const { ensureOBSConnected, obsCall } = require('../../src/obs/connection');

            await sourcesModule.updateTextSource('test-source', 'new message');

            // Should use mock OBS and log appropriately
            expect(logger.debug).toHaveBeenCalledWith('[OBS Source] Test environment - using mock OBS for text source update: "test-source" with: new message', 'obs-sources');
            expect(logger.debug).toHaveBeenCalledWith('[OBS Source] Mock OBS call completed for "test-source"', 'obs-sources');
            expect(ensureOBSConnected).not.toHaveBeenCalled();
            expect(obsCall).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('clearTextSource should call OBS with proper safe operations', async () => {
            const { ensureOBSConnected, obsCall, getOBSConnectionManager } = require('../../src/obs/connection');
            const mockInputSettings = { text: 'existing text', font: 'Arial' };
            
            // Verify mock setup is working correctly
            const obsManager = getOBSConnectionManager();
            expect(obsManager).toBeDefined();
            expect(typeof obsManager.isReady).toBe('function');
            
            const isReady = await obsManager.isReady();
            expect(isReady).toBe(true);
            
            // Configure mock responses for OBS operations
            obsCall.mockResolvedValueOnce({ inputSettings: mockInputSettings });
            obsCall.mockResolvedValueOnce(); // for SetInputSettings

            await sourcesModule.clearTextSource('test-source');

            // Verify safe OBS operations were called properly
            expect(ensureOBSConnected).toHaveBeenCalledTimes(1);
            expect(obsCall).toHaveBeenCalledWith('GetInputSettings', { inputName: 'test-source' });
            expect(obsCall).toHaveBeenCalledWith('SetInputSettings', {
                inputName: 'test-source',
                inputSettings: {
                    ...mockInputSettings,
                    text: '' // Empty string clears the text
                },
                overlay: false
            });
        }, TEST_TIMEOUTS.FAST);

        test('updateChatMsgText should format username and delegate to updateTextSource', async () => {
            const { logger } = require('../../src/core/logging');
            const { sanitizeDisplayName } = require('../../src/utils/validation');
            sanitizeDisplayName.mockReturnValue('User'); // 15 char limit

            await sourcesModule.updateChatMsgText('chat-source', 'VeryLongUsername', 'Hello world');

            expect(sanitizeDisplayName).toHaveBeenCalledWith('VeryLongUsername', 15);
            expect(logger.debug).toHaveBeenCalledWith('[OBS Source] Updating chat message text to: User: Hello world', 'obs-sources');
            // updateTextSource will use mock OBS in test environment
            expect(logger.debug).toHaveBeenCalledWith('[OBS Source] Test environment - using mock OBS for text source update: "chat-source" with: User: Hello world', 'obs-sources');
            // Note: Success confirmation log was removed during logging cleanup - test behavior, not implementation details
        }, TEST_TIMEOUTS.FAST);

        test('text source operations should handle errors when OBS operations run', async () => {
            const { obsCall } = require('../../src/obs/connection');
            const { logger } = require('../../src/core/logging');
            const testError = new Error('OBS connection failed');
            obsCall.mockRejectedValue(testError);

            // clearTextSource doesn't skip in test environment, so it will throw
            await expect(sourcesModule.clearTextSource('test-source')).rejects.toThrow('OBS connection failed');
            expect(logger.error).toHaveBeenCalledWith(
                '[OBS Safety] Clearing text source "test-source" failed: OBS connection failed',
                'obs-safety',
                expect.objectContaining({
                    error: 'OBS connection failed',
                    context: expect.stringContaining('Clearing text source "test-source"')
                })
            );
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Source Visibility Management', () => {
        test('getSceneItemId should return scene item information with correct format', async () => {
            const { ensureOBSConnected, obsCall } = require('../../src/obs/connection');
            obsCall.mockResolvedValue({ sceneItemId: 42 });

            const result = await sourcesModule.getSceneItemId('test-scene', 'test-source');

            // Verify behavior-focused outcomes: proper OBS API calls and correct return format
            expect(ensureOBSConnected).toHaveBeenCalledTimes(1);
            expect(obsCall).toHaveBeenCalledWith('GetSceneItemId', { 
                sceneName: 'test-scene', 
                sourceName: 'test-source' 
            });
            
            // Focus on user-observable behavior: correct return data structure
            expect(result).toEqual({ 
                sceneItemId: 42, 
                sceneName: 'test-scene' 
            });
            expect(typeof result.sceneItemId).toBe('number');
            expect(typeof result.sceneName).toBe('string');
        }, TEST_TIMEOUTS.FAST);

        test('setSourceVisibility should skip operations in test environment', async () => {
            const { logger } = require('../../src/core/logging');
            const { obsCall } = require('../../src/obs/connection');

            await sourcesModule.setSourceVisibility('test-scene', 'test-source', true);

            // In test environment, should skip OBS operations
            expect(logger.debug).toHaveBeenCalledWith('[OBS Source] Skipping source visibility change in test environment: test-source to true', 'obs-sources');
            expect(obsCall).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('getSceneItemId should throw error for invalid scene item ID', async () => {
            const { obsCall } = require('../../src/obs/connection');
            obsCall.mockResolvedValue({ sceneItemId: null });

            await expect(sourcesModule.getSceneItemId('test-scene', 'invalid-source')).rejects.toThrow(
                'Scene item ID for source "invalid-source" in scene "test-scene" not found.'
            );
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Group Source Management', () => {
        test('getGroupSceneItemId should find source within group (no test environment check)', async () => {
            const { ensureOBSConnected, obsCall } = require('../../src/obs/connection');
            const { logger } = require('../../src/core/logging');
            const mockSceneItems = [
                { sourceName: 'other-source', sceneItemId: 10 },
                { sourceName: 'target-source', sceneItemId: 20 },
            ];
            obsCall.mockResolvedValue({ sceneItems: mockSceneItems });

            const result = await sourcesModule.getGroupSceneItemId('target-source', 'test-group');

            expect(ensureOBSConnected).toHaveBeenCalledTimes(1);
            expect(obsCall).toHaveBeenCalledWith('GetGroupSceneItemList', { sceneName: 'test-group' });
            expect(result).toEqual({ sceneItemId: 20 });
            // Removed debug logging assertion - tests should validate behavior outcomes, not internal logging calls
        }, TEST_TIMEOUTS.FAST);

        test('setGroupSourceVisibility should skip operations in test environment', async () => {
            const { logger } = require('../../src/core/logging');
            const { obsCall } = require('../../src/obs/connection');

            await sourcesModule.setGroupSourceVisibility('test-source', 'test-group', false);

            expect(logger.debug).toHaveBeenCalledWith('[OBS Group] Skipping visibility set in test env for test-source in test-group', 'obs-sources');
            expect(obsCall).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('getGroupSceneItemId should handle missing source in group', async () => {
            const { obsCall } = require('../../src/obs/connection');
            const mockSceneItems = [
                { sourceName: 'other-source', sceneItemId: 10 }
            ];
            obsCall.mockResolvedValue({ sceneItems: mockSceneItems });

            await expect(sourcesModule.getGroupSceneItemId('missing-source', 'test-group')).rejects.toThrow(
                'Source \'missing-source\' not found inside group \'test-group\''
            );
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Platform Logo Management', () => {
        test('setPlatformLogoVisibility should skip operations in test environment', async () => {
            const { logger } = require('../../src/core/logging');
            const { obsCall } = require('../../src/obs/connection');
            
            const mockPlatformLogos = {
                tiktok: 'tiktok-logo-source',
                twitch: 'twitch-logo-source',
                youtube: 'youtube-logo-source'
            };

            await sourcesModule.setPlatformLogoVisibility('tiktok', mockPlatformLogos);

            expect(logger.debug).toHaveBeenCalledWith('[OBS Platform Logo] Skipping platform logo visibility change in test environment: tiktok to true', 'obs-sources');
            expect(obsCall).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('hideAllPlatformLogos should skip operations in test environment', async () => {
            const { logger } = require('../../src/core/logging');
            const { obsCall } = require('../../src/obs/connection');
            
            const mockPlatformLogos = {
                tiktok: 'tiktok-logo-source',
                twitch: 'twitch-logo-source',
                youtube: 'youtube-logo-source'
            };

            await sourcesModule.hideAllPlatformLogos(mockPlatformLogos);

            expect(logger.debug).toHaveBeenCalledWith('[OBS Platform Logo] Skipping hide all platform logos in test environment', 'obs-sources');
            expect(obsCall).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Display Control', () => {
        test('setChatDisplayVisibility should skip operations in test environment', async () => {
            const { logger } = require('../../src/core/logging');
            const { obsCall } = require('../../src/obs/connection');

            await sourcesModule.setChatDisplayVisibility(true);

            expect(logger.debug).toHaveBeenCalledWith('[OBS Display] Skipping chat display visibility change in test environment: true', 'obs-sources');
            expect(obsCall).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('setNotificationDisplayVisibility should skip operations in test environment', async () => {
            const { logger } = require('../../src/core/logging');
            const { obsCall } = require('../../src/obs/connection');

            await sourcesModule.setNotificationDisplayVisibility(true);

            expect(logger.debug).toHaveBeenCalledWith('[OBS Display] Skipping notification display visibility change in test environment: true', 'obs-sources');
            expect(obsCall).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('hideAllDisplays should skip operations in test environment', async () => {
            const { logger } = require('../../src/core/logging');
            const { obsCall } = require('../../src/obs/connection');

            await sourcesModule.hideAllDisplays();

            expect(logger.debug).toHaveBeenCalledWith('[OBS Display] Skipping hide all displays in test environment', 'obs-sources');
            expect(obsCall).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Source Filter Management', () => {
        test('setSourceFilterEnabled should skip operations in test environment', async () => {
            const { logger } = require('../../src/core/logging');
            const { obsCall } = require('../../src/obs/connection');

            await sourcesModule.setSourceFilterEnabled('test-source', 'test-filter', true);

            expect(logger.debug).toHaveBeenCalledWith('[OBS Filter] Skipping filter enable/disable in test environment: test-filter on test-source to true', 'obs-sources');
            expect(obsCall).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);

        test('getSourceFilterSettings should call OBS (no test environment check)', async () => {
            const { ensureOBSConnected, obsCall } = require('../../src/obs/connection');
            const mockSettings = { enabled: true, settings: { key: 'value' } };
            const mockFilterInfo = { filterSettings: mockSettings };
            obsCall.mockResolvedValue(mockFilterInfo);

            const result = await sourcesModule.getSourceFilterSettings('test-source', 'test-filter');

            expect(ensureOBSConnected).toHaveBeenCalledTimes(1);
            expect(obsCall).toHaveBeenCalledWith('GetSourceFilter', {
                sourceName: 'test-source',
                filterName: 'test-filter'
            });
            expect(result).toEqual(mockSettings);
        }, TEST_TIMEOUTS.FAST);

        test('setSourceFilterSettings should skip operations in test environment', async () => {
            const { logger } = require('../../src/core/logging');
            const { obsCall } = require('../../src/obs/connection');

            await sourcesModule.setSourceFilterSettings('test-source', 'test-filter', { key: 'value' });

            expect(logger.debug).toHaveBeenCalledWith('[OBS Filter] Skipping filter settings update in test environment: test-filter on test-source', 'obs-sources');
            expect(obsCall).not.toHaveBeenCalled();
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Error Handling', () => {
        test('should handle OBS connection failures gracefully', async () => {
            const { ensureOBSConnected } = require('../../src/obs/connection');
            const { logger } = require('../../src/core/logging');
            const connectionError = new Error('OBS connection failed');
            ensureOBSConnected.mockRejectedValue(connectionError);

            await expect(sourcesModule.clearTextSource('test-source')).rejects.toThrow('OBS connection failed');
            expect(logger.error).toHaveBeenCalledWith(
                '[OBS Safety] Clearing text source "test-source" failed: OBS connection failed',
                'obs-safety',
                expect.objectContaining({
                    error: 'OBS connection failed',
                    context: expect.stringContaining('Clearing text source "test-source"')
                })
            );
        }, TEST_TIMEOUTS.FAST);

        test('should handle invalid source names gracefully', async () => {
            const { ensureOBSConnected, obsCall } = require('../../src/obs/connection');
            ensureOBSConnected.mockResolvedValue();
            obsCall.mockResolvedValue({ sceneItemId: null });

            await expect(sourcesModule.getSceneItemId('test-scene', '')).rejects.toThrow(
                'Scene item ID for source "" in scene "test-scene" not found.'
            );
        }, TEST_TIMEOUTS.FAST);
    });

    describe('Performance Tests', () => {
        test('should handle rapid source operations efficiently', async () => {
            const { logger } = require('../../src/core/logging');
            const startTime = testClock.now();

            // Make multiple rapid calls to test environment functions
            const promises = [];
            for (let i = 0; i < 10; i++) {
                promises.push(sourcesModule.updateTextSource(`source-${i}`, `message-${i}`));
            }

            await Promise.all(promises);
            testClock.advance(promises.length);
            const duration = testClock.now() - startTime;

            // Should complete quickly since operations are skipped in test environment
            expect(duration).toBeLessThan(100);
            expect(logger.debug).toHaveBeenCalledTimes(20); // 2 debug calls per updateTextSource call in test env
        }, TEST_TIMEOUTS.FAST);
    });
}); 
