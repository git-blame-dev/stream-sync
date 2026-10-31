import { vi, afterEach, describe, expect, test } from "bun:test";
import { AppRuntime } from "../../src/main";
import { createAppRuntimeTestDependencies } from "../helpers/runtime-test-harness";
import { TEST_TIMEOUTS } from "../helpers/test-setup";

describe("ViewerCount runtime activation integration", () => {
  const apps = new Set<AppRuntime>();

  afterEach(async () => {
    try {
      await Promise.all([...apps].map((app) => app.shutdown()));
    } finally {
      apps.clear();
    }
  });

  function createRuntime() {
    const platforms = {
      youtube: { getViewerCount: vi.fn<() => Promise<number>>().mockResolvedValue(150) },
      twitch: { getViewerCount: vi.fn<() => Promise<number>>().mockResolvedValue(75) },
      tiktok: { getViewerCount: vi.fn<() => Promise<number>>().mockResolvedValue(200) },
    };
    const harness = createAppRuntimeTestDependencies({
      configOverrides: {
        general: { viewerCountPollingIntervalMs: 60_000 },
        youtube: { enabled: true, viewerCountEnabled: true },
        twitch: { enabled: true, viewerCountEnabled: true },
        tiktok: { enabled: true, viewerCountEnabled: true },
        obs: { enabled: false },
      },
    });
    const lifecycle = harness.dependencies.platformLifecycleService;
    lifecycle.getAllPlatforms = () => platforms;
    const app = new AppRuntime(harness.runtimeConfig, harness.dependencies);
    apps.add(app);
    const emitStatus = (platform: string, isLive: boolean) => {
      harness.eventBus.emit?.("platform:event", {
        type: "platform:stream-status", platform, data: { isLive },
      });
    };
    const observeCounts = (expected: Record<string, number>) => {
      const remaining = new Set(Object.keys(expected));
      const completed = Promise.withResolvers<void>();
      app.viewerCountSystem.addObserver({
        getObserverId: () => "synthetic-activation-observer",
        onViewerCountUpdate(update) {
          if (update.count === expected[update.platform]) remaining.delete(update.platform);
          if (remaining.size === 0) completed.resolve();
        },
      });
      return completed.promise;
    };
    return { app, platforms, lifecycle, emitStatus, observeCounts };
  }

  test("app.start activates its original viewer owner and publishes all live platform counts", async () => {
    const { app, platforms, lifecycle, emitStatus, observeCounts } = createRuntime();
    const originalOwner = app.viewerCountSystem;
    const counts = observeCounts({ youtube: 150, twitch: 75, tiktok: 200 });
    emitStatus("youtube", true);
    emitStatus("twitch", true);
    emitStatus("tiktok", true);
    await app.start();
    await counts;
    expect(app.viewerCountSystem).toBe(originalOwner);
    expect(lifecycle.initializeAllPlatforms).toHaveBeenCalledTimes(1);
    expect(app.viewerCountSystem.isPolling).toBe(true);
    expect(app.viewerCountSystem.isStreamLive("youtube")).toBe(true);
    expect(app.viewerCountSystem.getViewerCounts()).toEqual({ youtube: 150, twitch: 75, tiktok: 200 });
    for (const platform of Object.values(platforms)) expect(platform.getViewerCount).toHaveBeenCalled();
  }, TEST_TIMEOUTS.FAST);

  test("runtime stream-status input starts late polling and resets a confirmed offline platform", async () => {
    const { app, platforms, emitStatus, observeCounts } = createRuntime();
    emitStatus("youtube", false);
    emitStatus("twitch", false);
    emitStatus("tiktok", false);
    await app.start();
    expect(app.viewerCountSystem.isPolling).toBe(true);
    expect(platforms.twitch.getViewerCount).not.toHaveBeenCalled();
    expect(platforms.tiktok.getViewerCount).not.toHaveBeenCalled();
    expect(app.viewerCountSystem.getViewerCount("twitch")).toBe(0);
    expect(app.viewerCountSystem.getViewerCount("tiktok")).toBe(0);
    const liveCount = observeCounts({ youtube: 150 });
    emitStatus("youtube", true);
    await liveCount;
    expect(app.viewerCountSystem.isStreamLive("youtube")).toBe(true);
    expect(platforms.youtube.getViewerCount).toHaveBeenCalled();
    expect(app.viewerCountSystem.getViewerCount("youtube")).toBe(150);
    const offlineCount = observeCounts({ youtube: 0 });
    emitStatus("youtube", false);
    await offlineCount;
    expect(app.viewerCountSystem.isStreamLive("youtube")).toBe(false);
    expect(app.viewerCountSystem.getViewerCount("youtube")).toBe(0);
  }, TEST_TIMEOUTS.FAST);
});
