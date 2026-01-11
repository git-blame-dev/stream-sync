
const { initializeTestLogging } = require('../helpers/test-setup');
const { createMockPlatform, createMockNotificationManager, createMockLogger } = require('../helpers/mock-factories');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');

// Initialize logging for tests FIRST
initializeTestLogging();

// Setup automated cleanup with enhanced performance monitoring
setupAutomatedCleanup({
    clearCallsBeforeEach: true,
    validateAfterCleanup: true,
    logPerformanceMetrics: true
});

const { ViewerCountSystem } = require('../../src/utils/viewer-count');

const createViewerCountSystemWithBehaviors = (platformBehaviors = {}, systemBehaviors = {}) => {
    const defaultPlatformBehaviors = {
        tiktok: { viewerCount: 150 },
        twitch: { viewerCount: 50 },
        youtube: { viewerCount: 200 },
        ...platformBehaviors
    };
    
    // Create platforms using mock pattern for compatibility
    const platforms = {};
    Object.entries(defaultPlatformBehaviors).forEach(([name, behavior]) => {
        platforms[name] = createMockPlatform(name, {
            getViewerCount: jest.fn().mockReturnValue(behavior.viewerCount),
            initialize: jest.fn().mockResolvedValue(true),
            destroy: jest.fn().mockResolvedValue(true),
            isConnected: jest.fn().mockReturnValue(true)
        });
    });
    
    const logger = createMockLogger('info');
    const app = {
        platforms,
        notificationManager: createMockNotificationManager(),
        logger,
        ...systemBehaviors
    };
    
    const system = new ViewerCountSystem({
        platforms,
        logger
    });

    return { system, app, platforms };
};

const simulatePlatformReadiness = async (system, platform, isReady) => {
    await system.updateStreamStatus(platform, isReady);
};

