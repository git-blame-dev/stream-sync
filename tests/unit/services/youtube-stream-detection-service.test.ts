import { vi, describe, it, beforeEach, afterEach, expect, spyOn } from 'bun:test';

import testClock from "../../helpers/test-clock";
import { noOpLogger } from "../../helpers/mock-factories";
import { YouTubeStreamDetectionService } from "../../../src/services/youtube-stream-detection-service.ts";
import { InnertubeService } from "../../../src/services/innertube-service";
import { YouTubeLiveStreamService } from "../../../src/services/youtube-live-stream-service";

type DetectionClient = Parameters<typeof YouTubeLiveStreamService.getLiveStreamsWithParserTolerance>[0];
type DetectionService = InstanceType<typeof YouTubeStreamDetectionService>;

type StreamFixture = {
  videoId: string | null;
  title: string;
  isLive: boolean;
  channelName: string;
};

type StatusError = Error & { status?: number };

function createChannelVideo(stream: StreamFixture) {
  return {
    ...(stream.videoId === null
      ? {}
      : { id: stream.videoId, video_id: stream.videoId }),
    title: { text: stream.title },
    is_live: stream.isLive,
    author: { name: stream.channelName },
  };
}

function createSearchVideo(stream: StreamFixture) {
  return {
    ...(stream.videoId === null ? {} : { id: stream.videoId }),
    title: stream.title,
    is_live: stream.isLive,
    author: { id: "UC" + "m".repeat(22), name: stream.channelName },
  };
}

function createMockInnertubeClient(
  streamData: StreamFixture[] = [],
): DetectionClient {
  const mockChannel = {
    videos: [],
    getLiveStreams: vi.fn<(...args: []) => Promise<{ videos: ReturnType<typeof createChannelVideo>[] }>>().mockResolvedValue({
      videos: streamData.map(createChannelVideo),
    }),
  };

  return {
    search: vi.fn<(...args: [string, Record<string, unknown>?]) => Promise<{ videos?: ReturnType<typeof createSearchVideo>[]; channels?: { author: { id: string; name: string; handle: string } }[] }>
    >().mockImplementation((_query, options) => {
      if (options && options.type === "channel") {
        return Promise.resolve({
          channels: [
            {
              author: {
                id: "UC" + "m".repeat(22),
                name: "testchannel",
                handle: "@testchannel",
              },
            },
          ],
        });
      }
      return Promise.resolve({
        videos: streamData.map(createSearchVideo),
      });
    }),
    resolveURL: vi.fn<(...args: [string]) => Promise<{ payload?: { browseId?: string } }>>().mockResolvedValue({
      payload: { browseId: "UC" + "m".repeat(22) },
    }),
    getChannel: vi.fn<(...args: [string]) => Promise<typeof mockChannel>>().mockResolvedValue(mockChannel),
  };
}

const detectionFixtures: Array<{ service: DetectionService; owner: InnertubeService }> = [];
afterEach(async () => {
  const results = await Promise.allSettled(detectionFixtures.splice(0).map(async ({ service, owner }) => {
    try { await service.cleanup(); }
    finally { await owner.dispose(); }
  }));
  const errors = results.filter(result => result.status === "rejected").map(result => result.reason);
  if (errors.length) throw new AggregateError(errors, "Synthetic detection fixture cleanup failed");
});

function createStreamDetectionService(
  mockClient: DetectionClient = createMockInnertubeClient(),
  timeout = 2000,
): DetectionService {
  const client = mockClient || createMockInnertubeClient();
  const owner = new InnertubeService({
    createWithTimeout: async () => ({ ...client, getInfo: async () => ({}) }),
  }, { logger: noOpLogger });
  const service = new YouTubeStreamDetectionService(owner, { logger: noOpLogger, timeout });
  detectionFixtures.push({ service, owner });
  return service;
}

function createLiveStreamData(): StreamFixture[] {
  return [
    {
      videoId: "live123",
      title: "Test Live Stream",
      isLive: true,
      channelName: "TestChannel",
    },
    {
      videoId: "live456",
      title: "Another Live Stream",
      isLive: true,
      channelName: "TestChannel",
    },
  ];
}

function createNonLiveStreamData(): StreamFixture[] {
  return [
    {
      videoId: "video123",
      title: "Recorded Video",
      isLive: false,
      channelName: "TestChannel",
    },
  ];
}

