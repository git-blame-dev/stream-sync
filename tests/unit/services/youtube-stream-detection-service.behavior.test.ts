import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import {
  createMockFn,
  clearAllMocks,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { YouTubeStreamDetectionService } from "../../../src/services/youtube-stream-detection-service.ts";
import { InnertubeService } from "../../../src/services/innertube-service";
import * as testClock from "../../helpers/test-clock";

type ChannelVideo = {
  id?: string;
  video_id?: string;
  title?: { text?: string } | string;
  is_live?: boolean;
  is_live_content?: boolean;
  badges?: Array<{ label?: string; text?: string; style?: string }>;
  author?: { id?: string; name?: string; handle?: string };
};
type ChannelLike = { videos?: ChannelVideo[] };
type DetectionClient = {
  getChannel: (channelId: string) => Promise<ChannelLike | null>;
};
type DetectionConfig = { timeout?: number; username?: string };

const createDetectionClient = () => new InnertubeService({
  createWithTimeout: async (): Promise<DetectionClient & { getInfo: () => Promise<unknown> }> => ({
    getInfo: async () => ({}),
    getChannel: createMockFn<[channelId: string], Promise<ChannelLike | null>>().mockResolvedValue(null),
  }),
}, { logger: noOpLogger });

describe("YouTubeStreamDetectionService behavior", () => {
  it("rejects cleaned-empty handles before metadata access and normalizes native timeouts", async () => {
    let calls = 0;
    const owner = new InnertubeService({ createWithTimeout: async () => { calls++; return { getInfo: async () => ({}) }; } }, { logger: noOpLogger });
    const service = new YouTubeStreamDetectionService(owner, { logger: noOpLogger, timeout: Infinity });
    expect(service.timeout).toBe(2000);
    service.updateConfiguration({ timeout: 4500 });
    for (const timeout of [NaN, Infinity, -1, 0, 1.5, 2147483648]) {
      service.updateConfiguration({ timeout });
      expect(service.timeout).toBe(4500);
    }
    for (const handle of ["   ", "@", " @ "]) expect((await service.detectLiveStreams(handle)).success).toBe(false);
    expect(calls).toBe(0);
    expect(service.getUsageMetrics().failedRequests).toBe(3);
  });

  it("does not poison the service circuit with channel 404s but retains parser failures", () => {
    const service = new YouTubeStreamDetectionService(createDetectionClient(), { logger: noOpLogger });
    for (let index = 0; index < 3; index++) service._recordCircuitBreakerFailure(Object.assign(new Error("Channel not found!"), { status: 404 }));
    expect(service._circuitBreaker.isOpen).toBe(false);
    for (let index = 0; index < 3; index++) service._recordCircuitBreakerFailure(new Error("YouTubeParser class not found!"));
    expect(service._circuitBreaker.isOpen).toBe(true);
  });

  it("keeps three channel failures out of the circuit and permits a later functional discovery", async () => {
    const missingChannels = ["UC" + "a".repeat(22), "UC" + "b".repeat(22), "UC" + "c".repeat(22)];
    const liveChannel = "UC" + "d".repeat(22);
    const channelCalls: string[] = [];
    let creations = 0;
    const owner = new InnertubeService({ createWithTimeout: async () => {
      creations++;
      return {
        getInfo: async () => ({}),
        getChannel: async (channelId: string) => {
          channelCalls.push(channelId);
          if (channelCalls.length <= 3) throw Object.assign(new Error("Channel not found!"), { status: 404 });
          const videos = [{ id: "ABCDEFGHIJK", is_live: true, author: { id: liveChannel } }];
          return { videos, getLiveStreams: async () => ({ videos }) };
        },
      };
    } }, { logger: noOpLogger });
    const service = new YouTubeStreamDetectionService(owner, { logger: noOpLogger });
    try {
      for (const channelId of missingChannels) {
        expect(await service.detectLiveStreams(channelId)).toMatchObject({ success: false, observationKind: "unavailable", videoIds: [] });
      }
      expect(channelCalls).toEqual(missingChannels);
      expect(service.getUsageMetrics().failedRequests).toBe(3);
      expect(service._circuitBreaker.isOpen).toBe(false);
      expect(await service.detectLiveStreams(liveChannel)).toMatchObject({ success: true, observationKind: "complete", videoIds: ["ABCDEFGHIJK"] });
      expect(channelCalls).toEqual([...missingChannels, liveChannel]);
      expect(creations).toBe(1);
      expect(service.getUsageMetrics()).toMatchObject({ totalRequests: 4, failedRequests: 3, successfulRequests: 1 });
    } finally {
      await service.cleanup();
      await owner.dispose();
    }
    await expect((async () => owner.withMetadataOperation({}, async () => ({})))()).rejects.toThrow("disposed");
    expect(channelCalls).toHaveLength(4);
  });

  it("omits synthetic handles, raw upstream errors and tokens from diagnostics", async () => {
    const messages: unknown[] = [];
    const logger = {
      debug: (...args: unknown[]) => { messages.push(args); },
      warn: (...args: unknown[]) => { messages.push(args); },
      error: (...args: unknown[]) => { messages.push(args); },
    };
    const channelId = "UC" + "p".repeat(22);
    const resolvedUrls: string[] = [];
    const channelCalls: string[] = [];
    const owner = new InnertubeService({ createWithTimeout: async () => ({
      getInfo: async () => ({}),
      resolveURL: async (url: string) => {
        resolvedUrls.push(url);
        return { payload: { browseId: channelId } };
      },
      getChannel: async (id: string) => {
        channelCalls.push(id);
        throw new Error("syntheticPrivateHandle synthetic-provider access_token=synthetic-secret");
      },
    }) }, { logger });
    const service = new YouTubeStreamDetectionService(owner, { logger });
    try {
      const result = await service.detectLiveStreams("syntheticPrivateHandle", { debug: true });
      expect(resolvedUrls).toEqual(["https://www.youtube.com/@syntheticprivatehandle"]);
      expect(channelCalls).toEqual([channelId]);
      expect(result).toMatchObject({ success: false, observationKind: "unavailable", videoIds: [], debug: { errorMessage: "Unable to detect streams", errorType: "Error" } });
      const diagnostics = JSON.stringify([messages, result.debug]);
      expect(diagnostics).not.toContain("syntheticPrivateHandle");
      expect(diagnostics).not.toContain("syntheticprivatehandle");
      expect(diagnostics).not.toContain(channelId);
      expect(diagnostics).not.toContain("synthetic-provider");
      expect(diagnostics).not.toContain("synthetic-secret");
    } finally {
      await service.cleanup();
      await owner.dispose();
    }
  });
  beforeEach(() => {
    clearAllMocks();
  });

  afterEach(() => {
    restoreAllMocks();
  });

  it("returns error response for invalid channel handle", async () => {
    const service = new YouTubeStreamDetectionService(
      createDetectionClient(),
      { logger: noOpLogger },
    );
    const result = await service.detectLiveStreams(null);

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(false);
    expect(result.message).toContain("Unable to detect streams");
    expect(service.getUsageMetrics()).toMatchObject({ totalRequests: 1, failedRequests: 1, successfulRequests: 0 });
  });

  it("short-circuits when circuit breaker is open", async () => {
    const service = new YouTubeStreamDetectionService(
      createDetectionClient(),
      { logger: noOpLogger },
    );
    service._circuitBreaker.isOpen = true;
    service._circuitBreaker.lastFailureTime = testClock.now();
    service._circuitBreaker.cooldownPeriod = 10_000;

    const result = await service.detectLiveStreams("testChannel");

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(service._metrics.totalRequests).toBe(1);
    expect(service.getUsageMetrics()).toMatchObject({ totalRequests: 1, failedRequests: 1, successfulRequests: 0 });
  });

  it("formats successful detection with validated video IDs", async () => {
    const service = new YouTubeStreamDetectionService(
      createDetectionClient(),
      { logger: noOpLogger },
    );
    service._performDetection = createMockFn().mockResolvedValue({
      observationKind: "complete" as const,
      streams: [{ videoId: "ABCDEFGHIJK" }, { videoId: "invalid" }],
      hasContent: true,
      detectionMethod: "youtubei",
    });

    const result = await service.detectLiveStreams("@testChannel");

    expect(result.success).toBe(true);
    expect(result.videoIds).toEqual(["ABCDEFGHIJK", "invalid"]);
    expect(result.message).toContain("Found 2 live streams");
    expect(result.detectionMethod).toBe("youtubei");
  });

  it("opens circuit breaker after repeated failures", async () => {
    const service = new YouTubeStreamDetectionService(
      createDetectionClient(),
      { logger: noOpLogger },
    );
    service._performDetection = createMockFn().mockRejectedValue(
      new Error("timeout error"),
    );

    await service.detectLiveStreams("testChannel");
    await service.detectLiveStreams("testChannel");
    await service.detectLiveStreams("testChannel");

    expect(service._circuitBreaker.isOpen).toBe(true);
    expect(service._metrics.failedRequests).toBe(3);
  });

  it("returns debug payload for unknown errors and marks retryable by default", async () => {
    const service = new YouTubeStreamDetectionService(
      createDetectionClient(),
      { logger: noOpLogger },
    );
    service._performDetection = createMockFn().mockRejectedValue(
      new Error("unexpected downstream issue"),
    );

    const result = await service.detectLiveStreams("testChannel", {
      debug: true,
    });

    expect(result.success).toBe(false);
    expect(result.retryable).toBe(true);
    expect(result.debug).toBeDefined();
    if (!result.debug) {
      throw new Error("Expected debug payload for failed detection");
    }
    expect(result.debug.errorMessage).toBe("Unable to detect streams");
  });

  it("reports zero average response time when all requests fail", async () => {
    const service = new YouTubeStreamDetectionService(
      createDetectionClient(),
      { logger: noOpLogger },
    );
    service._performDetection = createMockFn().mockRejectedValue(
      new Error("hard failure"),
    );

    await service.detectLiveStreams("testChannel");
    await service.detectLiveStreams("testChannel");

    const metrics = service.getUsageMetrics();
    expect(metrics.totalRequests).toBe(2);
    expect(metrics.successfulRequests).toBe(0);
    expect(metrics.failedRequests).toBe(2);
    expect(metrics.averageResponseTime).toBe(0);
  });

  it("updates timeout configuration and stays active while configured", () => {
    const service = new YouTubeStreamDetectionService(
      createDetectionClient(),
      { logger: noOpLogger },
    );

    const updated = service.updateConfiguration({
      timeout: 4500,
      username: "test-user",
    });

    expect(updated).toBe(true);
    expect(service.timeout).toBe(4500);
    expect(service.isConfigured()).toBe(true);
    expect(service.isActive()).toBe(true);
  });

  it("returns false when configuration update throws", () => {
    const service = new YouTubeStreamDetectionService(
      createDetectionClient(),
      { logger: noOpLogger },
    );
    const unstableConfig: DetectionConfig = {
      get timeout(): number {
        throw new Error("bad config");
      },
    };

    const updated = service.updateConfiguration(unstableConfig);

    expect(updated).toBe(false);
  });

  it("cleans up service state and reports inactive afterward", async () => {
    const service = new YouTubeStreamDetectionService(
      createDetectionClient(),
      { logger: noOpLogger },
    );

    await service.cleanup();

    expect(service.client).toBeNull();
    expect(service.isActive()).toBe(false);
    expect(service.getUsageMetrics().totalRequests).toBe(0);
  });
});
