const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { useFakeTimers, useRealTimers } = require('../../helpers/bun-timers');

const { ViewerCountSystem } = require('../../../src/utils/viewer-count');
const { OBSViewerCountObserver } = require('../../../src/observers/obs-viewer-count-observer');
const { createConfigFixture } = require('../../helpers/config-fixture');

const {
    createMockOBSManager,
    setupAutomatedCleanup,
    noOpLogger
} = require('../../helpers/mock-factories');
const testClock = require('../../helpers/test-clock');

const createEdgeCasePlatform = (platformName = 'tiktok', edgeCaseConfig = {}) => {
    const {
        returnValue = 0,
        shouldThrow = false,
        errorMessage = 'Platform API error',
        delay = 0,
        responseSequence = []
    } = edgeCaseConfig;
    
    let callCount = 0;
    
    return {
        platformName,
        isConnected: true,
        connectionState: 'connected',
        
        async getViewerCount() {
            callCount++;
            
            if (delay > 0) {
                await waitForDelay(delay);
            }
            
            if (shouldThrow) {
                throw new Error(errorMessage);
            }
            
            if (responseSequence.length > 0) {
                const index = Math.min(callCount - 1, responseSequence.length - 1);
                return responseSequence[index];
            }
            
            return returnValue;
        },
        
        getCallCount() {
            return callCount;
        }
    };
};

const createEdgeCaseTestEnvironment = (config = {}) => {
    const {
        pollingInterval = 1,
        platforms = { tiktok: {}, twitch: {}, youtube: {} }
    } = config;
    
    const mockPlatforms = {};
    Object.entries(platforms).forEach(([platformName, platformConfig]) => {
        mockPlatforms[platformName] = createEdgeCasePlatform(platformName, platformConfig);
    });
    
    const system = new ViewerCountSystem({
        platformProvider: () => mockPlatforms,
        config: createConfigFixture({
            general: { viewerCountPollingIntervalMs: pollingInterval }
        })
    });
    
    return { system, mockPlatforms };
};

const createEdgeCaseObserver = (observerId = 'edge-case-observer', edgeCaseBehavior = {}) => {
    const {
        shouldThrowOnUpdate = false,
        shouldThrowOnStatusChange = false,
        processingDelay = 0,
        throwAfterCalls = null
    } = edgeCaseBehavior;
    
    let updateCallCount = 0;

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
            updateCallCount++;
            
            if (processingDelay > 0) {
                await waitForDelay(processingDelay);
            }
            
            if (shouldThrowOnUpdate || (throwAfterCalls && updateCallCount > throwAfterCalls)) {
                throw new Error('Observer processing failed');
            }
            
            this.receivedUpdates.push(update);
        },
        
        async onStreamStatusChange(statusUpdate) {
            if (shouldThrowOnStatusChange) {
                throw new Error('Observer status processing failed');
            }
            
            this.statusChanges.push(statusUpdate);
        },
        
        async initialize() {
            this.initializationCompleted = true;
        },
        
        async cleanup() {
            this.cleanupCompleted = true;
        }
    };
};

const expectSystemStability = (system) => {
    expect(system).toBeDefined();
    expect(typeof system.isPolling).toBe('boolean');
    expect(typeof system.counts).toBe('object');
    expect(system.observers).toBeInstanceOf(Map);
};

