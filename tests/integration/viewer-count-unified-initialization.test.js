const { describe, test, afterEach, expect } = require('bun:test');
const { createMockFn, restoreAllMocks } = require('../helpers/bun-mock-utils');
const { createMockPlatform, noOpLogger } = require('../helpers/mock-factories');
const { ViewerCountSystem } = require('../../src/utils/viewer-count');
const { createRuntimeConstantsFixture } = require('../helpers/runtime-constants-fixture');

const createViewerCountSystemWithBehaviors = (platformBehaviors = {}) => {
    const defaultPlatformBehaviors = {
        tiktok: { viewerCount: 150 },
        twitch: { viewerCount: 50 },
        youtube: { viewerCount: 200 },
        ...platformBehaviors
    };

    const platforms = {};
    Object.entries(defaultPlatformBehaviors).forEach(([name, behavior]) => {
        platforms[name] = createMockPlatform(name, {
            getViewerCount: createMockFn().mockReturnValue(behavior.viewerCount),
            initialize: createMockFn().mockResolvedValue(true),
            destroy: createMockFn().mockResolvedValue(true),
            isConnected: createMockFn().mockReturnValue(true)
        });
    });

    const system = new ViewerCountSystem({
        platforms,
        logger: noOpLogger,
        runtimeConstants: createRuntimeConstantsFixture()
    });

    return { system, platforms };
};

const simulatePlatformReadiness = async (system, platform, isReady) => {
    await system.updateStreamStatus(platform, isReady);
};

const validateSystemStability = (system) => {
    const status = system.getSystemStatus();
    return {
        isStable: status.isPolling !== undefined && status.viewerCounts !== undefined,
        hasValidCounts: Object.values(status.viewerCounts).every(count => typeof count === 'number'),
        platformsTracked: Object.keys(status.streamStatus).length,
        pollingState: status.isPolling,
        activePollingPlatforms: status.activePollingPlatforms
    };
};

const simulateNetworkFailure = (platform, errorType = 'connection_timeout') => {
    if (platform.getViewerCount) {
        platform.getViewerCount.mockRejectedValue(new Error(`Network ${errorType}`));
    }
    if (platform.initialize) {
        platform.initialize.mockRejectedValue(new Error(`Platform ${errorType}`));
    }
};

const expectUserSeesViewerCount = (system, platform, expectedCount) => {
    const status = system.getSystemStatus();
    const actualCount = status.viewerCounts[platform.toLowerCase()];
    return actualCount === expectedCount;
};

