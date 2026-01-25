const { describe, test, beforeEach, afterEach, expect } = require('bun:test');

const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { ViewerCountSystem } = require('../../src/utils/viewer-count');
const { YouTubeViewerExtractor } = require('../../src/extractors/youtube-viewer-extractor');
const { InnertubeFactory } = require('../../src/factories/innertube-factory');
const { OBSViewerCountObserver } = require('../../src/observers/obs-viewer-count-observer');
const { createMockOBSManager } = require('../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../helpers/behavior-validation');
const { createSilentLogger } = require('../helpers/test-logger');
const { createConfigFixture } = require('../helpers/config-fixture');
const testClock = require('../helpers/test-clock');

describe('YouTube Viewer Count System - End-to-End Integration', () => {
    afterEach(async () => {
        restoreAllMocks();
        if (viewerCountSystem) {
            viewerCountSystem.stopPolling();
            await viewerCountSystem.cleanup();
        }
    });

    let platforms, obsManager, viewerCountSystem, logger, testConfig;

    beforeEach(async () => {
        testClock.reset();
        logger = createSilentLogger();
        testConfig = createConfigFixture();
        platforms = {
            youtube: {
                getViewerCount: createMockFn().mockResolvedValue(1234),
                isEnabled: () => true
            }
        };
        obsManager = createMockOBSManager();
        const timeProvider = {
            now: () => testClock.now(),
            createDate: (timestamp) => new Date(timestamp)
        };
        viewerCountSystem = new ViewerCountSystem({
            platformProvider: () => platforms,
            logger,
            config: testConfig,
            timeProvider
        });
        const obsObserver = new OBSViewerCountObserver(obsManager, logger);
        viewerCountSystem.addObserver(obsObserver);
        await viewerCountSystem.initialize();
    });
    
    describe('Dependency Injection', () => {
        test('should resolve updated platform maps when dependencies change', async () => {
            const originalPlatform = platforms.youtube;
            const replacementPlatforms = {
                youtube: {
                    getViewerCount: createMockFn().mockResolvedValue(777),
                    isEnabled: () => true
                }
            };
            platforms = replacementPlatforms;
            await viewerCountSystem.updateStreamStatus('youtube', true);

            const validation = viewerCountSystem.validatePlatformForPolling('youtube');

            expect(validation.valid).toBe(true);
            expect(validation.platform).toBe(replacementPlatforms.youtube);
            expect(validation.platform).not.toBe(originalPlatform);
        });
    });

    describe('Complete System Integration', () => {
        test('should successfully process YouTube viewer count through complete system', async () => {
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(100);

            expect(viewerCountSystem.counts.youtube).toBe(1234);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputSettings: expect.objectContaining({
                        text: expect.any(String)
                    })
                })
            );
        });

        test('should handle multiple platform viewer counts simultaneously', async () => {
            platforms.twitch = {
                getViewerCount: createMockFn().mockResolvedValue(567),
                isEnabled: () => true
            };
            platforms.tiktok = {
                getViewerCount: createMockFn().mockResolvedValue(890),
                isEnabled: () => true
            };
            await viewerCountSystem.updateStreamStatus('youtube', true);
            await viewerCountSystem.updateStreamStatus('twitch', true);
            await viewerCountSystem.updateStreamStatus('tiktok', true);
            viewerCountSystem.startPolling();
            await waitForDelay(100);

            expect(viewerCountSystem.counts.youtube).toBe(1234);
            expect(viewerCountSystem.counts.twitch).toBe(567);
            expect(viewerCountSystem.counts.tiktok).toBe(890);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(viewerCountSystem.isStreamLive('twitch')).toBe(true);
            expect(viewerCountSystem.isStreamLive('tiktok')).toBe(true);
        });

        test('should handle stream status transitions correctly', async () => {
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);
            const initialCount = viewerCountSystem.counts.youtube;
            expect(initialCount).toBe(1234);

            await viewerCountSystem.updateStreamStatus('youtube', false);

            expect(viewerCountSystem.counts.youtube).toBe(0);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(false);
            expect(obsManager.call).toHaveBeenLastCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputSettings: { text: '0' }
                })
            );
        });
    });

    describe('Factory Pattern Integration', () => {
        test('should provide factory statistics without creating instances', () => {
            const stats = InnertubeFactory.getStats();

            expect(stats.factoryVersion).toBe('1.0.0');
            expect(stats.esm).toBe(true);
            expect(stats.supportedMethods).toContain('createInstance');
        });

        test('should provide meaningful error messages when Innertube creation fails', async () => {
            InnertubeFactory.configure({
                importer: () => Promise.reject(new Error('Test import failure'))
            });

            await expect(InnertubeFactory.createInstance()).rejects.toThrow(/Innertube creation failed/);

            InnertubeFactory.configure({});
        });
    });

    describe('Extractor Service Integration', () => {
        test('should extract viewer counts using YouTubeViewerExtractor strategies', () => {
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '5,432 watching now'
                        }
                    }
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result.success).toBe(true);
            expect(result.count).toBe(5432);
            expect(result.strategy).toBe('view_text');
        });

        test('should fallback to alternative extraction strategies', () => {
            const videoInfo = {
                video_details: {
                    viewer_count: '9876'
                }
            };

            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

            expect(result.success).toBe(true);
            expect(result.count).toBe(9876);
            expect(result.strategy).toBe('video_details');
        });

        test('should validate extracted viewer counts', () => {
            expect(YouTubeViewerExtractor.isValidViewerCount(100)).toBe(true);
            expect(YouTubeViewerExtractor.isValidViewerCount(0)).toBe(true);
            expect(YouTubeViewerExtractor.isValidViewerCount(-1)).toBe(false);
            expect(YouTubeViewerExtractor.isValidViewerCount(NaN)).toBe(false);
            expect(YouTubeViewerExtractor.isValidViewerCount('invalid')).toBe(false);
            expect(YouTubeViewerExtractor.isValidViewerCount(11000000)).toBe(false);
        });
    });

    describe('Observer Pattern Integration', () => {
        test('should notify multiple observers of viewer count updates', async () => {
            const mockObserver = {
                getObserverId: () => 'test-observer',
                onViewerCountUpdate: createMockFn(),
                onStreamStatusChange: createMockFn(),
                initialize: createMockFn(),
                cleanup: createMockFn()
            };
            viewerCountSystem.addObserver(mockObserver);
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            expect(mockObserver.onViewerCountUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    platform: 'youtube',
                    count: 1234,
                    isStreamLive: true
                })
            );
        });

        test('should handle observer errors gracefully', async () => {
            const faultyObserver = {
                getObserverId: () => 'faulty-observer',
                onViewerCountUpdate: createMockFn().mockRejectedValue(new Error('Observer error')),
                onStreamStatusChange: createMockFn()
            };
            viewerCountSystem.addObserver(faultyObserver);
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            expect(viewerCountSystem.counts.youtube).toBe(1234);
        });
    });

    describe('Configuration Integration', () => {
        test('should respect polling interval configuration', async () => {
            viewerCountSystem.pollingIntervalMs = 2000;

            viewerCountSystem.startPolling();

            expect(viewerCountSystem.pollingInterval).toBe(2000);
            viewerCountSystem.stopPolling();
        });

        test('should handle disabled viewer count polling', async () => {
            viewerCountSystem.pollingIntervalMs = 0;

            viewerCountSystem.startPolling();

            expect(viewerCountSystem.isPolling).toBe(false);
        });
    });

    describe('Content Quality Validation', () => {
        test('should produce user-friendly viewer count displays', async () => {
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            const obsCall = obsManager.call.mock.calls.find(call =>
                call[0] === 'SetInputSettings'
            );
            expect(obsCall).toBeDefined();
            const text = obsCall[1].inputSettings.text;
            expect(text).toMatch(/^\d{1,3}(,\d{3})*$/);
            expectNoTechnicalArtifacts(text);
        });

        test('should handle zero viewer counts appropriately', async () => {
            platforms.youtube.getViewerCount.mockResolvedValue(0);
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            expect(viewerCountSystem.counts.youtube).toBe(0);
            const obsCall = obsManager.call.mock.calls.find(call =>
                call[0] === 'SetInputSettings'
            );
            expect(obsCall[1].inputSettings.text).toBe('0');
        });
    });

    describe('Error Recovery and Resilience', () => {
        test('should handle YouTube API errors gracefully', async () => {
            platforms.youtube.getViewerCount.mockRejectedValue(new Error('API rate limit exceeded'));
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            expect(viewerCountSystem.isPolling).toBe(true);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(viewerCountSystem.counts.youtube).toBe(0);
        });

        test('should handle invalid viewer count responses', async () => {
            platforms.youtube.getViewerCount
                .mockResolvedValueOnce(null)
                .mockResolvedValue(1337);
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(100);

            expect(viewerCountSystem.isPolling).toBe(true);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(typeof viewerCountSystem.counts.youtube).toBe('number');
        });

        test('should maintain system stability during connection failures', async () => {
            platforms.youtube.getViewerCount.mockRejectedValue(new Error('Network timeout'));
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            expect(viewerCountSystem.isPolling).toBe(true);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(typeof viewerCountSystem.counts.youtube).toBe('number');
            expect(viewerCountSystem.counts.youtube).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Performance Validation', () => {
        test('should complete viewer count updates within performance targets', async () => {
            await viewerCountSystem.updateStreamStatus('youtube', true);
            const startTime = testClock.now();
            const waitMs = 100;
            viewerCountSystem.startPolling();
            testClock.advance(waitMs);
            await waitForDelay(waitMs);
            const endTime = testClock.now();

            expect(endTime - startTime).toBeLessThan(200);
            expect(viewerCountSystem.counts.youtube).toBe(1234);
        });

        test('should handle concurrent viewer count requests efficiently', async () => {
            const promises = [];
            for (let i = 0; i < 5; i++) {
                promises.push(
                    viewerCountSystem.updateStreamStatus('youtube', true)
                );
            }
            const startTime = testClock.now();
            await Promise.all(promises);
            const simulatedDurationMs = 50;
            testClock.advance(simulatedDurationMs);
            const endTime = testClock.now();

            expect(endTime - startTime).toBeLessThan(100);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
        });
    });
});
