import { describe, test, beforeEach, afterEach, expect } from "bun:test";
import {
  clearAllMocks,
  createMockFn,
  restoreAllMocks,
  type TestMockFn,
} from "../helpers/bun-mock-utils";

import { ViewerCountSystem } from "../../src/utils/viewer-count";
import { YouTubeViewerExtractor } from "../../src/extractors/youtube-viewer-extractor";
import { InnertubeFactory } from "../../src/factories/innertube-factory";
import * as InnertubeInstanceManager from "../../src/services/innertube-instance-manager.ts";
import { OBSViewerCountObserver } from "../../src/observers/obs-viewer-count-observer";
import { createMockOBSManager } from "../helpers/mock-factories";
import { expectNoTechnicalArtifacts } from "../helpers/behavior-validation";
import { createConfigFixture } from "../helpers/config-fixture";
import { waitForDelay } from "../helpers/time-utils";

type ViewerCountUpdate = {
  platform: string;
  count: number;
  previousCount: number;
  isStreamLive: boolean;
  timestamp: Date;
};

type StreamStatusUpdate = {
  platform: string;
  isLive: boolean;
  wasLive: boolean;
  timestamp: Date;
};

type TestViewerCountPlatform = {
  getViewerCount: TestMockFn<[], Promise<unknown>>;
};

type TestPlatforms = {
  youtube: TestViewerCountPlatform;
};

type TestObserver = {
  getObserverId: () => string;
  onViewerCountUpdate: TestMockFn<[ViewerCountUpdate], unknown>;
  onStreamStatusChange: TestMockFn<[StreamStatusUpdate], unknown>;
  cleanup?: TestMockFn<[], unknown>;
};

const createViewerCountLogger = () => ({
  debug: (_message: string, _context?: string, _payload?: unknown) => undefined,
  info: (_message: string, _context?: string, _payload?: unknown) => undefined,
  warn: (_message: string, _context?: string, _payload?: unknown) => undefined,
  error: (_message: string, _context?: string, _payload?: unknown) => undefined,
});

const expectExtractorInput = (
  value: unknown,
): Parameters<typeof YouTubeViewerExtractor.extractConcurrentViewers>[0] => {
  return value as Parameters<typeof YouTubeViewerExtractor.extractConcurrentViewers>[0];
};

const createRejectedUpdateMock = <Args extends unknown[]>(error: Error) =>
  createMockFn<Args, unknown>(() => Promise.reject(error));

const expectFirstArg = <Args extends unknown[]>(mockFn: TestMockFn<Args, unknown>): Args[0] => {
  const firstCall = mockFn.mock.calls[0];
  expect(firstCall).toBeDefined();
  if (!firstCall) {
    throw new Error("Expected mock to have at least one call");
  }
  return firstCall[0];
};

