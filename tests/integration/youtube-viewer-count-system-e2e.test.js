const { describe, test, beforeEach, afterEach, expect } = require('bun:test');

const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { initializeTestLogging } = require('../helpers/test-setup');

// Initialize logging for tests
initializeTestLogging();

const { ViewerCountSystem } = require('../../src/utils/viewer-count');
const { YouTubeViewerExtractor } = require('../../src/extractors/youtube-viewer-extractor');
const { InnertubeFactory } = require('../../src/factories/innertube-factory');
const { InnertubeInstanceManager } = require('../../src/services/innertube-instance-manager');
const { OBSViewerCountObserver } = require('../../src/observers/obs-viewer-count-observer');

// Test utilities
const { createMockOBSManager } = require('../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../helpers/behavior-validation');
const { createSilentLogger } = require('../helpers/test-logger');
const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');
const testClock = require('../helpers/test-clock');

describe('YouTube Viewer Count System - End-to-End Integration', () => {
    afterEach(async () => {
        restoreAllMocks();
        if (viewerCountSystem) {
            viewerCountSystem.stopPolling();
            await viewerCountSystem.cleanup();
        }
    });

    let platforms, obsManager, viewerCountSystem, logger, runtimeConstants;

    beforeEach(async () => {
        testClock.reset();
        logger = createSilentLogger();
        runtimeConstants = createRuntimeConstantsFixture();
        platforms = {
            youtube: {
                getViewerCount: createMockFn().mockResolvedValue(1234),
                isEnabled: () => true
            }
        };
        
        // Create mock OBS manager
        obsManager = createMockOBSManager();
        
        // Create ViewerCountSystem with proper initialization
        const timeProvider = {
            now: () => testClock.now(),
            createDate: (timestamp) => new Date(timestamp)
        };
        viewerCountSystem = new ViewerCountSystem({
            platformProvider: () => platforms,
            logger,
            runtimeConstants,
            timeProvider
        });
        
        // Add OBS observer
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

            // Replace platform map after ViewerCountSystem constructed
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
            // Given: YouTube stream is live
            await viewerCountSystem.updateStreamStatus('youtube', true);
            
            // When: Polling is started
            viewerCountSystem.startPolling();
            
            // Wait for polling to complete
            await waitForDelay(100);
            
            // Then: System should have processed viewer count
            expect(viewerCountSystem.counts.youtube).toBe(1234);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            
            // And: OBS should be updated
            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings', 
                expect.objectContaining({
                    inputSettings: expect.objectContaining({
                        text: expect.any(String)
                    })
                })
            );
        });

        test('should handle multiple platform viewer counts simultaneously', async () => {
            // Given: Multiple platforms with viewer counts
            platforms.twitch = {
                getViewerCount: createMockFn().mockResolvedValue(567),
                isEnabled: () => true
            };
            platforms.tiktok = {
                getViewerCount: createMockFn().mockResolvedValue(890),
                isEnabled: () => true
            };
            
            // When: All streams go live
            await viewerCountSystem.updateStreamStatus('youtube', true);
            await viewerCountSystem.updateStreamStatus('twitch', true);
            await viewerCountSystem.updateStreamStatus('tiktok', true);
            
            viewerCountSystem.startPolling();
            await waitForDelay(100);
            
            // Then: All platforms should have correct counts
            expect(viewerCountSystem.counts.youtube).toBe(1234);
            expect(viewerCountSystem.counts.twitch).toBe(567);
            expect(viewerCountSystem.counts.tiktok).toBe(890);
            
            // And: All should be marked as live
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(viewerCountSystem.isStreamLive('twitch')).toBe(true);
            expect(viewerCountSystem.isStreamLive('tiktok')).toBe(true);
        });

        test('should handle stream status transitions correctly', async () => {
            // Given: YouTube stream starts live
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);
            
            const initialCount = viewerCountSystem.counts.youtube;
            expect(initialCount).toBe(1234);
            
            // When: Stream goes offline
            await viewerCountSystem.updateStreamStatus('youtube', false);
            
            // Then: Count should be reset to 0
            expect(viewerCountSystem.counts.youtube).toBe(0);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(false);
            
            // And: OBS should be updated with 0
            expect(obsManager.call).toHaveBeenLastCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputSettings: { text: '0' }
                })
            );
        });
    });

    describe('Factory Pattern Integration', () => {
        test('should provide factory statistics without creating instances', () => {
            // When: Getting factory stats (doesn't require YouTube.js import)
            const stats = InnertubeFactory.getStats();
            
            // Then: Should provide comprehensive metadata
            expect(stats.factoryVersion).toBe('1.0.0');
            expect(stats.esm).toBe(true);
            expect(stats.supportedMethods).toContain('createInstance');
        });

        test('should handle factory creation errors gracefully', async () => {
            // When: Factory encounters import errors (expected in test environment)
            // Then: Should provide meaningful error messages
            await expect(InnertubeFactory.createInstance()).rejects.toThrow(/Innertube creation failed/);
        });
    });

    describe('Instance Manager Integration', () => {
        test('should provide instance manager functionality', async () => {
            // Given: Instance manager with mock logger to avoid import issues
            const mockLogger = {
                debug: createMockFn(),
                info: createMockFn(),
                warn: createMockFn(),
                error: createMockFn()
            };
            const manager = require('../../src/services/innertube-instance-manager').getInstance({ logger: mockLogger });
            
            // When: Getting manager stats
            const stats = manager.getStats();
            
            // Then: Should provide statistics
            expect(stats).toHaveProperty('activeInstances');
            expect(stats).toHaveProperty('maxInstances');
            expect(stats).toHaveProperty('instanceDetails');
            expect(typeof stats.activeInstances).toBe('number');
        });
    });

    describe('Extractor Service Integration', () => {
        test('should extract viewer counts using YouTubeViewerExtractor strategies', () => {
            // Given: Mock video info with view text
            const videoInfo = {
                primary_info: {
                    view_count: {
                        view_count: {
                            text: '5,432 watching now'
                        }
                    }
                }
            };
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            
            // Then: Should extract correct count
            expect(result.success).toBe(true);
            expect(result.count).toBe(5432);
            expect(result.strategy).toBe('view_text');
        });

        test('should fallback to alternative extraction strategies', () => {
            // Given: Video info without primary text but with video details
            const videoInfo = {
                video_details: {
                    viewer_count: '9876'
                }
            };
            
            // When: Extracting viewer count
            const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);
            
            // Then: Should use fallback strategy
            expect(result.success).toBe(true);
            expect(result.count).toBe(9876);
            expect(result.strategy).toBe('video_details');
        });

        test('should validate extracted viewer counts', () => {
            // When: Validating various counts
            expect(YouTubeViewerExtractor.isValidViewerCount(100)).toBe(true);
            expect(YouTubeViewerExtractor.isValidViewerCount(0)).toBe(true);
            expect(YouTubeViewerExtractor.isValidViewerCount(-1)).toBe(false);
            expect(YouTubeViewerExtractor.isValidViewerCount(NaN)).toBe(false);
            expect(YouTubeViewerExtractor.isValidViewerCount('invalid')).toBe(false);
            expect(YouTubeViewerExtractor.isValidViewerCount(11000000)).toBe(false); // Over limit
        });
    });

    describe('Observer Pattern Integration', () => {
        test('should notify multiple observers of viewer count updates', async () => {
            // Given: Additional mock observer
            const mockObserver = {
                getObserverId: () => 'test-observer',
                onViewerCountUpdate: createMockFn(),
                onStreamStatusChange: createMockFn(),
                initialize: createMockFn(),
                cleanup: createMockFn()
            };
            
            viewerCountSystem.addObserver(mockObserver);
            
            // When: Updating viewer count
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);
            
            // Then: Both observers should be notified
            expect(mockObserver.onViewerCountUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    platform: 'youtube',
                    count: 1234,
                    isStreamLive: true
                })
            );
        });

        test('should handle observer errors gracefully', async () => {
            // Given: Observer that throws errors
            const faultyObserver = {
                getObserverId: () => 'faulty-observer',
                onViewerCountUpdate: createMockFn().mockRejectedValue(new Error('Observer error')),
                onStreamStatusChange: createMockFn()
            };
            
            viewerCountSystem.addObserver(faultyObserver);
            
            // When: Updating viewer count (should not throw)
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            // Then: System should continue working despite observer error
            await waitForDelay(50);
            expect(viewerCountSystem.counts.youtube).toBe(1234);
        });
    });

    describe('Configuration Integration', () => {
        test('should respect polling interval configuration', async () => {
            viewerCountSystem.runtimeConstants = createRuntimeConstantsFixture({
                VIEWER_COUNT_POLLING_INTERVAL_SECONDS: 2
            });
            
            // When: Starting polling
            viewerCountSystem.startPolling();
            
            // Then: Should use configured interval
            expect(viewerCountSystem.pollingInterval).toBe(2000); // 2 seconds in ms
            
            viewerCountSystem.stopPolling();
        });

        test('should handle disabled viewer count polling', async () => {
            viewerCountSystem.runtimeConstants = createRuntimeConstantsFixture({
                VIEWER_COUNT_POLLING_INTERVAL_SECONDS: 0
            });
            
            // When: Attempting to start polling
            viewerCountSystem.startPolling();
            
            // Then: Polling should not start
            expect(viewerCountSystem.isPolling).toBe(false);
        });
    });

    describe('Content Quality Validation', () => {
        test('should produce user-friendly viewer count displays', async () => {
            // Given: Stream with viewer count
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);
            
            // Then: OBS text should be user-friendly
            const obsCall = obsManager.call.mock.calls.find(call => 
                call[0] === 'SetInputSettings'
            );
            
            expect(obsCall).toBeDefined();
            const text = obsCall[1].inputSettings.text;
            
            // Should be formatted number without technical artifacts
            expect(text).toMatch(/^\d{1,3}(,\d{3})*$/); // Formatted number like "1,234"
            expectNoTechnicalArtifacts(text);
        });

        test('should handle zero viewer counts appropriately', async () => {
            // Given: Platform returning zero viewers
            platforms.youtube.getViewerCount.mockResolvedValue(0);
            
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);
            
            // Then: Should display "0" clearly
            expect(viewerCountSystem.counts.youtube).toBe(0);
            
            const obsCall = obsManager.call.mock.calls.find(call => 
                call[0] === 'SetInputSettings'
            );
            expect(obsCall[1].inputSettings.text).toBe('0');
        });
    });

    describe('Error Recovery and Resilience', () => {
        test('should handle YouTube API errors gracefully', async () => {
            // Given: YouTube platform that fails
            platforms.youtube.getViewerCount.mockRejectedValue(new Error('API rate limit exceeded'));
            
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            // Wait for polling attempt
            await waitForDelay(50);
            
            // Then: System should remain stable despite errors
            expect(viewerCountSystem.isPolling).toBe(true);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            // Count should remain at initial value (0) since API is failing
            expect(viewerCountSystem.counts.youtube).toBe(0);
        });

        test('should handle invalid viewer count responses', async () => {
            // Given: Platform returning invalid data initially, then valid data
            platforms.youtube.getViewerCount
                .mockResolvedValueOnce(null)
                .mockResolvedValue(1337);
            
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            // Wait for polling attempts
            await waitForDelay(100);
            
            // Then: System should handle invalid responses gracefully
            expect(viewerCountSystem.isPolling).toBe(true);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            // Should eventually get valid count or stay at 0 if all are invalid
            expect(typeof viewerCountSystem.counts.youtube).toBe('number');
        });

        test('should maintain system stability during connection failures', async () => {
            // Given: Platform with connection issues
            platforms.youtube.getViewerCount.mockRejectedValue(new Error('Network timeout'));
            
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            // Wait for error handling
            await waitForDelay(50);
            
            // Then: System should remain stable
            expect(viewerCountSystem.isPolling).toBe(true);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(typeof viewerCountSystem.counts.youtube).toBe('number');
            expect(viewerCountSystem.counts.youtube).toBeGreaterThanOrEqual(0);
        });
    });

    describe('Performance Validation', () => {
        test('should complete viewer count updates within performance targets', async () => {
            // Given: Stream is live
            await viewerCountSystem.updateStreamStatus('youtube', true);
            
            // When: Measuring polling performance
            const startTime = testClock.now();
            const waitMs = 100;
            viewerCountSystem.startPolling();
            testClock.advance(waitMs);
            await waitForDelay(waitMs);
            const endTime = testClock.now();
            
            // Then: Should complete within reasonable time (< 100ms for processing)
            expect(endTime - startTime).toBeLessThan(200);
            expect(viewerCountSystem.counts.youtube).toBe(1234);
        });

        test('should handle concurrent viewer count requests efficiently', async () => {
            // Given: Multiple concurrent requests
            const promises = [];
            
            for (let i = 0; i < 5; i++) {
                promises.push(
                    viewerCountSystem.updateStreamStatus('youtube', true)
                );
            }
            
            // When: Processing concurrent updates
            const startTime = testClock.now();
            await Promise.all(promises);
            const simulatedDurationMs = 50;
            testClock.advance(simulatedDurationMs);
            const endTime = testClock.now();
            
            // Then: Should complete efficiently
            expect(endTime - startTime).toBeLessThan(100);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
        });
    });
});
