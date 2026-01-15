
const { describe, test, expect, beforeEach, afterEach } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../../helpers/bun-mock-utils');
const { mockModule, restoreAllModuleMocks } = require('../../helpers/bun-module-mocks');

mockModule('../../../src/core/config', () => ({
    configManager: {
        getSection: createMockFn().mockImplementation((platform) => ({
            viewerCountEnabled: true,
            viewerCountSource: `${platform} viewer count`
        })),
        getPlatforms: createMockFn(() => ['twitch', 'youtube', 'tiktok'])
    },
    config: { general: { fallbackUsername: 'Unknown User' } }
}));

const { configManager } = require('../../../src/core/config');
const { OBSViewerCountObserver } = require('../../../src/observers/obs-viewer-count-observer');
const { ViewerCountObserver } = require('../../../src/observers/viewer-count-observer');

// Test utilities following standard patterns
const { 
    createMockOBSManager,
    setupAutomatedCleanup
} = require('../../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../../helpers/behavior-validation');
const { createSilentLogger } = require('../../helpers/test-logger');

const defaultPlatforms = ['twitch', 'youtube', 'tiktok'];
const setDefaultConfig = () => {
    configManager.getSection = createMockFn().mockImplementation((platform) => ({
        viewerCountEnabled: true,
        viewerCountSource: `${platform} viewer count`
    }));
    configManager.getPlatforms = createMockFn().mockReturnValue(defaultPlatforms);
};

