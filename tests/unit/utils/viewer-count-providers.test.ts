import { describe, expect, beforeEach, it } from "bun:test";
import { createMockFn, clearAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createConfigFixture } from "../../helpers/config-fixture";
import { ViewerCountSystem } from "../../../src/utils/viewer-count";
import {
  ViewerCountProvider,
  TwitchViewerCountProvider,
  YouTubeViewerCountProvider,
  TikTokViewerCountProvider,
} from "../../../src/utils/viewer-count-providers";

type AggregatedViewerCount = {
  success: boolean;
  totalCount: number;
  successfulStreams: number;
  failedStreams?: number;
};

const createViewerExtractionService = (
  getAggregatedViewerCount = createMockFn<
    [string[]],
    Promise<AggregatedViewerCount>
  >(),
) => ({
  getAggregatedViewerCount,
  extractViewerCount: createMockFn<
    [string],
    Promise<{ success: boolean; count: number }>
  >(),
});

const createTwitchApiClient = (
  getStreamInfo = createMockFn<
    [string],
    Promise<{ isLive: boolean; viewerCount: number }>
  >(),
) => ({ getStreamInfo });

describe("ViewerCountProvider base behavior", () => {
  it("tracks error stats and categorizes network errors", () => {
    const provider = new ViewerCountProvider("testPlatform", noOpLogger);
    const result = provider._handleProviderError(
      new Error("Network timeout"),
      "fetch",
    );

    expect(result).toBe(0);
    const stats = provider.getErrorStats();
    expect(stats.totalErrors).toBe(1);
    expect(stats.consecutiveErrors).toBe(1);
    expect(stats.lastError).toBe("Network timeout");
    expect(stats.errorTypes.network).toBe(1);
  });

  it("categorizes auth, rate limit, and resource errors", () => {
    const provider = new ViewerCountProvider("testPlatform", noOpLogger);
    provider._handleProviderError(new Error("auth failure"), "testOperation");
    provider._handleProviderError(
      new Error("rate limit exceeded"),
      "testOperation",
    );
    provider._handleProviderError(
      new Error("stream not found"),
      "testOperation",
    );

    const stats = provider.getErrorStats();
    expect(stats.errorTypes.authentication).toBe(1);
    expect(stats.errorTypes.rate_limit).toBe(1);
    expect(stats.errorTypes.resource_not_found).toBe(1);
  });

  it("converts error type map to plain object and tracks unknown errors", () => {
    const provider = new ViewerCountProvider("testPlatform", noOpLogger);

    provider._handleProviderError(new Error("weird failure"), "testOperation");
    const stats = provider.getErrorStats();

    expect(stats.errorTypes.unknown).toBe(1);
    expect(typeof stats.errorTypes).toBe("object");
  });

  it("handles non-Error inputs without message gracefully", () => {
    const provider = new ViewerCountProvider("testPlatform", noOpLogger);

    const result = provider._handleProviderError({}, "testOperation");

    expect(result).toBe(0);
    const stats = provider.getErrorStats();
    expect(stats.errorTypes.unknown).toBe(1);
    expect(stats.lastError).toBe("Unknown error");
  });
});