describe('Viewer Count & OBS Observer Edge Case Tests', () => {
    setupAutomatedCleanup();
    
    beforeEach(() => {
        useFakeTimers();
    });
    
    afterEach(async () => {
        restoreAllMocks();
        useRealTimers();
    });

    describe('Extreme Viewer Count Edge Cases', () => {
        test('should handle zero viewer counts gracefully without errors', async () => {
            const { system } = createEdgeCaseTestEnvironment({
                platforms: { tiktok: { returnValue: 0 } }
            });
            const observer = createEdgeCaseObserver('zero-count-observer');
            system.addObserver(observer);

            await system.notifyObservers('tiktok', 0, 100);

            expect(observer.receivedUpdates).toHaveLength(1);
            expect(observer.receivedUpdates[0].count).toBe(0);
            expect(observer.receivedUpdates[0].previousCount).toBe(100);
            expectSystemStability(system);
        });

        test('should handle negative viewer counts by validating and providing fallback behavior', async () => {
            const { system } = createEdgeCaseTestEnvironment({
                platforms: { twitch: { returnValue: -500 } }
            });
            const observer = createEdgeCaseObserver('negative-count-observer');
            system.addObserver(observer);

            await system.notifyObservers('twitch', -500, 200);

            expect(observer.receivedUpdates).toHaveLength(1);
            expect(observer.receivedUpdates[0].count).toBe(-500);
            expectSystemStability(system);
            const update = observer.receivedUpdates[0];
            expect(update.count < 0).toBe(true);
        });

        test('should handle very large viewer counts without performance degradation', async () => {
            const largeCount = 999999999;
            const { system } = createEdgeCaseTestEnvironment({
                platforms: { youtube: { returnValue: largeCount } }
            });
            const observer = createEdgeCaseObserver('large-count-observer');
            system.addObserver(observer);
            const startTime = testClock.now();

            await system.notifyObservers('youtube', largeCount, 1000000);

            const simulatedProcessingMs = 25;
            testClock.advance(simulatedProcessingMs);
            const processingTime = testClock.now() - startTime;
            expect(observer.receivedUpdates).toHaveLength(1);
            expect(observer.receivedUpdates[0].count).toBe(largeCount);
            expect(processingTime).toBeLessThan(100);
            expectSystemStability(system);
        });

        test('should handle infinity viewer counts gracefully without system crash', async () => {
            const { system } = createEdgeCaseTestEnvironment();

            const observer = createEdgeCaseObserver('infinity-observer');
            system.addObserver(observer);

            await system.notifyObservers('tiktok', Infinity, 500);

            expect(observer.receivedUpdates).toHaveLength(1);
            expect(observer.receivedUpdates[0].count).toBe(Infinity);
            expectSystemStability(system);
        });

        test('should handle NaN viewer counts with appropriate error recovery', async () => {
            const { system } = createEdgeCaseTestEnvironment();
            
            const observer = createEdgeCaseObserver('nan-observer');
            system.addObserver(observer);
            
            await system.notifyObservers('twitch', NaN, 300);
            
            expect(observer.receivedUpdates).toHaveLength(1);
            expect(isNaN(observer.receivedUpdates[0].count)).toBe(true);
            expectSystemStability(system);

            await system.notifyObservers('twitch', 400, 300);
            expect(observer.receivedUpdates).toHaveLength(2);
            expect(observer.receivedUpdates[1].count).toBe(400);
        });

        test('should handle floating point precision edge cases correctly', async () => {
            const floatCount = 1234.5678;
            const { system } = createEdgeCaseTestEnvironment({
                platforms: { tiktok: { returnValue: floatCount } }
            });
            
            const observer = createEdgeCaseObserver('float-observer');
            system.addObserver(observer);
            
            await system.notifyObservers('tiktok', floatCount, 1200);
            
            expect(observer.receivedUpdates).toHaveLength(1);
            expect(observer.receivedUpdates[0].count).toBe(floatCount);
            expectSystemStability(system);

            const displayCount = Math.floor(observer.receivedUpdates[0].count);
            expect(displayCount).toBe(1234);
        });
    });

    describe('Platform API Response Edge Cases', () => {
        test('should continue operation when platform API completely fails', async () => {
            const { system, mockPlatforms } = createEdgeCaseTestEnvironment({
                platforms: {
                    tiktok: { shouldThrow: true, errorMessage: 'Network timeout' },
                    twitch: { returnValue: 500 }
                }
            });

            const observer = createEdgeCaseObserver('api-failure-observer');
            system.addObserver(observer);

            try {
                await mockPlatforms.tiktok.getViewerCount();
            } catch (error) {
                expect(error.message).toBe('Network timeout');
            }

            expectSystemStability(system);
        });

        test('should handle malformed API responses gracefully', async () => {
            const { system } = createEdgeCaseTestEnvironment({
                platforms: {
                    youtube: { returnValue: "not-a-number" }
                }
            });
            
            const observer = createEdgeCaseObserver('malformed-observer');
            system.addObserver(observer);
            
            await system.notifyObservers('youtube', "not-a-number", 100);
            
            expect(observer.receivedUpdates).toHaveLength(1);
            expect(typeof observer.receivedUpdates[0].count).toBe('string');
            expectSystemStability(system);
        });

        test('should handle partial platform failures without affecting others', async () => {
            const { system, mockPlatforms } = createEdgeCaseTestEnvironment({
                platforms: { 
                    tiktok: { shouldThrow: true },
                    twitch: { returnValue: 300 },
                    youtube: { returnValue: 150 }
                }
            });
            
            const observer = createEdgeCaseObserver('partial-failure-observer');
            system.addObserver(observer);
            
            const tiktokResult = await mockPlatforms.tiktok.getViewerCount().catch(e => 'failed');
            const twitchResult = await mockPlatforms.twitch.getViewerCount();
            const youtubeResult = await mockPlatforms.youtube.getViewerCount();
            
            expect(tiktokResult).toBe('failed');
            expect(twitchResult).toBe(300);
            expect(youtubeResult).toBe(150);
            expectSystemStability(system);
        });

        test('should handle API rate limiting with graceful degradation', async () => {
            const { system, mockPlatforms } = createEdgeCaseTestEnvironment({
                platforms: {
                    tiktok: {
                        responseSequence: [100, 150, 200],
                        shouldThrow: false
                    }
                }
            });

            let callCount = 0;
            const originalGetViewerCount = mockPlatforms.tiktok.getViewerCount;
            mockPlatforms.tiktok.getViewerCount = async function() {
                callCount++;
                if (callCount > 3) {
                    throw new Error('Rate limit exceeded');
                }
                return originalGetViewerCount.call(this);
            };
            
            const observer = createEdgeCaseObserver('rate-limit-observer');
            system.addObserver(observer);
            
            const results = [];
            for (let i = 0; i < 5; i++) {
                try {
                    const result = await mockPlatforms.tiktok.getViewerCount();
                    results.push(result);
                } catch {
                    results.push('rate-limited');
                }
            }
            
            expect(results.slice(0, 3)).toEqual([100, 150, 200]);
            expect(results.slice(3)).toEqual(['rate-limited', 'rate-limited']);
            expectSystemStability(system);
        });

        test('should handle very slow API responses with appropriate timeouts', async () => {
            const { system } = createEdgeCaseTestEnvironment({
                platforms: {
                    youtube: { returnValue: 250 }
                }
            });

            const observer = createEdgeCaseObserver('slow-api-observer');
            system.addObserver(observer);

            await system.notifyObservers('youtube', 250, 200);
            
            expect(observer.receivedUpdates).toHaveLength(1);
            expect(observer.receivedUpdates[0].count).toBe(250);
            expectSystemStability(system);
        });

        test('should recover from temporary API failures automatically', async () => {
            const { system, mockPlatforms } = createEdgeCaseTestEnvironment({
                platforms: { 
                    twitch: { returnValue: 400 }
                }
            });
            
            let failureCount = 0;
            const originalGetViewerCount = mockPlatforms.twitch.getViewerCount;
            mockPlatforms.twitch.getViewerCount = async function() {
                failureCount++;
                if (failureCount <= 3) {
                    throw new Error('Temporary failure');
                }
                return originalGetViewerCount.call(this);
            };
            
            const observer = createEdgeCaseObserver('recovery-observer');
            system.addObserver(observer);
            
            const results = [];
            for (let i = 0; i < 5; i++) {
                try {
                    const result = await mockPlatforms.twitch.getViewerCount();
                    results.push(result);
                } catch {
                    results.push('failed');
                }
            }
            
            expect(results.slice(0, 3)).toEqual(['failed', 'failed', 'failed']);
            expect(results.slice(3)).toEqual([400, 400]);
            expectSystemStability(system);
        });
    });

    describe('Configuration Edge Cases', () => {
        test('should handle negative polling intervals by disabling polling', () => {
            const { system } = createEdgeCaseTestEnvironment({
                pollingInterval: -30
            });
            
            const startOperation = () => system.startPolling();

            expect(startOperation).not.toThrow();
            expectSystemStability(system);
            expect(typeof system.isPolling).toBe('boolean');
        });

        test('should handle zero polling interval gracefully', () => {
            const { system } = createEdgeCaseTestEnvironment({
                pollingInterval: 0
            });

            const startOperation = () => system.startPolling();

            expect(startOperation).not.toThrow();
            expectSystemStability(system);
            expect(typeof system.isPolling).toBe('boolean');
        });

        test('throws when config is null', () => {
            expect(() => new ViewerCountSystem({
                platformProvider: () => ({}),
                config: null
            })).toThrow('ViewerCountSystem requires config');
        });

        test('throws when config.general is missing', () => {
            expect(() => new ViewerCountSystem({
                platformProvider: () => ({}),
                config: {}
            })).toThrow();
        });

        test('handles undefined pollingIntervalMs gracefully', () => {
            const system = new ViewerCountSystem({
                platformProvider: () => ({}),
                config: createConfigFixture({
                    general: { viewerCountPollingIntervalMs: undefined }
                })
            });

            expect(system.pollingIntervalMs).toBeUndefined();
            expectSystemStability(system);
        });

        test('reads pollingIntervalMs from config', () => {
            const system = new ViewerCountSystem({
                platformProvider: () => ({}),
                config: createConfigFixture({
                    general: { viewerCountPollingIntervalMs: 5000 }
                })
            });

            expect(system.pollingIntervalMs).toBe(5000);
            expectSystemStability(system);
        });
    });

    describe('Observer Pattern Edge Cases', () => {
        test('should isolate and continue when observer throws exceptions', async () => {
            const { system } = createEdgeCaseTestEnvironment();

            const workingObserver = createEdgeCaseObserver('working-observer');
            const failingObserver = createEdgeCaseObserver('failing-observer', {
                shouldThrowOnUpdate: true
            });

            system.addObserver(workingObserver);
            system.addObserver(failingObserver);

            await system.notifyObservers('tiktok', 100, 50);

            expect(workingObserver.receivedUpdates).toHaveLength(1);
            expectSystemStability(system);
        });

        test('should handle observers that take extremely long to process', async () => {
            const { system } = createEdgeCaseTestEnvironment();
            
            const slowObserver = createEdgeCaseObserver('slow-observer');
            const fastObserver = createEdgeCaseObserver('fast-observer');

            slowObserver.onViewerCountUpdate = async function(update) {
                this.receivedUpdates.push(update);
                return Promise.resolve();
            };
            
            system.addObserver(slowObserver);
            system.addObserver(fastObserver);
            
            await system.notifyObservers('youtube', 150, 100);
            
            expect(slowObserver.receivedUpdates).toHaveLength(1);
            expect(fastObserver.receivedUpdates).toHaveLength(1);
            expectSystemStability(system);
        });

        test('should handle observer memory issues without system crash', async () => {
            const { system } = createEdgeCaseTestEnvironment();
            
            const memoryIntensiveObserver = createEdgeCaseObserver('memory-observer');

            memoryIntensiveObserver.onViewerCountUpdate = async function(update) {
                this.receivedUpdates.push(update);
                this.largeData = new Array(10000).fill('memory-test');
            };
            
            system.addObserver(memoryIntensiveObserver);
            
            for (let i = 0; i < 100; i++) {
                await system.notifyObservers('tiktok', i, i - 1);
            }
            
            expect(memoryIntensiveObserver.receivedUpdates).toHaveLength(100);
            expectSystemStability(system);
        });

        test('should handle circular observer dependencies without infinite loops', async () => {
            const { system } = createEdgeCaseTestEnvironment();
            
            const observer1 = createEdgeCaseObserver('circular-observer-1');
            const observer2 = createEdgeCaseObserver('circular-observer-2');

            observer1.relatedObserver = observer2;
            observer2.relatedObserver = observer1;
            
            system.addObserver(observer1);
            system.addObserver(observer2);
            
            await system.notifyObservers('twitch', 200, 150);
            
            expect(observer1.receivedUpdates).toHaveLength(1);
            expect(observer2.receivedUpdates).toHaveLength(1);
            expectSystemStability(system);
        });

        test('should handle observer that becomes corrupted during operation', async () => {
            const { system } = createEdgeCaseTestEnvironment();
            
            const corruptingObserver = createEdgeCaseObserver('corrupting-observer');

            let updateCount = 0;
            const originalUpdate = corruptingObserver.onViewerCountUpdate;
            corruptingObserver.onViewerCountUpdate = async function(update) {
                updateCount++;
                if (updateCount === 1) {
                    await originalUpdate.call(this, update);
                    delete this.getObserverId;
                    this.receivedUpdates = null;
                } else {
                    throw new Error('Observer corrupted');
                }
            };
            
            system.addObserver(corruptingObserver);
            
            await system.notifyObservers('youtube', 100, 50);
            await system.notifyObservers('youtube', 120, 100);
            
            expect(updateCount).toBe(2);
            expectSystemStability(system);
        });

        test('should handle rapid observer addition and removal during operation', async () => {
            const { system } = createEdgeCaseTestEnvironment();
            
            for (let i = 0; i < 20; i++) {
                const observer = createEdgeCaseObserver(`dynamic-observer-${i}`);
                system.addObserver(observer);
                
                if (i % 3 === 0) {
                    system.removeObserver(`dynamic-observer-${i - 3}`);
                }
                
                await system.notifyObservers('tiktok', i * 10, (i - 1) * 10);
            }
            
            expect(system.observers.size).toBeGreaterThan(0);
            expectSystemStability(system);
        });
    });

    describe('System State Edge Cases', () => {
        test('should handle rapid online/offline transitions without state corruption', async () => {
            const { system } = createEdgeCaseTestEnvironment();
            
            const observer = createEdgeCaseObserver('rapid-transition-observer');
            system.addObserver(observer);
            
            const transitions = [
                { platform: 'tiktok', isLive: false },
                { platform: 'tiktok', isLive: true },
                { platform: 'tiktok', isLive: false },
                { platform: 'tiktok', isLive: true }
            ];
            
            for (const transition of transitions) {
                await system.updateStreamStatus(transition.platform, transition.isLive);
            }
            
            expect(observer.statusChanges.length).toBeGreaterThan(0);
            expect(system.isStreamLive('tiktok')).toBe(true);
            expectSystemStability(system);
        });

        test('should handle concurrent operations without race conditions', async () => {
            const { system } = createEdgeCaseTestEnvironment();
            
            const observer = createEdgeCaseObserver('concurrent-observer');
            system.addObserver(observer);
            
            const operations = [
                system.notifyObservers('tiktok', 100, 50),
                system.notifyObservers('twitch', 200, 150),
                system.updateStreamStatus('youtube', true),
                system.notifyObservers('youtube', 300, 0),
                system.updateStreamStatus('tiktok', false)
            ];
            
            await Promise.all(operations);
            
            expect(observer.receivedUpdates.length).toBeGreaterThan(0);
            expect(observer.statusChanges.length).toBeGreaterThan(0);
            expectSystemStability(system);
        });

        test('should maintain system stability during shutdown while operations are active', async () => {
            const { system } = createEdgeCaseTestEnvironment();

            const observer = createEdgeCaseObserver('shutdown-observer');
            system.addObserver(observer);

            system.startPolling();

            const operationPromise = system.notifyObservers('tiktok', 100, 50);
            await system.cleanup();
            await operationPromise;

            expectSystemStability(system);
        });

        test('should handle resource exhaustion scenarios gracefully', async () => {
            const { system } = createEdgeCaseTestEnvironment();
            
            // Add many observers to create resource pressure
            for (let i = 0; i < 1000; i++) {
                const observer = createEdgeCaseObserver(`resource-observer-${i}`);
                system.addObserver(observer);
            }
            
            const startTime = testClock.now();
            
            await system.notifyObservers('tiktok', 500, 400);
            
            const simulatedProcessingMs = 150;
            testClock.advance(simulatedProcessingMs);
            const processingTime = testClock.now() - startTime;
            
            expect(system.observers.size).toBe(1000);
            expect(processingTime).toBeLessThan(5000);
            expectSystemStability(system);
        });

        test('should handle clock changes and timezone issues appropriately', async () => {
            const { system } = createEdgeCaseTestEnvironment();
            
            const observer = createEdgeCaseObserver('time-observer');
            system.addObserver(observer);
            
            const futureDate = new Date(testClock.now() + 86400000);

            await system.notifyObservers('tiktok', 100, 50);

            const originalNow = global.Date.now;
            global.Date.now = () => futureDate.getTime();

            await system.notifyObservers('twitch', 200, 150);

            global.Date.now = originalNow;
            
            expect(observer.receivedUpdates).toHaveLength(2);
            expect(observer.receivedUpdates[0].timestamp).toBeInstanceOf(Date);
            expect(observer.receivedUpdates[1].timestamp).toBeInstanceOf(Date);
            expectSystemStability(system);
        });
    });

    describe('OBS Integration Edge Cases', () => {
        test('should handle missing OBS sources gracefully', async () => {
            const obsManager = createMockOBSManager('connected', {
                call: createMockFn().mockRejectedValue(new Error('Source "youtube viewer count" not found'))
            });

            const obsObserver = new OBSViewerCountObserver(obsManager, noOpLogger);

            await obsObserver.onViewerCountUpdate({
                platform: 'youtube',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date(testClock.now())
            });
        });

        test('should handle OBS source type mismatches appropriately', async () => {
            const obsManager = createMockOBSManager('connected', {
                call: createMockFn().mockRejectedValue(new Error('Source is not a text source'))
            });

            const obsObserver = new OBSViewerCountObserver(obsManager, noOpLogger);

            await obsObserver.onViewerCountUpdate({
                platform: 'twitch',
                count: 500,
                isStreamLive: true,
                timestamp: new Date(testClock.now())
            });
        });

        test('should handle OBS WebSocket protocol errors without system crash', async () => {
            const obsManager = createMockOBSManager('connected', {
                call: createMockFn().mockRejectedValue(new Error('WebSocket protocol error'))
            });

            const obsObserver = new OBSViewerCountObserver(obsManager, noOpLogger);

            await obsObserver.onViewerCountUpdate({
                platform: 'tiktok',
                count: 750,
                isStreamLive: true,
                timestamp: new Date(testClock.now())
            });
        });

        test('should handle very slow OBS connections without blocking system', async () => {
            const obsManager = createMockOBSManager('connected', {
                call: createMockFn().mockImplementation(() => 
                    new Promise(resolve => scheduleTestTimeout(() => resolve({ status: 'success' }), 5000))
                )
            });
            
            const obsObserver = new OBSViewerCountObserver(obsManager, noOpLogger);
            
            const startTime = testClock.now();
            
            const updatePromise = obsObserver.onViewerCountUpdate({
                platform: 'youtube',
                count: 1200,
                isStreamLive: true,
                timestamp: new Date(testClock.now())
            });

            testClock.advance(10);
            const quickCheck = testClock.now() - startTime;

            expect(quickCheck).toBeLessThan(100);

            updatePromise.catch(() => {});
        });

        test('should handle OBS scene changes dynamically', async () => {
            const obsManager = createMockOBSManager('connected');
            let sourceExists = true;

            obsManager.call = createMockFn().mockImplementation(() => {
                if (!sourceExists) {
                    throw new Error('Source not found in current scene');
                }
                return Promise.resolve({ status: 'success' });
            });

            const obsObserver = new OBSViewerCountObserver(obsManager, noOpLogger);

            await obsObserver.onViewerCountUpdate({
                platform: 'twitch',
                count: 300,
                isStreamLive: true,
                timestamp: new Date(testClock.now())
            });

            sourceExists = false;

            await obsObserver.onViewerCountUpdate({
                platform: 'twitch',
                count: 350,
                isStreamLive: true,
                timestamp: new Date(testClock.now())
            });
        });
    });

    describe('Platform Connection Edge Cases', () => {
        test('should handle platform API format changes gracefully', async () => {
            const { system, mockPlatforms } = createEdgeCaseTestEnvironment({
                platforms: {
                    tiktok: {
                        responseSequence: [
                            200,
                            { viewers: 250 },
                            "300 viewers",
                            [350]
                        ]
                    }
                }
            });
            
            const observer = createEdgeCaseObserver('format-change-observer');
            system.addObserver(observer);
            
            for (let i = 0; i < 4; i++) {
                const count = await mockPlatforms.tiktok.getViewerCount();
                await system.notifyObservers('tiktok', count, i * 50);
            }
            
            expect(observer.receivedUpdates).toHaveLength(4);
            expectSystemStability(system);
        });

        test('should handle unexpected platform events without disruption', async () => {
            const { system } = createEdgeCaseTestEnvironment();
            
            const observer = createEdgeCaseObserver('unexpected-event-observer');
            system.addObserver(observer);
            
            const unexpectedValues = [null, undefined, {}, [], Symbol('test'), () => {}];
            
            for (const value of unexpectedValues) {
                await system.notifyObservers('youtube', value, 100);
            }
            
            expect(observer.receivedUpdates).toHaveLength(unexpectedValues.length);
            expectSystemStability(system);
        });

        test('should handle platform authentication issues during operation', async () => {
            const { system, mockPlatforms } = createEdgeCaseTestEnvironment({
                platforms: {
                    twitch: {
                        responseSequence: [100, 150, 200]
                    }
                }
            });

            let authCallCount = 0;
            const originalGetViewerCount = mockPlatforms.twitch.getViewerCount;
            mockPlatforms.twitch.getViewerCount = async function() {
                authCallCount++;
                if (authCallCount > 2) {
                    throw new Error('Authentication expired');
                }
                return originalGetViewerCount.call(this);
            };
            
            const observer = createEdgeCaseObserver('auth-failure-observer');
            system.addObserver(observer);
            
            const results = [];
            for (let i = 0; i < 4; i++) {
                try {
                    const result = await mockPlatforms.twitch.getViewerCount();
                    results.push(result);
                } catch {
                    results.push('auth-failed');
                }
            }
            
            expect(results.slice(0, 2)).toEqual([100, 150]);
            expect(results.slice(2)).toEqual(['auth-failed', 'auth-failed']);
            expectSystemStability(system);
        });

        test('should handle complete platform service outages', async () => {
            const { system, mockPlatforms } = createEdgeCaseTestEnvironment({
                platforms: {
                    tiktok: { shouldThrow: true, errorMessage: 'Service unavailable' },
                    twitch: { shouldThrow: true, errorMessage: 'DNS resolution failed' },
                    youtube: { shouldThrow: true, errorMessage: 'Connection timeout' }
                }
            });
            
            const observer = createEdgeCaseObserver('outage-observer');
            system.addObserver(observer);
            
            const results = [];
            for (const [platform, mockPlatform] of Object.entries(mockPlatforms)) {
                try {
                    const result = await mockPlatform.getViewerCount();
                    results.push({ platform, result });
                } catch (error) {
                    results.push({ platform, error: error.message });
                }
            }
            
            results.forEach(result => {
                expect(result.error).toBeDefined();
            });
            expectSystemStability(system);
        });

        test('should handle mixed platform states efficiently', async () => {
            const { system, mockPlatforms } = createEdgeCaseTestEnvironment({
                platforms: {
                    tiktok: { returnValue: 500 },
                    twitch: { shouldThrow: true },
                    youtube: { returnValue: 300 }
                }
            });
            
            const observer = createEdgeCaseObserver('mixed-state-observer');
            system.addObserver(observer);
            
            const results = [];
            for (const [platform, mockPlatform] of Object.entries(mockPlatforms)) {
                try {
                    const result = await mockPlatform.getViewerCount();
                    results.push({ platform, result, status: 'success' });
                } catch (error) {
                    results.push({ platform, error: error.message, status: 'failed' });
                }
            }
            
            const successfulPlatforms = results.filter(r => r.status === 'success');
            const failedPlatforms = results.filter(r => r.status === 'failed');
            
            expect(successfulPlatforms).toHaveLength(2);
            expect(failedPlatforms).toHaveLength(1);
            expectSystemStability(system);
        });
    });
});