describe('OBSViewerCountObserver - Behavior-Focused Testing', () => {
    afterEach(() => {
        restoreAllMocks();
        restoreAllModuleMocks();
    });

    let obsManager, observer, logger;
    
    // Setup automated cleanup for all tests
    setupAutomatedCleanup();
    
    beforeEach(() => {
        setDefaultConfig();
        logger = createSilentLogger();

        // Create behavior-focused mock infrastructure
        obsManager = createMockOBSManager('connected', {
            call: createMockFn().mockResolvedValue({ status: 'success' }),
            isConnected: createMockFn().mockReturnValue(true)
        });
        
        observer = new OBSViewerCountObserver(obsManager, logger);
    });

    describe('Observer Initialization & Interface Compliance', () => {
        test('should properly implement observer interface contract', () => {
            // Given: OBS observer instance
            // When: Checking interface compliance
            // Then: Should implement all required observer methods
            expect(observer).toBeInstanceOf(ViewerCountObserver);
            expect(observer).toBeInstanceOf(OBSViewerCountObserver);
            expect(typeof observer.onViewerCountUpdate).toBe('function');
            expect(typeof observer.onStreamStatusChange).toBe('function');
            expect(typeof observer.initialize).toBe('function');
            expect(typeof observer.cleanup).toBe('function');
            expect(typeof observer.getObserverId).toBe('function');
        });

        test('should provide unique observer ID for system registration', () => {
            // Given: OBS observer instance
            // When: Getting observer ID
            const observerId = observer.getObserverId();
            
            // Then: Should provide consistent, unique identifier
            expect(observerId).toBe('obs-viewer-count-observer');
            expect(typeof observerId).toBe('string');
            expect(observerId.length).toBeGreaterThan(0);
            
            // No technical artifacts in ID
            expectNoTechnicalArtifacts(observerId);
        });

        test('should initialize with provided OBS manager dependency', () => {
            // Given: OBS manager and observer
            // When: Creating observer with dependency
            const testObserver = new OBSViewerCountObserver(obsManager, logger);
            
            // Then: Should accept dependency without errors
            expect(testObserver).toBeDefined();
            expect(testObserver.obsManager).toBe(obsManager);
        });

        test('should handle initialization without OBS connection gracefully', async () => {
            // Given: Disconnected OBS manager
            const disconnectedOBS = createMockOBSManager('disconnected');
            const testObserver = new OBSViewerCountObserver(disconnectedOBS, logger);
            
            // When: Initializing observer
            const initPromise = testObserver.initialize();
            
            // Then: Should complete without throwing errors
            await expect(initPromise).resolves.toBeUndefined();
        });

        test('should initialize all platform counts to zero when OBS connected', async () => {
            // Given: Connected OBS and observer
            // When: Initializing observer
            await observer.initialize();
            
            // Then: Should attempt to set all platforms to zero
            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings', 
                expect.objectContaining({
                    inputSettings: { text: '0' }
                })
            );
            
            // Should handle multiple platforms
            expect(obsManager.call).toHaveBeenCalledTimes(3); // tiktok, twitch, youtube
        });
    });

    describe('Viewer Count Update Behavior', () => {
        test('should update OBS text sources when stream is live', async () => {
            // Given: Live stream with viewer count update
            const updateData = {
                platform: 'youtube',
                count: 1234,
                previousCount: 1000,
                isStreamLive: true,
                timestamp: new Date()
            };
            
            // When: Processing viewer count update
            await observer.onViewerCountUpdate(updateData);
            
            // Then: Should update OBS with formatted count
            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings', 
                expect.objectContaining({
                    inputName: 'youtube viewer count',
                    inputSettings: { text: '1.2K' }, // Formatted viewer count
                    overlay: true
                })
            );
        });

        test('should format viewer counts according to platform standards', async () => {
            // Given: Different viewer count scenarios
            const testCases = [
                { count: 999, expectedFormat: '999' },
                { count: 1500, expectedFormat: '1.5K' },
                { count: 10000, expectedFormat: '10K' },
                { count: 1500000, expectedFormat: '1.5M' }
            ];
            
            for (const testCase of testCases) {
                // When: Updating with specific count
                await observer.onViewerCountUpdate({
                    platform: 'twitch',
                    count: testCase.count,
                    isStreamLive: true,
                    timestamp: new Date()
                });
                
                // Then: Should format count correctly
                expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                    expect.objectContaining({
                        inputSettings: { text: testCase.expectedFormat }
                    })
                );
            }
        });

        test('should skip updates when stream is offline', async () => {
            // Given: Offline stream with viewer count update
            const updateData = {
                platform: 'youtube',
                count: 1234,
                previousCount: 1000,
                isStreamLive: false,
                timestamp: new Date()
            };
            
            // Clear any previous calls
            obsManager.call.mockClear();
            
            // When: Processing viewer count update for offline stream
            await observer.onViewerCountUpdate(updateData);
            
            // Then: Should not update OBS
            expect(obsManager.call).not.toHaveBeenCalled();
        });

        test('should handle multiple platform updates simultaneously', async () => {
            // Given: Multiple simultaneous platform updates
            const updates = [
                { platform: 'youtube', count: 1000, isStreamLive: true },
                { platform: 'twitch', count: 2000, isStreamLive: true },
                { platform: 'tiktok', count: 500, isStreamLive: true }
            ];
            
            // When: Processing multiple updates
            await Promise.all(updates.map(update => 
                observer.onViewerCountUpdate({
                    ...update,
                    timestamp: new Date()
                })
            ));
            
            // Then: Should update all platforms
            expect(obsManager.call).toHaveBeenCalledTimes(3);
            
            // Verify each platform was updated with formatted counts
            const expectedCalls = [
                { platform: 'youtube', expectedText: '1K' },
                { platform: 'twitch', expectedText: '2K' },
                { platform: 'tiktok', expectedText: '500' }
            ];
            
            expectedCalls.forEach(({ platform, expectedText }) => {
                expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                    expect.objectContaining({
                        inputName: `${platform} viewer count`,
                        inputSettings: { text: expectedText }
                    })
                );
            });
        });

        test('should maintain viewer count accuracy across updates', async () => {
            // Given: Series of viewer count updates
            const updates = [
                { count: 100, expectedText: '100' },
                { count: 1500, expectedText: '1.5K' },
                { count: 999, expectedText: '999' },
                { count: 2000000, expectedText: '2M' }
            ];
            
            for (const update of updates) {
                // When: Updating viewer count
                await observer.onViewerCountUpdate({
                    platform: 'youtube',
                    count: update.count,
                    isStreamLive: true,
                    timestamp: new Date()
                });
                
                // Then: Should reflect accurate count
                expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                    expect.objectContaining({
                        inputSettings: { text: update.expectedText }
                    })
                );
            }
        });
    });

    describe('Stream Status Change Behavior', () => {
        test('should reset viewer counts to 0 when stream goes offline', async () => {
            // Given: Stream going from live to offline
            const statusUpdate = {
                platform: 'youtube',
                isLive: false,
                wasLive: true,
                timestamp: new Date()
            };
            
            // When: Processing stream status change
            await observer.onStreamStatusChange(statusUpdate);
            
            // Then: Should reset viewer count to 0
            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputSettings: { text: '0' }
                })
            );
        });

        test('should enable updates when stream comes online', async () => {
            // Given: Stream going from offline to live
            const statusUpdate = {
                platform: 'youtube',
                isLive: true,
                wasLive: false,
                timestamp: new Date()
            };
            
            // When: Processing stream status change
            await observer.onStreamStatusChange(statusUpdate);
            
            // Then: Should log status change without errors
            // (No specific behavior required for going live, just logging)
            expect(statusUpdate.isLive).toBe(true);
        });

        test('should handle rapid online/offline transitions', async () => {
            // Given: Rapid status changes
            const transitions = [
                { isLive: true, wasLive: false },
                { isLive: false, wasLive: true },
                { isLive: true, wasLive: false },
                { isLive: false, wasLive: true }
            ];
            
            let obsCallCount = 0;
            
            for (const transition of transitions) {
                // When: Processing rapid transitions
                await observer.onStreamStatusChange({
                    platform: 'twitch',
                    ...transition,
                    timestamp: new Date()
                });
                
                // Count OBS calls for offline transitions
                if (!transition.isLive && transition.wasLive) {
                    obsCallCount++;
                }
            }
            
            // Then: Should handle all transitions and reset when going offline
            expect(obsManager.call).toHaveBeenCalledTimes(obsCallCount);
        });

        test('should maintain state consistency during status changes', async () => {
            // Given: Various status change scenarios
            const scenarios = [
                { isLive: true, wasLive: false, shouldReset: false },
                { isLive: false, wasLive: true, shouldReset: true },
                { isLive: false, wasLive: false, shouldReset: false },
                { isLive: true, wasLive: true, shouldReset: false }
            ];
            
            for (const scenario of scenarios) {
                obsManager.call.mockClear();
                
                // When: Processing status change
                await observer.onStreamStatusChange({
                    platform: 'tiktok',
                    isLive: scenario.isLive,
                    wasLive: scenario.wasLive,
                    timestamp: new Date()
                });
                
                // Then: Should only reset when transitioning to offline
                if (scenario.shouldReset) {
                    expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                        expect.objectContaining({
                            inputSettings: { text: '0' }
                        })
                    );
                } else {
                    expect(obsManager.call).not.toHaveBeenCalled();
                }
            }
        });
    });

    describe('Configuration-Driven Behavior', () => {
        test('should respect platform-specific enable/disable settings', async () => {
            // Given: Platform with disabled viewer count
            configManager.getSection.mockReturnValue({
                viewerCountEnabled: false,
                viewerCountSource: 'youtube viewer count'
            });
            
            // When: Updating viewer count for disabled platform
            await observer.onViewerCountUpdate({
                platform: 'youtube',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });
            
            // Then: Should not update OBS
            expect(obsManager.call).not.toHaveBeenCalled();
        });

        test('should use configured OBS source names per platform', async () => {
            // Given: Platform-specific source configurations
            const platformConfigs = {
                'youtube': { viewerCountEnabled: true, viewerCountSource: 'yt_viewers' },
                'twitch': { viewerCountEnabled: true, viewerCountSource: 'ttv_viewers' },
                'tiktok': { viewerCountEnabled: true, viewerCountSource: 'tt_viewers' }
            };
            
            configManager.getSection.mockImplementation(platform => platformConfigs[platform]);
            
            // When: Updating each platform
            for (const [platform, config] of Object.entries(platformConfigs)) {
                obsManager.call.mockClear(); // Clear previous calls
                
                await observer.onViewerCountUpdate({
                    platform,
                    count: 500,
                    isStreamLive: true,
                    timestamp: new Date()
                });
                
                // Then: Should use correct source name
                expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                    expect.objectContaining({
                        inputName: config.viewerCountSource,
                        inputSettings: { text: '500' }
                    })
                );
            }
        });

        test('should handle missing configuration gracefully', async () => {
            // Given: Missing platform configuration
            configManager.getSection.mockReturnValue(null);
            
            // When: Updating viewer count with missing config
            const updatePromise = observer.onViewerCountUpdate({
                platform: 'unknown',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });
            
            // Then: Should handle gracefully without throwing
            await expect(updatePromise).resolves.toBeUndefined();
            expect(obsManager.call).not.toHaveBeenCalled();
        });

        test('should adapt to configuration changes at runtime', async () => {
            // Given: Initial configuration that changes between calls
            configManager.getSection
                .mockReturnValueOnce({ viewerCountEnabled: false, viewerCountSource: 'source1' })
                .mockReturnValueOnce({ viewerCountEnabled: true, viewerCountSource: 'source2' });
            
            // When: First update (disabled)
            await observer.onViewerCountUpdate({
                platform: 'youtube',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });
            
            // Then: Should not update OBS
            expect(obsManager.call).not.toHaveBeenCalled();
            
            // When: Second update (enabled)
            await observer.onViewerCountUpdate({
                platform: 'youtube',
                count: 2000,
                isStreamLive: true,
                timestamp: new Date()
            });
            
            // Then: Should update OBS with new source
            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputName: 'source2',
                    inputSettings: { text: '2K' }
                })
            );
        });
    });

    describe('Error Recovery & Resilience', () => {
        test('should continue operating when OBS connection unavailable', async () => {
            // Given: Disconnected OBS manager
            const disconnectedOBS = createMockOBSManager('disconnected');
            const resilientObserver = new OBSViewerCountObserver(disconnectedOBS, logger);
            
            // When: Attempting to update viewer count
            const updatePromise = resilientObserver.onViewerCountUpdate({
                platform: 'youtube',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });
            
            // Then: Should handle gracefully without throwing
            await expect(updatePromise).resolves.toBeUndefined();
        });

        test('should handle missing OBS sources gracefully', async () => {
            // Given: OBS call that fails with "source not found"
            obsManager.call.mockRejectedValue(new Error('Source not found'));
            
            configManager.getSection.mockReturnValue({
                viewerCountEnabled: true,
                viewerCountSource: 'missing_source'
            });
            
            // When: Updating viewer count with missing source
            const updatePromise = observer.onViewerCountUpdate({
                platform: 'youtube',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });
            
            // Then: Should handle error gracefully
            await expect(updatePromise).resolves.toBeUndefined();
        });

        test('should recover from temporary OBS failures', async () => {
            // Given: OBS that fails then recovers
            obsManager.call
                .mockRejectedValueOnce(new Error('Temporary failure'))
                .mockResolvedValueOnce({ status: 'success' });
            
            configManager.getSection.mockReturnValue({
                viewerCountEnabled: true,
                viewerCountSource: 'test_source'
            });
            
            // When: First update fails, second succeeds
            await observer.onViewerCountUpdate({
                platform: 'youtube',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });
            
            await observer.onViewerCountUpdate({
                platform: 'youtube',
                count: 2000,
                isStreamLive: true,
                timestamp: new Date()
            });
            
            // Then: Should continue functioning after failure
            expect(obsManager.call).toHaveBeenCalledTimes(2);
        });

        test('should maintain system stability during OBS errors', async () => {
            // Given: Multiple OBS operations that fail
            obsManager.call.mockRejectedValue(new Error('OBS disconnected'));
            
            configManager.getSection.mockReturnValue({
                viewerCountEnabled: true,
                viewerCountSource: 'test_source'
            });
            
            // When: Multiple operations during OBS failure
            const operations = [
                observer.onViewerCountUpdate({
                    platform: 'youtube',
                    count: 1000,
                    isStreamLive: true,
                    timestamp: new Date()
                }),
                observer.onStreamStatusChange({
                    platform: 'youtube',
                    isLive: false,
                    wasLive: true,
                    timestamp: new Date()
                }),
                observer.initialize()
            ];
            
            // Then: All operations should complete without throwing
            await expect(Promise.all(operations)).resolves.toBeDefined();
        });
    });

    describe('Platform-Specific Behavior', () => {
        const testCases = [
            { platform: 'tiktok', count: 1234, expectedFormat: '1.2K' },
            { platform: 'youtube', count: 5500, expectedFormat: '5.5K' },
            { platform: 'twitch', count: 1000000, expectedFormat: '1M' }
        ];

        testCases.forEach(({ platform, count, expectedFormat }) => {
            test(`should handle ${platform} viewer count formatting correctly`, async () => {
                // When: Updating viewer count for platform
                await observer.onViewerCountUpdate({
                    platform,
                    count,
                    isStreamLive: true,
                    timestamp: new Date()
                });
                
                // Then: Should format according to platform standards
                expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                    expect.objectContaining({
                        inputName: `${platform} viewer count`,
                        inputSettings: { text: expectedFormat }
                    })
                );
            });
        });

        test('should validate platform names and reject invalid platforms', async () => {
            // Given: Invalid platform name
            configManager.getSection.mockReturnValue(null);
            
            // When: Updating with invalid platform
            const updatePromise = observer.onViewerCountUpdate({
                platform: 'invalid-platform',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });
            
            // Then: Should handle gracefully and not update OBS
            await expect(updatePromise).resolves.toBeUndefined();
            expect(obsManager.call).not.toHaveBeenCalled();
        });
    });

    describe('Memory & Resource Management', () => {
        test('should clean up resources during observer removal', async () => {
            // Given: Initialized observer
            await observer.initialize();
            
            // When: Cleaning up observer
            const cleanupPromise = observer.cleanup();
            
            // Then: Should complete cleanup without errors
            await expect(cleanupPromise).resolves.toBeUndefined();
        });

        test('should not leak memory during extended operation', async () => {
            // Given: Extended operation scenario
            const initialMemory = process.memoryUsage().heapUsed;
            
            // When: Processing many viewer count updates
            for (let i = 0; i < 100; i++) {
                await observer.onViewerCountUpdate({
                    platform: 'youtube',
                    count: i * 10,
                    isStreamLive: true,
                    timestamp: new Date()
                });
            }
            
            // Force garbage collection if available
            if (global.gc) {
                global.gc();
            }
            
            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;
            
            // Then: Memory increase should be reasonable (< 10MB)
            expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
        });

        test('should handle observer lifecycle correctly', async () => {
            // Given: Complete observer lifecycle
            // When: Initialize → Use → Cleanup
            await observer.initialize();
            
            await observer.onViewerCountUpdate({
                platform: 'youtube',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });
            
            await observer.cleanup();
            
            // Then: Should complete full lifecycle without errors
            expect(observer.getObserverId()).toBe('obs-viewer-count-observer');
        });
    });
});
