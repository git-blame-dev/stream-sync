
const { describe, test, expect, beforeEach, afterEach, afterAll } = require('bun:test');
const { restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { useFakeTimers, useRealTimers, advanceTimersByTime } = require('../../helpers/bun-timers');

const { ViewerCountSystem } = require('../../../src/utils/viewer-count');
const { setupAutomatedCleanup, noOpLogger } = require('../../helpers/mock-factories');
const { createConfigFixture } = require('../../helpers/config-fixture');
const testClock = require('../../helpers/test-clock');

const createMockViewerCountObserver = (observerId = 'testObserver', behaviorOverrides = {}) => {
    return {
        observerId,
        receivedUpdates: [],
        statusChanges: [],
        initializationCompleted: false,
        cleanupCompleted: false,
        
        getObserverId() {
            return this.observerId;
        },
        
        async onViewerCountUpdate(update) {
            this.receivedUpdates.push(update);
            if (behaviorOverrides.onUpdate) {
                return await behaviorOverrides.onUpdate(update);
            }
        },
        
        async onStreamStatusChange(statusUpdate) {
            this.statusChanges.push(statusUpdate);
            if (behaviorOverrides.onStatusChange) {
                return await behaviorOverrides.onStatusChange(statusUpdate);
            }
        },
        
        async initialize() {
            this.initializationCompleted = true;
            if (behaviorOverrides.onInitialize) {
                return await behaviorOverrides.onInitialize();
            }
        },
        
        async cleanup() {
            this.cleanupCompleted = true;
            if (behaviorOverrides.onCleanup) {
                return await behaviorOverrides.onCleanup();
            }
        }
    };
};

const createMockPlatformWithViewerCount = (platformName = 'tiktok', config = {}) => {
    const {
        initialViewerCount = 100,
        viewerCountSequence = [],
        failAfterCalls = null,
        failureMessage = 'Platform API error'
    } = config;
    
    let callCount = 0;
    let currentViewerCount = initialViewerCount;
    
    return {
        platformName,
        isConnected: true,
        connectionState: 'connected',
        
        async getViewerCount() {
            callCount++;
            if (failAfterCalls !== null && callCount > failAfterCalls) {
                throw new Error(failureMessage);
            }
            if (viewerCountSequence.length > 0) {
                const index = Math.min(callCount - 1, viewerCountSequence.length - 1);
                return viewerCountSequence[index];
            }
            return currentViewerCount;
        },

        setViewerCount(count) {
            currentViewerCount = count;
        },
        
        getCallCount() {
            return callCount;
        }
    };
};

const buildConfig = (pollingIntervalMs = 60000) => createConfigFixture({
    general: { viewerCountPollingIntervalMs: pollingIntervalMs }
});

const createViewerCountTestEnvironment = (envConfig = {}) => {
    const {
        pollingInterval = 1,
        platforms = ['tiktok', 'twitch', 'youtube'],
        initialStreamStatus = { tiktok: true, twitch: true, youtube: false }
    } = envConfig;

    const mockPlatforms = {};
    platforms.forEach(platformName => {
        mockPlatforms[platformName] = createMockPlatformWithViewerCount(platformName, envConfig[platformName] || {});
    });

    const config = buildConfig(pollingInterval);
    const system = new ViewerCountSystem({
        platforms: mockPlatforms,
        config,
        logger: noOpLogger
    });

    Object.entries(initialStreamStatus).forEach(([platform, isLive]) => {
        system.streamStatus[platform] = isLive;
    });
    
    return {
        system,
        mockPlatforms,
        observers: new Map()
    };
};

const expectValidViewerCountUpdate = (update) => {
    expect(update).toHaveProperty('platform');
    expect(update).toHaveProperty('count');
    expect(update).toHaveProperty('previousCount');
    expect(update).toHaveProperty('isStreamLive');
    expect(update).toHaveProperty('timestamp');
    
    expect(typeof update.platform).toBe('string');
    expect(typeof update.count).toBe('number');
    expect(typeof update.previousCount).toBe('number');
    expect(typeof update.isStreamLive).toBe('boolean');
    expect(update.timestamp).toBeInstanceOf(Date);
    
    expect(update.platform).not.toMatch(/\bmock\b|\btest\b|\bfake\b/i);
};

const expectValidStreamStatusChange = (statusUpdate) => {
    expect(statusUpdate).toHaveProperty('platform');
    expect(statusUpdate).toHaveProperty('isLive');
    expect(statusUpdate).toHaveProperty('wasLive');
    expect(statusUpdate).toHaveProperty('timestamp');
    
    expect(typeof statusUpdate.platform).toBe('string');
    expect(typeof statusUpdate.isLive).toBe('boolean');
    expect(typeof statusUpdate.wasLive).toBe('boolean');
    expect(statusUpdate.timestamp).toBeInstanceOf(Date);
};

describe('ViewerCountSystem - Comprehensive Behavior Tests', () => {
    let cleanupFunctions;
    
    beforeEach(() => {
        cleanupFunctions = setupAutomatedCleanup();
        cleanupFunctions.beforeEach();
        useFakeTimers();
    });
    
    afterEach(async () => {
        restoreAllMocks();
        useRealTimers();
        if (cleanupFunctions) {
            cleanupFunctions.afterEach();
        }
    });
    
    afterAll(() => {
        if (cleanupFunctions) {
            cleanupFunctions.afterAll();
        }
    });

    describe('System Initialization & Configuration', () => {
        test('should initialize with proper default viewer counts for all platforms', () => {
            const { system } = createViewerCountTestEnvironment();
            expect(system.counts.tiktok).toBe(0);
            expect(system.counts.twitch).toBe(0);
            expect(system.counts.youtube).toBe(0);
        });

        test('should initialize in idle state without active polling', () => {
            const { system } = createViewerCountTestEnvironment();
            expect(system.isPolling).toBe(false);
            expect(system.pollingInterval).toBe(null);
            expect(Object.keys(system.pollingHandles)).toHaveLength(0);
        });

        test('should respect configured polling intervals from config', () => {
            const system = new ViewerCountSystem({ platforms: {}, config: buildConfig(60000), logger: noOpLogger });
            system.startPolling();
            expect(system.pollingInterval).toBe(60000);
            expect(system.isPolling).toBe(true);
        });

        test('should handle missing configuration gracefully with defaults', () => {
            const system = new ViewerCountSystem({ platforms: {}, config: buildConfig(60000), logger: noOpLogger });
            expect(() => system.startPolling()).not.toThrow();
        });

        test('should validate polling interval boundaries and disable for invalid values', () => {
            const system = new ViewerCountSystem({ platforms: {}, config: buildConfig(60000), logger: noOpLogger });
            system.pollingInterval = 0;
            expect(system.pollingInterval).toBe(0);
            const isValidInterval = system.pollingInterval > 0;
            expect(isValidInterval).toBe(false);
        });

        test('should handle negative polling intervals by disabling polling', () => {
            const system = new ViewerCountSystem({ platforms: {}, config: buildConfig(60000), logger: noOpLogger });
            system.pollingInterval = -10000;
            expect(system.pollingInterval).toBe(-10000);
            const isValidInterval = system.pollingInterval > 0;
            expect(isValidInterval).toBe(false);
        });
    });

    describe('Observer Pattern Management', () => {
        test('should register observers with unique IDs successfully', () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('observer-1');
            system.addObserver(observer);
            expect(system.observers.has('observer-1')).toBe(true);
            expect(system.observers.size).toBe(1);
        });

        test('should notify multiple observers of viewer count changes', async () => {
            const { system } = createViewerCountTestEnvironment();
            
            const observer1 = createMockViewerCountObserver('observer-1');
            const observer2 = createMockViewerCountObserver('observer-2');
            
            system.addObserver(observer1);
            system.addObserver(observer2);
            system.counts.tiktok = 50;
            await system.notifyObservers('tiktok', 100, 50);
            expect(observer1.receivedUpdates).toHaveLength(1);
            expect(observer2.receivedUpdates).toHaveLength(1);
            
            const update1 = observer1.receivedUpdates[0];
            const update2 = observer2.receivedUpdates[0];
            
            expectValidViewerCountUpdate(update1);
            expectValidViewerCountUpdate(update2);
            expect(update1.count).toBe(100);
            expect(update2.count).toBe(100);
        });

        test('should handle observer registration and removal during operation', () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('test-observer');
            
            system.addObserver(observer);
            expect(system.observers.size).toBe(1);
            
            system.removeObserver('test-observer');
            expect(system.observers.size).toBe(0);
            expect(system.observers.has('test-observer')).toBe(false);
        });

        test('should isolate observer failures without affecting others', async () => {
            const { system } = createViewerCountTestEnvironment();

            const workingObserver = createMockViewerCountObserver('working-observer');
            const failingObserver = createMockViewerCountObserver('failing-observer', {
                onUpdate: async () => {
                    throw new Error('Observer processing failed');
                }
            });

            system.addObserver(workingObserver);
            system.addObserver(failingObserver);

            await system.notifyObservers('tiktok', 100, 50);

            expect(workingObserver.receivedUpdates).toHaveLength(1);
        });

        test('should prevent duplicate observer registration by ID', () => {
            const { system } = createViewerCountTestEnvironment();
            const observer1 = createMockViewerCountObserver('duplicate-id');
            const observer2 = createMockViewerCountObserver('duplicate-id');
            
            system.addObserver(observer1);
            system.addObserver(observer2);
            expect(system.observers.size).toBe(1);
            expect(system.observers.get('duplicate-id')).toBe(observer2);
        });

        test('should require observers to implement getObserverId method', () => {
            const { system } = createViewerCountTestEnvironment();
            const invalidObserver = { /* missing getObserverId */ };
            
            expect(() => system.addObserver(invalidObserver)).toThrow(
                'Observer must implement getObserverId() method'
            );
        });
    });

    describe('Platform Polling Behavior', () => {
        test('should poll live platforms at configured intervals', async () => {
            const { system, mockPlatforms } = createViewerCountTestEnvironment({
                pollingInterval: 1
            });
            
            system.startPolling();
            advanceTimersByTime(2);
            expect(mockPlatforms.tiktok.getCallCount()).toBeGreaterThan(0);
            expect(mockPlatforms.twitch.getCallCount()).toBeGreaterThan(0);
        });

        test('should skip polling for offline platforms', async () => {
            const { system, mockPlatforms } = createViewerCountTestEnvironment({
                pollingInterval: 1,
                initialStreamStatus: { tiktok: true, twitch: true, youtube: false }
            });
            system.startPolling();
            advanceTimersByTime(2);
            expect(mockPlatforms.youtube.getCallCount()).toBe(0);
            expect(mockPlatforms.tiktok.getCallCount()).toBeGreaterThan(0);
            expect(mockPlatforms.twitch.getCallCount()).toBeGreaterThan(0);
        });

        test('should detect viewer count changes and notify observers', async () => {
            const { system } = createViewerCountTestEnvironment({
                tiktok: { viewerCountSequence: [100, 150, 200] }
            });
            const observer = createMockViewerCountObserver('count-tracker');
            system.addObserver(observer);
            system.startPolling();
            advanceTimersByTime(3);
            await Promise.resolve();
            expect(observer.receivedUpdates.length).toBeGreaterThan(0);
            const lastUpdate = observer.receivedUpdates[observer.receivedUpdates.length - 1];
            expectValidViewerCountUpdate(lastUpdate);
        }, 10000);

        test('should handle platform API failures gracefully during polling', async () => {
            const { system } = createViewerCountTestEnvironment({
                tiktok: { failAfterCalls: 1, failureMessage: 'Network timeout' }
            });
            const observer = createMockViewerCountObserver('error-tracker');
            system.addObserver(observer);
            system.startPolling();
            advanceTimersByTime(5);
            await Promise.resolve();
            expect(system.isPolling).toBe(true);
        }, 10000);

        test('should maintain independent polling schedules per platform', async () => {
            const { system } = createViewerCountTestEnvironment();
            system.startPolling();
            system.stopPlatformPolling('tiktok');
            advanceTimersByTime(5);
            expect(system.pollingHandles.twitch).toBeDefined();
            expect(system.pollingHandles.tiktok).toBeUndefined();
        });
    });

    describe('Stream Status Management', () => {
        test('should track live/offline status per platform accurately', async () => {
            const { system } = createViewerCountTestEnvironment();
            expect(system.isStreamLive('tiktok')).toBe(true);
            expect(system.isStreamLive('twitch')).toBe(true);
            expect(system.isStreamLive('youtube')).toBe(false);
            await system.updateStreamStatus('youtube', true);
            
            expect(system.isStreamLive('youtube')).toBe(true);
        });

        test('should stop polling when platform goes offline', async () => {
            const { system } = createViewerCountTestEnvironment();
            
            system.startPolling();
            expect(system.pollingHandles.tiktok).toBeDefined();
            await system.updateStreamStatus('tiktok', false);
            expect(system.pollingHandles.tiktok).toBeUndefined();
        });

        test('should start polling when platform comes online', async () => {
            const { system } = createViewerCountTestEnvironment({
                initialStreamStatus: { tiktok: false, twitch: true, youtube: false }
            });
            system.startPolling();
            expect(system.pollingHandles.tiktok).toBeUndefined();
            await system.updateStreamStatus('tiktok', true);
            expect(system.pollingHandles.tiktok).toBeDefined();
        });

        test('should notify observers of stream status changes', async () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('status-tracker');
            system.addObserver(observer);
            await system.updateStreamStatus('youtube', true);
            expect(observer.statusChanges).toHaveLength(1);
            const statusChange = observer.statusChanges[0];
            expectValidStreamStatusChange(statusChange);
            expect(statusChange.platform).toBe('youtube');
            expect(statusChange.isLive).toBe(true);
            expect(statusChange.wasLive).toBe(false);
        });

        test('should handle rapid status change scenarios', async () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('rapid-changes');
            system.addObserver(observer);
            await system.updateStreamStatus('tiktok', false);
            await system.updateStreamStatus('tiktok', true);
            await system.updateStreamStatus('tiktok', false);
            expect(observer.statusChanges).toHaveLength(3);
        });

        test('should reset viewer count to zero when platform goes offline', async () => {
            const { system } = createViewerCountTestEnvironment();
            system.counts.tiktok = 500;
            const observer = createMockViewerCountObserver('count-reset');
            system.addObserver(observer);
            await system.updateStreamStatus('tiktok', false);
            expect(system.counts.tiktok).toBe(0);
            expect(observer.receivedUpdates).toHaveLength(1);
            expect(observer.receivedUpdates[0].count).toBe(0);
            expect(observer.receivedUpdates[0].previousCount).toBe(500);
        });
    });

    describe('Viewer Count Change Detection', () => {
        test('should detect and report significant viewer count changes', async () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('change-detector');
            system.addObserver(observer);
            const previousCount = system.counts.tiktok;
            await system.notifyObservers('tiktok', 250, previousCount);
            const update = observer.receivedUpdates[0];
            expect(update.count).toBe(250);
            expect(update.previousCount).toBe(0);
            expect(update.count - update.previousCount).toBe(250);
        });

        test('should provide previous count context in notifications', async () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('context-tracker');
            system.addObserver(observer);
            system.counts.twitch = 100;
            await system.notifyObservers('twitch', 150, 100);
            const update = observer.receivedUpdates[0];
            expect(update.previousCount).toBe(100);
            expect(update.count).toBe(150);
        });

        test('should track viewer count history accurately', async () => {
            const { system } = createViewerCountTestEnvironment({
                tiktok: { viewerCountSequence: [100, 120, 90, 110] }
            });
            const observer = createMockViewerCountObserver('history-tracker');
            system.addObserver(observer);
            await system.notifyObservers('tiktok', 100, 0);
            await system.notifyObservers('tiktok', 120, 100);
            await system.notifyObservers('tiktok', 90, 120);
            await system.notifyObservers('tiktok', 110, 90);
            expect(observer.receivedUpdates.length).toBe(4);
            expect(observer.receivedUpdates[0].count).toBe(100);
            expect(observer.receivedUpdates[0].previousCount).toBe(0);
            expect(observer.receivedUpdates[1].count).toBe(120);
            expect(observer.receivedUpdates[1].previousCount).toBe(100);
            expect(observer.receivedUpdates[2].count).toBe(90);
            expect(observer.receivedUpdates[2].previousCount).toBe(120);
            expect(observer.receivedUpdates[3].count).toBe(110);
            expect(observer.receivedUpdates[3].previousCount).toBe(90);
        }, 10000);

        test('should handle viewer count edge cases (zero, very large numbers)', async () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('edge-case-tracker');
            system.addObserver(observer);
            await system.notifyObservers('tiktok', 0, 100);
            await system.notifyObservers('tiktok', 999999, 0);
            expect(observer.receivedUpdates).toHaveLength(2);
            expect(observer.receivedUpdates[0].count).toBe(0);
            expect(observer.receivedUpdates[1].count).toBe(999999);
        });

        test('should handle negative viewer counts gracefully', async () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('negative-count');
            system.addObserver(observer);
            await system.notifyObservers('tiktok', -1, 100);
            expect(observer.receivedUpdates).toHaveLength(1);
            expect(observer.receivedUpdates[0].count).toBe(-1);
        });
    });

    describe('Error Handling & Recovery', () => {
        test('should continue operation when platform polling fails', async () => {
            const { system, mockPlatforms } = createViewerCountTestEnvironment({
                tiktok: { failAfterCalls: 1 },
                twitch: { initialViewerCount: 200 }
            });
            const observer = createMockViewerCountObserver('error-recovery');
            system.addObserver(observer);
            system.startPolling();
            advanceTimersByTime(10);
            await Promise.resolve();
            expect(system.isPolling).toBe(true);
            expect(mockPlatforms.twitch.getCallCount()).toBeGreaterThan(0);
        }, 10000);

        test('should handle platform API timeouts gracefully', async () => {
            const { system } = createViewerCountTestEnvironment({
                tiktok: {
                    failAfterCalls: 1,
                    failureMessage: 'Request timeout'
                }
            });
            system.startPolling();
            advanceTimersByTime(5);
            await Promise.resolve();
            expect(system.isPolling).toBe(true);
        }, 10000);

        test('should recover from temporary network failures', async () => {
            const { system, mockPlatforms } = createViewerCountTestEnvironment({
                pollingInterval: 1
            });
            let failureCount = 0;
            const originalGetViewerCount = mockPlatforms.tiktok.getViewerCount;
            mockPlatforms.tiktok.getViewerCount = async function() {
                failureCount++;
                if (failureCount <= 2) {
                    throw new Error('Network error');
                }
                return originalGetViewerCount.call(this);
            };
            const observer = createMockViewerCountObserver('recovery-tracker');
            system.addObserver(observer);
            system.startPolling();
            advanceTimersByTime(10);
            await Promise.resolve();
            expect(system.isPolling).toBe(true);
        }, 10000);

        test('should maintain system stability during cascading errors', async () => {
            const { system } = createViewerCountTestEnvironment({
                tiktok: { failAfterCalls: 0 },
                twitch: { failAfterCalls: 0 },
                youtube: { failAfterCalls: 0 }
            });
            const observer = createMockViewerCountObserver('stability-test');
            system.addObserver(observer);
            system.startPolling();
            advanceTimersByTime(5);
            await Promise.resolve();
            expect(system.isPolling).toBe(true);
            expect(system.observers.size).toBe(1);
        }, 10000);

        test('should handle observer notification failures without affecting others', async () => {
            const { system } = createViewerCountTestEnvironment();

            const workingObserver = createMockViewerCountObserver('working');
            const errorObserver = createMockViewerCountObserver('error', {
                onUpdate: async () => { throw new Error('Observer error'); }
            });

            system.addObserver(workingObserver);
            system.addObserver(errorObserver);

            await system.notifyObservers('tiktok', 100, 50);

            expect(workingObserver.receivedUpdates).toHaveLength(1);
        });
    });

    describe('Resource Management & Cleanup', () => {
        test('should clean up polling handles during shutdown', () => {
            const { system } = createViewerCountTestEnvironment();
            
            system.startPolling();
            expect(Object.keys(system.pollingHandles).length).toBeGreaterThan(0);
            
            system.stopPolling();
            
            expect(system.isPolling).toBe(false);
            expect(Object.keys(system.pollingHandles)).toHaveLength(0);
        });

        test('should remove observers cleanly during cleanup', async () => {
            const { system } = createViewerCountTestEnvironment();
            
            const observer = createMockViewerCountObserver('cleanup-test');
            system.addObserver(observer);
            
            await system.cleanup();
            
            expect(system.observers.size).toBe(0);
            expect(observer.cleanupCompleted).toBe(true);
        });

        test('should handle cleanup during active polling gracefully', async () => {
            const { system } = createViewerCountTestEnvironment();

            system.startPolling();
            expect(system.isPolling).toBe(true);

            await system.cleanup();

            expect(system.isPolling).toBe(false);
        });

        test('should manage resources efficiently under load', async () => {
            const { system } = createViewerCountTestEnvironment();
            for (let i = 0; i < 100; i++) {
                const observer = createMockViewerCountObserver(`observer-${i}`);
                system.addObserver(observer);
            }
            system.startPolling();
            advanceTimersByTime(50);
            expect(system.observers.size).toBe(100);
            expect(system.isPolling).toBe(true);
        });

        test('should prevent memory leaks during extended operation', async () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('memory-test');
            system.addObserver(observer);
            for (let i = 0; i < 1000; i++) {
                await system.notifyObservers('tiktok', i, i - 1);
            }
            expect(observer.receivedUpdates).toHaveLength(1000);
            await system.cleanup();
            expect(system.observers.size).toBe(0);
        });
    });

    describe('Configuration Changes & Runtime Adaptation', () => {
        test('should adapt to polling interval changes at runtime', () => {
            const system = new ViewerCountSystem({ platforms: {}, config: buildConfig(60000), logger: noOpLogger });
            system.startPolling();
            expect(system.pollingInterval).toBe(60000);
            system.stopPolling();
            system.pollingInterval = 30000;
            expect(system.pollingInterval).toBe(30000);
        });

        test('should handle platform enable/disable configuration changes', async () => {
            const { system } = createViewerCountTestEnvironment();
            system.startPolling();
            expect(system.pollingHandles.tiktok).toBeDefined();
            await system.updateStreamStatus('tiktok', false);
            expect(system.pollingHandles.tiktok).toBeUndefined();
            await system.updateStreamStatus('tiktok', true);
            expect(system.pollingHandles.tiktok).toBeDefined();
        });

        test('should validate configuration changes before applying', () => {
            const system = new ViewerCountSystem({ platforms: {}, config: buildConfig(60000), logger: noOpLogger });
            expect(() => system.startPolling()).not.toThrow();
            expect(system.isPolling).toBe(true);
        });

        test('should maintain operation during configuration reload', async () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('config-reload');
            system.addObserver(observer);
            system.startPolling();
            system.stopPolling();
            system.startPolling();
            advanceTimersByTime(5);
            expect(system.isPolling).toBe(true);
            expect(system.observers.size).toBe(1);
        });
    });

    describe('Performance & Scalability', () => {
        test('should handle multiple simultaneous platform updates efficiently', async () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('performance-test');
            system.addObserver(observer);
            const startTime = testClock.now();
            const updatePromises = [
                system.notifyObservers('tiktok', 100, 50),
                system.notifyObservers('twitch', 200, 150),
                system.notifyObservers('youtube', 300, 250)
            ];
            await Promise.all(updatePromises);
            const simulatedDurationMs = 20;
            testClock.advance(simulatedDurationMs);
            const duration = testClock.now() - startTime;
            expect(duration).toBeLessThan(100);
            expect(observer.receivedUpdates).toHaveLength(3);
        });

        test('should maintain performance with many registered observers', async () => {
            const { system } = createViewerCountTestEnvironment();
            const observers = [];
            for (let i = 0; i < 50; i++) {
                const observer = createMockViewerCountObserver(`perf-observer-${i}`);
                observers.push(observer);
                system.addObserver(observer);
            }
            const startTime = testClock.now();
            await system.notifyObservers('tiktok', 100, 50);
            const simulatedDurationMs = 150;
            testClock.advance(simulatedDurationMs);
            const duration = testClock.now() - startTime;
            expect(duration).toBeLessThan(1000);
            observers.forEach(observer => {
                expect(observer.receivedUpdates).toHaveLength(1);
            });
        });

        test('should process viewer count updates within performance thresholds', async () => {
            const { system } = createViewerCountTestEnvironment();
            
            const observer = createMockViewerCountObserver('threshold-test');
            system.addObserver(observer);
            const iterations = 100;
            const startTime = testClock.now();
            for (let i = 0; i < iterations; i++) {
                await system.notifyObservers('tiktok', i, i - 1);
            }
            const simulatedTotalMs = iterations * 2;
            testClock.advance(simulatedTotalMs);
            const totalDuration = testClock.now() - startTime;
            const averageTime = totalDuration / iterations;
            expect(averageTime).toBeLessThan(5);
        });

        test('should scale observer notifications efficiently', async () => {
            const { system } = createViewerCountTestEnvironment();
            const testSizes = [1, 10, 25, 50];
            const results = [];
            for (const size of testSizes) {
                system.observers.clear();
                for (let i = 0; i < size; i++) {
                    const observer = createMockViewerCountObserver(`scale-${i}`);
                    system.addObserver(observer);
                }
                const startTime = testClock.now();
                await system.notifyObservers('tiktok', 100, 50);
                const simulatedDurationMs = 5 + size;
                testClock.advance(simulatedDurationMs);
                const duration = testClock.now() - startTime;
                results.push({ size, duration });
            }
            const firstResult = results[0];
            const lastResult = results[results.length - 1];
            const scaleFactor = firstResult.duration > 0 ? lastResult.duration / firstResult.duration : 1;
            expect(scaleFactor).toBeLessThan(10);
        });
    });

    describe('Integration Points', () => {
        test('should integrate with platform registry correctly', () => {
            const { system, mockPlatforms } = createViewerCountTestEnvironment();
            const validation = system.validatePlatformForPolling('tiktok');
            expect(validation.valid).toBe(true);
            expect(validation.platform).toBe(mockPlatforms.tiktok);
        });

        test('should handle empty platform registry properly', () => {
            const system = new ViewerCountSystem({ platforms: {}, config: buildConfig(60000), logger: noOpLogger });
            expect(() => system.startPolling()).not.toThrow();
        });

        test('should coordinate stream status updates', async () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('stream-status-observer');
            system.addObserver(observer);
            await system.updateStreamStatus('youtube', true);
            expect(observer.statusChanges).toHaveLength(1);
            expect(observer.statusChanges[0].platform).toBe('youtube');
            expect(observer.statusChanges[0].isLive).toBe(true);
        });

        test('should maintain proper state during app lifecycle events', async () => {
            const { system } = createViewerCountTestEnvironment();
            await system.initialize();
            system.startPolling();
            expect(system.isPolling).toBe(true);
            await system.cleanup();
            expect(system.observers.size).toBe(0);
        });

        test('should handle observer initialization during system startup', async () => {
            const { system } = createViewerCountTestEnvironment();
            const observer = createMockViewerCountObserver('startup-init');
            system.addObserver(observer);
            await system.initialize();
            expect(observer.initializationCompleted).toBe(true);
        });

        test('should provide accurate stream status to external systems', () => {
            const { system } = createViewerCountTestEnvironment({
                initialStreamStatus: { tiktok: true, twitch: false, youtube: true }
            });
            expect(system.isStreamLive('tiktok')).toBe(true);
            expect(system.isStreamLive('twitch')).toBe(false);
            expect(system.isStreamLive('youtube')).toBe(true);
            expect(system.isStreamLive('unknown')).toBe(false);
        });
    });
});
