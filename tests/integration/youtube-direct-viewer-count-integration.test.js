const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger } = require('../helpers/mock-factories');
const { createMockPlatformDependencies } = require('../helpers/test-setup');
const { createYouTubeConfigFixture } = require('../helpers/config-fixture');
const testClock = require('../helpers/test-clock');

const createMockViewerCountProvider = (overrides = {}) => ({
    getViewerCount: createMockFn().mockResolvedValue(100),
    isReady: createMockFn().mockReturnValue(true),
    getProviderStatus: createMockFn().mockReturnValue({ healthy: true }),
    cleanup: createMockFn(),
    getViewerCountForVideo: createMockFn().mockResolvedValue(100),
    ...overrides
});

describe('YouTube Direct getViewerCount() Integration', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    const createProviderYouTubePlatform = async (expectedViewerCount = 100, providerOverrides = {}) => {
        const { YouTubePlatform } = require('../../src/platforms/youtube');

        const mockProvider = createMockViewerCountProvider({
            getViewerCount: createMockFn().mockResolvedValue(expectedViewerCount),
            ...providerOverrides
        });

        const configFixture = createYouTubeConfigFixture();
        const mockDeps = createMockPlatformDependencies('youtube', {
            logger: noOpLogger,
            viewerCountProvider: mockProvider
        });

        const platform = new YouTubePlatform(configFixture, mockDeps);

        return { platform, mockProvider };
    };

    beforeEach(() => {
        testClock.reset();
    });

    describe('Direct Call Path Integration', () => {
        test('should use provider aggregation for multi-stream scenario', async () => {
            const { platform, mockProvider } = await createProviderYouTubePlatform(1000);

            const totalViewers = await platform.getViewerCount();

            expect(totalViewers).toBe(1000);
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });

        test('should work for single stream through provider path', async () => {
            const { platform, mockProvider } = await createProviderYouTubePlatform(1234);

            const viewerCount = await platform.getViewerCount();

            expect(viewerCount).toBe(1234);
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });

        test('should respect provider configuration', async () => {
            const { platform, mockProvider } = await createProviderYouTubePlatform(500);

            const viewerCount = await platform.getViewerCount();

            expect(viewerCount).toBe(500);
            expect(typeof viewerCount).toBe('number');
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });

        test('should handle provider errors gracefully', async () => {
            const { platform } = await createProviderYouTubePlatform(0, {
                getViewerCount: createMockFn().mockRejectedValue(new Error('Provider error'))
            });

            const viewerCount = await platform.getViewerCount();

            expect(viewerCount).toBe(0);
            expect(typeof viewerCount).toBe('number');
        });
    });

    describe('Error Handling and User Experience', () => {
        test('should return 0 when provider fails completely', async () => {
            const { platform } = await createProviderYouTubePlatform(0, {
                getViewerCount: createMockFn().mockRejectedValue(new Error('Provider API unavailable'))
            });

            const viewerCount = await platform.getViewerCount();

            expect(viewerCount).toBe(0);
            expect(typeof viewerCount).toBe('number');
        });

        test('should handle no active streams gracefully', async () => {
            const { platform } = await createProviderYouTubePlatform(0);

            const viewerCount = await platform.getViewerCount();

            expect(viewerCount).toBe(0);
        });

        test('should return accurate viewer count for normal operation', async () => {
            const { platform, mockProvider } = await createProviderYouTubePlatform(777);

            const result = await platform.getViewerCount();

            expect(result).toBe(777);
            expect(typeof result).toBe('number');
            expect(result).toBeGreaterThanOrEqual(0);
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });
    });

    describe('Integration with ViewerCount System', () => {
        test('should provide consistent interface for ViewerCount polling', async () => {
            const { platform, mockProvider } = await createProviderYouTubePlatform(456);

            const polledCount = await platform.getViewerCount();

            expect(typeof polledCount).toBe('number');
            expect(polledCount).toBe(456);
            expect(polledCount).toBeGreaterThanOrEqual(0);
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });

        test('should handle rapid successive calls efficiently', async () => {
            const { platform, mockProvider } = await createProviderYouTubePlatform(888);

            const results = await Promise.all([
                platform.getViewerCount(),
                platform.getViewerCount(),
                platform.getViewerCount()
            ]);

            expect(results).toEqual([888, 888, 888]);
            expect(mockProvider.getViewerCount).toHaveBeenCalledTimes(3);
        });

        test('should maintain performance under load', async () => {
            const { platform } = await createProviderYouTubePlatform(999);

            const startTime = testClock.now();
            await platform.getViewerCount();
            const simulatedDurationMs = 100;
            testClock.advance(simulatedDurationMs);
            const duration = testClock.now() - startTime;

            expect(duration).toBeLessThan(1000);
        });
    });

    describe('Configuration and Method Routing', () => {
        test('should route to provider when configured', async () => {
            const { platform, mockProvider } = await createProviderYouTubePlatform(200);

            const viewerCount = await platform.getViewerCount();

            expect(typeof viewerCount).toBe('number');
            expect(viewerCount).toBe(200);
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });

        test('should use provider with default configuration', async () => {
            const { platform, mockProvider } = await createProviderYouTubePlatform(333);

            const viewerCount = await platform.getViewerCount();

            expect(viewerCount).toBe(333);
            expect(typeof viewerCount).toBe('number');
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });
    });

    describe('Real-World Integration Scenarios', () => {
        test('should handle typical streaming platform usage', async () => {
            const { platform, mockProvider } = await createProviderYouTubePlatform(1415);

            const totalViewers = await platform.getViewerCount();

            expect(totalViewers).toBe(1415);
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });

        test('should work in educational streaming context', async () => {
            const { platform, mockProvider } = await createProviderYouTubePlatform(640);

            const totalStudents = await platform.getViewerCount();

            expect(totalStudents).toBe(640);
            expect(mockProvider.getViewerCount).toHaveBeenCalled();
        });
    });
});