function expectNoTechnicalArtifacts(message: string) {
  expect(message).not.toMatch(/innertube|api|client|error|exception/i);
  expect(message).not.toContain("undefined");
  expect(message).not.toContain("null");
  expect(message).not.toContain("[object Object]");
}

function expectValidVideoId(videoId: string) {
  expect(videoId).toBeDefined();
  expect(typeof videoId).toBe("string");
  expect(videoId.length).toBeGreaterThan(0);
  expect(videoId).toMatch(/^[a-zA-Z0-9_-]+$/);
}

describe("YouTubeStreamDetectionService", () => {
  let service: DetectionService;
  let mockClient: DetectionClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Core Stream Detection Behavior", () => {
    it("should preserve feed live streams when the direct API never settles", async () => {
      const feedStream = {
        id: "feed-live-id",
        author: { id: "UC" + "f".repeat(22) },
        title: { text: "Feed Live Stream" },
        is_live: true,
      };
      mockClient = {
        resolveURL: vi.fn<(...args: unknown[]) => Promise<{ payload: { browseId: string; }; }>>().mockResolvedValue({
          payload: { browseId: "UC" + "f".repeat(22) },
        }),
        getChannel: vi.fn<(...args: unknown[]) => Promise<{ videos: { id: string; title: { text: string; }; is_live: boolean; }[]; getLiveStreams: import("bun:test").Mock<() => Promise<never>>; }>>().mockResolvedValue({
          videos: [feedStream],
          getLiveStreams: vi.fn(() => new Promise<never>(() => undefined)),
        }),
      } as DetectionClient;
      service = createStreamDetectionService(mockClient, 25);

      const result = await service.detectLiveStreams("@feedchannel");

      expect(result.success).toBe(true);
      expect(result.videoIds).toEqual(["feed-live-id"]);
    });

    it("should detect multiple live streams for a channel", async () => {
      const liveStreams = createLiveStreamData();
      mockClient = createMockInnertubeClient(liveStreams);
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("@testchannel");

      expect(result.videoIds).toHaveLength(2);
      expect(result.videoIds).toContain("live123");
      expect(result.videoIds).toContain("live456");
      expect(result.success).toBe(true);
      result.videoIds.forEach(expectValidVideoId);
    });

    it("should return empty array when no streams are live", async () => {
      const nonLiveStreams = createNonLiveStreamData();
      mockClient = createMockInnertubeClient(nonLiveStreams);
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("@testchannel");

      expect(result.videoIds).toEqual([]);
      expect(result.success).toBe(true);
      expect(result.message).toContain("No live streams");
      expectNoTechnicalArtifacts(result.message);
    });

    it("should handle channel with no content gracefully", async () => {
      mockClient = createMockInnertubeClient([]);
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("@emptychannel");

      expect(result.videoIds).toEqual([]);
      expect(result.success).toBe(true);
      expect(result.message).toContain("No content found");
      expectNoTechnicalArtifacts(result.message);
    });

    it("should include detection method metadata for transparency", async () => {
      const liveStreams = createLiveStreamData();
      mockClient = createMockInnertubeClient(liveStreams);
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("@testchannel");

      expect(result.success).toBe(true);
      expect(result.detectionMethod).toBe("channel_api");
      expect(result.hasContent).toBe(true);
    });
  });

  describe("Detection behavior", () => {
    it("returns live streams", async () => {
      service = createStreamDetectionService(createMockInnertubeClient(createLiveStreamData()));
      const result = await service.detectLiveStreams("@testchannel");
      expect(result.success).toBe(true);
      expect(result.videoIds).toEqual(["live123", "live456"]);
    });

    it("should timeout gracefully for slow responses", async () => {
      mockClient = {
        resolveURL: vi.fn<(...args: [string]) => Promise<never>>(
          () => new Promise<never>(() => undefined),
        ),
        getChannel: vi.fn<(...args: [string]) => Promise<{}>>().mockResolvedValue({}),
      };
      service = createStreamDetectionService(mockClient, 1);

      const result = await service.detectLiveStreams("@slowchannel");

      expect(result.success).toBe(false);
      expect(result.videoIds).toEqual([]);
      expect(result.message).toContain("timeout");
      expectNoTechnicalArtifacts(result.message);
    });
  });

  describe("Error Recovery Behavior", () => {
    it("should handle network errors gracefully", async () => {
      mockClient = {
        resolveURL: vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue(new Error("Network error")),
        getChannel: vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue(new Error("Network error")),
      };
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("@testchannel");

      expect(result.success).toBe(false);
      expect(result.videoIds).toEqual([]);
      expect(result.message).toContain("connection issue");
      expectNoTechnicalArtifacts(result.message);
      expect(result.retryable).toBe(true);
    });

    it("should handle API rate limiting gracefully", async () => {
      const rateLimitError: StatusError = new Error("Quota exceeded");
      rateLimitError.status = 429;
      mockClient = {
        resolveURL: vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue(rateLimitError),
        getChannel: vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue(rateLimitError),
      };
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("@testchannel");

      expect(result.success).toBe(false);
      expect(result.videoIds).toEqual([]);
      expect(result.message).toContain("rate limit");
      expectNoTechnicalArtifacts(result.message);
      expect(result.retryAfter).toBeDefined();
    });

    it("should handle invalid channel gracefully", async () => {
      const notFoundError: StatusError = new Error("Channel not found");
      notFoundError.status = 404;
      mockClient = {
        resolveURL: vi.fn<(...args: unknown[]) => Promise<{ payload: {}; }>>().mockResolvedValue({ payload: {} }),
        getChannel: vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue(notFoundError),
      };
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("@nonexistentchannel");

      expect(result.success).toBe(false);
      expect(result.videoIds).toEqual([]);
      expect(result.message).toContain("channel not found");
      expectNoTechnicalArtifacts(result.message);
      expect(result.retryable).toBe(false);
    });
  });

  describe("Channel Handle Format Support", () => {
    it("should work with @ handle format", async () => {
      const liveStreams = createLiveStreamData();
      mockClient = createMockInnertubeClient(liveStreams);
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("@testchannel");

      expect(result.success).toBe(true);
      expect(result.videoIds).toHaveLength(2);
    });

    it("should work with plain channel name", async () => {
      const liveStreams = createLiveStreamData();
      mockClient = createMockInnertubeClient(liveStreams);
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("testchannel");

      expect(result.success).toBe(true);
      expect(result.videoIds).toHaveLength(2);
    });

    it("should work with channel ID format", async () => {
      const liveStreams = createLiveStreamData();
      mockClient = createMockInnertubeClient(liveStreams);
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("UCTestChannelId123");

      expect(result.success).toBe(true);
      expect(result.videoIds).toHaveLength(2);
    });
  });

  describe("Data Quality and Validation", () => {
    it("should filter out invalid video IDs", async () => {
      const mixedData: StreamFixture[] = [
        {
          videoId: "valid123",
          title: "Valid Stream",
          isLive: true,
          channelName: "Test",
        },
        {
          videoId: "",
          title: "Invalid Stream",
          isLive: true,
          channelName: "Test",
        },
        {
          videoId: null,
          title: "Null Stream",
          isLive: true,
          channelName: "Test",
        },
        {
          videoId: "valid456",
          title: "Another Valid",
          isLive: true,
          channelName: "Test",
        },
      ];
      mockClient = createMockInnertubeClient(mixedData);
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("@testchannel");

      expect(result.videoIds).toEqual(["valid123", "valid456"]);
      expect(result.success).toBe(true);
      result.videoIds.forEach(expectValidVideoId);
    });

    it("should handle malformed API responses gracefully", async () => {
      const malformedChannel = {
        getLiveStreams: vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue(new Error("Type mismatch in YouTube.js parser")),
      };
      mockClient = {
        resolveURL: vi.fn<(...args: [string]) => Promise<{ payload?: { browseId?: string } }>>().mockResolvedValue({
          payload: { browseId: "UC" + "p".repeat(22) },
        }),
        search: vi.fn<(...args: [string, Record<string, unknown>?]) => Promise<{ videos?: ReturnType<typeof createSearchVideo>[] }>>().mockResolvedValue({
          videos: [],
        }),
        getChannel: vi.fn<(...args: [string]) => Promise<typeof malformedChannel>>().mockResolvedValue(malformedChannel),
      };
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("@testchannel");

      expect(result.success).toBe(false);
      expect(result.observationKind).toBe("partial");
      expect(result.videoIds).toEqual([]);
      expect(result.message).toContain("Unable to detect streams");
      expectNoTechnicalArtifacts(result.message);
    });
  });

  describe("Metrics and Debug Support", () => {
    it("should provide debug information for troubleshooting", async () => {
      const liveStreams = createLiveStreamData();
      mockClient = createMockInnertubeClient(liveStreams);
      service = createStreamDetectionService(mockClient);

      const result = await service.detectLiveStreams("@testchannel", {
        debug: true,
      });

      expect(result.debug).toBeDefined();
      const debug = result.debug;
      expect(debug).toBeDefined();
      if (debug === undefined) {
        throw new Error("Expected debug information");
      }
      expect(debug.requestTime).toBeDefined();
      expect(debug.channelHandle).toBeUndefined();
      expect(debug.totalVideosFound).toBe(2);
      expectNoTechnicalArtifacts(result.message);
    });

    it("should track API usage metrics", async () => {
      const liveStreams = createLiveStreamData();
      mockClient = createMockInnertubeClient(liveStreams);
      service = createStreamDetectionService(mockClient);

      await service.detectLiveStreams("@channel1");
      await service.detectLiveStreams("@channel2");
      const metrics = service.getUsageMetrics();

      expect(metrics.totalRequests).toBe(2);
      expect(metrics.successfulRequests).toBe(2);
      expect(metrics.averageResponseTime).toBeDefined();
      expect(metrics.errorRate).toBe(0);
    });
  });
});


