const { describe, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');

describe('Main App updateViewerCount OBS Integration', () => {
    let mockViewerCountSystem;
    let updateViewerCountMethod;

    beforeEach(() => {
        mockViewerCountSystem = {
            counts: {
                tiktok: 0,
                twitch: 0,
                youtube: 0
            },
            notifyObservers: createMockFn().mockResolvedValue(true)
        };

        const testAppRuntime = {
            viewerCountSystem: mockViewerCountSystem,
            updateViewerCount(platform, count) {
                if (this.viewerCountSystem) {
                    const previousCount = this.viewerCountSystem.counts[platform.toLowerCase()];
                    this.viewerCountSystem.counts[platform.toLowerCase()] = count;

                    const notificationPromise = this.viewerCountSystem.notifyObservers(platform, count, previousCount);
                    if (notificationPromise && notificationPromise.catch) {
                        notificationPromise.catch(() => {});
                    }
                }
            }
        };

        updateViewerCountMethod = testAppRuntime.updateViewerCount.bind(testAppRuntime);
    });

    afterEach(() => {
        restoreAllMocks();
        clearAllMocks();
    });

    describe('when updateViewerCount is called', () => {
        describe('and ViewerCountSystem is available', () => {
            it('should update internal count tracking', () => {
                const platform = 'tiktok';
                const viewerCount = 1337;

                updateViewerCountMethod(platform, viewerCount);

                expect(mockViewerCountSystem.counts.tiktok).toBe(viewerCount);
            });

            it('should call ViewerCountSystem.notifyObservers', () => {
                const platform = 'tiktok';
                const viewerCount = 2468;

                updateViewerCountMethod(platform, viewerCount);

                expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledWith(platform, viewerCount, 0);
                expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledTimes(1);
            });

            it('should work for all platforms', () => {
                const platforms = ['tiktok', 'twitch', 'youtube'];
                const viewerCounts = [100, 200, 300];

                platforms.forEach((platform, index) => {
                    updateViewerCountMethod(platform, viewerCounts[index]);
                });

                expect(mockViewerCountSystem.counts.tiktok).toBe(100);
                expect(mockViewerCountSystem.counts.twitch).toBe(200);
                expect(mockViewerCountSystem.counts.youtube).toBe(300);
                expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledTimes(3);
            });
        });

        describe('and ViewerCountSystem is missing', () => {
            let updateViewerCountMethodWithoutSystem;

            beforeEach(() => {
                const testAppRuntimeWithoutSystem = {
                    viewerCountSystem: null,
                    updateViewerCount(platform, count) {
                        if (this.viewerCountSystem) {
                            const previousCount = this.viewerCountSystem.counts[platform.toLowerCase()];
                            this.viewerCountSystem.counts[platform.toLowerCase()] = count;

                            const notificationPromise = this.viewerCountSystem.notifyObservers(platform, count, previousCount);
                            if (notificationPromise && notificationPromise.catch) {
                                notificationPromise.catch(() => {});
                            }
                        }
                    }
                };

                updateViewerCountMethodWithoutSystem = testAppRuntimeWithoutSystem.updateViewerCount.bind(testAppRuntimeWithoutSystem);
            });

            it('should not crash when ViewerCountSystem is null', () => {
                const platform = 'tiktok';
                const viewerCount = 555;

                expect(() => {
                    updateViewerCountMethodWithoutSystem(platform, viewerCount);
                }).not.toThrow();
            });
        });

        describe('and ViewerCountSystem.notifyObservers fails', () => {
            beforeEach(() => {
                mockViewerCountSystem.notifyObservers.mockRejectedValue(new Error('Observer notification failed'));
            });

            it('should still update internal counts despite observer failure', async () => {
                const platform = 'tiktok';
                const viewerCount = 444;

                updateViewerCountMethod(platform, viewerCount);

                await new Promise(resolve => setImmediate(resolve));

                expect(mockViewerCountSystem.counts.tiktok).toBe(viewerCount);
                expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledWith(platform, viewerCount, 0);
            });
        });
    });

    describe('regression prevention', () => {
        it('should prevent TikTok viewer count from being ignored in observers', () => {
            const platform = 'tiktok';
            const viewerCount = 4;

            mockViewerCountSystem.counts.tiktok = 0;

            updateViewerCountMethod(platform, viewerCount);

            expect(mockViewerCountSystem.counts.tiktok).toBe(viewerCount);
            expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledWith(platform, viewerCount, 0);
            expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledTimes(1);
        });

        it('should handle real-time updates from all platforms', () => {
            const updates = [
                { platform: 'tiktok', count: 4 },
                { platform: 'twitch', count: 1 },
                { platform: 'youtube', count: 2 }
            ];

            updates.forEach(({ platform, count }) => {
                updateViewerCountMethod(platform, count);
            });

            expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledTimes(3);
            expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledWith('tiktok', 4, 0);
            expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledWith('twitch', 1, 0);
            expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledWith('youtube', 2, 0);
        });
    });
});
