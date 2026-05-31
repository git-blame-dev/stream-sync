import { describe, test, beforeEach, afterEach, expect } from "bun:test";

import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  noOpLogger,
  createMockNotificationManager,
  setupAutomatedCleanup,
} from "../helpers/mock-factories";
import { expectNoTechnicalArtifacts } from "../helpers/behavior-validation";
import { YouTubePlatform } from "../../src/platforms/youtube";

type StreamConfig = {
  videoId: string;
  viewers: number;
  chatReady: boolean;
  isLive?: boolean;
};
type MultiStreamScenario = {
  name: string;
  streams: StreamConfig[];
  expectedViewerCount: number;
  chatReadyCount: number;
  detectedCount: number;
};
type NotificationManagerFixture = ReturnType<typeof createMockNotificationManager>;

const expectViewerCount = (value: number | null, expected: number): number => {
  expect(value).toBe(expected);
  expect(value).not.toBeNull();
  if (value === null) {
    throw new Error("Expected YouTube viewer count to be available");
  }
  return value;
};

describe("YouTube Multi-Stream Viewer Count Separation", () => {
  let mockNotificationManager: NotificationManagerFixture;
  let cleanup: unknown;

  afterEach(async () => {
    restoreAllMocks();
    if (typeof cleanup === "function") {
      await cleanup();
    }
  });

  const createMultiStreamScenario = (
    streamConfigs: StreamConfig[],
  ): MultiStreamScenario => {
    const totalViewers = streamConfigs
      .filter((stream) => stream.isLive !== false)
      .reduce((sum, stream) => sum + stream.viewers, 0);

    const chatReadyStreams = streamConfigs.filter((stream) => stream.chatReady);
    const allDetectedStreams = streamConfigs.filter(
      (stream) => stream.isLive !== false,
    );

    return {
      name: `${streamConfigs.length} total streams (${chatReadyStreams.length} chat-ready, ${allDetectedStreams.length} detected)`,
      streams: streamConfigs,
      expectedViewerCount: totalViewers,
      chatReadyCount: chatReadyStreams.length,
      detectedCount: allDetectedStreams.length,
    };
  };

  const createYouTubePlatformWithMixedStates = async (
    scenario: MultiStreamScenario,
  ) => {
    const mockViewerExtractionService = {
      getAggregatedViewerCount: createMockFn<[string[]], Promise<{
        success: boolean;
        totalCount: number;
        successfulStreams: number;
      }>>().mockImplementation(
        async (videoIds: string[]) => {
          let totalCount = 0;
          let successfulStreams = 0;
          for (const videoId of videoIds) {
            const stream = scenario.streams.find((s) => s.videoId === videoId);
            if (stream && stream.isLive !== false) {
              totalCount += stream.viewers;
              successfulStreams++;
            }
          }
          return {
            success: true,
            totalCount,
            successfulStreams,
          };
        },
      ),
      extractViewerCount: createMockFn<[string], Promise<{ success: boolean; count: number }>>().mockImplementation(async (videoId) => {
        const stream = scenario.streams.find((s) => s.videoId === videoId);
        if (stream && stream.isLive !== false) {
          return {
            success: true,
            count: stream.viewers,
          };
        }
        return {
          success: false,
          count: 0,
        };
      }),
    };

    const platform = new YouTubePlatform(
      {
        youtube: {
          viewerCountMethod: "youtubei",
          enabled: true,
        },
      },
      {
        logger: noOpLogger,
        notificationManager: mockNotificationManager,
        viewerExtractionService: mockViewerExtractionService,
        streamDetectionService: {
          detectLiveStreams: createMockFn().mockResolvedValue({
            success: true,
            videoIds: [],
          }),
        },
      },
    );

    platform.connectionManager.getActiveVideoIds =
      createMockFn<[], string[]>().mockReturnValue(
        scenario.streams
          .filter((stream) => stream.isLive !== false)
          .map((stream) => stream.videoId),
      );

    platform.connectionManager.isConnectionReady =
      createMockFn<[string], boolean>().mockImplementation((videoId) => {
        const stream = scenario.streams.find((s) => s.videoId === videoId);
        return stream ? stream.chatReady : false;
      });

    return platform;
  };

  beforeEach(async () => {
    cleanup = setupAutomatedCleanup();
    mockNotificationManager = createMockNotificationManager();
  });

  describe("Multi-Stream Viewer Count Aggregation (From ALL Detected Streams)", () => {
    test("should aggregate viewer count from all detected streams regardless of chat readiness", async () => {
      const scenario = createMultiStreamScenario([
        { videoId: "stream-1", viewers: 1500, chatReady: true, isLive: true },
        { videoId: "stream-2", viewers: 800, chatReady: false, isLive: true },
        { videoId: "stream-3", viewers: 1200, chatReady: true, isLive: true },
        { videoId: "stream-4", viewers: 600, chatReady: false, isLive: true },
      ]);
      const platform = await createYouTubePlatformWithMixedStates(scenario);

      const totalViewers = expectViewerCount(await platform.getViewerCount(), 4100);

      expect(totalViewers).toBe(scenario.expectedViewerCount);
      const chatReadyOnly = scenario.streams
        .filter((s) => s.chatReady)
        .reduce((sum, s) => sum + s.viewers, 0);
      expect(totalViewers).toBeGreaterThan(chatReadyOnly);
    });

    test("should include streams with failed chat connections in viewer count", async () => {
      const scenario = createMultiStreamScenario([
        {
          videoId: "successful-chat",
          viewers: 2000,
          chatReady: true,
          isLive: true,
        },
        {
          videoId: "failed-chat-1",
          viewers: 1500,
          chatReady: false,
          isLive: true,
        },
        {
          videoId: "failed-chat-2",
          viewers: 900,
          chatReady: false,
          isLive: true,
        },
      ]);
      const platform = await createYouTubePlatformWithMixedStates(scenario);

      const totalViewers = expectViewerCount(await platform.getViewerCount(), 4400);

      const chatReadyTotal = 2000;
      expect(totalViewers).toBeGreaterThan(chatReadyTotal);
    });

    test("should handle mixed stream states with premiere and live streams", async () => {
      const scenario = createMultiStreamScenario([
        { videoId: "live-main", viewers: 3500, chatReady: true, isLive: true },
        {
          videoId: "premiere-pending",
          viewers: 800,
          chatReady: false,
          isLive: true,
        },
        {
          videoId: "live-backup",
          viewers: 1200,
          chatReady: false,
          isLive: true,
        },
        { videoId: "restream", viewers: 400, chatReady: true, isLive: true },
      ]);
      const platform = await createYouTubePlatformWithMixedStates(scenario);

      const totalViewers = expectViewerCount(await platform.getViewerCount(), 5900);

      expect(totalViewers).toBe(scenario.expectedViewerCount);
    });

    test("should maintain accurate count when chat connections change state", async () => {
      const scenario = createMultiStreamScenario([
        {
          videoId: "stable-stream",
          viewers: 1000,
          chatReady: true,
          isLive: true,
        },
        {
          videoId: "unstable-stream",
          viewers: 2000,
          chatReady: false,
          isLive: true,
        },
      ]);
      const platform = await createYouTubePlatformWithMixedStates(scenario);

      const initialCount = expectViewerCount(await platform.getViewerCount(), 3000);

      platform.connectionManager.isConnectionReady =
        createMockFn<[string], boolean>().mockImplementation((videoId) => {
          return true;
        });
      const afterChatReady = expectViewerCount(await platform.getViewerCount(), 3000);

      expect(afterChatReady).toBe(initialCount);
    });
  });

  describe("Chat-Independent Viewer Count Functionality", () => {
    test("should provide viewer count even when all chat connections fail", async () => {
      const scenario = createMultiStreamScenario([
        { videoId: "stream-1", viewers: 1800, chatReady: false, isLive: true },
        { videoId: "stream-2", viewers: 1200, chatReady: false, isLive: true },
        { videoId: "stream-3", viewers: 900, chatReady: false, isLive: true },
      ]);
      const platform = await createYouTubePlatformWithMixedStates(scenario);

      const totalViewers = expectViewerCount(await platform.getViewerCount(), 3900);

      expect(totalViewers).toBeGreaterThan(0);
      expect(totalViewers).not.toBe(0);
    });

    test("should work independently of chat service availability", async () => {
      const scenario = createMultiStreamScenario([
        {
          videoId: "detected-stream-1",
          viewers: 2500,
          chatReady: false,
          isLive: true,
        },
        {
          videoId: "detected-stream-2",
          viewers: 1800,
          chatReady: false,
          isLive: true,
        },
      ]);
      const platform = await createYouTubePlatformWithMixedStates(scenario);
      platform.connectionManager.isConnectionReady =
        createMockFn().mockReturnValue(false);
      platform.connectionManager.isAnyConnectionReady =
        createMockFn().mockReturnValue(false);

      const viewerCount = expectViewerCount(await platform.getViewerCount(), 4300);

      expect(viewerCount).toBeGreaterThan(0);
    });

    test("should handle partial chat connectivity gracefully", async () => {
      const scenario = createMultiStreamScenario([
        {
          videoId: "chat-enabled",
          viewers: 3000,
          chatReady: true,
          isLive: true,
        },
        {
          videoId: "api-detected-1",
          viewers: 1500,
          chatReady: false,
          isLive: true,
        },
        {
          videoId: "api-detected-2",
          viewers: 800,
          chatReady: false,
          isLive: true,
        },
        {
          videoId: "chat-enabled-2",
          viewers: 1200,
          chatReady: true,
          isLive: true,
        },
      ]);
      const platform = await createYouTubePlatformWithMixedStates(scenario);

      const totalViewers = expectViewerCount(await platform.getViewerCount(), 6500);

      const chatOnlyTotal = scenario.streams
        .filter((s) => s.chatReady)
        .reduce((sum, s) => sum + s.viewers, 0);
      expect(totalViewers).toBeGreaterThan(chatOnlyTotal);
    });

    test("should maintain viewer count during chat connection interruptions", async () => {
      const scenario = createMultiStreamScenario([
        {
          videoId: "main-stream",
          viewers: 4000,
          chatReady: true,
          isLive: true,
        },
        {
          videoId: "backup-stream",
          viewers: 1000,
          chatReady: true,
          isLive: true,
        },
      ]);
      const platform = await createYouTubePlatformWithMixedStates(scenario);

      const beforeInterruption = expectViewerCount(await platform.getViewerCount(), 5000);

      platform.connectionManager.isConnectionReady =
        createMockFn().mockReturnValue(false);
      const duringInterruption = expectViewerCount(await platform.getViewerCount(), 5000);

      expect(duringInterruption).toBe(beforeInterruption);
    });
  });

  describe("Consistent Platform Interface Parity", () => {
    test("should provide reliable getViewerCount() like other platforms", async () => {
      const scenario = createMultiStreamScenario([
        {
          videoId: "reliable-stream",
          viewers: 2500,
          chatReady: false,
          isLive: true,
        },
      ]);
      const platform = await createYouTubePlatformWithMixedStates(scenario);

      const call1 = expectViewerCount(await platform.getViewerCount(), 2500);
      const call2 = expectViewerCount(await platform.getViewerCount(), 2500);
      const call3 = expectViewerCount(await platform.getViewerCount(), 2500);

      expect(call1).toBe(2500);
      expect(call2).toBe(2500);
      expect(call3).toBe(2500);
      expect(call1).toBeDefined();
      expect(typeof call1).toBe("number");
    });

    test("should handle zero viewers consistently with other platforms", async () => {
      const scenario = createMultiStreamScenario([
        { videoId: "empty-stream", viewers: 0, chatReady: false, isLive: true },
      ]);
      const platform = await createYouTubePlatformWithMixedStates(scenario);

      const viewerCount = expectViewerCount(await platform.getViewerCount(), 0);

      expect(typeof viewerCount).toBe("number");
    });

    test("should behave consistently regardless of chat implementation details", async () => {
      const scenario1 = createMultiStreamScenario([
        {
          videoId: "websocket-chat",
          viewers: 1000,
          chatReady: true,
          isLive: true,
        },
        {
          videoId: "api-polling",
          viewers: 500,
          chatReady: false,
          isLive: true,
        },
      ]);
      const scenario2 = createMultiStreamScenario([
        {
          videoId: "different-impl-1",
          viewers: 1000,
          chatReady: false,
          isLive: true,
        },
        {
          videoId: "different-impl-2",
          viewers: 500,
          chatReady: true,
          isLive: true,
        },
      ]);
      const platform1 = await createYouTubePlatformWithMixedStates(scenario1);
      const platform2 = await createYouTubePlatformWithMixedStates(scenario2);

      const count1 = expectViewerCount(await platform1.getViewerCount(), 1500);
      const count2 = expectViewerCount(await platform2.getViewerCount(), 1500);

      expect(count1).toBe(1500);
      expect(count2).toBe(1500);
      expect(count1).toBe(count2);
    });

    test("should provide user-friendly viewer count display values", async () => {
      const scenario = createMultiStreamScenario([
        {
          videoId: "big-stream",
          viewers: 15000,
          chatReady: true,
          isLive: true,
        },
        {
          videoId: "medium-stream",
          viewers: 850,
          chatReady: false,
          isLive: true,
        },
        {
          videoId: "small-stream",
          viewers: 42,
          chatReady: false,
          isLive: true,
        },
      ]);
      const platform = await createYouTubePlatformWithMixedStates(scenario);

      const totalViewers = expectViewerCount(await platform.getViewerCount(), 15892);

      expect(typeof totalViewers).toBe("number");
      expect(totalViewers).toBeGreaterThan(0);
      expect(Number.isInteger(totalViewers)).toBe(true);
      const displayText = totalViewers.toLocaleString();
      expectNoTechnicalArtifacts(displayText);
      expect(displayText).toMatch(/^\d{1,3}(,\d{3})*$/);
    });
  });
});