it("uses completed monotonic detection samples despite wall clock changes", async () => {
  let mono = 100;
  let wall = 1000000;
  const clock = spyOn(performance, "now").mockImplementation(() => mono);
  const previousWall = testClock.now();
  testClock.set(wall);
  let release!: () => void;
  let entered!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const client = createMockInnertubeClient(createLiveStreamData());
  const getChannel = client.getChannel!.bind(client);
  client.getChannel = async (...args) => { entered(); await hold; return getChannel(...args); };
  const service = createStreamDetectionService(client);
  try {
    const pending = service.detectLiveStreams("@testchannel", { debug: true });
    await started; wall -= 10000; testClock.set(wall); mono += 2.5; release();
    const first = await pending;
    expect(first.success).toBe(true);
    expect(first.responseTime).toBe(2.5);
    expect(first.debug?.responseTimeMs).toBe(2.5);
    expect(Number.isFinite(Date.parse(first.debug!.requestTime))).toBe(true);
    wall += 20000; testClock.set(wall);
    const second = await service.detectLiveStreams("@testchannel", { debug: true });
    expect(second.responseTime).toBe(0);
    expect(service.getUsageMetrics().averageResponseTime).toBe(1);
    const invalid = await service.detectLiveStreams("", { debug: true });
    expect(invalid.success).toBe(false);
    expect(invalid.responseTime).toBe(0);
    expect(service.getUsageMetrics().successfulRequests).toBe(2);
  } finally { release(); testClock.set(previousWall); clock.mockRestore(); }
});


it("reports a held external detection failure with monotonic elapsed time", async () => {
  let mono = 20;
  let wall = 1000000;
  const clock = spyOn(performance, "now").mockImplementation(() => mono);
  const previousWall = testClock.now();
  testClock.set(wall);
  let release!: () => void;
  let entered!: () => void;
  const hold = new Promise<void>(resolve => { release = resolve; });
  const started = new Promise<void>(resolve => { entered = resolve; });
  const client = createMockInnertubeClient();
  client.getChannel = async () => { entered(); await hold; throw new Error("Network synthetic failure"); };
  const service = createStreamDetectionService(client);
  try {
    const pending = service.detectLiveStreams("@synthetic", { debug: true });
    await started; wall += 50000; testClock.set(wall); mono += 3.25; release();
    const result = await pending;
    expect(result.success).toBe(false);
    expect(result.responseTime).toBe(3.25);
    expect(result.debug?.responseTimeMs).toBe(3.25);
    expect(service.getUsageMetrics().averageResponseTime).toBe(0);
    expect(service.getUsageMetrics().failedRequests).toBe(1);
  } finally { release(); testClock.set(previousWall); clock.mockRestore(); }
});
