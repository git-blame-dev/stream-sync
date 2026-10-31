import { vi, describe, test, expect, afterEach } from 'bun:test';

import { noOpLogger } from "../../../../helpers/mock-factories";
import { YouTubePlatform } from "../../../../../src/platforms/youtube";
import { YouTubeConnectionManager } from "../../../../../src/platforms/youtube/youtube-connection-manager";

type ConnectionManagerOverrides = Partial<{
  isConnectionReady: (videoId: string) => boolean;
  getActiveVideoIds: () => string[];
  getAllVideoIds: () => string[];
  getConnectionCount: () => number;
  getReadyConnectionCount: () => number;
}>;

const createConnectionManager = (
  overrides: ConnectionManagerOverrides = {},
): YouTubeConnectionManager => {
  const manager = new YouTubeConnectionManager(noOpLogger);
  Object.assign(manager, overrides);
  return manager;
};

const createPlatform = (configOverrides = {}, depsOverrides = {}) => {
  const config = {
    enabled: true,
    username: "testchannel",
    channelId: "UC-test-channel-id",
    multiStreamEnabled: true,
    ...configOverrides,
  };
  const platform = new YouTubePlatform(config, {
    logger: noOpLogger,
    streamDetectionService: {
      detectLiveStreams: vi.fn<(...args: unknown[]) => Promise<never[]>>().mockResolvedValue([]),
    },
    notificationDispatcher: { dispatch: vi.fn<(...args: unknown[]) => unknown>() },
    RawPlatformDataLoggingService: class {
      logRawPlatformData() {}
    },
    ...depsOverrides,
  });
  return platform;
};

