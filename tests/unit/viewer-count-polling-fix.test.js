const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createConfigFixture } = require('../helpers/config-fixture');
const { noOpLogger } = require('../helpers/mock-factories');

describe('Viewer Count Polling System Fix', () => {
    let ViewerCountSystem;
    let viewerCountSystem;
    let mockYoutubePlatform;
    let mockTwitchPlatform;
    let mockTiktokPlatform;
    let platforms;
    let testConfig;

    beforeEach(async () => {
        ({ ViewerCountSystem } = require('../../src/utils/viewer-count'));

        testConfig = createConfigFixture({
            general: { viewerCountPollingIntervalMs: 60 }
        });

        mockYoutubePlatform = {
            getViewerCount: createMockFn().mockResolvedValue(100)
        };

        mockTwitchPlatform = {
            getViewerCount: createMockFn().mockResolvedValue(50)
        };

        mockTiktokPlatform = {
            getViewerCount: createMockFn().mockResolvedValue(25)
        };

        platforms = {
            youtube: mockYoutubePlatform,
            twitch: mockTwitchPlatform,
            tiktok: mockTiktokPlatform
        };

        viewerCountSystem = new ViewerCountSystem({
            platformProvider: () => platforms,
            logger: noOpLogger,
            config: testConfig
        });

        const mockObserver = {
            getObserverId: () => 'testObserver',
            onViewerCountUpdate: createMockFn().mockResolvedValue(),
            onStreamStatusChange: createMockFn().mockResolvedValue()
        };
        viewerCountSystem.addObserver(mockObserver);

        await viewerCountSystem.updateStreamStatus('youtube', true);
        await viewerCountSystem.updateStreamStatus('twitch', true);
        await viewerCountSystem.updateStreamStatus('tiktok', false);
    });

    afterEach(() => {
        restoreAllMocks();
    });

    describe('Platform Detection for Active Streams', () => {
        test('starts polling for platforms with active connections', async () => {
            expect(viewerCountSystem.isPolling).toBe(false);
            expect(Object.keys(viewerCountSystem.pollingHandles)).toHaveLength(0);

            viewerCountSystem.startPolling();

            expect(viewerCountSystem.isPolling).toBe(true);

            const liveHandles = Object.keys(viewerCountSystem.pollingHandles);
            expect(liveHandles.length).toBeGreaterThan(0);
        });

        test('skips polling when YouTube stream status is offline', () => {
            viewerCountSystem.updateStreamStatus('youtube', false);

            expect(viewerCountSystem.isStreamLive('youtube')).toBe(false);

            viewerCountSystem.startPolling();

            expect(viewerCountSystem.pollingHandles['youtube']).toBeUndefined();
            expect(mockYoutubePlatform.getViewerCount).not.toHaveBeenCalled();
        });

        test('starts polling for Twitch platform (always active)', async () => {
            viewerCountSystem.startPolling();
            await new Promise(resolve => setImmediate(resolve));

            expect(viewerCountSystem.pollingHandles['twitch']).toBeDefined();
            expect(mockTwitchPlatform.getViewerCount).toHaveBeenCalled();
        });

        test('does not start polling for platforms without active streams', async () => {
            expect(viewerCountSystem.isStreamLive('tiktok')).toBe(false);

            viewerCountSystem.startPolling();
            await new Promise(resolve => setImmediate(resolve));

            expect(viewerCountSystem.pollingHandles['tiktok']).toBeUndefined();
            expect(mockTiktokPlatform.getViewerCount).not.toHaveBeenCalled();
        });
    });

    describe('Polling System Behavior', () => {
        test('tracks polling state correctly when starting', () => {
            expect(viewerCountSystem.isPolling).toBe(false);
            expect(Object.keys(viewerCountSystem.pollingHandles)).toHaveLength(0);

            viewerCountSystem.startPolling();

            expect(viewerCountSystem.isPolling).toBe(true);

            const activeHandles = Object.keys(viewerCountSystem.pollingHandles);
            expect(activeHandles.length).toBeGreaterThan(0);
            expect(activeHandles).toContain('youtube');
            expect(activeHandles).toContain('twitch');
            expect(activeHandles).not.toContain('tiktok');
        });

        test('prevents duplicate polling when called multiple times', () => {
            viewerCountSystem.startPolling();
            viewerCountSystem.startPolling();

            expect(viewerCountSystem.isPolling).toBe(true);
        });

        test('handles polling interval configuration correctly', () => {
            viewerCountSystem.startPolling();

            expect(viewerCountSystem.isPolling).toBe(true);
            expect(typeof viewerCountSystem.pollingInterval).toBe('number');
        });
    });

    describe('Platform Stream Status Integration', () => {
        test('starts polling when stream status changes to live', async () => {
            expect(viewerCountSystem.isStreamLive('tiktok')).toBe(false);
            viewerCountSystem.startPolling();

            expect(viewerCountSystem.pollingHandles['tiktok']).toBeUndefined();

            viewerCountSystem.updateStreamStatus('tiktok', true);
            await new Promise(resolve => setImmediate(resolve));

            expect(viewerCountSystem.pollingHandles['tiktok']).toBeDefined();
            expect(mockTiktokPlatform.getViewerCount).toHaveBeenCalled();
        });

        test('stops polling when stream status changes to offline', async () => {
            viewerCountSystem.startPolling();
            expect(viewerCountSystem.pollingHandles['youtube']).toBeDefined();

            await viewerCountSystem.updateStreamStatus('youtube', false);

            expect(viewerCountSystem.pollingHandles['youtube']).toBeUndefined();
            expect(viewerCountSystem.counts.youtube).toBe(0);
        });

        test('starts polling after YouTube marks stream live', async () => {
            viewerCountSystem.stopPolling();
            await viewerCountSystem.updateStreamStatus('youtube', false);

            expect(viewerCountSystem.isStreamLive('youtube')).toBe(false);

            viewerCountSystem.startPolling();
            expect(viewerCountSystem.pollingHandles['youtube']).toBeUndefined();

            await viewerCountSystem.updateStreamStatus('youtube', true);

            expect(viewerCountSystem.pollingHandles['youtube']).toBeDefined();
            expect(mockYoutubePlatform.getViewerCount).toHaveBeenCalled();
        });
    });
});
