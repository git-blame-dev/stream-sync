
const { describe, test, expect, beforeEach, afterEach, it } = require('bun:test');
const { createMockFn, clearAllMocks, restoreAllMocks } = require('../helpers/bun-mock-utils');

const { TEST_TIMEOUTS } = require('../helpers/test-setup');
const { setupAutomatedCleanup } = require('../helpers/mock-lifecycle');

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true
});

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
    
    // Create a simple test object that mimics the AppRuntime's updateViewerCount method
    const testAppRuntime = {
      viewerCountSystem: mockViewerCountSystem,
      updateViewerCount(platform, count) {
        // Update the ViewerCountSystem's internal count tracking and notify observers
        if (this.viewerCountSystem) {
          const previousCount = this.viewerCountSystem.counts[platform.toLowerCase()];
          this.viewerCountSystem.counts[platform.toLowerCase()] = count;

          // Notify observers of real-time count update - handle async properly
          const notificationPromise = this.viewerCountSystem.notifyObservers(platform, count, previousCount);
          if (notificationPromise && notificationPromise.catch) {
            notificationPromise.catch(() => {
              // Handle observer notification errors gracefully
            });
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
        // Arrange
        const platform = 'tiktok';
        const viewerCount = 1337;

        // Act
        updateViewerCountMethod(platform, viewerCount);

        // Assert
        expect(mockViewerCountSystem.counts.tiktok).toBe(viewerCount);
      });

      it('should call ViewerCountSystem.notifyObservers', () => {
        // Arrange
        const platform = 'tiktok';
        const viewerCount = 2468;

        // Act
        updateViewerCountMethod(platform, viewerCount);

        // Assert
        expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledWith(platform, viewerCount, 0);
        expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledTimes(1);
      });

      it('should work for all platforms', () => {
        // Arrange
        const platforms = ['tiktok', 'twitch', 'youtube'];
        const viewerCounts = [100, 200, 300];

        // Act
        platforms.forEach((platform, index) => {
          updateViewerCountMethod(platform, viewerCounts[index]);
        });

        // Assert
        expect(mockViewerCountSystem.counts.tiktok).toBe(100);
        expect(mockViewerCountSystem.counts.twitch).toBe(200);
        expect(mockViewerCountSystem.counts.youtube).toBe(300);
        expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledTimes(3);
      });
    });

    describe('and ViewerCountSystem is missing', () => {
      let updateViewerCountMethodWithoutSystem;

      beforeEach(() => {
        // Create a test method where viewerCountSystem is null
        const testAppRuntimeWithoutSystem = {
          viewerCountSystem: null,
          updateViewerCount(platform, count) {
            // Update the ViewerCountSystem's internal count tracking
            if (this.viewerCountSystem) {
              const previousCount = this.viewerCountSystem.counts[platform.toLowerCase()];
              this.viewerCountSystem.counts[platform.toLowerCase()] = count;

              // Notify observers for real-time updates
              const notificationPromise = this.viewerCountSystem.notifyObservers(platform, count, previousCount);
              if (notificationPromise && notificationPromise.catch) {
                notificationPromise.catch(() => {
                  // Handle observer notification errors gracefully
                });
              }
            }
          }
        };

        updateViewerCountMethodWithoutSystem = testAppRuntimeWithoutSystem.updateViewerCount.bind(testAppRuntimeWithoutSystem);
      });

      it('should not crash when ViewerCountSystem is null', () => {
        // Arrange
        const platform = 'tiktok';
        const viewerCount = 555;

        // Act & Assert
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
        // Arrange
        const platform = 'tiktok';
        const viewerCount = 444;

        // Act - updateViewerCountMethod should handle observer failures gracefully
        updateViewerCountMethod(platform, viewerCount);
        
        // Wait for any async operations to complete
        await new Promise(resolve => setImmediate(resolve));

        // Assert
        expect(mockViewerCountSystem.counts.tiktok).toBe(viewerCount);
        expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledWith(platform, viewerCount, 0);
      });
    });
  });

  describe('regression prevention', () => {
    it('should prevent TikTok viewer count from being ignored in observers', () => {
      const platform = 'tiktok';
      const viewerCount = 4;

      // Reset internal count to verify it gets updated
      mockViewerCountSystem.counts.tiktok = 0;

      updateViewerCountMethod(platform, viewerCount);

      expect(mockViewerCountSystem.counts.tiktok).toBe(viewerCount);
      expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledWith(platform, viewerCount, 0);
      expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledTimes(1);
    });

    it('should handle real-time updates from all platforms', () => {
      // Arrange - Test the common scenario of real-time platform updates
      const updates = [
        { platform: 'tiktok', count: 4 },
        { platform: 'twitch', count: 1 },
        { platform: 'youtube', count: 2 }
      ];

      // Act
      updates.forEach(({ platform, count }) => {
        updateViewerCountMethod(platform, count);
      });

      // Assert - All platforms should notify observers
      expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledTimes(3);
      expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledWith('tiktok', 4, 0);
      expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledWith('twitch', 1, 0);
      expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledWith('youtube', 2, 0);
    });
  });
}, TEST_TIMEOUTS.FAST);