describe("System Resilience and Error Recovery Integration", () => {
  let platforms: TestPlatforms;
  let obsManager: ReturnType<typeof createMockOBSManager>;
  let viewerCountSystem: InstanceType<typeof ViewerCountSystem>;

  beforeEach(async () => {
    platforms = {
      youtube: {
        getViewerCount: createMockFn<[], Promise<unknown>>(async () => 1000),
      },
    };

    obsManager = createMockOBSManager();
    const testConfig = createConfigFixture();
    viewerCountSystem = new ViewerCountSystem({
      platforms,
      config: testConfig,
      logger: createViewerCountLogger(),
    });

    const obsObserver = new OBSViewerCountObserver(
      obsManager,
      createViewerCountLogger(),
      { config: testConfig },
    );
    viewerCountSystem.addObserver(obsObserver);

    await viewerCountSystem.initialize();
  });

  afterEach(async () => {
    if (viewerCountSystem) {
      viewerCountSystem.stopPolling();
      await viewerCountSystem.cleanup();
    }
    await InnertubeInstanceManager.cleanup();
    clearAllMocks();
    restoreAllMocks();
  });

  describe("Platform API Error Handling", () => {
    test("should handle YouTube API errors gracefully", async () => {
      platforms.youtube.getViewerCount.mockRejectedValue(
        new Error("API rate limit exceeded"),
      );

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      expect(viewerCountSystem.isPolling).toBe(true);
      expect(viewerCountSystem.isStreamLive("youtube")).toBe(true);
      expect(viewerCountSystem.counts.youtube).toBe(0);
    });

    test("should handle malformed API responses gracefully", async () => {
      let callCount = 0;
      platforms.youtube.getViewerCount.mockImplementation(() => {
        const responses = [
          null,
          undefined,
          "invalid",
          { invalid: "object" },
          -1,
        ];
        return Promise.resolve(responses[callCount++ % responses.length]);
      });

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(100);

      expect(viewerCountSystem.isPolling).toBe(true);
      expect(viewerCountSystem.isStreamLive("youtube")).toBe(true);
      expect(callCount).toBeGreaterThan(0);
    });

    test("should maintain system stability during connection failures", async () => {
      platforms.youtube.getViewerCount.mockRejectedValue(
        new Error("Network timeout"),
      );

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      expect(viewerCountSystem.isPolling).toBe(true);
      expect(viewerCountSystem.isStreamLive("youtube")).toBe(true);
      expect(typeof viewerCountSystem.counts.youtube).toBe("number");
    });
  });

  describe("Observer Error Isolation", () => {
    test("should isolate observer errors from system operation", async () => {
      const faultyObserver: TestObserver = {
        getObserverId: () => "faulty-observer",
        onViewerCountUpdate: createRejectedUpdateMock<[ViewerCountUpdate]>(
          new Error("Observer crashed"),
        ),
        onStreamStatusChange: createRejectedUpdateMock<[StreamStatusUpdate]>(
          new Error("Observer failed"),
        ),
      };
      viewerCountSystem.addObserver(faultyObserver);

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      expect(viewerCountSystem.counts.youtube).toBe(1000);
      expect(viewerCountSystem.isPolling).toBe(true);
      expect(faultyObserver.onViewerCountUpdate).toHaveBeenCalled();
      expect(obsManager.call).toHaveBeenCalled();
    });

    test("should handle OBS connection failures gracefully", async () => {
      obsManager.isConnected.mockReturnValue(false);
      obsManager.call.mockRejectedValue(new Error("OBS connection lost"));

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      expect(viewerCountSystem.counts.youtube).toBe(1000);
      expect(viewerCountSystem.isPolling).toBe(true);
    });
  });

  describe("Configuration Error Handling", () => {
    test("should handle invalid polling configuration gracefully", async () => {
      viewerCountSystem.pollingIntervalMs = 0;

      viewerCountSystem.startPolling();

      expect(viewerCountSystem.isPolling).toBe(false);
    });

    test("should handle missing OBS configuration", async () => {
      createConfigFixture({
        youtube: {
          viewerCountEnabled: true,
        },
      });

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      expect(viewerCountSystem.counts.youtube).toBe(1000);
      expect(viewerCountSystem.isPolling).toBe(true);
    });
  });

  describe("Factory and Instance Manager Resilience", () => {
    test("creates Innertube instance successfully", async () => {
      const instance = await InnertubeFactory.createInstance();

      expect(instance).toBeDefined();
      expect(typeof instance).toBe("object");
    });

    test("handles instance manager operations safely", async () => {
      const manager = InnertubeInstanceManager.getInstance();
      const stats = manager.getStats();

      expect(stats).toHaveProperty("activeInstances");
      expect(typeof stats.activeInstances).toBe("number");

      await expect(manager.cleanup()).resolves.toBeUndefined();
    });
  });

  describe("Extractor Resilience", () => {
    test("handles malformed YouTube data structures gracefully", () => {
      const malformedStructures = [
        null,
        undefined,
        {},
        { primary_info: null },
        { broken: "structure" },
      ];

      malformedStructures.forEach((structure) => {
        const result =
          YouTubeViewerExtractor.extractConcurrentViewers(
            expectExtractorInput(structure),
          );

        expect(typeof result.success).toBe("boolean");
        expect(typeof result.count).toBe("number");
        expect(result.count >= 0 || Number.isNaN(result.count)).toBe(true);
        expect(result.metadata).toBeDefined();
      });
    });

    test("should handle extraction strategy failures", () => {
      const problematicData = {
        primary_info: {
          view_count: {
            view_count: {
              text: undefined,
            },
          },
        },
        video_details: {
          viewer_count: "not-a-number",
        },
      };

      const result =
        YouTubeViewerExtractor.extractConcurrentViewers(problematicData);

      expect(result).toMatchObject({
        success: expect.any(Boolean),
        count: expect.any(Number),
        metadata: expect.any(Object),
      });
    });
  });

  describe("Concurrent Operation Resilience", () => {
    test("should handle concurrent status updates safely", async () => {
      const promises: Array<Promise<void>> = [];
      for (let i = 0; i < 5; i++) {
        promises.push(
          viewerCountSystem.updateStreamStatus("youtube", i % 2 === 0),
        );
      }

      await Promise.all(promises);

      expect(typeof viewerCountSystem.isStreamLive("youtube")).toBe("boolean");
      expect(typeof viewerCountSystem.counts.youtube).toBe("number");
    });

    test("should handle rapid polling operations", async () => {
      await viewerCountSystem.updateStreamStatus("youtube", true);

      for (let i = 0; i < 3; i++) {
        viewerCountSystem.startPolling();
        viewerCountSystem.stopPolling();
      }

      expect(viewerCountSystem.isPolling).toBe(false);
    });
  });

  describe("System State Consistency", () => {
    test("should maintain consistent state during errors", async () => {
      platforms.youtube.getViewerCount
        .mockRejectedValueOnce(new Error("Error 1"))
        .mockResolvedValueOnce(1500)
        .mockRejectedValueOnce(new Error("Error 2"));

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(100);

      expect(viewerCountSystem.isStreamLive("youtube")).toBe(true);
      expect(viewerCountSystem.isPolling).toBe(true);
      expect(typeof viewerCountSystem.counts.youtube).toBe("number");
      expect(viewerCountSystem.counts.youtube).toBeGreaterThanOrEqual(0);
    });

    test("should handle observer lifecycle during errors", async () => {
      const problematicObserver: TestObserver = {
        getObserverId: () => "problematic-observer",
        onViewerCountUpdate: createMockFn<[ViewerCountUpdate], unknown>(),
        onStreamStatusChange: createMockFn<[StreamStatusUpdate], unknown>(),
        cleanup: createRejectedUpdateMock<[]>(new Error("Cleanup failed")),
      };
      viewerCountSystem.addObserver(problematicObserver);

      await expect(viewerCountSystem.cleanup()).resolves.toBeUndefined();

      expect(problematicObserver.cleanup).toHaveBeenCalled();
      expect(viewerCountSystem.observers.size).toBe(0);
    });
  });

  describe("Content Quality During Errors", () => {
    test("should maintain user-friendly content during failures", async () => {
      const qualityObserver: TestObserver = {
        getObserverId: () => "quality-observer",
        onViewerCountUpdate: createMockFn<[ViewerCountUpdate], unknown>(),
        onStreamStatusChange: createMockFn<[StreamStatusUpdate], unknown>(),
      };
      viewerCountSystem.addObserver(qualityObserver);

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      const lastSuccessfulUpdate = expectFirstArg(
        qualityObserver.onViewerCountUpdate,
      );
      expect(lastSuccessfulUpdate.platform).toMatch(/^(youtube|twitch|tiktok)$/);
      expect(lastSuccessfulUpdate.count).toBeGreaterThanOrEqual(0);
      expectNoTechnicalArtifacts(lastSuccessfulUpdate.platform);
    });

    test("should provide meaningful error states", async () => {
      platforms.youtube.getViewerCount.mockRejectedValue(
        new Error("Persistent failure"),
      );

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      expect(viewerCountSystem.isStreamLive("youtube")).toBe(true);
      expect(viewerCountSystem.counts.youtube).toBe(0);
      expect(viewerCountSystem.isPolling).toBe(true);
    });
  });

  describe("Resource Management", () => {
    test("should clean up resources properly during failures", async () => {
      const resourceObserver: TestObserver = {
        getObserverId: () => "resource-observer",
        onViewerCountUpdate: createMockFn<[ViewerCountUpdate], unknown>(),
        onStreamStatusChange: createMockFn<[StreamStatusUpdate], unknown>(),
        cleanup: createMockFn<[], unknown>(),
      };
      viewerCountSystem.addObserver(resourceObserver);

      await viewerCountSystem.updateStreamStatus("youtube", true);
      viewerCountSystem.startPolling();
      await waitForDelay(50);

      viewerCountSystem.stopPolling();
      await viewerCountSystem.cleanup();

      expect(resourceObserver.cleanup).toHaveBeenCalled();
      expect(viewerCountSystem.observers.size).toBe(0);
      expect(viewerCountSystem.isPolling).toBe(false);
    });

    test("should handle memory cleanup during stress", async () => {
      const initialObserverCount = viewerCountSystem.observers.size;

      for (let i = 0; i < 10; i++) {
        const observer: TestObserver = {
          getObserverId: () => `stress-observer-${i}`,
          onViewerCountUpdate: createMockFn<[ViewerCountUpdate], unknown>(),
          onStreamStatusChange: createMockFn<[StreamStatusUpdate], unknown>(),
        };

        viewerCountSystem.addObserver(observer);
        viewerCountSystem.removeObserver(`stress-observer-${i}`);
      }

      expect(viewerCountSystem.observers.size).toBe(initialObserverCount);
    });
  });
});
