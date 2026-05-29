import { describe, expect, beforeEach, afterEach, it } from "bun:test";
import {
  createMockFn,
  clearAllMocks,
  restoreAllMocks,
  type TestMockFn,
} from "../helpers/bun-mock-utils";

type ViewerPlatform = "tiktok" | "twitch" | "youtube";
type ViewerCounts = Record<string, number>;
type NotifyObservers = TestMockFn<
  [platform: string, count: number, previousCount: number],
  Promise<boolean>
>;
type ViewerCountSystem = {
  counts: ViewerCounts;
  notifyObservers: NotifyObservers;
};
type AppRuntime = {
  viewerCountSystem: ViewerCountSystem | null;
  updateViewerCount: (platform: string, count: number) => void;
};

function updateViewerCount(this: AppRuntime, platform: string, count: number): void {
  if (!this.viewerCountSystem) {
    return;
  }

  const platformKey = platform.toLowerCase();
  const previousCount = this.viewerCountSystem.counts[platformKey] ?? 0;
  this.viewerCountSystem.counts[platformKey] = count;

  this.viewerCountSystem
    .notifyObservers(platform, count, previousCount)
    .catch(() => undefined);
}

describe("Main App updateViewerCount OBS Integration", () => {
  let mockViewerCountSystem: ViewerCountSystem;
  let updateViewerCountMethod: (platform: string, count: number) => void;

  beforeEach(() => {
    mockViewerCountSystem = {
      counts: {
        tiktok: 0,
        twitch: 0,
        youtube: 0,
      },
      notifyObservers: createMockFn<
        [platform: string, count: number, previousCount: number],
        Promise<boolean>
      >().mockResolvedValue(true),
    };

    const testAppRuntime: AppRuntime = {
      viewerCountSystem: mockViewerCountSystem,
      updateViewerCount,
    };

    updateViewerCountMethod =
      testAppRuntime.updateViewerCount.bind(testAppRuntime);
  });

  afterEach(() => {
    restoreAllMocks();
    clearAllMocks();
  });

  describe("when updateViewerCount is called", () => {
    describe("and ViewerCountSystem is available", () => {
      it("should update internal count tracking", () => {
        const platform = "tiktok";
        const viewerCount = 1337;

        updateViewerCountMethod(platform, viewerCount);

        expect(mockViewerCountSystem.counts.tiktok).toBe(viewerCount);
      });

      it("notifies observers with current and previous counts", () => {
        const platform = "tiktok";
        const viewerCount = 2468;

        updateViewerCountMethod(platform, viewerCount);

        expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledTimes(1);
        expect(mockViewerCountSystem.notifyObservers.mock.calls).toEqual([
          [platform, viewerCount, 0],
        ]);
      });

      it("should work for all platforms", () => {
        const platforms: readonly ViewerPlatform[] = ["tiktok", "twitch", "youtube"];
        const viewerCounts: readonly number[] = [100, 200, 300];

        platforms.forEach((platform, index) => {
          const viewerCount = viewerCounts[index];
          expect(viewerCount).toBeDefined();
          if (viewerCount === undefined) {
            throw new Error(`Missing viewer count for ${platform}`);
          }
          updateViewerCountMethod(platform, viewerCount);
        });

        expect(mockViewerCountSystem.counts.tiktok).toBe(100);
        expect(mockViewerCountSystem.counts.twitch).toBe(200);
        expect(mockViewerCountSystem.counts.youtube).toBe(300);
        expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledTimes(3);
      });
    });

    describe("and ViewerCountSystem is missing", () => {
      let updateViewerCountMethodWithoutSystem: (
        platform: string,
        count: number,
      ) => void;

      beforeEach(() => {
        const testAppRuntimeWithoutSystem: AppRuntime = {
          viewerCountSystem: null,
          updateViewerCount,
        };

        updateViewerCountMethodWithoutSystem =
          testAppRuntimeWithoutSystem.updateViewerCount.bind(
            testAppRuntimeWithoutSystem,
          );
      });

      it("should not crash when ViewerCountSystem is null", () => {
        const platform = "tiktok";
        const viewerCount = 555;

        expect(() => {
          updateViewerCountMethodWithoutSystem(platform, viewerCount);
        }).not.toThrow();
      });
    });

    describe("and ViewerCountSystem.notifyObservers fails", () => {
      beforeEach(() => {
        mockViewerCountSystem.notifyObservers.mockRejectedValue(
          new Error("Observer notification failed"),
        );
      });

      it("should still update internal counts despite observer failure", async () => {
        const platform = "tiktok";
        const viewerCount = 444;

        updateViewerCountMethod(platform, viewerCount);

        await Promise.resolve();

        expect(mockViewerCountSystem.counts.tiktok).toBe(viewerCount);
        expect(mockViewerCountSystem.notifyObservers.mock.calls).toEqual([
          [platform, viewerCount, 0],
        ]);
      });
    });
  });

  describe("regression prevention", () => {
    it("should prevent TikTok viewer count from being ignored in observers", () => {
      const platform = "tiktok";
      const viewerCount = 4;

      mockViewerCountSystem.counts.tiktok = 0;

      updateViewerCountMethod(platform, viewerCount);

      expect(mockViewerCountSystem.counts.tiktok).toBe(viewerCount);
      expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledTimes(1);
      expect(mockViewerCountSystem.notifyObservers.mock.calls).toEqual([
        [platform, viewerCount, 0],
      ]);
    });

    it("emits observer updates for real-time counts across all platforms", () => {
      const updates: readonly { platform: ViewerPlatform; count: number }[] = [
        { platform: "tiktok", count: 4 },
        { platform: "twitch", count: 1 },
        { platform: "youtube", count: 2 },
      ];

      updates.forEach(({ platform, count }) => {
        updateViewerCountMethod(platform, count);
      });

      expect(mockViewerCountSystem.notifyObservers).toHaveBeenCalledTimes(3);
      expect(mockViewerCountSystem.notifyObservers.mock.calls).toEqual([
        ["tiktok", 4, 0],
        ["twitch", 1, 0],
        ["youtube", 2, 0],
      ]);
    });
  });
});
