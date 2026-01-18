
const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { clearAllMocks, createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { ViewerCountSystem } = require('../../src/utils/viewer-count');
const { YouTubeViewerExtractor } = require('../../src/extractors/youtube-viewer-extractor');
const { InnertubeFactory } = require('../../src/factories/innertube-factory');
const InnertubeInstanceManager = require('../../src/services/innertube-instance-manager');
const { OBSViewerCountObserver } = require('../../src/observers/obs-viewer-count-observer');
const { createMockOBSManager, createMockConfig } = require('../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../helpers/behavior-validation');
const { createSilentLogger } = require('../helpers/test-logger');
const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');

describe('System Resilience and Error Recovery Integration', () => {
    let platforms, obsManager, viewerCountSystem;

    beforeEach(async () => {
        global.__TEST_RUNTIME_CONSTANTS__ = createRuntimeConstantsFixture();
        platforms = {
            youtube: {
                getViewerCount: createMockFn().mockResolvedValue(1000),
                isEnabled: () => true
            }
        };

        obsManager = createMockOBSManager();
        viewerCountSystem = new ViewerCountSystem({
            platforms,
            runtimeConstants: createRuntimeConstantsFixture()
        });

        const obsObserver = new OBSViewerCountObserver(obsManager, createSilentLogger());
        viewerCountSystem.addObserver(obsObserver);

        await viewerCountSystem.initialize();
    });

    afterEach(async () => {
        if (viewerCountSystem) {
            viewerCountSystem.stopPolling();
            await viewerCountSystem.cleanup();
        }
        await InnertubeInstanceManager.cleanup();
        clearAllMocks();
        restoreAllMocks();
    });

    describe('Platform API Error Handling', () => {
        test('should handle YouTube API errors gracefully', async () => {
            platforms.youtube.getViewerCount.mockRejectedValue(new Error('API rate limit exceeded'));

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            expect(viewerCountSystem.isPolling).toBe(true);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(viewerCountSystem.counts.youtube).toBe(0);
        });

        test('should handle malformed API responses gracefully', async () => {
            let callCount = 0;
            platforms.youtube.getViewerCount.mockImplementation(() => {
                const responses = [null, undefined, 'invalid', { invalid: 'object' }, -1];
                return Promise.resolve(responses[callCount++ % responses.length]);
            });

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(100);

            expect(viewerCountSystem.isPolling).toBe(true);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(callCount).toBeGreaterThan(0);
        });

        test('should maintain system stability during connection failures', async () => {
            platforms.youtube.getViewerCount.mockRejectedValue(new Error('Network timeout'));

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            expect(viewerCountSystem.isPolling).toBe(true);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(typeof viewerCountSystem.counts.youtube).toBe('number');
        });
    });

    describe('Observer Error Isolation', () => {
        test('should isolate observer errors from system operation', async () => {
            const faultyObserver = {
                getObserverId: () => 'faulty-observer',
                onViewerCountUpdate: createMockFn().mockRejectedValue(new Error('Observer crashed')),
                onStreamStatusChange: createMockFn().mockRejectedValue(new Error('Observer failed'))
            };
            viewerCountSystem.addObserver(faultyObserver);

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            expect(viewerCountSystem.counts.youtube).toBe(1000);
            expect(viewerCountSystem.isPolling).toBe(true);
            expect(faultyObserver.onViewerCountUpdate).toHaveBeenCalled();
            expect(obsManager.call).toHaveBeenCalled();
        });

        test('should handle OBS connection failures gracefully', async () => {
            obsManager.isConnected.mockReturnValue(false);
            obsManager.call.mockRejectedValue(new Error('OBS connection lost'));

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            expect(viewerCountSystem.counts.youtube).toBe(1000);
            expect(viewerCountSystem.isPolling).toBe(true);
        });
    });

    describe('Configuration Error Handling', () => {
        test('should handle invalid polling configuration gracefully', async () => {
            viewerCountSystem.runtimeConstants = createRuntimeConstantsFixture({
                VIEWER_COUNT_POLLING_INTERVAL_SECONDS: 0
            });

            viewerCountSystem.startPolling();

            expect(viewerCountSystem.isPolling).toBe(false);
        });

        test('should handle missing OBS configuration', async () => {
            createMockConfig({
                youtube: {
                    viewerCountEnabled: true
                }
            });

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            expect(viewerCountSystem.counts.youtube).toBe(1000);
            expect(viewerCountSystem.isPolling).toBe(true);
        });
    });

    describe('Factory and Instance Manager Resilience', () => {
        test('creates Innertube instance successfully', async () => {
            const instance = await InnertubeFactory.createInstance();

            expect(instance).toBeDefined();
            expect(typeof instance).toBe('object');
        });

        test('handles instance manager operations safely', async () => {
            const manager = InnertubeInstanceManager.getInstance();
            const stats = manager.getStats();

            expect(stats).toHaveProperty('activeInstances');
            expect(typeof stats.activeInstances).toBe('number');

            await expect(manager.cleanup()).resolves.toBeUndefined();
        });
    });

    describe('Extractor Resilience', () => {
        test('handles malformed YouTube data structures gracefully', () => {
            const malformedStructures = [
                null,
                undefined,
                {},
                { primary_info: null },
                { broken: 'structure' }
            ];

            malformedStructures.forEach(structure => {
                const result = YouTubeViewerExtractor.extractConcurrentViewers(structure);

                expect(typeof result.success).toBe('boolean');
                expect(typeof result.count).toBe('number');
                expect(result.count >= 0 || Number.isNaN(result.count)).toBe(true);
                expect(result.metadata).toBeDefined();
            });
        });

        test('should handle extraction strategy failures', () => {
            const problematicData = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: undefined
                        }
                    }
                },
                video_details: {
                    viewer_count: 'not-a-number'
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(problematicData);

            expect(result).toMatchObject({
                success: expect.any(Boolean),
                count: expect.any(Number),
                metadata: expect.any(Object)
            });
        });
    });

    describe('Concurrent Operation Resilience', () => {
        test('should handle concurrent status updates safely', async () => {
            const promises = [];
            for (let i = 0; i < 5; i++) {
                promises.push(
                    viewerCountSystem.updateStreamStatus('youtube', i % 2 === 0)
                );
            }

            await Promise.all(promises);

            expect(typeof viewerCountSystem.isStreamLive('youtube')).toBe('boolean');
            expect(typeof viewerCountSystem.counts.youtube).toBe('number');
        });

        test('should handle rapid polling operations', async () => {
            await viewerCountSystem.updateStreamStatus('youtube', true);

            for (let i = 0; i < 3; i++) {
                viewerCountSystem.startPolling();
                viewerCountSystem.stopPolling();
            }

            expect(viewerCountSystem.isPolling).toBe(false);
        });
    });

    describe('System State Consistency', () => {
        test('should maintain consistent state during errors', async () => {
            platforms.youtube.getViewerCount
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockResolvedValueOnce(1500)
                .mockRejectedValueOnce(new Error('Error 2'));

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(100);

            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(viewerCountSystem.isPolling).toBe(true);
            expect(typeof viewerCountSystem.counts.youtube).toBe('number');
            expect(viewerCountSystem.counts.youtube).toBeGreaterThanOrEqual(0);
        });

        test('should handle observer lifecycle during errors', async () => {
            const problematicObserver = {
                getObserverId: () => 'problematic-observer',
                onViewerCountUpdate: createMockFn(),
                onStreamStatusChange: createMockFn(),
                cleanup: createMockFn().mockRejectedValue(new Error('Cleanup failed'))
            };
            viewerCountSystem.addObserver(problematicObserver);

            await expect(viewerCountSystem.cleanup()).resolves.toBeUndefined();

            expect(problematicObserver.cleanup).toHaveBeenCalled();
            expect(viewerCountSystem.observers.size).toBe(0);
        });
    });

    describe('Content Quality During Errors', () => {
        test('should maintain user-friendly content during failures', async () => {
            let lastSuccessfulUpdate = null;
            const qualityObserver = {
                getObserverId: () => 'quality-observer',
                onViewerCountUpdate: createMockFn(update => {
                    lastSuccessfulUpdate = update;
                }),
                onStreamStatusChange: createMockFn()
            };
            viewerCountSystem.addObserver(qualityObserver);

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            if (lastSuccessfulUpdate) {
                expect(lastSuccessfulUpdate.platform).toMatch(/^(youtube|twitch|tiktok)$/);
                expect(lastSuccessfulUpdate.count).toBeGreaterThanOrEqual(0);
                expectNoTechnicalArtifacts(lastSuccessfulUpdate.platform);
            }
        });

        test('should provide meaningful error states', async () => {
            platforms.youtube.getViewerCount.mockRejectedValue(new Error('Persistent failure'));

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(viewerCountSystem.counts.youtube).toBe(0);
            expect(viewerCountSystem.isPolling).toBe(true);
        });
    });

    describe('Resource Management', () => {
        test('should clean up resources properly during failures', async () => {
            const resourceObserver = {
                getObserverId: () => 'resource-observer',
                onViewerCountUpdate: createMockFn(),
                onStreamStatusChange: createMockFn(),
                cleanup: createMockFn()
            };
            viewerCountSystem.addObserver(resourceObserver);

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            viewerCountSystem.stopPolling();
            await viewerCountSystem.cleanup();

            expect(resourceObserver.cleanup).toHaveBeenCalled();
            expect(viewerCountSystem.observers.size).toBe(0);
            expect(viewerCountSystem.isPolling).toBe(false);
        });

        test('should handle memory cleanup during stress', async () => {
            const initialObserverCount = viewerCountSystem.observers.size;

            for (let i = 0; i < 10; i++) {
                const observer = {
                    getObserverId: () => `stress-observer-${i}`,
                    onViewerCountUpdate: createMockFn(),
                    onStreamStatusChange: createMockFn()
                };

                viewerCountSystem.addObserver(observer);
                viewerCountSystem.removeObserver(`stress-observer-${i}`);
            }

            expect(viewerCountSystem.observers.size).toBe(initialObserverCount);
        });
    });
});
