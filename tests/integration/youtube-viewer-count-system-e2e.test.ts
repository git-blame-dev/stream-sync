import { vi, type Mock, describe, test, beforeEach, afterEach, expect } from 'bun:test';
import { EventEmitter } from "node:events";



import { ViewerCountSystem } from "../../src/utils/viewer-count.ts";
import { YouTubeViewerExtractor } from "../../src/extractors/youtube-viewer-extractor";
import { InnertubeFactory } from "../../src/factories/innertube-factory";
import { OBSConnectionManager } from "../../src/obs/connection";
import { OBSViewerCountObserver } from "../../src/observers/obs-viewer-count-observer.ts";
import { expectNoTechnicalArtifacts } from "../helpers/behavior-validation";
import { createConfigFixture } from "../helpers/config-fixture";
import testClock from "../helpers/test-clock";

type ViewerPlatform = {
  getViewerCount: Mock<(...args: []) => Promise<number | null>>;
  isEnabled: () => boolean;
};
type ViewerPlatformMap = Record<string, ViewerPlatform>;
type TestConfig = ReturnType<typeof createConfigFixture>;
type TestLogger = {
  debug: (message: string, context?: string, payload?: unknown) => void;
  info: (message: string, context?: string, payload?: unknown) => void;
  warn: (message: string, context?: string, payload?: unknown) => void;
  error: (message: string, context?: string, payload?: unknown) => void;
};
type ObsCall = [method: string, payload?: { inputSettings?: { text?: string } }];
type ViewerUpdate = {
  platform: string;
  count: number;
  isStreamLive: boolean;
};

