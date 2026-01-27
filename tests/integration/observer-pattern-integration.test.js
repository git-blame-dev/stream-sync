
const { describe, test, beforeEach, afterEach, expect } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { ViewerCountSystem } = require('../../src/utils/viewer-count');
const { OBSViewerCountObserver } = require('../../src/observers/obs-viewer-count-observer');
const { createMockOBSManager } = require('../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../helpers/behavior-validation');
const { createSilentLogger } = require('../helpers/test-logger');
const testClock = require('../helpers/test-clock');
const { createConfigFixture } = require('../helpers/config-fixture');

const createTimeProvider = () => ({
    now: () => testClock.now(),
    createDate: (timestamp) => new Date(timestamp)
});

describe('Observer Pattern Integration', () => {
    let viewerCountSystem;
    let platforms;
    let logger;
    let testConfig;

    beforeEach(async () => {
        testClock.reset();
        testConfig = createConfigFixture();
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
            timeProvider: createTimeProvider(),
            config: testConfig
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
            const observer1 = createTestObserver('analytics-observer');
            const observer2 = createTestObserver('metrics-observer');

            viewerCountSystem.addObserver(observer1);
            viewerCountSystem.addObserver(observer2);

            expect(viewerCountSystem.observers.size).toBe(2);
            expect(viewerCountSystem.observers.has('analytics-observer')).toBe(true);
            expect(viewerCountSystem.observers.has('metrics-observer')).toBe(true);
        });

        test('should reject observers without required interface methods', () => {
            const invalidObserver = {
                onViewerCountUpdate: createMockFn()
            };

            expect(() => {
                viewerCountSystem.addObserver(invalidObserver);
            }).toThrow('Observer must implement getObserverId() method');
        });

        test('should allow observer removal by ID', () => {
            const observer = createTestObserver('removable-observer');
            viewerCountSystem.addObserver(observer);
            expect(viewerCountSystem.observers.size).toBe(1);

            viewerCountSystem.removeObserver('removable-observer');

            expect(viewerCountSystem.observers.size).toBe(0);
            expect(viewerCountSystem.observers.has('removable-observer')).toBe(false);
        });

        test('should handle duplicate observer IDs by replacing existing', () => {
            const observer1 = createTestObserver('duplicate-id');
            const observer2 = createTestObserver('duplicate-id');

            viewerCountSystem.addObserver(observer1);
            viewerCountSystem.addObserver(observer2);

            expect(viewerCountSystem.observers.size).toBe(1);
            expect(viewerCountSystem.observers.get('duplicate-id')).toBe(observer2);
        });
    });

    describe('Observer Notifications', () => {
        test('should notify all observers of viewer count updates', async () => {
            const observers = [
                createTestObserver('observer-1'),
                createTestObserver('observer-2'),
                createTestObserver('observer-3')
            ];
            observers.forEach(observer => viewerCountSystem.addObserver(observer));

            const expectedTimestampMs = testClock.now();
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

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
            const observer = createTestObserver('status-observer');
            viewerCountSystem.addObserver(observer);

            const firstTimestampMs = testClock.now();
            await viewerCountSystem.updateStreamStatus('youtube', true);
            testClock.advance(1000);
            const secondTimestampMs = testClock.now();
            await viewerCountSystem.updateStreamStatus('youtube', false);

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
            const observer = createTestObserver('metadata-observer');
            viewerCountSystem.addObserver(observer);

            const expectedTimestampMs = testClock.now();
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            const updateCall = observer.onViewerCountUpdate.mock.calls[0][0];
            expect(updateCall).toMatchObject({
                platform: 'youtube',
                count: 1000,
                previousCount: 0,
                isStreamLive: true
            });
            expect(updateCall.timestamp instanceof Date).toBe(true);
            expect(Number.isFinite(updateCall.timestamp.getTime())).toBe(true);
            expect(updateCall.timestamp.getTime()).toBe(expectedTimestampMs);
        });
    });

    describe('OBS Observer Integration', () => {
        const createMockConfig = () => ({
            twitch: { viewerCountEnabled: true, viewerCountSource: 'test-viewer-count-source' },
            youtube: { viewerCountEnabled: true, viewerCountSource: 'test-viewer-count-source' },
            tiktok: { viewerCountEnabled: true, viewerCountSource: 'test-viewer-count-source' }
        });

        test('should integrate OBS observer with ViewerCountSystem', async () => {
            const obsManager = createMockOBSManager();
            const obsObserver = new OBSViewerCountObserver(obsManager, createSilentLogger(), {
                config: createMockConfig()
            });
            viewerCountSystem.addObserver(obsObserver);

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputSettings: expect.objectContaining({
                        text: expect.any(String)
                    })
                })
            );
        });

        test('should handle OBS observer initialization and cleanup', async () => {
            const obsManager = createMockOBSManager();
            const obsObserver = new OBSViewerCountObserver(obsManager, createSilentLogger(), {
                config: createMockConfig()
            });

            viewerCountSystem.addObserver(obsObserver);
            await viewerCountSystem.initializeObservers();

            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputSettings: { text: '0' }
                })
            );

            await viewerCountSystem.cleanup();

            expect(viewerCountSystem.observers.size).toBe(0);
        });
    });

    describe('Error Handling and Resilience', () => {
        test('should handle observer errors gracefully without affecting others', async () => {
            const healthyObserver = createTestObserver('healthy-observer');
            const faultyObserver = createTestObserver('faulty-observer');
            faultyObserver.onViewerCountUpdate.mockRejectedValue(new Error('Observer crashed'));

            viewerCountSystem.addObserver(healthyObserver);
            viewerCountSystem.addObserver(faultyObserver);

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(100);

            expect(healthyObserver.onViewerCountUpdate).toHaveBeenCalled();
            expect(faultyObserver.onViewerCountUpdate).toHaveBeenCalled();
            expect(viewerCountSystem.counts.youtube).toBe(1000);
        });

        test('should handle observers that throw during initialization', async () => {
            const faultyObserver = createTestObserver('init-faulty-observer');
            faultyObserver.initialize.mockRejectedValue(new Error('Init failed'));
            const healthyObserver = createTestObserver('init-healthy-observer');

            viewerCountSystem.addObserver(faultyObserver);
            viewerCountSystem.addObserver(healthyObserver);

            await expect(viewerCountSystem.initializeObservers()).resolves.toBeUndefined();

            expect(healthyObserver.initialize).toHaveBeenCalled();
        });

        test('should handle observers that throw during cleanup', async () => {
            const faultyObserver = createTestObserver('cleanup-faulty-observer');
            faultyObserver.cleanup.mockRejectedValue(new Error('Cleanup failed'));
            const healthyObserver = createTestObserver('cleanup-healthy-observer');

            viewerCountSystem.addObserver(faultyObserver);
            viewerCountSystem.addObserver(healthyObserver);

            await expect(viewerCountSystem.cleanup()).resolves.toBeUndefined();

            expect(faultyObserver.cleanup).toHaveBeenCalled();
            expect(healthyObserver.cleanup).toHaveBeenCalled();
            expect(viewerCountSystem.observers.size).toBe(0);
        });
    });

    describe('Multiple Platform Observer Integration', () => {
        test('should notify observers of updates from multiple platforms', async () => {
            const multiPlatformObserver = createTestObserver('multi-platform-observer');
            viewerCountSystem.addObserver(multiPlatformObserver);

            await viewerCountSystem.updateStreamStatus('youtube', true);
            await viewerCountSystem.updateStreamStatus('twitch', true);
            viewerCountSystem.startPolling();
            await waitForDelay(100);

            const calls = multiPlatformObserver.onViewerCountUpdate.mock.calls;
            const platforms = calls.map(call => call[0].platform);

            expect(platforms).toContain('youtube');
            expect(platforms).toContain('twitch');
            expect(calls.length).toBeGreaterThanOrEqual(2);
        });

        test('should handle platform-specific observer filtering', async () => {
            const youtubeObserver = {
                getObserverId: () => 'youtube-only-observer',
                onViewerCountUpdate: createMockFn((update) => {
                    if (update.platform !== 'youtube') return;
                }),
                onStreamStatusChange: createMockFn()
            };
            viewerCountSystem.addObserver(youtubeObserver);

            await viewerCountSystem.updateStreamStatus('youtube', true);
            await viewerCountSystem.updateStreamStatus('twitch', true);
            viewerCountSystem.startPolling();
            await waitForDelay(100);

            expect(youtubeObserver.onViewerCountUpdate).toHaveBeenCalled();

            const calls = youtubeObserver.onViewerCountUpdate.mock.calls;
            expect(calls.some(call => call[0].platform === 'youtube')).toBe(true);
            expect(calls.some(call => call[0].platform === 'twitch')).toBe(true);
        });
    });

    describe('Observer Lifecycle Management', () => {
        test('should properly initialize observers during system startup', async () => {
            const observer1 = createTestObserver('lifecycle-observer-1');
            const observer2 = createTestObserver('lifecycle-observer-2');

            viewerCountSystem.addObserver(observer1);
            viewerCountSystem.addObserver(observer2);

            await viewerCountSystem.initializeObservers();

            expect(observer1.initialize).toHaveBeenCalled();
            expect(observer2.initialize).toHaveBeenCalled();
        });

        test('should support dynamic observer addition during runtime', async () => {
            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();

            const dynamicObserver = createTestObserver('dynamic-observer');
            viewerCountSystem.addObserver(dynamicObserver);

            await waitForDelay(100);

            expect(dynamicObserver.onViewerCountUpdate).toHaveBeenCalledWith(
                expect.objectContaining({
                    platform: 'youtube',
                    count: 1000
                })
            );
        });

        test('should support dynamic observer removal during runtime', async () => {
            const removableObserver = createTestObserver('removable-observer');
            viewerCountSystem.addObserver(removableObserver);

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            removableObserver.onViewerCountUpdate.mockClear();

            viewerCountSystem.removeObserver('removable-observer');

            await waitForDelay(100);

            expect(removableObserver.onViewerCountUpdate).not.toHaveBeenCalled();
        });
    });

    describe('Performance and Scalability', () => {
        test('should handle large numbers of observers with all receiving valid updates', async () => {
            const observers = [];
            for (let i = 0; i < 50; i++) {
                observers.push(createTestObserver(`observer-${i}`));
            }
            observers.forEach(observer => viewerCountSystem.addObserver(observer));

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(100);

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

            expect(viewerCountSystem.observers.size).toBe(50);
            expect(viewerCountSystem.counts.youtube).toBe(1000);
        });

        test('should handle concurrent observer notifications with all observers receiving updates', async () => {
            const asyncObservers = [];
            for (let i = 0; i < 10; i++) {
                const observer = createTestObserver(`async-observer-${i}`);
                observer.onViewerCountUpdate.mockImplementation(async () => {
                    await waitForDelay(10);
                });
                asyncObservers.push(observer);
            }
            asyncObservers.forEach(observer => viewerCountSystem.addObserver(observer));

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(150);

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
            const qualityObserver = createTestObserver('quality-observer');
            viewerCountSystem.addObserver(qualityObserver);

            await viewerCountSystem.updateStreamStatus('youtube', true);
            viewerCountSystem.startPolling();
            await waitForDelay(50);

            const updateData = qualityObserver.onViewerCountUpdate.mock.calls[0][0];

            expect(updateData.platform).toMatch(/^(youtube|twitch|tiktok)$/);
            expect(updateData.count).toBeGreaterThanOrEqual(0);
            expect(updateData.isStreamLive).toBe(true);
            expect(updateData.timestamp).toBeInstanceOf(Date);
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
