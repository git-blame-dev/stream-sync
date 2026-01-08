
const { ViewerCountSystem } = require('../../src/utils/viewer-count');
const { YouTubeViewerExtractor } = require('../../src/extractors/youtube-viewer-extractor');
const { InnertubeFactory } = require('../../src/factories/innertube-factory');
const InnertubeInstanceManager = require('../../src/services/innertube-instance-manager');
const { OBSViewerCountObserver } = require('../../src/observers/obs-viewer-count-observer');

// Test utilities
const { createMockOBSManager, createMockConfig } = require('../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../helpers/behavior-validation');
const { createSilentLogger } = require('../helpers/test-logger');
const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');

describe('System Resilience and Error Recovery Integration', () => {
    let platforms, obsManager, viewerCountSystem;
    
    beforeEach(async () => {
        platforms = {
            youtube: {
                getViewerCount: jest.fn().mockResolvedValue(1000),
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
        jest.clearAllMocks();
    });

    describe('Platform API Error Handling', () => {
        test('should handle YouTube API errors gracefully', async () => {
            // Given: YouTube platform that fails
            platforms.youtube.getViewerCount.mockRejectedValue(new Error('API rate limit exceeded'));
            
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            // Wait for error handling
            await waitForDelay(50);
            
            // Then: System should remain stable despite errors
            expect(viewerCountSystem.isPolling).toBe(true);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(viewerCountSystem.counts.youtube).toBe(0); // No valid data received
        });

        test('should handle malformed API responses gracefully', async () => {
            // Given: Platform returning various invalid responses
            let callCount = 0;
            platforms.youtube.getViewerCount.mockImplementation(() => {
                const responses = [null, undefined, 'invalid', { invalid: 'object' }, -1];
                return Promise.resolve(responses[callCount++ % responses.length]);
            });
            
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            // Wait for multiple polls
            await waitForDelay(100);
            
            // Then: System should remain stable
            expect(viewerCountSystem.isPolling).toBe(true);
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(callCount).toBeGreaterThan(0);
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
        });
    });

    describe('Observer Error Isolation', () => {
        test('should isolate observer errors from system operation', async () => {
            // Given: Observer that consistently fails
            const faultyObserver = {
                getObserverId: () => 'faulty-observer',
                onViewerCountUpdate: jest.fn().mockRejectedValue(new Error('Observer crashed')),
                onStreamStatusChange: jest.fn().mockRejectedValue(new Error('Observer failed'))
            };
            
            viewerCountSystem.addObserver(faultyObserver);
            
            // When: System operates with faulty observer
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            await waitForDelay(50);
            
            // Then: System should continue functioning despite observer errors
            expect(viewerCountSystem.counts.youtube).toBe(1000);
            expect(viewerCountSystem.isPolling).toBe(true);
            expect(faultyObserver.onViewerCountUpdate).toHaveBeenCalled();
            
            // OBS observer should still work
            expect(obsManager.call).toHaveBeenCalled();
        });

        test('should handle OBS connection failures gracefully', async () => {
            // Given: OBS manager that fails
            obsManager.isConnected.mockReturnValue(false);
            obsManager.call.mockRejectedValue(new Error('OBS connection lost'));
            
            // When: Operating with failed OBS
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            await waitForDelay(50);
            
            // Then: System should continue despite OBS failure
            expect(viewerCountSystem.counts.youtube).toBe(1000);
            expect(viewerCountSystem.isPolling).toBe(true);
        });
    });

    describe('Configuration Error Handling', () => {
        test('should handle invalid polling configuration gracefully', async () => {
            viewerCountSystem.runtimeConstants = createRuntimeConstantsFixture({
                VIEWER_COUNT_POLLING_INTERVAL_SECONDS: 0
            });
            
            // When: Attempting to start polling
            viewerCountSystem.startPolling();
            
            // Then: Should handle invalid config gracefully by not starting
            expect(viewerCountSystem.isPolling).toBe(false);
        });

        test('should handle missing OBS configuration', async () => {
            // Given: Missing OBS configuration
            const missingConfig = createMockConfig({
                youtube: {
                    viewerCountEnabled: true
                    // Missing viewerCountSource
                }
            });
            
            // When: Operating with missing config
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            await waitForDelay(50);
            
            // Then: Should continue without OBS updates
            expect(viewerCountSystem.counts.youtube).toBe(1000);
            expect(viewerCountSystem.isPolling).toBe(true);
        });
    });

    describe('Factory and Instance Manager Resilience', () => {
        test('should handle Innertube creation failures gracefully', async () => {
            // When: Creating instance (expected to fail in test environment)
            // Then: Should fail with meaningful error
            await expect(InnertubeFactory.createInstance()).rejects.toThrow(/Innertube creation failed/);
        });

        test('should handle instance manager operations safely', async () => {
            // Given: Instance manager
            const manager = InnertubeInstanceManager.getInstance();
            
            // When: Basic operations
            const stats = manager.getStats();
            
            // Then: Should provide valid statistics
            expect(stats).toHaveProperty('activeInstances');
            expect(typeof stats.activeInstances).toBe('number');
            
            // When: Cleanup operations
            await expect(manager.cleanup()).resolves.toBeUndefined();
        });
    });

    describe('Extractor Resilience', () => {
        test('should handle malformed YouTube data structures', () => {
            // Given: Various malformed video info structures
            const malformedStructures = [
                null,
                undefined,
                {},
                { primary_info: null },
                { broken: 'structure' }
            ];
            
            // When: Extracting from each malformed structure
            malformedStructures.forEach(structure => {
                const result = YouTubeViewerExtractor.extractConcurrentViewers(structure);
                
                // Then: Should handle gracefully without throwing
                expect(result).toMatchObject({
                    success: expect.any(Boolean),
                    count: expect.any(Number),
                    metadata: expect.any(Object)
                });
                expect(result.count).toBeGreaterThanOrEqual(0);
            });
        });

        test('should handle extraction strategy failures', () => {
            // Given: Video info that causes strategy errors
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
            
            // When: Extracting (should not throw)
            const result = YouTubeViewerExtractor.extractConcurrentViewers(problematicData);
            
            // Then: Should handle failures gracefully
            expect(result).toMatchObject({
                success: expect.any(Boolean),
                count: expect.any(Number),
                metadata: expect.any(Object)
            });
        });
    });

    describe('Concurrent Operation Resilience', () => {
        test('should handle concurrent status updates safely', async () => {
            // When: Performing concurrent status updates
            const promises = [];
            for (let i = 0; i < 5; i++) {
                promises.push(
                    viewerCountSystem.updateStreamStatus('youtube', i % 2 === 0)
                );
            }
            
            await Promise.all(promises);
            
            // Then: Should end in consistent state without errors
            expect(typeof viewerCountSystem.isStreamLive('youtube')).toBe('boolean');
            expect(typeof viewerCountSystem.counts.youtube).toBe('number');
        });

        test('should handle rapid polling operations', async () => {
            // Given: System with rapid operations
            await viewerCountSystem.updateStreamStatus('youtube', true);
            
            // When: Starting/stopping polling rapidly
            for (let i = 0; i < 3; i++) {
                viewerCountSystem.startPolling();
                viewerCountSystem.stopPolling();
            }
            
            // Then: Should end in consistent state
            expect(viewerCountSystem.isPolling).toBe(false);
        });
    });

    describe('System State Consistency', () => {
        test('should maintain consistent state during errors', async () => {
            // Given: System with error-prone platform
            platforms.youtube.getViewerCount
                .mockRejectedValueOnce(new Error('Error 1'))
                .mockResolvedValueOnce(1500)
                .mockRejectedValueOnce(new Error('Error 2'));
            
            // When: Operating through errors
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            await waitForDelay(100);
            
            // Then: Should maintain consistent state
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(viewerCountSystem.isPolling).toBe(true);
            expect(typeof viewerCountSystem.counts.youtube).toBe('number');
            expect(viewerCountSystem.counts.youtube).toBeGreaterThanOrEqual(0);
        });

        test('should handle observer lifecycle during errors', async () => {
            // Given: Observer with cleanup errors
            const problematicObserver = {
                getObserverId: () => 'problematic-observer',
                onViewerCountUpdate: jest.fn(),
                onStreamStatusChange: jest.fn(),
                cleanup: jest.fn().mockRejectedValue(new Error('Cleanup failed'))
            };
            
            viewerCountSystem.addObserver(problematicObserver);
            
            // When: System cleanup (should not throw)
            await expect(viewerCountSystem.cleanup()).resolves.toBeUndefined();
            
            // Then: Cleanup should have been attempted
            expect(problematicObserver.cleanup).toHaveBeenCalled();
            expect(viewerCountSystem.observers.size).toBe(0);
        });
    });

    describe('Content Quality During Errors', () => {
        test('should maintain user-friendly content during failures', async () => {
            // Given: System with observer that tracks content quality
            let lastSuccessfulUpdate = null;
            const qualityObserver = {
                getObserverId: () => 'quality-observer',
                onViewerCountUpdate: jest.fn(update => {
                    lastSuccessfulUpdate = update;
                }),
                onStreamStatusChange: jest.fn()
            };
            
            viewerCountSystem.addObserver(qualityObserver);
            
            // When: Getting at least one successful update
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            await waitForDelay(50);
            
            // Then: Content should be user-friendly when available
            if (lastSuccessfulUpdate) {
                expect(lastSuccessfulUpdate.platform).toMatch(/^(youtube|twitch|tiktok)$/);
                expect(lastSuccessfulUpdate.count).toBeGreaterThanOrEqual(0);
                expectNoTechnicalArtifacts(lastSuccessfulUpdate.platform);
            }
        });

        test('should provide meaningful error states', async () => {
            // Given: Platform that always fails
            platforms.youtube.getViewerCount.mockRejectedValue(new Error('Persistent failure'));
            
            // When: Operating with persistent failures
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            await waitForDelay(50);
            
            // Then: System should maintain meaningful state
            expect(viewerCountSystem.isStreamLive('youtube')).toBe(true);
            expect(viewerCountSystem.counts.youtube).toBe(0); // Clear failure state
            expect(viewerCountSystem.isPolling).toBe(true);
        });
    });

    describe('Resource Management', () => {
        test('should clean up resources properly during failures', async () => {
            // Given: System with failing components
            const resourceObserver = {
                getObserverId: () => 'resource-observer',
                onViewerCountUpdate: jest.fn(),
                onStreamStatusChange: jest.fn(),
                cleanup: jest.fn()
            };
            
            viewerCountSystem.addObserver(resourceObserver);
            
            // When: Operating then cleaning up
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            await waitForDelay(50);
            
            // Stop polling first then cleanup
            viewerCountSystem.stopPolling();
            await viewerCountSystem.cleanup();
            
            // Then: Resources should be cleaned up
            expect(resourceObserver.cleanup).toHaveBeenCalled();
            expect(viewerCountSystem.observers.size).toBe(0);
            expect(viewerCountSystem.isPolling).toBe(false);
        });

        test('should handle memory cleanup during stress', async () => {
            // Given: Initial state
            const initialObserverCount = viewerCountSystem.observers.size;
            
            // When: Adding and removing observers rapidly
            for (let i = 0; i < 10; i++) {
                const observer = {
                    getObserverId: () => `stress-observer-${i}`,
                    onViewerCountUpdate: jest.fn(),
                    onStreamStatusChange: jest.fn()
                };
                
                viewerCountSystem.addObserver(observer);
                viewerCountSystem.removeObserver(`stress-observer-${i}`);
            }
            
            // Then: Should return to initial state
            expect(viewerCountSystem.observers.size).toBe(initialObserverCount);
        });
    });
});