describe("YouTube Connection Filtering Accuracy", () => {
  let youtubePlatform: YouTubePlatform | null = null;

  afterEach(() => {
    if (youtubePlatform?.cleanup) {
      youtubePlatform.cleanup().catch(() => {});
    }
    youtubePlatform = null;
  });

  describe("getActiveYouTubeVideoIds filtering accuracy", () => {
    test("returns only ready connections, not all stored connections", () => {
      youtubePlatform = createPlatform();
      const storedVideoIds = [
        "testvideo1",
        "testvideo2",
        "testvideo3",
        "testvideo4",
      ];
      const readyVideoIds = ["testvideo1", "testvideo3"];

      const mockConnectionManager = createConnectionManager({
        getActiveVideoIds: vi.fn<(...args: unknown[]) => typeof storedVideoIds>().mockReturnValue(storedVideoIds),
        isConnectionReady: vi.fn<(...args: [string]) => boolean>().mockImplementation(
          (videoId) => readyVideoIds.includes(videoId),
        ),
        getConnectionCount: vi.fn<(...args: unknown[]) => number>().mockReturnValue(4),
        getReadyConnectionCount: vi.fn<(...args: unknown[]) => number>().mockReturnValue(2),
      });
      youtubePlatform.connectionManager = mockConnectionManager;

      const activeIds = youtubePlatform.getActiveYouTubeVideoIds();

      expect(activeIds).toEqual(readyVideoIds);
      expect(activeIds.length).toBe(2);
    });

    test("returns empty array when no connections are ready", () => {
      youtubePlatform = createPlatform();
      const storedVideoIds = ["testvideo1", "testvideo2", "testvideo3"];

      const mockConnectionManager = createConnectionManager({
        getActiveVideoIds: vi.fn<(...args: unknown[]) => typeof storedVideoIds>().mockReturnValue(storedVideoIds),
        isConnectionReady: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(false),
        getConnectionCount: vi.fn<(...args: unknown[]) => number>().mockReturnValue(3),
        getReadyConnectionCount: vi.fn<(...args: unknown[]) => number>().mockReturnValue(0),
      });
      youtubePlatform.connectionManager = mockConnectionManager;

      const activeIds = youtubePlatform.getActiveYouTubeVideoIds();

      expect(activeIds).toEqual([]);
      expect(activeIds.length).toBe(0);
    });

    test("handles connection state transitions accurately", () => {
      youtubePlatform = createPlatform();
      const videoId = "test_transition_video";
      const storedIds = [videoId];

      const isReadyMock = vi.fn<(...args: unknown[]) => boolean>()
        .mockReturnValueOnce(false)
        .mockReturnValueOnce(true);

      const mockConnectionManager = createConnectionManager({
        getActiveVideoIds: vi.fn<(...args: unknown[]) => typeof storedIds>().mockReturnValue(storedIds),
        isConnectionReady: isReadyMock,
      });
      youtubePlatform.connectionManager = mockConnectionManager;

      const activeIdsBefore = youtubePlatform.getActiveYouTubeVideoIds();
      expect(activeIdsBefore).toEqual([]);

      const activeIdsAfter = youtubePlatform.getActiveYouTubeVideoIds();
      expect(activeIdsAfter).toEqual([videoId]);
    });
  });

  describe("status reporting accuracy for user interface", () => {
    test("shows accurate multi-stream status with proper distinction", () => {
      youtubePlatform = createPlatform();
      const storedConnections = [
        "testpremiere1",
        "testlive_stream1",
        "testpremiere2",
        "testlive_stream2",
      ];
      const readyConnections = ["testlive_stream1", "testlive_stream2"];

      const mockConnectionManager = createConnectionManager({
        getAllVideoIds: vi.fn<(...args: unknown[]) => typeof storedConnections>().mockReturnValue(storedConnections),
        getActiveVideoIds: vi.fn<(...args: unknown[]) => typeof storedConnections>().mockReturnValue(storedConnections),
        getConnectionCount: vi.fn<(...args: unknown[]) => number>().mockReturnValue(4),
        getReadyConnectionCount: vi.fn<(...args: unknown[]) => number>().mockReturnValue(2),
        isConnectionReady: vi.fn<(...args: [string]) => boolean>().mockImplementation(
          (id) => readyConnections.includes(id),
        ),
      });
      youtubePlatform.connectionManager = mockConnectionManager;

      const activeIds = youtubePlatform.getActiveYouTubeVideoIds();
      const storedIds = youtubePlatform.connectionManager.getAllVideoIds();

      expect(activeIds).toEqual(readyConnections);
      expect(storedIds).toEqual(storedConnections);
      expect(activeIds.length).toBe(2);
      expect(storedIds.length).toBe(4);
    });

    test("provides accurate counts for user dashboard display", () => {
      youtubePlatform = createPlatform();
      const allStoredIds = [
        "testpremiere_waiting",
        "testlive_active1",
        "testlive_active2",
        "testpremiere_scheduled",
      ];
      const actualReadyIds = ["testlive_active1", "testlive_active2"];

      const mockConnectionManager = createConnectionManager({
        getAllVideoIds: vi.fn<(...args: unknown[]) => typeof allStoredIds>().mockReturnValue(allStoredIds),
        getActiveVideoIds: vi.fn<(...args: unknown[]) => typeof allStoredIds>().mockReturnValue(allStoredIds),
        getConnectionCount: vi.fn<(...args: unknown[]) => number>().mockReturnValue(4),
        getReadyConnectionCount: vi.fn<(...args: unknown[]) => number>().mockReturnValue(2),
        isConnectionReady: vi.fn<(...args: [string]) => boolean>().mockImplementation(
          (id) => actualReadyIds.includes(id),
        ),
      });
      youtubePlatform.connectionManager = mockConnectionManager;

      const storedCount =
        youtubePlatform.connectionManager.getConnectionCount();
      const readyCount =
        youtubePlatform.connectionManager.getReadyConnectionCount();
      const userVisibleActiveIds = youtubePlatform.getActiveYouTubeVideoIds();

      expect(storedCount).toBe(4);
      expect(readyCount).toBe(2);
      expect(userVisibleActiveIds.length).toBe(readyCount);
      expect(userVisibleActiveIds).toEqual(actualReadyIds);
    });
  });

  describe("connection filtering for operational decisions", () => {
    test("enables accurate operational decisions based on ready connections", () => {
      youtubePlatform = createPlatform();
      const storedStreams = ["teststream1", "teststream2", "teststream3"];
      const operationallyActiveStreams = ["teststream2"];

      const mockConnectionManager = createConnectionManager({
        getActiveVideoIds: vi.fn<(...args: unknown[]) => typeof storedStreams>().mockReturnValue(storedStreams),
        isConnectionReady: vi.fn<(...args: [string]) => boolean>().mockImplementation(
          (id) => operationallyActiveStreams.includes(id),
        ),
      });
      youtubePlatform.connectionManager = mockConnectionManager;

      const streamsForOperations = youtubePlatform.getActiveYouTubeVideoIds();

      expect(streamsForOperations).toEqual(operationallyActiveStreams);
      expect(streamsForOperations.length).toBe(1);

      const shouldAggregateViewers = streamsForOperations.length > 0;
      const shouldShowMultiStreamStatus = streamsForOperations.length > 1;

      expect(shouldAggregateViewers).toBe(true);
      expect(shouldShowMultiStreamStatus).toBe(false);
    });
  });

  describe("edge cases: connection filtering robustness", () => {
    test("handles undefined connection manager gracefully", () => {
      youtubePlatform = createPlatform();
      Object.defineProperty(youtubePlatform, "connectionManager", {
        configurable: true,
        value: null,
      });

      const activeIds = youtubePlatform.getActiveYouTubeVideoIds();

      expect(activeIds).toBeDefined();
      expect(Array.isArray(activeIds)).toBe(true);
      expect(activeIds).toEqual([]);
    });

    test("returns empty array when getActiveVideoIds returns empty array", () => {
      youtubePlatform = createPlatform();

      const mockConnectionManager = createConnectionManager({
        getActiveVideoIds: vi.fn<(...args: unknown[]) => never[]>().mockReturnValue([]),
        isConnectionReady: vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(false),
      });
      youtubePlatform.connectionManager = mockConnectionManager;

      const activeIds = youtubePlatform.getActiveYouTubeVideoIds();
      expect(activeIds).toEqual([]);
    });
  });
});