describe('ViewerCount Unified Initialization Behavior', () => {
    afterEach(() => {
        restoreAllMocks();
    });

    describe('Unified Initialization Behavior', () => {
        test('should not have dual initialization artifacts', async () => {
            const { system } = createViewerCountSystemWithBehaviors();

            const hasEarlyInitMethod = typeof system.startViewerCountSystemEarly === 'function';
            expect(hasEarlyInitMethod).toBe(false);
            expect(typeof system.initialize === 'function').toBe(true);
        });

        test('should handle platform readiness changes without re-initialization', async () => {
            const { system } = createViewerCountSystemWithBehaviors({
                tiktok: { viewerCount: 75 },
                twitch: { viewerCount: 25 },
                youtube: { viewerCount: 150 }
            });

            await system.initialize();
            await simulatePlatformReadiness(system, 'twitch', true);
            await simulatePlatformReadiness(system, 'youtube', true);

            const stability = validateSystemStability(system);
            expect(stability.isStable).toBe(true);

            await simulatePlatformReadiness(system, 'tiktok', true);
            const postReadinessStability = validateSystemStability(system);
            expect(postReadinessStability.isStable).toBe(true);
        });

        test('should prevent race conditions from dual initialization timing', async () => {
            const { system } = createViewerCountSystemWithBehaviors();

            let raceConditionDetected = false;
            try {
                await system.initialize();
            } catch {
                raceConditionDetected = true;
            }

            expect(raceConditionDetected).toBe(false);
        });
    });

    describe('Platform Integration Behavior', () => {
        test('should use unified polling via single startPolling method', async () => {
            const { system } = createViewerCountSystemWithBehaviors();

            await system.initialize();

            const hasStartPolling = typeof system.startPolling === 'function';
            const hasSeparateEarlyPolling = typeof system.startViewerCountSystemEarly === 'function';

            expect(hasStartPolling).toBe(true);
            expect(hasSeparateEarlyPolling).toBe(false);
        });

        test('should start polling when platform becomes ready', async () => {
            const { system } = createViewerCountSystemWithBehaviors({
                youtube: { viewerCount: 300 }
            });

            await system.initialize();
            system.startPolling();
            await simulatePlatformReadiness(system, 'youtube', true);

            const status = system.getSystemStatus();
            expect(status.activePollingPlatforms).toContain('youtube');

            await system.pollPlatform('youtube');
            expect(expectUserSeesViewerCount(system, 'youtube', 300)).toBe(true);
        });

        test('should stop polling when platform goes offline', async () => {
            const { system } = createViewerCountSystemWithBehaviors({
                twitch: { viewerCount: 100 }
            });

            await system.initialize();
            await simulatePlatformReadiness(system, 'twitch', true);
            system.startPolling();
            await simulatePlatformReadiness(system, 'twitch', false);

            const status = system.getSystemStatus();
            expect(status.activePollingPlatforms).not.toContain('twitch');
            expect(expectUserSeesViewerCount(system, 'twitch', 0)).toBe(true);
        });

        test('should reflect platform readiness changes in viewer count updates', async () => {
            const { system } = createViewerCountSystemWithBehaviors({
                tiktok: { viewerCount: 200 },
                youtube: { viewerCount: 150 }
            });

            await system.initialize();
            system.startPolling();
            await simulatePlatformReadiness(system, 'tiktok', true);
            await simulatePlatformReadiness(system, 'youtube', false);

            const status = system.getSystemStatus();
            expect(status.activePollingPlatforms).toContain('tiktok');
            expect(status.activePollingPlatforms).not.toContain('youtube');
            expect(expectUserSeesViewerCount(system, 'youtube', 0)).toBe(true);

            await system.pollPlatform('tiktok');
            expect(expectUserSeesViewerCount(system, 'tiktok', 200)).toBe(true);
        });
    });

    describe('Error Recovery Behavior', () => {
        test('should maintain system stability during platform connection failures', async () => {
            const { system, platforms } = createViewerCountSystemWithBehaviors();
            await system.initialize();

            const initialStability = validateSystemStability(system);
            expect(initialStability.isStable).toBe(true);

            simulateNetworkFailure(platforms.tiktok, 'connection_refused');

            const recoveryStability = validateSystemStability(system);
            expect(recoveryStability.isStable).toBe(true);
            expect(recoveryStability.hasValidCounts).toBe(true);
        });

        test('should recover when platforms become available later', async () => {
            const { system, platforms } = createViewerCountSystemWithBehaviors({
                youtube: { viewerCount: 250 }
            });

            simulateNetworkFailure(platforms.youtube, 'initialization_failed');
            await system.initialize();

            platforms.youtube.getViewerCount.mockReturnValue(250);
            platforms.youtube.initialize.mockResolvedValue(true);
            await simulatePlatformReadiness(system, 'youtube', true);

            const status = system.getSystemStatus();
            expect(status.streamStatus.youtube).toBe(true);

            system.startPolling();
            const pollingStatus = system.getSystemStatus();
            expect(pollingStatus.isPolling).toBe(true);
        });

        test('should remain stable during simultaneous platform failures', async () => {
            const { system, platforms } = createViewerCountSystemWithBehaviors();
            await system.initialize();

            await simulatePlatformReadiness(system, 'tiktok', true);
            await simulatePlatformReadiness(system, 'twitch', true);
            await simulatePlatformReadiness(system, 'youtube', true);

            Object.values(platforms).forEach(platform => {
                simulateNetworkFailure(platform, 'network_outage');
            });

            const stability = validateSystemStability(system);
            expect(stability.isStable).toBe(true);
            expect(stability.hasValidCounts).toBe(true);

            const status = system.getSystemStatus();
            expect(Object.values(status.viewerCounts).every(count => count >= 0)).toBe(true);
        });
    });

    describe('Timing Reliability Behavior', () => {
        test('should work regardless of platform initialization order', async () => {
            const { system } = createViewerCountSystemWithBehaviors();
            await system.initialize();

            const platformOrder = ['youtube', 'twitch', 'tiktok'];
            for (const platform of platformOrder) {
                await simulatePlatformReadiness(system, platform, true);
            }

            const stability = validateSystemStability(system);
            expect(stability.isStable).toBe(true);
            expect(stability.platformsTracked).toBe(3);

            const status = system.getSystemStatus();
            expect(Object.keys(status.streamStatus)).toContain('tiktok');
            expect(Object.keys(status.streamStatus)).toContain('twitch');
            expect(Object.keys(status.streamStatus)).toContain('youtube');
        });

        test('should prevent race conditions with early platform readiness', async () => {
            const { system } = createViewerCountSystemWithBehaviors();

            await simulatePlatformReadiness(system, 'twitch', true);
            await system.initialize();

            const stability = validateSystemStability(system);
            expect(stability.isStable).toBe(true);

            const status = system.getSystemStatus();
            expect(status.streamStatus.twitch).toBe(true);
        });

        test('should handle late platform readiness without issues', async () => {
            const { system } = createViewerCountSystemWithBehaviors();
            await system.initialize();
            system.startPolling();

            await waitForDelay(50);
            await simulatePlatformReadiness(system, 'tiktok', true);

            const status = system.getSystemStatus();
            expect(status.streamStatus.tiktok).toBe(true);
            expect(system.isPlatformEligibleForPolling('tiktok')).toBe(true);
        });

        test('should maintain predictable polling behavior across timing scenarios', async () => {
            const { system } = createViewerCountSystemWithBehaviors();
            await system.initialize();

            await simulatePlatformReadiness(system, 'youtube', true);
            system.startPolling();
            await simulatePlatformReadiness(system, 'twitch', true);

            const status = system.getSystemStatus();
            expect(status.isPolling).toBe(true);
            expect(status.streamStatus.youtube).toBe(true);
            expect(status.streamStatus.twitch).toBe(true);
            expect(system.isPlatformEligibleForPolling('youtube')).toBe(true);
            expect(system.isPlatformEligibleForPolling('twitch')).toBe(true);
        });
    });
});
