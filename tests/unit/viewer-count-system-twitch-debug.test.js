
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
            debug: jest.fn(),
            info: jest.fn(),
            warn: jest.fn(),
            error: jest.fn()
        };
        
        runtimeConstants = createRuntimeConstantsFixture({
            VIEWER_COUNT_POLLING_INTERVAL_SECONDS: 30
        });

        // Mock OBS manager
        mockObsManager = {
            isConnected: jest.fn(() => true),
            call: jest.fn().mockResolvedValue({})
        };

        // Mock Twitch platform with getViewerCount method
        mockTwitchPlatform = {
            getViewerCount: jest.fn().mockResolvedValue(42)
        };

        // Platform map used by ViewerCountSystem
        mockPlatforms = {
            twitch: mockTwitchPlatform,
            youtube: { getViewerCount: jest.fn().mockResolvedValue(100) },
            tiktok: { getViewerCount: jest.fn().mockResolvedValue(25) }
        };

        jest.doMock('../../src/core/logging', () => ({
            logger: logger
        }));
        
        mockTextProcessing = {
            formatViewerCount: jest.fn((count) => count.toString())
        };

        jest.doMock('../../src/utils/text-processing', () => ({
            createTextProcessingManager: jest.fn(() => mockTextProcessing),
            TextProcessingManager: jest.fn(),
            formatTimestampCompact: jest.fn()
        }));
        
        const { ViewerCountSystem: VCS } = require('../../src/utils/viewer-count');
        ViewerCountSystem = VCS;
    });

    afterEach(() => {
        jest.clearAllMocks();
        jest.resetModules();
    });

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
        const startPlatformPollingSpy = jest.spyOn(viewerSystem, 'startPlatformPolling');
        const pollPlatformSpy = jest.spyOn(viewerSystem, 'pollPlatform');

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
            getObserverId: jest.fn().mockReturnValue('test-observer'),
            onViewerCountUpdate: jest.fn().mockResolvedValue()
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
