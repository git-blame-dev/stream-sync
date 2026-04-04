const { describe, test, beforeEach, afterEach, expect } = require('bun:test');

const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { noOpLogger, createMockNotificationManager, setupAutomatedCleanup } = require('../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../helpers/behavior-validation');
const { YouTubePlatform } = require('../../src/platforms/youtube');

describe('YouTube Multi-Stream Viewer Count Separation', () => {
    let mockNotificationManager, cleanup;

    afterEach(async () => {
        restoreAllMocks();
        if (cleanup && typeof cleanup === 'function') {
            await cleanup();
        }
    });

    const createMultiStreamScenario = (streamConfigs) => {
        const totalViewers = streamConfigs
            .filter(stream => stream.isLive !== false)
            .reduce((sum, stream) => sum + stream.viewers, 0);

        const chatReadyStreams = streamConfigs.filter(stream => stream.chatReady);
        const allDetectedStreams = streamConfigs.filter(stream => stream.isLive !== false);

        return {
            name: `${streamConfigs.length} total streams (${chatReadyStreams.length} chat-ready, ${allDetectedStreams.length} detected)`,
            streams: streamConfigs,
            expectedViewerCount: totalViewers,
            chatReadyCount: chatReadyStreams.length,
            detectedCount: allDetectedStreams.length
        };
    };

    const createYouTubePlatformWithMixedStates = async (scenario) => {
        const mockViewerExtractionService = {
            getAggregatedViewerCount: createMockFn().mockImplementation(async (videoIds) => {
                let totalCount = 0;
                let successfulStreams = 0;
                for (const videoId of videoIds) {
                    const stream = scenario.streams.find(s => s.videoId === videoId);
                    if (stream && stream.isLive !== false) {
                        totalCount += stream.viewers;
                        successfulStreams++;
                    }
                }
                return {
                    success: true,
                    totalCount,
                    successfulStreams
                };
            }),
            extractViewerCount: createMockFn().mockImplementation(async (videoId) => {
                const stream = scenario.streams.find(s => s.videoId === videoId);
                if (stream && stream.isLive !== false) {
                    return {
                        success: true,
                        count: stream.viewers
                    };
                }
                return {
                    success: false,
                    count: 0
                };
            })
        };

        const platform = new YouTubePlatform({
            youtube: {
                viewerCountMethod: 'youtubei',
                enabled: true
            }
        }, {
            logger: noOpLogger,
            notificationManager: mockNotificationManager,
            viewerExtractionService: mockViewerExtractionService,
            streamDetectionService: {
                detectLiveStreams: createMockFn().mockResolvedValue({ success: true, videoIds: [] })
            }
        });

        const originalGetActiveVideoIds = platform.connectionManager.getActiveVideoIds;
        const originalIsConnectionReady = platform.connectionManager.isConnectionReady;

        platform.connectionManager.getActiveVideoIds = createMockFn().mockReturnValue(
            scenario.streams
                .filter(stream => stream.isLive !== false)
                .map(stream => stream.videoId)
        );

        platform.connectionManager.isConnectionReady = createMockFn().mockImplementation((videoId) => {
            const stream = scenario.streams.find(s => s.videoId === videoId);
            return stream ? stream.chatReady : false;
        });

        platform._originalGetActiveVideoIds = originalGetActiveVideoIds;
        platform._originalIsConnectionReady = originalIsConnectionReady;

        return platform;
    };

    beforeEach(async () => {
        cleanup = setupAutomatedCleanup();
        mockNotificationManager = createMockNotificationManager();
    });

    describe('Multi-Stream Viewer Count Aggregation (From ALL Detected Streams)', () => {
        test('should aggregate viewer count from all detected streams regardless of chat readiness', async () => {
            const scenario = createMultiStreamScenario([
                { videoId: 'stream-1', viewers: 1500, chatReady: true, isLive: true },
                { videoId: 'stream-2', viewers: 800, chatReady: false, isLive: true },
                { videoId: 'stream-3', viewers: 1200, chatReady: true, isLive: true },
                { videoId: 'stream-4', viewers: 600, chatReady: false, isLive: true },
            ]);
            const platform = await createYouTubePlatformWithMixedStates(scenario);

            const totalViewers = await platform.getViewerCount();

            expect(totalViewers).toBe(4100);
            expect(totalViewers).toBe(scenario.expectedViewerCount);
            const chatReadyOnly = scenario.streams
                .filter(s => s.chatReady)
                .reduce((sum, s) => sum + s.viewers, 0);
            expect(totalViewers).toBeGreaterThan(chatReadyOnly);
        });

        test('should include streams with failed chat connections in viewer count', async () => {
            const scenario = createMultiStreamScenario([
                { videoId: 'successful-chat', viewers: 2000, chatReady: true, isLive: true },
                { videoId: 'failed-chat-1', viewers: 1500, chatReady: false, isLive: true },
                { videoId: 'failed-chat-2', viewers: 900, chatReady: false, isLive: true },
            ]);
            const platform = await createYouTubePlatformWithMixedStates(scenario);

            const totalViewers = await platform.getViewerCount();

            expect(totalViewers).toBe(4400);
            const chatReadyTotal = 2000;
            expect(totalViewers).toBeGreaterThan(chatReadyTotal);
        });

        test('should handle mixed stream states with premiere and live streams', async () => {
            const scenario = createMultiStreamScenario([
                { videoId: 'live-main', viewers: 3500, chatReady: true, isLive: true },
                { videoId: 'premiere-pending', viewers: 800, chatReady: false, isLive: true },
                { videoId: 'live-backup', viewers: 1200, chatReady: false, isLive: true },
                { videoId: 'restream', viewers: 400, chatReady: true, isLive: true },
            ]);
            const platform = await createYouTubePlatformWithMixedStates(scenario);

            const totalViewers = await platform.getViewerCount();

            expect(totalViewers).toBe(5900);
            expect(totalViewers).toBe(scenario.expectedViewerCount);
        });

        test('should maintain accurate count when chat connections change state', async () => {
            const scenario = createMultiStreamScenario([
                { videoId: 'stable-stream', viewers: 1000, chatReady: true, isLive: true },
                { videoId: 'unstable-stream', viewers: 2000, chatReady: false, isLive: true },
            ]);
            const platform = await createYouTubePlatformWithMixedStates(scenario);

            const initialCount = await platform.getViewerCount();
            expect(initialCount).toBe(3000);

            platform.connectionManager.isConnectionReady = createMockFn().mockImplementation((videoId) => {
                return true;
            });
            const afterChatReady = await platform.getViewerCount();

            expect(afterChatReady).toBe(3000);
            expect(afterChatReady).toBe(initialCount);
        });
    });

    describe('Chat-Independent Viewer Count Functionality', () => {
        test('should provide viewer count even when all chat connections fail', async () => {
            const scenario = createMultiStreamScenario([
                { videoId: 'stream-1', viewers: 1800, chatReady: false, isLive: true },
                { videoId: 'stream-2', viewers: 1200, chatReady: false, isLive: true },
                { videoId: 'stream-3', viewers: 900, chatReady: false, isLive: true },
            ]);
            const platform = await createYouTubePlatformWithMixedStates(scenario);

            const totalViewers = await platform.getViewerCount();

            expect(totalViewers).toBe(3900);
            expect(totalViewers).toBeGreaterThan(0);
            expect(totalViewers).not.toBe(0);
        });

        test('should work independently of chat service availability', async () => {
            const scenario = createMultiStreamScenario([
                { videoId: 'detected-stream-1', viewers: 2500, chatReady: false, isLive: true },
                { videoId: 'detected-stream-2', viewers: 1800, chatReady: false, isLive: true },
            ]);
            const platform = await createYouTubePlatformWithMixedStates(scenario);
            platform.connectionManager.isConnectionReady = createMockFn().mockReturnValue(false);
            platform.connectionManager.isAnyConnectionReady = createMockFn().mockReturnValue(false);

            const viewerCount = await platform.getViewerCount();

            expect(viewerCount).toBe(4300);
            expect(viewerCount).toBeGreaterThan(0);
        });

        test('should handle partial chat connectivity gracefully', async () => {
            const scenario = createMultiStreamScenario([
                { videoId: 'chat-enabled', viewers: 3000, chatReady: true, isLive: true },
                { videoId: 'api-detected-1', viewers: 1500, chatReady: false, isLive: true },
                { videoId: 'api-detected-2', viewers: 800, chatReady: false, isLive: true },
                { videoId: 'chat-enabled-2', viewers: 1200, chatReady: true, isLive: true },
            ]);
            const platform = await createYouTubePlatformWithMixedStates(scenario);

            const totalViewers = await platform.getViewerCount();

            expect(totalViewers).toBe(6500);
            const chatOnlyTotal = scenario.streams
                .filter(s => s.chatReady)
                .reduce((sum, s) => sum + s.viewers, 0);
            expect(totalViewers).toBeGreaterThan(chatOnlyTotal);
        });

        test('should maintain viewer count during chat connection interruptions', async () => {
            const scenario = createMultiStreamScenario([
                { videoId: 'main-stream', viewers: 4000, chatReady: true, isLive: true },
                { videoId: 'backup-stream', viewers: 1000, chatReady: true, isLive: true },
            ]);
            const platform = await createYouTubePlatformWithMixedStates(scenario);

            const beforeInterruption = await platform.getViewerCount();
            expect(beforeInterruption).toBe(5000);

            platform.connectionManager.isConnectionReady = createMockFn().mockReturnValue(false);
            const duringInterruption = await platform.getViewerCount();

            expect(duringInterruption).toBe(5000);
            expect(duringInterruption).toBe(beforeInterruption);
        });
    });

    describe('Consistent Platform Interface (TikTok/Twitch Compatibility)', () => {
        test('should provide reliable getViewerCount() like other platforms', async () => {
            const scenario = createMultiStreamScenario([
                { videoId: 'reliable-stream', viewers: 2500, chatReady: false, isLive: true },
            ]);
            const platform = await createYouTubePlatformWithMixedStates(scenario);

            const call1 = await platform.getViewerCount();
            const call2 = await platform.getViewerCount();
            const call3 = await platform.getViewerCount();

            expect(call1).toBe(2500);
            expect(call2).toBe(2500);
            expect(call3).toBe(2500);
            expect(call1).toBeDefined();
            expect(typeof call1).toBe('number');
        });

        test('should handle zero viewers consistently with other platforms', async () => {
            const scenario = createMultiStreamScenario([
                { videoId: 'empty-stream', viewers: 0, chatReady: false, isLive: true },
            ]);
            const platform = await createYouTubePlatformWithMixedStates(scenario);

            const viewerCount = await platform.getViewerCount();

            expect(viewerCount).toBe(0);
            expect(typeof viewerCount).toBe('number');
        });

        test('should behave consistently regardless of chat implementation details', async () => {
            const scenario1 = createMultiStreamScenario([
                { videoId: 'websocket-chat', viewers: 1000, chatReady: true, isLive: true },
                { videoId: 'api-polling', viewers: 500, chatReady: false, isLive: true },
            ]);
            const scenario2 = createMultiStreamScenario([
                { videoId: 'different-impl-1', viewers: 1000, chatReady: false, isLive: true },
                { videoId: 'different-impl-2', viewers: 500, chatReady: true, isLive: true },
            ]);
            const platform1 = await createYouTubePlatformWithMixedStates(scenario1);
            const platform2 = await createYouTubePlatformWithMixedStates(scenario2);

            const count1 = await platform1.getViewerCount();
            const count2 = await platform2.getViewerCount();

            expect(count1).toBe(1500);
            expect(count2).toBe(1500);
            expect(count1).toBe(count2);
        });

        test('should provide user-friendly viewer count display values', async () => {
            const scenario = createMultiStreamScenario([
                { videoId: 'big-stream', viewers: 15000, chatReady: true, isLive: true },
                { videoId: 'medium-stream', viewers: 850, chatReady: false, isLive: true },
                { videoId: 'small-stream', viewers: 42, chatReady: false, isLive: true },
            ]);
            const platform = await createYouTubePlatformWithMixedStates(scenario);

            const totalViewers = await platform.getViewerCount();

            expect(totalViewers).toBe(15892);
            expect(typeof totalViewers).toBe('number');
            expect(totalViewers).toBeGreaterThan(0);
            expect(Number.isInteger(totalViewers)).toBe(true);
            const displayText = totalViewers.toLocaleString();
            expectNoTechnicalArtifacts(displayText);
            expect(displayText).toMatch(/^\d{1,3}(,\d{3})*$/);
        });
    });
});