describe("TwitchViewerCountProvider", () => {
  it("skips blank channels and trims usable channels", async () => {
    const api = createTwitchApiClient();
    api.getStreamInfo.mockResolvedValue({ isLive: true, viewerCount: 0 });
    const config = { channel: " \t " };
    const provider = new TwitchViewerCountProvider(api, {}, config, null, noOpLogger);
    expect(provider.isReady()).toBe(false);
    expect(await provider.getViewerCount()).toBeNull();
    expect(api.getStreamInfo).not.toHaveBeenCalled();
    config.channel = " synthetic-channel \t";
    expect(provider.isReady()).toBe(true);
    expect(await provider.getViewerCount()).toBe(0);
    expect(api.getStreamInfo).toHaveBeenCalledWith("synthetic-channel");
  });

  it("preserves last-good state and errors when the configured channel becomes unavailable", async () => {
    const api = createTwitchApiClient();
    const config = { channel: "synthetic-channel" };
    const provider = new TwitchViewerCountProvider(api, {}, config, null, noOpLogger);
    const system = new ViewerCountSystem({ platforms: { twitch: provider }, logger: noOpLogger, config: createConfigFixture() });
    system.streamStatus.twitch = true;
    api.getStreamInfo.mockResolvedValue({ isLive: true, viewerCount: 12 });
    await system.pollPlatform("twitch");
    const before = system.getViewerCountSnapshot("twitch");
    const updates: unknown[] = [];
    system.addObserver({ getObserverId: () => "synthetic-blank-channel-observer", onViewerCountUpdate: value => { updates.push(value); } });
    provider._handleProviderError(new Error("prior failure"));
    for (const channel of ["", " \t "]) {
      config.channel = channel;
      expect(await provider.getViewerCount()).toBeNull();
      await system.pollPlatform("twitch");
      expect(system.getViewerCountSnapshot("twitch")).toEqual(before);
      expect(system.getViewerCount("twitch")).toBe(12);
      expect(provider.getErrorStats().consecutiveErrors).toBe(1);
    }
    expect(api.getStreamInfo).toHaveBeenCalledTimes(1);
    expect(updates).toHaveLength(0);
  });

  it("rejects non-boolean stream status rather than coercing it", async () => {
    for (const isLive of [undefined, "false", 1, null]) {
      const api = createTwitchApiClient();
      api.getStreamInfo.mockResolvedValue({ isLive: isLive as unknown as boolean, viewerCount: 12 });
      const provider = new TwitchViewerCountProvider(api, {}, { channel: "synthetic-channel" }, null, noOpLogger);
      expect(await provider.getViewerCount()).toBeNull();
      expect(provider.getErrorStats().consecutiveErrors).toBe(1);
    }
  });

  it("rejects malformed live counts without resetting errors", async () => {
    for (const count of [NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "12", undefined, null]) {
      const api = createTwitchApiClient();
      api.getStreamInfo.mockResolvedValue({ isLive: true, viewerCount: count as number });
      const provider = new TwitchViewerCountProvider(api, {}, { channel: "synthetic-channel" }, null, noOpLogger);
      provider._handleProviderError(new Error("prior failure"));
      expect(await provider.getViewerCount()).toBeNull();
      expect(provider.getErrorStats().consecutiveErrors).toBe(2);
    }
  });

  it("accepts offline zero despite stale positive count, and live zero", async () => {
    const api = createTwitchApiClient();
    const provider = new TwitchViewerCountProvider(api, {}, { channel: "synthetic-channel" }, null, noOpLogger);
    for (const response of [{ isLive: false, viewerCount: 99 }, { isLive: true, viewerCount: 0 }]) {
      provider._handleProviderError(new Error("prior failure"));
      api.getStreamInfo.mockResolvedValue(response);
      expect(await provider.getViewerCount()).toBe(0);
      expect(provider.getErrorStats().consecutiveErrors).toBe(0);
    }
  });

  it("retains real store measurement and freshness after malformed provider polls", async () => {
    const api = createTwitchApiClient();
    const provider = new TwitchViewerCountProvider(api, {}, { channel: "synthetic-channel" }, null, noOpLogger);
    const system = new ViewerCountSystem({ platforms: { twitch: provider }, logger: noOpLogger, config: createConfigFixture() });
    system.streamStatus.twitch = true;
    await system.updateViewerCount("twitch", 12);
    const before = system.getViewerCountSnapshot("twitch");
    const updates: unknown[] = [];
    system.addObserver({ getObserverId: () => "synthetic-twitch-observer", onViewerCountUpdate: value => { updates.push(value); } });
    for (const count of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      api.getStreamInfo.mockResolvedValue({ isLive: true, viewerCount: count });
      await system.pollPlatform("twitch");
      expect(system.getViewerCount("twitch")).toBe(12);
      expect(system.getViewerCountSnapshot("twitch")).toEqual(before);
    }
    expect(updates).toHaveLength(0);
    api.getStreamInfo.mockResolvedValue({ isLive: true, viewerCount: 0 });
    await system.pollPlatform("twitch");
    expect(system.getViewerCount("twitch")).toBe(0);
    expect(updates).toHaveLength(1);
  });
  beforeEach(() => {
    clearAllMocks();
  });

  it("returns unavailable when not ready", async () => {
    const provider = new TwitchViewerCountProvider(
      createTwitchApiClient(),
      {},
      {},
      null,
      noOpLogger,
    );

    await expect(provider.getViewerCount()).resolves.toBeNull();
  });

  it("returns live viewer count and resets error counters", async () => {
    const provider = new TwitchViewerCountProvider(
      createTwitchApiClient(
        createMockFn<
          [string],
          Promise<{ isLive: boolean; viewerCount: number }>
        >().mockResolvedValue({
          isLive: true,
          viewerCount: 42,
        }),
      ),
      {},
      { channel: "testStreamer" },
      null,
      noOpLogger,
    );

    const count = await provider.getViewerCount();

    expect(count).toBe(42);
    expect(provider.errorStats.consecutiveErrors).toBe(0);
  });
});

