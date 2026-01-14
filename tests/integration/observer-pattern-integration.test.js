
const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { ViewerCountSystem } = require('../../src/utils/viewer-count');
const { ViewerCountObserver } = require('../../src/observers/viewer-count-observer');
const { OBSViewerCountObserver } = require('../../src/observers/obs-viewer-count-observer');

// Test utilities
const { createMockOBSManager } = require('../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../helpers/behavior-validation');
const { createSilentLogger } = require('../helpers/test-logger');
const testClock = require('../helpers/test-clock');

const createTimeProvider = () => ({
    now: () => testClock.now(),
    createDate: (timestamp) => new Date(timestamp)
});

describe('Observer Pattern Integration', () => {
    let viewerCountSystem;
    let platforms;
    let logger;
    
    beforeEach(async () => {
        testClock.reset();
        logger = createSilentLogger();
        platforms = {
            youtube: {
                getViewerCount: createMockFn().mockResolvedValue(1000),
                isEnabled: () => true
            },
            twitch: {
                getViewerCount: createMockFn().mockResolvedValue(2000),
                isEnabled: () => true
            }
        };
        
        viewerCountSystem = new ViewerCountSystem({
            platforms,
            logger,
            timeProvider: createTimeProvider()
        });
        await viewerCountSystem.initialize();
    });
    
    afterEach(async () => {
        if (viewerCountSystem) {
            viewerCountSystem.stopPolling();
            await viewerCountSystem.cleanup();
        }
        clearAllMocks();
        restoreAllMocks();
    });

    describe('Observer Registration and Management', () => {
        test('should register observers and assign unique IDs', () => {
            // Given: Two different observers
            const observer1 = createTestObserver('analytics-observer');
            const observer2 = createTestObserver('metrics-observer');
            
            // When: Registering observers
            viewerCountSystem.addObserver(observer1);
            viewerCountSystem.addObserver(observer2);
            
            // Then: Both should be registered with unique IDs
            expect(viewerCountSystem.observers.size).toBe(2);
            expect(viewerCountSystem.observers.has('analytics-observer')).toBe(true);
            expect(viewerCountSystem.observers.has('metrics-observer')).toBe(true);
        });

        test('should reject observers without required interface methods', () => {
            // Given: Invalid observer missing getObserverId
            const invalidObserver = {
                onViewerCountUpdate: createMockFn()
                // Missing getObserverId method
            };
            
            // When/Then: Registration should throw error
            expect(() => {
                viewerCountSystem.addObserver(invalidObserver);
            }).toThrow('Observer must implement getObserverId() method');
        });

        test('should allow observer removal by ID', () => {
            // Given: Registered observer
            const observer = createTestObserver('removable-observer');
            viewerCountSystem.addObserver(observer);
            expect(viewerCountSystem.observers.size).toBe(1);
            
            // When: Removing observer
            viewerCountSystem.removeObserver('removable-observer');
            
            // Then: Observer should be removed
            expect(viewerCountSystem.observers.size).toBe(0);
            expect(viewerCountSystem.observers.has('removable-observer')).toBe(false);
        });

        test('should handle duplicate observer IDs by replacing existing', () => {
            // Given: Observer with specific ID
            const observer1 = createTestObserver('duplicate-id');
            const observer2 = createTestObserver('duplicate-id');
            
            // When: Registering observers with same ID
            viewerCountSystem.addObserver(observer1);
            viewerCountSystem.addObserver(observer2);
            
            // Then: Should have only one observer (the latest)
            expect(viewerCountSystem.observers.size).toBe(1);
            expect(viewerCountSystem.observers.get('duplicate-id')).toBe(observer2);
        });
    });

    describe('Observer Notifications', () => {
        test('should notify all observers of viewer count updates', async () => {
            // Given: Multiple observers
            const observers = [
                createTestObserver('observer-1'),
                createTestObserver('observer-2'),
                createTestObserver('observer-3')
            ];
            
            observers.forEach(observer => viewerCountSystem.addObserver(observer));
            
            // When: Stream goes live and polling occurs
            const expectedTimestampMs = testClock.now();
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);
            
            // Then: All observers should receive updates
            observers.forEach(observer => {
                expect(observer.onViewerCountUpdate).toHaveBeenCalled();
                const updateCall = observer.onViewerCountUpdate.mock.calls[0][0];
                expect(updateCall).toMatchObject({
                    platform: 'youtube',
                    count: 1000,
                    isStreamLive: true
                });
                expect(updateCall.timestamp).toBeInstanceOf(Date);
                expect(updateCall.timestamp.getTime()).toBe(expectedTimestampMs);
            });
        });

        test('should notify observers of stream status changes', async () => {
            // Given: Registered observer
            const observer = createTestObserver('status-observer');
            viewerCountSystem.addObserver(observer);
            
            // When: Stream status changes
            const firstTimestampMs = testClock.now();
            await viewerCountSystem.updateStreamStatus('youtube', true);
            testClock.advance(1000);
            const secondTimestampMs = testClock.now();
            await viewerCountSystem.updateStreamStatus('youtube', false);
            
            // Then: Observer should receive status change notifications
            expect(observer.onStreamStatusChange).toHaveBeenCalledTimes(2);
            const firstCall = observer.onStreamStatusChange.mock.calls[0][0];
            const secondCall = observer.onStreamStatusChange.mock.calls[1][0];
            expect(firstCall).toMatchObject({
                platform: 'youtube',
                isLive: true,
                wasLive: false
            });
            expect(secondCall).toMatchObject({
                platform: 'youtube',
                isLive: false,
                wasLive: true
            });
            expect(firstCall.timestamp).toBeInstanceOf(Date);
            expect(secondCall.timestamp).toBeInstanceOf(Date);
            expect(firstCall.timestamp.getTime()).toBe(firstTimestampMs);
            expect(secondCall.timestamp.getTime()).toBe(secondTimestampMs);
        });

        test('should include correct metadata in observer notifications', async () => {
            // Given: Observer tracking metadata
            const observer = createTestObserver('metadata-observer');
            viewerCountSystem.addObserver(observer);
            
            // When: Viewer count updates
            const expectedTimestampMs = testClock.now();
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);
            
            // Then: Notification should include complete metadata
            const updateCall = observer.onViewerCountUpdate.mock.calls[0][0];
            expect(updateCall).toMatchObject({
                platform: 'youtube',
                count: 1000,
                previousCount: 0,
                isStreamLive: true
            });
            
            // Validate timestamp is a real Date value
            expect(updateCall.timestamp instanceof Date).toBe(true);
            expect(Number.isFinite(updateCall.timestamp.getTime())).toBe(true);
            expect(updateCall.timestamp.getTime()).toBe(expectedTimestampMs);
        });
    });

    describe('OBS Observer Integration', () => {
        test('should integrate OBS observer with ViewerCountSystem', async () => {
            // Given: OBS manager and observer
            const obsManager = createMockOBSManager();
            const obsObserver = new OBSViewerCountObserver(obsManager, createSilentLogger());
            
            viewerCountSystem.addObserver(obsObserver);
            
            // When: Viewer count updates
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);
            
            // Then: OBS should be updated
            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputSettings: expect.objectContaining({
                        text: expect.any(String)
                    })
                })
            );
        });

        test('should handle OBS observer initialization and cleanup', async () => {
            // Given: OBS observer
            const obsManager = createMockOBSManager();
            const obsObserver = new OBSViewerCountObserver(obsManager, createSilentLogger());
            
            // When: Adding and initializing observer
            viewerCountSystem.addObserver(obsObserver);
            await viewerCountSystem.initializeObservers();
            
            // Then: OBS should be initialized with zero counts
            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputSettings: { text: '0' }
                })
            );
            
            // When: Cleaning up
            await viewerCountSystem.cleanup();
            
            // Then: Should complete without errors
            expect(viewerCountSystem.observers.size).toBe(0);
        });
    });

    describe('Error Handling and Resilience', () => {
        test('should handle observer errors gracefully without affecting others', async () => {
            // Given: Mix of healthy and faulty observers
            const healthyObserver = createTestObserver('healthy-observer');
            const faultyObserver = createTestObserver('faulty-observer');
            faultyObserver.onViewerCountUpdate.mockRejectedValue(new Error('Observer crashed'));
            
            viewerCountSystem.addObserver(healthyObserver);
            viewerCountSystem.addObserver(faultyObserver);
            
            // When: Viewer count updates (should not throw)
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            // Wait for notifications
            await waitForDelay(100);
            
            // Then: Healthy observer should still receive updates
            expect(healthyObserver.onViewerCountUpdate).toHaveBeenCalled();
            expect(faultyObserver.onViewerCountUpdate).toHaveBeenCalled();
            
            // And: System should continue functioning
            expect(viewerCountSystem.counts.youtube).toBe(1000);
        });

        test('should handle observers that throw during initialization', async () => {
            // Given: Observer that fails during initialization
            const faultyObserver = createTestObserver('init-faulty-observer');
            faultyObserver.initialize.mockRejectedValue(new Error('Init failed'));
            
            const healthyObserver = createTestObserver('init-healthy-observer');
            
            viewerCountSystem.addObserver(faultyObserver);
            viewerCountSystem.addObserver(healthyObserver);
            
            // When: Initializing observers (should not throw)
            await expect(viewerCountSystem.initializeObservers()).resolves.toBeUndefined();
            
            // Then: Healthy observer should still be initialized
            expect(healthyObserver.initialize).toHaveBeenCalled();
        });

        test('should handle observers that throw during cleanup', async () => {
            // Given: Observer that fails during cleanup
            const faultyObserver = createTestObserver('cleanup-faulty-observer');
            faultyObserver.cleanup.mockRejectedValue(new Error('Cleanup failed'));
            
            const healthyObserver = createTestObserver('cleanup-healthy-observer');
            
            viewerCountSystem.addObserver(faultyObserver);
            viewerCountSystem.addObserver(healthyObserver);
            
            // When: Cleaning up (should not throw)
            await expect(viewerCountSystem.cleanup()).resolves.toBeUndefined();
            
            // Then: Both observers should have cleanup attempted
            expect(faultyObserver.cleanup).toHaveBeenCalled();
            expect(healthyObserver.cleanup).toHaveBeenCalled();
            
            // And: Observer list should be cleared
            expect(viewerCountSystem.observers.size).toBe(0);
        });
    });

    describe('Multiple Platform Observer Integration', () => {
        test('should notify observers of updates from multiple platforms', async () => {
            // Given: Observer tracking all platforms
            const multiPlatformObserver = createTestObserver('multi-platform-observer');
            viewerCountSystem.addObserver(multiPlatformObserver);
            
            // When: Multiple platforms go live
            await viewerCountSystem.updateStreamStatus('youtube', true);
            await viewerCountSystem.updateStreamStatus('twitch', true);
            
            viewerCountSystem.startPolling();
            await waitForDelay(100);
            
            // Then: Observer should receive updates from both platforms
            const calls = multiPlatformObserver.onViewerCountUpdate.mock.calls;
            const platforms = calls.map(call => call[0].platform);
            
            expect(platforms).toContain('youtube');
            expect(platforms).toContain('twitch');
            expect(calls.length).toBeGreaterThanOrEqual(2);
        });

        test('should handle platform-specific observer filtering', async () => {
            // Given: Observer that only cares about YouTube
            const youtubeObserver = {
                getObserverId: () => 'youtube-only-observer',
                onViewerCountUpdate: createMockFn((update) => {
                    // Only process YouTube updates
                    if (update.platform !== 'youtube') return;
                    // Process YouTube update...
                }),
                onStreamStatusChange: createMockFn()
            };
            
            viewerCountSystem.addObserver(youtubeObserver);
            
            // When: Both platforms update
            await viewerCountSystem.updateStreamStatus('youtube', true);
            await viewerCountSystem.updateStreamStatus('twitch', true);
            
            viewerCountSystem.startPolling();
            await waitForDelay(100);
            
            // Then: Observer should receive all updates but can filter internally
            expect(youtubeObserver.onViewerCountUpdate).toHaveBeenCalled();
            
            const calls = youtubeObserver.onViewerCountUpdate.mock.calls;
            expect(calls.some(call => call[0].platform === 'youtube')).toBe(true);
            expect(calls.some(call => call[0].platform === 'twitch')).toBe(true);
        });
    });

    describe('Observer Lifecycle Management', () => {
        test('should properly initialize observers during system startup', async () => {
            // Given: Observers with initialization logic
            const observer1 = createTestObserver('lifecycle-observer-1');
            const observer2 = createTestObserver('lifecycle-observer-2');
            
            viewerCountSystem.addObserver(observer1);
            viewerCountSystem.addObserver(observer2);
            
            // When: Initializing system
            await viewerCountSystem.initializeObservers();
            
            // Then: All observers should be initialized
            expect(observer1.initialize).toHaveBeenCalled();
            expect(observer2.initialize).toHaveBeenCalled();
        });

        test('should support dynamic observer addition during runtime', async () => {
            // Given: System already running
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            
            // When: Adding observer during runtime
            const dynamicObserver = createTestObserver('dynamic-observer');
            viewerCountSystem.addObserver(dynamicObserver);
            
            // Wait for next polling cycle
            await waitForDelay(100);
            
            // Then: New observer should receive updates
            expect(dynamicObserver.onViewerCountUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    platform: 'youtube',
                    count: 1000
                })
            );
        });

        test('should support dynamic observer removal during runtime', async () => {
            // Given: System running with observer
            const removableObserver = createTestObserver('removable-observer');
            viewerCountSystem.addObserver(removableObserver);
            
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);
            
            // Clear previous calls
            removableObserver.onViewerCountUpdate.mockClear();
            
            // When: Removing observer during runtime
            viewerCountSystem.removeObserver('removable-observer');
            
            // Wait for next polling cycle
            await waitForDelay(100);
            
            // Then: Removed observer should not receive further updates
            expect(removableObserver.onViewerCountUpdate).not.toHaveBeenCalled();
        });
    });

    describe('Performance and Scalability', () => {
        test('should handle large numbers of observers with all receiving valid updates', async () => {
            // Given: Many observers (50 observers simulating high-scale scenario)
            const observers = [];
            for (let i = 0; i < 50; i++) {
                observers.push(createTestObserver(`observer-${i}`));
            }
            
            observers.forEach(observer => viewerCountSystem.addObserver(observer));
            
            // When: Updating viewer count
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(100);
            
            // Then: All observers should receive valid, complete updates
            observers.forEach(observer => {
                expect(observer.onViewerCountUpdate).toHaveBeenCalledWith(
                    expect.objectContaining({
                        platform: 'youtube',
                        count: 1000,
                        isStreamLive: true,
                        timestamp: expect.any(Date)
                    })
                );
            });
            
            // And: System should remain stable with high observer count
            expect(viewerCountSystem.observers.size).toBe(50);
            expect(viewerCountSystem.counts.youtube).toBe(1000);
        });

        test('should handle concurrent observer notifications with all observers receiving updates', async () => {
            // Given: Observers with async processing
            const asyncObservers = [];
            for (let i = 0; i < 10; i++) {
                const observer = createTestObserver(`async-observer-${i}`);
                observer.onViewerCountUpdate.mockImplementation(async () => {
                    // Simulate async processing
                    await waitForDelay(10);
                });
                asyncObservers.push(observer);
            }
            
            asyncObservers.forEach(observer => viewerCountSystem.addObserver(observer));
            
            // When: Triggering notifications
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(150);
            
            // Then: All observers should complete processing and receive valid updates
            asyncObservers.forEach(observer => {
                expect(observer.onViewerCountUpdate).toHaveBeenCalledWith(
                    expect.objectContaining({
                        platform: 'youtube',
                        count: 1000,
                        isStreamLive: true,
                        timestamp: expect.any(Date)
                    })
                );
            });
        });
    });

    describe('Content Quality Validation', () => {
        test('should provide user-friendly data to observers', async () => {
            // Given: Observer tracking notification quality
            const qualityObserver = createTestObserver('quality-observer');
            viewerCountSystem.addObserver(qualityObserver);
            
            // When: Viewer count updates
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);
            
            // Then: Observer data should be user-friendly
            const updateData = qualityObserver.onViewerCountUpdate.mock.calls[0][0];
            
            expect(updateData.platform).toMatch(/^(youtube|twitch|tiktok)$/);
            expect(updateData.count).toBeGreaterThanOrEqual(0);
            expect(updateData.isStreamLive).toBe(true);
            expect(updateData.timestamp).toBeInstanceOf(Date);
            
            // No technical artifacts in platform name
            expectNoTechnicalArtifacts(updateData.platform);
        });
    });
});

// Helper function to create test observers
function createTestObserver(id) {
    return {
        getObserverId: () => id,
        onViewerCountUpdate: createMockFn(),
        onStreamStatusChange: createMockFn(),
        initialize: createMockFn(),
        cleanup: createMockFn()
    };
}
