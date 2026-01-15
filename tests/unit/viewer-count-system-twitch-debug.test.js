
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, spyOn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { mockModule, resetModules, restoreAllModuleMocks } = require('../helpers/bun-module-mocks');

const { VIEWER_COUNT_CONSTANTS } = require('../../src/core/constants');
const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');

describe('Twitch Viewer Count System Debug', () => {
    let logger;
    let runtimeConstants;
    let ViewerCountSystem, mockPlatforms, mockTwitchPlatform, mockObsManager;
    let mockTextProcessing;
    const createViewerSystem = () => {
        return new ViewerCountSystem({ platforms: mockPlatforms, logger, runtimeConstants });
    };

    beforeEach(() => {
        // Mock logger
        logger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };
        
        runtimeConstants = createRuntimeConstantsFixture({
            VIEWER_COUNT_POLLING_INTERVAL_SECONDS: 30
        });

        // Mock OBS manager
        mockObsManager = {
            isConnected: createMockFn(() => true),
            call: createMockFn().mockResolvedValue({})
        };

        // Mock Twitch platform with getViewerCount method
        mockTwitchPlatform = {
            getViewerCount: createMockFn().mockResolvedValue(42)
        };

        // Platform map used by ViewerCountSystem
        mockPlatforms = {
            twitch: mockTwitchPlatform,
            youtube: { getViewerCount: createMockFn().mockResolvedValue(100) },
            tiktok: { getViewerCount: createMockFn().mockResolvedValue(25) }
        };

        mockTextProcessing = {
            formatViewerCount: createMockFn((count) => count.toString())
        };

        mockModule('../../src/utils/text-processing', () => ({
            createTextProcessingManager: createMockFn(() => mockTextProcessing),
            TextProcessingManager: createMockFn(),
            formatTimestampCompact: createMockFn()
        }));
        
        const { ViewerCountSystem: VCS } = require('../../src/utils/viewer-count');
        ViewerCountSystem = VCS;
    });

    afterEach(() => {
        restoreAllMocks();
        clearAllMocks();
restoreAllModuleMocks();});

    test('should initialize ViewerCountSystem with Twitch set to always live', () => {
        // Act
        const viewerSystem = createViewerSystem();

        // Assert
        expect(viewerSystem.streamStatus.twitch).toBe(true);
        expect(viewerSystem.streamStatus.youtube).toBe(false);
        expect(viewerSystem.streamStatus.tiktok).toBe(false);
        expect(viewerSystem.counts.twitch).toBe(0);
    });

    test('should start polling immediately for Twitch since it is always live', async () => {
        // Arrange
        const viewerSystem = createViewerSystem();
        
        // Spy on startPlatformPolling to verify it's called for Twitch
        const startPlatformPollingSpy = spyOn(viewerSystem, 'startPlatformPolling');
        const pollPlatformSpy = spyOn(viewerSystem, 'pollPlatform');

        // Act
        viewerSystem.startPolling();

        // Assert - Twitch should start polling immediately because streamStatus.twitch = true
        expect(startPlatformPollingSpy).toHaveBeenCalledWith('twitch');
        
        // Verify immediate poll was called
        expect(pollPlatformSpy).toHaveBeenCalledWith('twitch');
    });

    test('should fetch Twitch viewer count when polling', async () => {
        // Arrange
        const viewerSystem = createViewerSystem();
        
        // Create a mock observer to verify notifications
        const mockObserver = {
            getObserverId: createMockFn().mockReturnValue('test-observer'),
            onViewerCountUpdate: createMockFn().mockResolvedValue()
        };
        viewerSystem.addObserver(mockObserver);

        // Act
        await viewerSystem.pollPlatform('twitch');

        // Assert
        expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalled();
        expect(viewerSystem.counts.twitch).toBe(42);
        
        // Verify observer was notified
        expect(mockObserver.onViewerCountUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                platform: 'twitch',
                count: 42,
                previousCount: 0
            })
        );
    });

    test('should handle Twitch API errors gracefully', async () => {
        // Arrange
        const viewerSystem = createViewerSystem();
        
        const apiError = new Error('Twitch API rate limit exceeded');
        mockTwitchPlatform.getViewerCount.mockRejectedValue(apiError);

        // Act
        await viewerSystem.pollPlatform('twitch');

        // Assert - should not crash and should log error
        expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalled();
        expect(viewerSystem.counts.twitch).toBe(0); // Should remain 0 on error
        expect(logger.error).toHaveBeenCalledWith(
            'Failed to poll twitch: Twitch API rate limit exceeded',
            VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT,
            expect.objectContaining({
                eventType: 'polling',
                error: 'Twitch API rate limit exceeded'
            })
        );
    });

    test('should verify polling configuration is correct', () => {
        // Act
        const viewerSystem = createViewerSystem();
        viewerSystem.startPolling();

        // Assert
        expect(viewerSystem.pollingInterval).toBe(30 * 1000); // 30 seconds in milliseconds
        expect(viewerSystem.isPolling).toBe(true);
    });
});