const validateSystemStability = (system) => {
    const status = system.getSystemStatus();
    return {
        isStable: status.isPolling !== undefined && status.viewerCounts !== undefined,
        hasValidCounts: Object.values(status.viewerCounts).every(count => typeof count === 'number'),
        platformsTracked: Object.keys(status.streamStatus).length, // Number of platforms tracked
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
    describe('Unified Initialization Behavior', () => {
        test('should eliminate dual initialization paths completely', async () => {
            // Given: ViewerCount system (simulating real app usage)
            const { system, app } = createViewerCountSystemWithBehaviors();
            
            // This test should FAIL because current system has dual initialization:
            // 1. Regular initialization path (main.js:1623-1635)
            // 2. Early initialization path (main.js:1641-1656)
            
            // When: Checking for dual initialization indicators 
            const hasEarlyInitMethod = typeof system.startViewerCountSystemEarly === 'function';
            const hasViewerCountSystemStartedFlag = app.viewerCountSystemStarted !== undefined;
            
            // Then: System should NOT have dual initialization artifacts
            expect(hasEarlyInitMethod).toBe(false); // Should FAIL - method exists in current system
            expect(hasViewerCountSystemStartedFlag).toBe(false); // Should FAIL - flag exists in app
            
            // And: System should have single, unified initialization method
            expect(typeof system.initialize === 'function').toBe(true);
            // unifiedInitialize was removed as dead code - initialize is the single unified method
        });

        test('should handle platform readiness changes without re-initialization', async () => {
            // Given: ViewerCount system with all platforms initially offline
            const { system } = createViewerCountSystemWithBehaviors({
                tiktok: { connectsBehavior: 'stable', viewerCount: 75 },
                twitch: { connectsBehavior: 'stable', viewerCount: 25 },
                youtube: { connectsBehavior: 'stable', viewerCount: 150 }
            });
            
            await system.initialize();
            
            // When: Platforms become ready at different times
            await simulatePlatformReadiness(system, 'twitch', true);
            await simulatePlatformReadiness(system, 'youtube', true);
            
            // Then: System should adapt without re-initialization
            const stability = validateSystemStability(system);
            expect(stability.isStable).toBe(true);
            
            // And: Platform readiness should not affect core system stability
            await simulatePlatformReadiness(system, 'tiktok', true);
            const postReadinessStability = validateSystemStability(system);
            expect(postReadinessStability.isStable).toBe(true);
        });

        test('should prevent race conditions from dual initialization timing', async () => {
            // Given: ViewerCount system in app that has the dual init problem
            const { system, app } = createViewerCountSystemWithBehaviors();
            
            // This test should FAIL because current system allows race conditions
            // The real system has both regular init and early init paths that can conflict
            
            // When: Simulating the race condition scenario from main.js
            // Early init (triggered by platform connection) vs Regular init (startup)
            let raceConditionDetected = false;
            
            try {
                // Simulate early initialization (like YouTube connection trigger)
                await system.initialize(); // Regular path
                
                // Now simulate what happens when platform connection triggers early init
                // In real system, this creates potential race condition
                if (app.viewerCountSystemStarted) {
                    // This flag indicates dual initialization pattern exists
                    raceConditionDetected = true;
                }
            } catch (error) {
                raceConditionDetected = true; // Any error indicates potential race condition
            }
            
            // Then: System should NOT have race condition potential
            expect(raceConditionDetected).toBe(false); // Should FAIL - dual init exists
            
            // And: System should have timing-independent initialization
            expect(system.hasUnifiedInitialization).toBe(true); // Should FAIL - property doesn't exist
        });
    });

    describe('Platform Integration Behavior', () => {
        test('should use unified polling start instead of early/regular split', async () => {
            // Given: ViewerCount system that should have unified behavior
            const { system } = createViewerCountSystemWithBehaviors();
            
            // This test should FAIL because current system has split polling logic:
            // - startPolling() in regular init (main.js:1631)  
            // - startPolling() in early init (main.js:1650)
            
            await system.initialize();
            
            // When: Checking for unified polling approach
            // startUnifiedPolling was removed - startPolling is the single unified method
            const hasStartPolling = typeof system.startPolling === 'function';
            const hasSeparateEarlyPolling = typeof system.startViewerCountSystemEarly === 'function';

            // Then: Should have unified approach via single startPolling method
            expect(hasStartPolling).toBe(true);
            expect(hasSeparateEarlyPolling).toBe(false);
        });

        test('should start polling when platform becomes ready', async () => {
            // Given: ViewerCount system with platform initially offline
            const { system } = createViewerCountSystemWithBehaviors({
                youtube: { viewerCount: 300 }
            });
            
            await system.initialize();
            system.startPolling();
            
            // When: Platform becomes ready
            await simulatePlatformReadiness(system, 'youtube', true);
            
            // Then: System should start polling that platform
            const status = system.getSystemStatus();
            expect(status.activePollingPlatforms).toContain('youtube');

            // And: User should see viewer count updates from ready platform
            await system.pollPlatform('youtube');
            expect(expectUserSeesViewerCount(system, 'youtube', 300)).toBe(true);
        });

        test('should stop polling when platform goes offline', async () => {
            // Given: ViewerCount system with platform initially live
            const { system } = createViewerCountSystemWithBehaviors({
                twitch: { connectsBehavior: 'stable', viewerCount: 100 }
            });
            
            await system.initialize();
            await simulatePlatformReadiness(system, 'twitch', true);
            system.startPolling();
            
            // When: Platform goes offline
            await simulatePlatformReadiness(system, 'twitch', false);
            
            // Then: System should stop polling that platform
            const status = system.getSystemStatus();
            expect(status.activePollingPlatforms).not.toContain('twitch');
            
            // And: User should see count reset to zero for offline platform
            expect(expectUserSeesViewerCount(system, 'twitch', 0)).toBe(true);
        });

        test('should reflect platform readiness changes in viewer count updates', async () => {
            // Given: ViewerCount system with multiple platforms
            const { system } = createViewerCountSystemWithBehaviors({
                tiktok: { connectsBehavior: 'stable', viewerCount: 200 },
                youtube: { connectsBehavior: 'stable', viewerCount: 150 }
            });
            
            await system.initialize();
            system.startPolling();
            
            // When: Platform readiness changes dynamically
            await simulatePlatformReadiness(system, 'tiktok', true);
            await simulatePlatformReadiness(system, 'youtube', false);
            
            // Then: User should see polling status reflect platform states
            const status = system.getSystemStatus();
            expect(status.activePollingPlatforms).toContain('tiktok');
            expect(status.activePollingPlatforms).not.toContain('youtube');
            
            // And: User should see appropriate viewer counts
            // TikTok should show 0 initially, YouTube should show 0 when offline
            expect(expectUserSeesViewerCount(system, 'youtube', 0)).toBe(true); // Offline
            
            // Perform polling to get actual counts
            await system.pollPlatform('tiktok');
            expect(expectUserSeesViewerCount(system, 'tiktok', 200)).toBe(true); // Now polled
        });
    });

    describe('Error Recovery Behavior', () => {
        test('should maintain system stability during platform connection failures', async () => {
            // Given: ViewerCount system with stable initial state
            const { system, platforms } = createViewerCountSystemWithBehaviors();
            await system.initialize();
            
            const initialStability = validateSystemStability(system);
            expect(initialStability.isStable).toBe(true);
            
            // When: Platform connection failure occurs
            const tiktokPlatform = platforms.tiktok;
            simulateNetworkFailure(tiktokPlatform, 'connection_refused');
            
            // Then: System should handle gracefully
            const recoveryStability = validateSystemStability(system);
            expect(recoveryStability.isStable).toBe(true);
            expect(recoveryStability.hasValidCounts).toBe(true);
        });

        test('should recover when platforms become available later', async () => {
            // Given: ViewerCount system with failed platform initialization
            const { system, platforms } = createViewerCountSystemWithBehaviors({
                youtube: { viewerCount: 250 }
            });
            
            // Initially fail platform
            const youtubePlatform = platforms.youtube;
            simulateNetworkFailure(youtubePlatform, 'initialization_failed');
            
            await system.initialize();
            
            // When: Platform becomes available later
            youtubePlatform.getViewerCount.mockReturnValue(250);
            youtubePlatform.initialize.mockResolvedValue(true);
            await simulatePlatformReadiness(system, 'youtube', true);
            
            // Then: System should recover and integrate platform
            const status = system.getSystemStatus();
            expect(status.streamStatus.youtube).toBe(true);
            
            // And: User should be able to get viewer counts from recovered platform
            system.startPolling();
            const pollingStatus = system.getSystemStatus();
            expect(pollingStatus.isPolling).toBe(true);
        });

        test('should remain stable during simultaneous platform failures', async () => {
            // Given: ViewerCount system with multiple active platforms
            const { system, platforms } = createViewerCountSystemWithBehaviors();
            await system.initialize();
            
            // Simulate all platforms as live
            await simulatePlatformReadiness(system, 'tiktok', true);
            await simulatePlatformReadiness(system, 'twitch', true);
            await simulatePlatformReadiness(system, 'youtube', true);
            
            // When: Multiple platforms fail simultaneously
            Object.values(platforms).forEach(platform => {
                simulateNetworkFailure(platform, 'network_outage');
            });
            
            // Then: System should maintain stability
            const stability = validateSystemStability(system);
            expect(stability.isStable).toBe(true);
            expect(stability.hasValidCounts).toBe(true);
            
            // And: User experience should remain predictable
            const status = system.getSystemStatus();
            expect(Object.values(status.viewerCounts).every(count => count >= 0)).toBe(true);
        });
    });

    describe('Timing Reliability Behavior', () => {
        test('should work regardless of platform initialization order', async () => {
            // Given: ViewerCount system where platforms initialize in random order
            const { system } = createViewerCountSystemWithBehaviors();
            await system.initialize();
            
            // When: Platforms become ready in a shuffled order
            const platformOrder = ['youtube', 'twitch', 'tiktok'];
            
            for (const platform of platformOrder) {
                await simulatePlatformReadiness(system, platform, true);
            }
            
            // Then: System should function correctly regardless of order
            const stability = validateSystemStability(system);
            expect(stability.isStable).toBe(true);
            expect(stability.platformsTracked).toBe(3);
            
            // And: All platforms should be properly tracked
            const status = system.getSystemStatus();
            expect(Object.keys(status.streamStatus)).toContain('tiktok');
            expect(Object.keys(status.streamStatus)).toContain('twitch');
            expect(Object.keys(status.streamStatus)).toContain('youtube');
        });

        test('should prevent race conditions with early platform readiness', async () => {
            // Given: Platform becomes ready before ViewerCount initialization
            const { system } = createViewerCountSystemWithBehaviors();
            
            // When: Platform readiness occurs before system initialization
            await simulatePlatformReadiness(system, 'twitch', true);
            await system.initialize();
            
            // Then: System should handle early readiness without race conditions
            const stability = validateSystemStability(system);
            expect(stability.isStable).toBe(true);
            
            // And: Platform state should be correctly tracked
            const status = system.getSystemStatus();
            expect(status.streamStatus.twitch).toBe(true);
        });

        test('should handle late platform readiness without issues', async () => {
            // Given: ViewerCount system fully initialized and running
            const { system } = createViewerCountSystemWithBehaviors();
            await system.initialize();
            system.startPolling();
            
            // When: Platform becomes ready much later
            await waitForDelay(50); // Simulate delay
            await simulatePlatformReadiness(system, 'tiktok', true);
            
            // Then: System should integrate late platform seamlessly
            const status = system.getSystemStatus();
            expect(status.streamStatus.tiktok).toBe(true);
            
            // And: Polling should start for late platform
            expect(system.isPlatformEligibleForPolling('tiktok')).toBe(true);
        });

        test('should maintain predictable polling behavior across timing scenarios', async () => {
            // Given: ViewerCount system with varied platform timing
            const { system } = createViewerCountSystemWithBehaviors();
            await system.initialize();
            
            // When: Mixed timing scenario occurs
            await simulatePlatformReadiness(system, 'youtube', true); // Early
            system.startPolling(); // Middle
            await simulatePlatformReadiness(system, 'twitch', true); // Late
            
            // Then: Polling behavior should be predictable
            const status = system.getSystemStatus();
            expect(status.isPolling).toBe(true);
            
            // And: Both early and late platforms should be handled correctly
            expect(status.streamStatus.youtube).toBe(true);
            expect(status.streamStatus.twitch).toBe(true);
            
            // And: User should see consistent polling behavior
            expect(system.isPlatformEligibleForPolling('youtube')).toBe(true);
            expect(system.isPlatformEligibleForPolling('twitch')).toBe(true);
        });
    });
});
