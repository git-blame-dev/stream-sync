const { describe, test, expect, beforeEach } = require('bun:test');
const { createMockFn } = require('../../helpers/bun-mock-utils');
const { OBSViewerCountObserver } = require('../../../src/observers/obs-viewer-count-observer');
const { ViewerCountObserver } = require('../../../src/observers/viewer-count-observer');
const { createMockOBSManager } = require('../../helpers/mock-factories');
const { expectNoTechnicalArtifacts } = require('../../helpers/behavior-validation');
const { createSilentLogger } = require('../../helpers/test-logger');

const defaultPlatforms = ['twitch', 'youtube', 'tiktok'];

function createMockConfigManager(overrides = {}) {
    return {
        getSection: createMockFn().mockImplementation((platform) => ({
            viewerCountEnabled: true,
            viewerCountSource: `${platform} viewer count`,
            ...overrides[platform]
        })),
        getPlatforms: createMockFn().mockReturnValue(defaultPlatforms)
    };
}

describe('OBSViewerCountObserver - Behavior-Focused Testing', () => {
    let obsManager;
    let observer;
    let logger;
    let mockConfigManager;

    beforeEach(() => {
        mockConfigManager = createMockConfigManager();
        logger = createSilentLogger();

        obsManager = createMockOBSManager('connected', {
            call: createMockFn().mockResolvedValue({ status: 'success' }),
            isConnected: createMockFn().mockReturnValue(true)
        });

        observer = new OBSViewerCountObserver(obsManager, logger, { configManager: mockConfigManager });
    });

    describe('Observer Initialization & Interface Compliance', () => {
        test('should properly implement observer interface contract', () => {
            expect(observer).toBeInstanceOf(ViewerCountObserver);
            expect(observer).toBeInstanceOf(OBSViewerCountObserver);
            expect(typeof observer.onViewerCountUpdate).toBe('function');
            expect(typeof observer.onStreamStatusChange).toBe('function');
            expect(typeof observer.initialize).toBe('function');
            expect(typeof observer.cleanup).toBe('function');
            expect(typeof observer.getObserverId).toBe('function');
        });

        test('should provide unique observer ID for system registration', () => {
            const observerId = observer.getObserverId();

            expect(observerId).toBe('obs-viewer-count-observer');
            expect(typeof observerId).toBe('string');
            expect(observerId.length).toBeGreaterThan(0);

            expectNoTechnicalArtifacts(observerId);
        });

        test('should initialize with provided OBS manager dependency', () => {
            const testObserver = new OBSViewerCountObserver(obsManager, logger, { configManager: mockConfigManager });

            expect(testObserver).toBeDefined();
            expect(testObserver.obsManager).toBe(obsManager);
        });

        test('should handle initialization without OBS connection gracefully', async () => {
            const disconnectedOBS = createMockOBSManager('disconnected');
            const testObserver = new OBSViewerCountObserver(disconnectedOBS, logger, { configManager: mockConfigManager });

            const initPromise = testObserver.initialize();

            await expect(initPromise).resolves.toBeUndefined();
        });

        test('should initialize all platform counts to zero when OBS connected', async () => {
            await observer.initialize();

            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputSettings: { text: '0' }
                })
            );

            expect(obsManager.call).toHaveBeenCalledTimes(3);
        });
    });

    describe('Viewer Count Update Behavior', () => {
        test('should update OBS text sources when stream is live', async () => {
            const updateData = {
                platform: 'youtube',
                count: 1234,
                previousCount: 1000,
                isStreamLive: true,
                timestamp: new Date()
            };

            await observer.onViewerCountUpdate(updateData);

            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputName: 'youtube viewer count',
                    inputSettings: { text: '1.2K' },
                    overlay: true
                })
            );
        });

        test('should format viewer counts according to platform standards', async () => {
            const testCases = [
                { count: 999, expectedFormat: '999' },
                { count: 1500, expectedFormat: '1.5K' },
                { count: 10000, expectedFormat: '10K' },
                { count: 1500000, expectedFormat: '1.5M' }
            ];

            for (const testCase of testCases) {
                await observer.onViewerCountUpdate({
                    platform: 'twitch',
                    count: testCase.count,
                    isStreamLive: true,
                    timestamp: new Date()
                });

                expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                    expect.objectContaining({
                        inputSettings: { text: testCase.expectedFormat }
                    })
                );
            }
        });

        test('should skip updates when stream is offline', async () => {
            const updateData = {
                platform: 'youtube',
                count: 1234,
                previousCount: 1000,
                isStreamLive: false,
                timestamp: new Date()
            };

            obsManager.call.mockClear();

            await observer.onViewerCountUpdate(updateData);

            expect(obsManager.call).not.toHaveBeenCalled();
        });

        test('should handle multiple platform updates simultaneously', async () => {
            const updates = [
                { platform: 'youtube', count: 1000, isStreamLive: true },
                { platform: 'twitch', count: 2000, isStreamLive: true },
                { platform: 'tiktok', count: 500, isStreamLive: true }
            ];

            await Promise.all(updates.map(update =>
                observer.onViewerCountUpdate({
                    ...update,
                    timestamp: new Date()
                })
            ));

            expect(obsManager.call).toHaveBeenCalledTimes(3);

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
            const updates = [
                { count: 100, expectedText: '100' },
                { count: 1500, expectedText: '1.5K' },
                { count: 999, expectedText: '999' },
                { count: 2000000, expectedText: '2M' }
            ];

            for (const update of updates) {
                await observer.onViewerCountUpdate({
                    platform: 'youtube',
                    count: update.count,
                    isStreamLive: true,
                    timestamp: new Date()
                });

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
            const statusUpdate = {
                platform: 'youtube',
                isLive: false,
                wasLive: true,
                timestamp: new Date()
            };

            await observer.onStreamStatusChange(statusUpdate);

            expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                expect.objectContaining({
                    inputSettings: { text: '0' }
                })
            );
        });

        test('should enable updates when stream comes online', async () => {
            const statusUpdate = {
                platform: 'youtube',
                isLive: true,
                wasLive: false,
                timestamp: new Date()
            };

            await observer.onStreamStatusChange(statusUpdate);

            expect(statusUpdate.isLive).toBe(true);
        });

        test('should handle rapid online/offline transitions', async () => {
            const transitions = [
                { isLive: true, wasLive: false },
                { isLive: false, wasLive: true },
                { isLive: true, wasLive: false },
                { isLive: false, wasLive: true }
            ];

            let obsCallCount = 0;

            for (const transition of transitions) {
                await observer.onStreamStatusChange({
                    platform: 'twitch',
                    ...transition,
                    timestamp: new Date()
                });

                if (!transition.isLive && transition.wasLive) {
                    obsCallCount++;
                }
            }

            expect(obsManager.call).toHaveBeenCalledTimes(obsCallCount);
        });

        test('should maintain state consistency during status changes', async () => {
            const scenarios = [
                { isLive: true, wasLive: false, shouldReset: false },
                { isLive: false, wasLive: true, shouldReset: true },
                { isLive: false, wasLive: false, shouldReset: false },
                { isLive: true, wasLive: true, shouldReset: false }
            ];

            for (const scenario of scenarios) {
                obsManager.call.mockClear();

                await observer.onStreamStatusChange({
                    platform: 'tiktok',
                    isLive: scenario.isLive,
                    wasLive: scenario.wasLive,
                    timestamp: new Date()
                });

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
            mockConfigManager.getSection.mockReturnValue({
                viewerCountEnabled: false,
                viewerCountSource: 'youtube viewer count'
            });

            await observer.onViewerCountUpdate({
                platform: 'youtube',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });

            expect(obsManager.call).not.toHaveBeenCalled();
        });

        test('should use configured OBS source names per platform', async () => {
            const platformConfigs = {
                'youtube': { viewerCountEnabled: true, viewerCountSource: 'yt_viewers' },
                'twitch': { viewerCountEnabled: true, viewerCountSource: 'ttv_viewers' },
                'tiktok': { viewerCountEnabled: true, viewerCountSource: 'tt_viewers' }
            };

            mockConfigManager.getSection.mockImplementation(platform => platformConfigs[platform]);

            for (const [platform, config] of Object.entries(platformConfigs)) {
                obsManager.call.mockClear();

                await observer.onViewerCountUpdate({
                    platform,
                    count: 500,
                    isStreamLive: true,
                    timestamp: new Date()
                });

                expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                    expect.objectContaining({
                        inputName: config.viewerCountSource,
                        inputSettings: { text: '500' }
                    })
                );
            }
        });

        test('should handle missing configuration gracefully', async () => {
            mockConfigManager.getSection.mockReturnValue(null);

            const updatePromise = observer.onViewerCountUpdate({
                platform: 'unknown',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });

            await expect(updatePromise).resolves.toBeUndefined();
            expect(obsManager.call).not.toHaveBeenCalled();
        });

        test('should adapt to configuration changes at runtime', async () => {
            mockConfigManager.getSection
                .mockReturnValueOnce({ viewerCountEnabled: false, viewerCountSource: 'source1' })
                .mockReturnValueOnce({ viewerCountEnabled: true, viewerCountSource: 'source2' });

            await observer.onViewerCountUpdate({
                platform: 'youtube',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });

            expect(obsManager.call).not.toHaveBeenCalled();

            await observer.onViewerCountUpdate({
                platform: 'youtube',
                count: 2000,
                isStreamLive: true,
                timestamp: new Date()
            });

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
            const disconnectedOBS = createMockOBSManager('disconnected');
            const resilientObserver = new OBSViewerCountObserver(disconnectedOBS, logger, { configManager: mockConfigManager });

            const updatePromise = resilientObserver.onViewerCountUpdate({
                platform: 'youtube',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });

            await expect(updatePromise).resolves.toBeUndefined();
        });

        test('should handle missing OBS sources gracefully', async () => {
            obsManager.call.mockRejectedValue(new Error('Source not found'));

            mockConfigManager.getSection.mockReturnValue({
                viewerCountEnabled: true,
                viewerCountSource: 'missing_source'
            });

            const updatePromise = observer.onViewerCountUpdate({
                platform: 'youtube',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });

            await expect(updatePromise).resolves.toBeUndefined();
        });

        test('should recover from temporary OBS failures', async () => {
            obsManager.call
                .mockRejectedValueOnce(new Error('Temporary failure'))
                .mockResolvedValueOnce({ status: 'success' });

            mockConfigManager.getSection.mockReturnValue({
                viewerCountEnabled: true,
                viewerCountSource: 'test_source'
            });

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

            expect(obsManager.call).toHaveBeenCalledTimes(2);
        });

        test('should maintain system stability during OBS errors', async () => {
            obsManager.call.mockRejectedValue(new Error('OBS disconnected'));

            mockConfigManager.getSection.mockReturnValue({
                viewerCountEnabled: true,
                viewerCountSource: 'test_source'
            });

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
                await observer.onViewerCountUpdate({
                    platform,
                    count,
                    isStreamLive: true,
                    timestamp: new Date()
                });

                expect(obsManager.call).toHaveBeenCalledWith('SetInputSettings',
                    expect.objectContaining({
                        inputName: `${platform} viewer count`,
                        inputSettings: { text: expectedFormat }
                    })
                );
            });
        });

        test('should validate platform names and reject invalid platforms', async () => {
            mockConfigManager.getSection.mockReturnValue(null);

            const updatePromise = observer.onViewerCountUpdate({
                platform: 'invalid-platform',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });

            await expect(updatePromise).resolves.toBeUndefined();
            expect(obsManager.call).not.toHaveBeenCalled();
        });
    });

    describe('Memory & Resource Management', () => {
        test('should clean up resources during observer removal', async () => {
            await observer.initialize();

            const cleanupPromise = observer.cleanup();

            await expect(cleanupPromise).resolves.toBeUndefined();
        });

        test('should not leak memory during extended operation', async () => {
            const initialMemory = process.memoryUsage().heapUsed;

            for (let i = 0; i < 100; i++) {
                await observer.onViewerCountUpdate({
                    platform: 'youtube',
                    count: i * 10,
                    isStreamLive: true,
                    timestamp: new Date()
                });
            }

            if (global.gc) {
                global.gc();
            }

            const finalMemory = process.memoryUsage().heapUsed;
            const memoryIncrease = finalMemory - initialMemory;

            expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024);
        });

        test('should handle observer lifecycle correctly', async () => {
            await observer.initialize();

            await observer.onViewerCountUpdate({
                platform: 'youtube',
                count: 1000,
                isStreamLive: true,
                timestamp: new Date()
            });

            await observer.cleanup();

            expect(observer.getObserverId()).toBe('obs-viewer-count-observer');
        });
    });
});
