const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, spyOn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');
const { VIEWER_COUNT_CONSTANTS } = require('../../src/core/constants');

const noOpLogger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe('Twitch Viewer Count System Debug', () => {
    let ViewerCountSystem;
    let mockTwitchPlatform;
    let mockPlatforms;
    let runtimeConstants;
    let logger;

    beforeEach(() => {
        ({ ViewerCountSystem } = require('../../src/utils/viewer-count'));

        logger = {
            debug: createMockFn(),
            info: createMockFn(),
            warn: createMockFn(),
            error: createMockFn()
        };

        runtimeConstants = createRuntimeConstantsFixture({
            VIEWER_COUNT_POLLING_INTERVAL_SECONDS: 30
        });

        mockTwitchPlatform = {
            getViewerCount: createMockFn().mockResolvedValue(42)
        };

        mockPlatforms = {
            twitch: mockTwitchPlatform,
            youtube: { getViewerCount: createMockFn().mockResolvedValue(100) },
            tiktok: { getViewerCount: createMockFn().mockResolvedValue(25) }
        };
    });

    afterEach(() => {
        restoreAllMocks();
    });

    const createViewerSystem = () => {
        return new ViewerCountSystem({ platforms: mockPlatforms, logger, runtimeConstants });
    };

    test('initializes with Twitch set to always live', () => {
        const viewerSystem = createViewerSystem();

        expect(viewerSystem.streamStatus.twitch).toBe(true);
        expect(viewerSystem.streamStatus.youtube).toBe(false);
        expect(viewerSystem.streamStatus.tiktok).toBe(false);
        expect(viewerSystem.counts.twitch).toBe(0);
    });

    test('starts polling immediately for Twitch since it is always live', async () => {
        const viewerSystem = createViewerSystem();
        const startPlatformPollingSpy = spyOn(viewerSystem, 'startPlatformPolling');
        const pollPlatformSpy = spyOn(viewerSystem, 'pollPlatform');

        viewerSystem.startPolling();

        expect(startPlatformPollingSpy).toHaveBeenCalledWith('twitch');
        expect(pollPlatformSpy).toHaveBeenCalledWith('twitch');
    });

    test('fetches Twitch viewer count when polling', async () => {
        const viewerSystem = createViewerSystem();

        const mockObserver = {
            getObserverId: createMockFn().mockReturnValue('testObserver'),
            onViewerCountUpdate: createMockFn().mockResolvedValue()
        };
        viewerSystem.addObserver(mockObserver);

        await viewerSystem.pollPlatform('twitch');

        expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalled();
        expect(viewerSystem.counts.twitch).toBe(42);
        expect(mockObserver.onViewerCountUpdate).toHaveBeenCalledWith(
            expect.objectContaining({
                platform: 'twitch',
                count: 42,
                previousCount: 0
            })
        );
    });

    test('handles Twitch API errors gracefully', async () => {
        const viewerSystem = createViewerSystem();
        const apiError = new Error('Twitch API rate limit exceeded');
        mockTwitchPlatform.getViewerCount.mockRejectedValue(apiError);

        await viewerSystem.pollPlatform('twitch');

        expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalled();
        expect(viewerSystem.counts.twitch).toBe(0);
        expect(logger.error).toHaveBeenCalledWith(
            'Failed to poll twitch: Twitch API rate limit exceeded',
            VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.VIEWER_COUNT,
            expect.objectContaining({
                eventType: 'polling',
                error: 'Twitch API rate limit exceeded'
            })
        );
    });

    test('uses correct polling configuration', () => {
        const viewerSystem = createViewerSystem();
        viewerSystem.startPolling();

        expect(viewerSystem.pollingInterval).toBe(30 * 1000);
        expect(viewerSystem.isPolling).toBe(true);
    });
});
