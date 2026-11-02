import { vi, describe, test, expect, afterEach } from 'bun:test';


import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ViewerCountSystem } from "../../../src/utils/viewer-count";
import { TwitchViewerCountProvider } from "../../../src/utils/viewer-count-providers";
import { advanceTimersByTime, useFakeTimers, useRealTimers } from "../../helpers/bun-timers";

describe("ViewerCountSystem polling resilience", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function createSystem({ streamLive = true } = {}) {
    const platform = {
      getViewerCount: vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue(new Error("fetch failed")),
    };

    const system = new ViewerCountSystem({
      platforms: { twitch: platform },
      logger: noOpLogger,
      config: createConfigFixture(),
    });

    system.streamStatus.twitch = streamLive;

    return { system, platform };
  }

  test("skips polling when stream is offline", async () => {
    const { system } = createSystem({ streamLive: false });

    await system.pollPlatform("twitch");

    expect(system.getViewerCount("twitch")).toBe(0);
  });

  test("continues polling cycle when provider throws", async () => {
    const { system } = createSystem({ streamLive: true });

    await system.pollPlatform("twitch");

    expect(system.getViewerCount("twitch")).toBe(0);
  });

  test("discards a held count from a replaced platform before publishing the replacement", async () => {
    let release!: (value: { isLive: boolean; viewerCount: number }) => void;
    const held = new Promise<{ isLive: boolean; viewerCount: number }>(resolve => { release = resolve; });
    let entered!: () => void;
    const requested = new Promise<void>(resolve => { entered = resolve; });
    const platforms = {
      twitch: new TwitchViewerCountProvider({ getStreamInfo: async () => { entered(); return held; } }, { channel: "synthetic-channel" }, noOpLogger),
    };
    const system = new ViewerCountSystem({ platforms, logger: noOpLogger, config: createConfigFixture() });
    try {
      await system.updateViewerCount("twitch", 7);
      const pending = system.pollPlatform("twitch");
      await requested;
      platforms.twitch = new TwitchViewerCountProvider({ getStreamInfo: async () => ({ isLive: true, viewerCount: 5 }) }, { channel: "synthetic-replacement" }, noOpLogger);
      release({ isLive: true, viewerCount: 99 });
      await pending;
      expect(system.getViewerCount("twitch")).toBe(7);
      await system.pollPlatform("twitch");
      expect(system.getViewerCount("twitch")).toBe(5);
    } finally {
      release({ isLive: true, viewerCount: 99 });
      await system.cleanup();
    }
  });

  test("reserves enabled Twitch polling before registration without an online event", async () => {
    useFakeTimers();
    const platforms: Record<string, TwitchViewerCountProvider> = {};
    const observed = Promise.withResolvers<void>();
    const system = new ViewerCountSystem({ platforms, logger: noOpLogger,
      config: { general: { viewerCountPollingIntervalMs: 60000 }, twitch: { enabled: true } } });
    system.addObserver({ getObserverId: () => "synthetic-registration", onViewerCountUpdate: () => { observed.resolve(); } });
    try {
      system.startPolling();
      expect(system.pollingHandles.twitch).toBeDefined();
      platforms.twitch = new TwitchViewerCountProvider({ getStreamInfo: async () => ({ isLive: true, viewerCount: 9 }) }, { channel: "synthetic-channel" }, noOpLogger);
      advanceTimersByTime(60000);
      await observed.promise;
      expect(system.getViewerCount("twitch")).toBe(9);
    } finally { await system.cleanup(); useRealTimers(); }
  });
});