describe("YouTubeViewerCountProvider", () => {
  beforeEach(() => {
    clearAllMocks();
  });

  it("returns unavailable when required dependencies are missing", async () => {
    const provider = new YouTubeViewerCountProvider({}, null, {
      logger: noOpLogger,
    });

    await expect(provider.getViewerCount()).resolves.toBeNull();
  });

  it("aggregates counts across active streams via service layer", async () => {
    const viewerExtractionService = createViewerExtractionService(
      createMockFn<[string[]], Promise<AggregatedViewerCount>>().mockResolvedValue({
        success: true,
        totalCount: 75,
        successfulStreams: 1,
      }),
    );
    const provider = new YouTubeViewerCountProvider(
      {},
      () => ({ generation: 1, videoIds: ["testVideoId1"], availability: "live" }),
      { viewerExtractionService, logger: noOpLogger },
    );

    const count = await provider.getViewerCount();
    expect(count).toBe(75);

    const stats = provider.getStats();
    expect(stats.successRate).toBe("100.00%");
  });

  it("returns unavailable and tracks an error when aggregation fails", async () => {
    const viewerExtractionService = createViewerExtractionService(
      createMockFn<[string[]], Promise<AggregatedViewerCount>>().mockResolvedValue({
        success: false,
        totalCount: 0,
        successfulStreams: 0,
      }),
    );
    const provider = new YouTubeViewerCountProvider(
      {},
      () => ({ generation: 1, videoIds: ["testVideoId1"], availability: "live" }),
      { viewerExtractionService, logger: noOpLogger },
    );

    const count = await provider.getViewerCount();
    expect(count).toBeNull();
    expect(provider.getErrorStats().totalErrors).toBe(1);
  });

  it("returns unavailable when all active stream extractions fail", async () => {
    const viewerExtractionService = createViewerExtractionService(
      createMockFn<[string[]], Promise<AggregatedViewerCount>>().mockResolvedValue({
        success: false,
        totalCount: 0,
        successfulStreams: 0,
        failedStreams: 2,
      }),
    );
    const provider = new YouTubeViewerCountProvider(
      {},
      () => ({ generation: 1, videoIds: ["testVideoId1", "testVideoId2"], availability: "live" }),
      { viewerExtractionService, logger: noOpLogger },
    );

    const count = await provider.getViewerCount();

    expect(count).toBeNull();
    expect(provider.getErrorStats().totalErrors).toBe(1);
  });

  it("returns confirmed empty zero without incrementing errors", async () => {
    const provider = new YouTubeViewerCountProvider({}, () => ({ generation: 1, videoIds: [], availability: "offline" }), {
      viewerExtractionService: createViewerExtractionService(),
      logger: noOpLogger,
    });

    const count = await provider.getViewerCount();

    expect(count).toBe(0);
    expect(provider.getErrorStats().totalErrors).toBe(0);
  });

  it("resets consecutive errors after successful aggregation following a failure", async () => {
    const viewerExtractionService = createViewerExtractionService(
      createMockFn<[string[]], Promise<AggregatedViewerCount>>()
        .mockRejectedValueOnce(new Error("network down"))
        .mockResolvedValueOnce({
          success: true,
          totalCount: 5,
          successfulStreams: 1,
        }),
    );
    const provider = new YouTubeViewerCountProvider(
      {},
      () => ({ generation: 1, videoIds: ["testVideoId1"], availability: "live" }),
      { viewerExtractionService, logger: noOpLogger },
    );

    await provider.getViewerCount();
    expect(provider.errorStats.consecutiveErrors).toBe(1);

    const count = await provider.getViewerCount();

    expect(count).toBe(5);
    expect(provider.errorStats.consecutiveErrors).toBe(0);
  });
});

describe("TikTokViewerCountProvider", () => {
  beforeEach(() => {
    clearAllMocks();
  });

  it("handles missing platform gracefully", async () => {
    const provider = new TikTokViewerCountProvider(null, {
      logger: noOpLogger,
    });

    const count = await provider.getViewerCount();
    expect(count).toBe(0);
    expect(provider.getErrorStats().totalErrors).toBe(1);
  });

  it("returns platform viewer count when available", async () => {
    const platform = {
      connection: { isConnected: true },
      getViewerCount: createMockFn().mockResolvedValue(33),
    };
    const provider = new TikTokViewerCountProvider(platform, {
      logger: noOpLogger,
    });

    const count = await provider.getViewerCount();
    expect(count).toBe(33);
    expect(provider.errorStats.consecutiveErrors).toBe(0);
  });

  it("resets error count on success after previous failure", async () => {
    let callCount = 0;
    const platform = {
      connection: { isConnected: true },
      getViewerCount: createMockFn<[], Promise<number>>(async () => {
        callCount++;
        if (callCount === 1) {
          throw new Error("network");
        }
        return 10;
      }),
    };
    const provider = new TikTokViewerCountProvider(platform, {
      logger: noOpLogger,
    });

    await provider.getViewerCount();
    expect(provider.errorStats.consecutiveErrors).toBe(1);

    const count = await provider.getViewerCount();
    expect(count).toBe(10);
    expect(provider.errorStats.consecutiveErrors).toBe(0);
  });

  it("is not ready when connection missing or disconnected", () => {
    const provider = new TikTokViewerCountProvider(
      { connection: { isConnected: false } },
      { logger: noOpLogger },
    );

    expect(provider.isReady()).toBe(false);
  });
});