class SyntheticObsSocket extends EventEmitter {
  call = vi.fn<(...args: [string, Record<string, unknown>?]) => Promise<Record<string, unknown>>>()
    .mockResolvedValue({ status: "success" });
  async connect() {
    this.emit("Identified");
    return { obsWebSocketVersion: "synthetic" };
  }
  async disconnect() {
    this.emit("ConnectionClosed");
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isObsCall = (call: unknown[]): call is ObsCall =>
  typeof call[0] === "string";

const isSetInputSettingsCall = (call: unknown[]): call is ObsCall =>
  isObsCall(call) && call[0] === "SetInputSettings";

const isViewerUpdate = (value: unknown): value is ViewerUpdate =>
  isRecord(value) &&
  typeof value.platform === "string" &&
  typeof value.count === "number" &&
  typeof value.isStreamLive === "boolean";

const createViewerPlatform = (count: number): ViewerPlatform => ({
  getViewerCount: vi.fn<(...args: []) => Promise<number | null>>().mockResolvedValue(
    count,
  ),
  isEnabled: () => true,
});

const requireYouTubePlatform = (platforms: ViewerPlatformMap): ViewerPlatform => {
  const platform = platforms.youtube;
  if (!platform) {
    throw new Error("Expected YouTube test platform to be configured");
  }
  return platform;
};

const createViewerCountLogger = (): TestLogger => ({
  debug: vi.fn<(message: string, context?: string, payload?: unknown) => void>(),
  info: vi.fn<(message: string, context?: string, payload?: unknown) => void>(),
  warn: vi.fn<(message: string, context?: string, payload?: unknown) => void>(),
  error: vi.fn<(message: string, context?: string, payload?: unknown) => void>(),
});

describe("YouTube Viewer Count System - End-to-End Integration", () => {
  afterEach(async () => {
    try {
      if (viewerCountSystem) {
        await viewerCountSystem.cleanup();
      }
      if (obsManager) {
        obsManager.dispose();
        await obsManager.disconnect();
      }
    } finally {
      vi.restoreAllMocks();
    }
  });

  let platforms: ViewerPlatformMap;
  let obsSocket: SyntheticObsSocket;
  let obsManager: OBSConnectionManager;
  let viewerCountSystem: ViewerCountSystem;
  let logger: TestLogger;
  let testConfig: TestConfig;

  beforeEach(async () => {
    testClock.reset();
    logger = createViewerCountLogger();
    testConfig = createConfigFixture();
    platforms = {
      youtube: createViewerPlatform(1234),
    };
    obsSocket = new SyntheticObsSocket();
    obsManager = new OBSConnectionManager({
      obs: obsSocket,
      config: {
        enabled: true,
        address: "ws://synthetic.invalid",
        password: "synthetic-password",
      },
    });
    await obsManager.connect();
    obsSocket.call.mockClear();

    const timeProvider = {
      now: () => testClock.now(),
      createDate: (timestamp: number) => new Date(timestamp),
    };
    viewerCountSystem = new ViewerCountSystem({
      platformProvider: () => platforms,
      logger,
      config: testConfig,
      timeProvider,
    });
    const obsObserver = new OBSViewerCountObserver(obsManager, logger, {
      config: testConfig,
    });
    viewerCountSystem.addObserver(obsObserver);
    await viewerCountSystem.initialize();
  });

  describe("Dependency Injection", () => {
    test("should resolve updated platform maps when dependencies change", async () => {
      const originalPlatform = requireYouTubePlatform(platforms);
      const replacementPlatforms = {
        youtube: createViewerPlatform(777),
      };
      platforms = replacementPlatforms;
      await viewerCountSystem.updateStreamStatus("youtube", true);

      const validation =
        viewerCountSystem.validatePlatformForPolling("youtube");

      expect(validation.valid).toBe(true);
      if (validation.valid) {
        expect(validation.platform).toBe(replacementPlatforms.youtube);
        expect(validation.platform).not.toBe(originalPlatform);
      }
    });
  });

  describe("Complete System Integration", () => {
    test("should successfully process YouTube viewer count through complete system", async () => {
      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.pollPlatform("youtube");
      viewerCountSystem.startPolling();

      expect(viewerCountSystem.getViewerCount("youtube")).toBe(1234);
      expect(viewerCountSystem.isStreamLive("youtube")).toBe(true);
      const obsUpdateCalls = obsSocket.call.mock.calls.filter(
        isSetInputSettingsCall,
      );
      expect(obsUpdateCalls.length).toBeGreaterThan(0);

      const latestObsUpdate = obsUpdateCalls[obsUpdateCalls.length - 1]?.[1];
      expect(latestObsUpdate?.inputSettings?.text).toMatch(
        /^\d{1,3}(,\d{3})*(\.\d+)?[KMB]?$/,
      );
      expect(latestObsUpdate?.inputSettings?.text).not.toBe("0");
    });

    test("should handle multiple platform viewer counts simultaneously", async () => {
      platforms.twitch = {
        getViewerCount: vi.fn<(...args: []) => Promise<number | null>>().mockResolvedValue(567),
        isEnabled: () => true,
      };
      platforms.tiktok = {
        getViewerCount: vi.fn<(...args: []) => Promise<number | null>>().mockResolvedValue(890),
        isEnabled: () => true,
      };
      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.updateStreamStatus("twitch", true);
      await viewerCountSystem.updateStreamStatus("tiktok", true);
      await Promise.all(['youtube', 'twitch', 'tiktok'].map(platform => viewerCountSystem.pollPlatform(platform)));
      viewerCountSystem.startPolling();

      expect(viewerCountSystem.getViewerCount("youtube")).toBe(1234);
      expect(viewerCountSystem.getViewerCount("twitch")).toBe(567);
      expect(viewerCountSystem.getViewerCount("tiktok")).toBe(890);
      expect(viewerCountSystem.isStreamLive("youtube")).toBe(true);
      expect(viewerCountSystem.isStreamLive("twitch")).toBe(true);
      expect(viewerCountSystem.isStreamLive("tiktok")).toBe(true);
    });

    test("should handle stream status transitions correctly", async () => {
      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.pollPlatform("youtube");
      viewerCountSystem.startPolling();
      const initialCount = viewerCountSystem.getViewerCount("youtube");
      expect(initialCount).toBe(1234);

      await viewerCountSystem.updateStreamStatus("youtube", false);

      expect(viewerCountSystem.getViewerCount("youtube")).toBe(0);
      expect(viewerCountSystem.isStreamLive("youtube")).toBe(false);
      expect(obsSocket.call).toHaveBeenLastCalledWith(
        "SetInputSettings",
        expect.objectContaining({
          inputSettings: { text: "0" },
        }),
      );
    });
  });

  describe("Factory Pattern Integration", () => {
    test("should provide factory statistics without creating instances", () => {
      const stats = InnertubeFactory.getStats();

      expect(stats.factoryVersion).toBe("1.0.0");
      expect(stats.esm).toBe(true);
      expect(stats.supportedMethods).toContain("createInstance");
    });

    test("should provide meaningful error messages when Innertube creation fails", async () => {
      const originalImporter = InnertubeFactory._importer;
      try {
        InnertubeFactory.configure({
          importer: () => Promise.reject(new Error("Test import failure")),
        });
        await expect(InnertubeFactory.createInstance()).rejects.toThrow(/Innertube creation failed/);
      } finally {
        InnertubeFactory.configure(originalImporter ? { importer: originalImporter } : {});
      }
    });
  });

  describe("Extractor Service Integration", () => {
    test("should extract viewer counts using YouTubeViewerExtractor strategies", () => {
      const videoInfo = {
        primary_info: {
          view_count: {
            is_live: true,
            view_count: {
              text: "5,432 watching now",
            },
          },
        },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

      expect(result.success).toBe(true);
      expect(result.count).toBe(5432);
      expect(result.strategy).toBe("view_text");
    });

    test("should extract exact SDK concurrent counts", () => {
      const videoInfo = {
        primary_info: { view_count: { is_live: true, original_view_count: 9876 } },
      };

      const result = YouTubeViewerExtractor.extractConcurrentViewers(videoInfo);

      expect(result.success).toBe(true);
      expect(result.count).toBe(9876);
      expect(result.strategy).toBe("original_view_count");
    });

    test("should validate extracted viewer counts", () => {
      expect(YouTubeViewerExtractor.isValidViewerCount(100)).toBe(true);
      expect(YouTubeViewerExtractor.isValidViewerCount(0)).toBe(true);
      expect(YouTubeViewerExtractor.isValidViewerCount(-1)).toBe(false);
      expect(YouTubeViewerExtractor.isValidViewerCount(NaN)).toBe(false);
      expect(YouTubeViewerExtractor.isValidViewerCount("invalid")).toBe(false);
      expect(YouTubeViewerExtractor.isValidViewerCount(11000000)).toBe(true);
      expect(YouTubeViewerExtractor.isValidViewerCount(1.5)).toBe(false);
      expect(YouTubeViewerExtractor.isValidViewerCount(Number.MAX_SAFE_INTEGER + 1)).toBe(false);
    });
  });

  describe("Observer Pattern Integration", () => {
    test("should notify multiple observers of viewer count updates", async () => {
      const mockObserver = {
        getObserverId: () => "test-observer",
        onViewerCountUpdate: vi.fn<(...args: unknown[]) => unknown>(),
        onStreamStatusChange: vi.fn<(...args: unknown[]) => unknown>(),
        initialize: vi.fn<(...args: unknown[]) => unknown>(),
        cleanup: vi.fn<(...args: unknown[]) => unknown>(),
      };
      viewerCountSystem.addObserver(mockObserver);
      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.pollPlatform("youtube");
      viewerCountSystem.startPolling();

      const observerUpdates = mockObserver.onViewerCountUpdate.mock.calls
        .map((call) => call[0])
        .filter(isViewerUpdate);
      expect(observerUpdates.length).toBeGreaterThan(0);
      expect(
        observerUpdates.some(
          (update) =>
            update.platform === "youtube" &&
            update.count === 1234 &&
            update.isStreamLive === true,
        ),
      ).toBe(true);
    });

    test("should handle observer errors gracefully", async () => {
      const faultyObserver = {
        getObserverId: () => "faulty-observer",
        onViewerCountUpdate: vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue(new Error("Observer error")),
        onStreamStatusChange: vi.fn<(...args: unknown[]) => unknown>(),
      };
      viewerCountSystem.addObserver(faultyObserver);
      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.pollPlatform("youtube");
      viewerCountSystem.startPolling();

      expect(viewerCountSystem.getViewerCount("youtube")).toBe(1234);
    });
  });

  describe("Configuration Integration", () => {
    test("should respect polling interval configuration", async () => {
      viewerCountSystem.pollingIntervalMs = 2000;

      viewerCountSystem.startPolling();

      expect(viewerCountSystem.pollingInterval).toBe(2000);
      viewerCountSystem.stopPolling();
    });

    test("should handle disabled viewer count polling", async () => {
      viewerCountSystem.pollingIntervalMs = 0;

      viewerCountSystem.startPolling();

      expect(viewerCountSystem.isPolling).toBe(false);
    });
  });

  describe("Content Quality Validation", () => {
    test("should produce user-friendly viewer count displays", async () => {
      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.pollPlatform("youtube");
      viewerCountSystem.startPolling();

      const obsCall = obsSocket.call.mock.calls.find(isSetInputSettingsCall);
      expect(obsCall).toBeDefined();
      const text = obsCall?.[1]?.inputSettings?.text ?? "";
      expect(text).toBe("1.2K");
      expectNoTechnicalArtifacts(text);
    });

    test("should handle zero viewer counts appropriately", async () => {
      requireYouTubePlatform(platforms).getViewerCount.mockResolvedValue(0);
      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.pollPlatform("youtube");
      viewerCountSystem.startPolling();

      expect(viewerCountSystem.getViewerCount("youtube")).toBe(0);
      const obsCall = obsSocket.call.mock.calls.find(isSetInputSettingsCall);
      expect(obsCall?.[1]?.inputSettings?.text).toBe("0");
    });
  });

  describe("Error Recovery and Resilience", () => {
    test("should handle YouTube API errors gracefully", async () => {
      requireYouTubePlatform(platforms).getViewerCount.mockRejectedValue(
        new Error("API rate limit exceeded"),
      );
      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.pollPlatform("youtube");
      viewerCountSystem.startPolling();

      expect(viewerCountSystem.isPolling).toBe(true);
      expect(viewerCountSystem.isStreamLive("youtube")).toBe(true);
      expect(viewerCountSystem.getViewerCount("youtube")).toBe(0);
    });

    test("should handle invalid viewer count responses", async () => {
      requireYouTubePlatform(platforms).getViewerCount
        .mockResolvedValueOnce(null)
        .mockResolvedValue(1337);
      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.pollPlatform("youtube");
      viewerCountSystem.startPolling();

      expect(viewerCountSystem.isPolling).toBe(true);
      expect(viewerCountSystem.isStreamLive("youtube")).toBe(true);
      expect(typeof viewerCountSystem.getViewerCount("youtube")).toBe("number");
    });

    test("preserves last known viewer count when provider returns unavailable", async () => {
      await viewerCountSystem.updateStreamStatus("youtube", true);

      requireYouTubePlatform(platforms).getViewerCount
        .mockResolvedValueOnce(1234)
        .mockResolvedValueOnce(null);

      await viewerCountSystem.pollPlatform("youtube");
      expect(viewerCountSystem.getViewerCount("youtube")).toBe(1234);

      await viewerCountSystem.pollPlatform("youtube");
      expect(viewerCountSystem.getViewerCount("youtube")).toBe(1234);
    });

    test("should maintain system stability during connection failures", async () => {
      requireYouTubePlatform(platforms).getViewerCount.mockRejectedValue(
        new Error("Network timeout"),
      );
      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.pollPlatform("youtube");
      viewerCountSystem.startPolling();

      expect(viewerCountSystem.isPolling).toBe(true);
      expect(viewerCountSystem.isStreamLive("youtube")).toBe(true);
      expect(typeof viewerCountSystem.getViewerCount("youtube")).toBe("number");
      expect(viewerCountSystem.getViewerCount("youtube")).toBeGreaterThanOrEqual(0);
    });
  });

  describe("Completed viewer count operations", () => {
    test("commits a completed poll and its OBS display update", async () => {
      await viewerCountSystem.updateStreamStatus("youtube", true);
      await viewerCountSystem.pollPlatform("youtube");
      expect(viewerCountSystem.getViewerCount("youtube")).toBe(1234);
      expect(obsSocket.call.mock.calls.filter(isSetInputSettingsCall).at(-1)?.[1]?.inputSettings?.text).toBe('1.2K');
    });

    test("settles concurrent status updates before committing a viewer count poll", async () => {
      const promises: Array<Promise<void>> = [];
      for (let i = 0; i < 5; i++) {
        promises.push(viewerCountSystem.updateStreamStatus("youtube", true));
      }
      await Promise.all(promises);
      await viewerCountSystem.pollPlatform("youtube");
      expect(viewerCountSystem.isStreamLive("youtube")).toBe(true);
      expect(viewerCountSystem.getViewerCount("youtube")).toBe(1234);
    });
  });
});
