import { describe, it, beforeEach, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { ViewerCountExtractionService } from "../../../src/services/viewer-count-extraction-service.ts";
import { InnertubeService } from "../../../src/services/innertube-service";

type VideoInfo = Record<string, unknown>;
type ExtractorOptions = { debug?: boolean; strategies?: string[] };
type ExtractorResult = {
  success: boolean;
  count: number;
  strategy?: string;
  metadata?: Record<string, unknown>;
};
type MockInnertube = {
  getVideoInfo: ReturnType<
    typeof createMockFn<[string, { timeout?: number; instanceKey?: unknown }?], Promise<VideoInfo>>
  >;
};
type MockExtractor = {
  extractConcurrentViewers: ReturnType<
    typeof createMockFn<[VideoInfo, ExtractorOptions?], ExtractorResult>
  >;
};
type ExtractionResponse = Awaited<ReturnType<ViewerCountExtractionService["extractViewerCount"]>>;

function metadataOwner(client: MockInnertube) {
  return new InnertubeService({
    createWithTimeout: async () => ({ getInfo: (id: string) => client.getVideoInfo(id) }),
  }, { logger: noOpLogger });
}

describe("ViewerCountExtractionService", () => {
  it("normalizes configuration without losing prior valid values", () => {
    const owner = new InnertubeService({ createWithTimeout: async () => ({ getInfo: async () => ({}) }) }, { logger: noOpLogger });
    const service = new ViewerCountExtractionService(owner, { timeout: Infinity, strategies: ["unknown"], retries: 2 });
    expect(service.config.timeout).toBe(8000);
    expect(service.config.strategies).toEqual(["view_text", "video_details", "basic_info"]);
    service.updateConfig({ timeout: 4500, strategies: ["basic_info"], debug: true });
    service.updateConfig({ timeout: 1.5, strategies: ["unknown"], debug: "false", unexpected: "synthetic-private" });
    expect(service.config).toEqual({ timeout: 4500, strategies: ["basic_info"], debug: true, retries: 2 });
    service.updateConfig({ timeout: 2147483648 });
    expect(service.config.timeout).toBe(4500);
  });

  it("caps simultaneous external metadata jobs at five while preserving result order", async () => {
    let active = 0;
    let maximum = 0;
    const owner = new InnertubeService({ createWithTimeout: async () => ({ getInfo: async () => {
      active++;
      maximum = Math.max(maximum, active);
      await Promise.resolve();
      active--;
      return { video_details: { viewer_count: 12 } };
    } }) }, { logger: noOpLogger });
    const service = new ViewerCountExtractionService(owner);
    const ids = Array.from({ length: 12 }, (_, index) => `synthetic-video-${index}`);
    const results = await service.extractViewerCountsBatch(ids, { maxConcurrency: 999 });
    expect(maximum).toBe(5);
    expect(results.map(result => result.videoId)).toEqual(ids);
    expect(results.every(result => result.success && result.count === 12)).toBe(true);
  });

  it("projects diagnostic metadata to bounded provenance without raw provider content", async () => {
    const owner = new InnertubeService({ createWithTimeout: async () => ({ getInfo: async () => ({
      video_details: { viewer_count: 10000001, private: "synthetic-private" },
    }) }) }, { logger: noOpLogger });
    const service = new ViewerCountExtractionService(owner);
    const result = await service.extractViewerCount("synthetic-private-video", { debug: true });
    expect(result.count).toBe(10000001);
    expect(result.videoId).toBe("synthetic-private-video");
    expect(result.metadata).toEqual({
      strategiesAttempted: ["view_text", "video_details"],
      rawData: { view_text: {}, video_details: { hasVideoDetails: true, sourceField: "viewer_count" } },
    });
    expect(JSON.stringify(result.metadata)).not.toContain("synthetic-private");
    expect(JSON.stringify(result.metadata)).not.toContain("10000001");
  });

  it("does not coerce metadata enum objects or retain arbitrary provider payloads", async () => {
    let coercions = 0;
    const disguised = (value: string) => ({ body: "synthetic-private-body", toString: () => { coercions++; return value; } });
    const owner = new InnertubeService({ createWithTimeout: async () => ({ getInfo: async () => ({}) }) }, { logger: noOpLogger });
    const service = new ViewerCountExtractionService(owner, { YouTubeViewerExtractor: {
      extractConcurrentViewers: () => ({ success: true, count: 12, metadata: {
        strategiesAttempted: ["view_text"],
        rawData: { view_text: { sourceField: disguised("viewer_count"), patternMatched: disguised("watching_now") } },
      } }),
    } });
    const result = await service.extractViewerCount("synthetic-functional-id");
    expect(coercions).toBe(0);
    expect(result.metadata).toEqual({ strategiesAttempted: ["view_text"], rawData: { view_text: {} } });
    expect(JSON.stringify(result.metadata)).not.toContain("synthetic-private-body");
  });
  let mockInnertube: MockInnertube;
  let mockExtractor: MockExtractor;

  beforeEach(() => {
    mockInnertube = {
      getVideoInfo: createMockFn<
        [string, { timeout?: number; instanceKey?: unknown }?],
        Promise<VideoInfo>
      >(),
    };
    mockExtractor = {
      extractConcurrentViewers: createMockFn<[VideoInfo, ExtractorOptions?], ExtractorResult>(),
    };
  });

  it("returns success with count and updates stats on extraction success", async () => {
    mockInnertube.getVideoInfo.mockResolvedValue({ info: true });
    mockExtractor.extractConcurrentViewers.mockReturnValue({
      success: true,
      count: 123,
      strategy: "view_text",
      metadata: { attempted: ["view_text"] },
    });

    const service = new ViewerCountExtractionService(metadataOwner(mockInnertube), {
      logger: noOpLogger,
      strategies: ["view_text"],
      YouTubeViewerExtractor: mockExtractor,
    });

    const result = await service.extractViewerCount("vid1");

    expect(result.success).toBe(true);
    expect(result.count).toBe(123);
    expect(service.stats.totalRequests).toBe(1);
    expect(service.stats.successfulExtractions).toBe(1);
  });

  it("returns failure when extractor does not succeed", async () => {
    mockInnertube.getVideoInfo.mockResolvedValue({ info: true });
    mockExtractor.extractConcurrentViewers.mockReturnValue({
      success: false,
      count: 0,
      metadata: { strategiesAttempted: ["a"] },
    });

    const service = new ViewerCountExtractionService(metadataOwner(mockInnertube), {
      logger: noOpLogger,
      YouTubeViewerExtractor: mockExtractor,
    });

    const result = await service.extractViewerCount("vid1");

    expect(result.success).toBe(false);
    expect(result.count).toBe(0);
    expect(service.stats.failedExtractions).toBe(1);
  });

  it("returns failure and error message when innertube throws", async () => {
    mockInnertube.getVideoInfo.mockRejectedValue(new Error("boom"));

    const service = new ViewerCountExtractionService(metadataOwner(mockInnertube), {
      logger: noOpLogger,
      YouTubeViewerExtractor: mockExtractor,
    });

    const result = await service.extractViewerCount("vid1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("Viewer count extraction failed");
    expect(service.stats.failedExtractions).toBe(1);
  });

  it("handles batch extraction with rejected promises", async () => {
    const service = new ViewerCountExtractionService(metadataOwner(mockInnertube), {
      logger: noOpLogger,
      YouTubeViewerExtractor: mockExtractor,
    });

    let call = 0;
    service.extractViewerCount = createMockFn<[string], Promise<ExtractionResponse>>((videoId) => {
      call++;
      if (call === 1) {
        return Promise.resolve({ success: true, count: 1, videoId });
      }
      return Promise.reject(new Error("fail"));
    });

    const results = await service.extractViewerCountsBatch(["one", "two"], {
      maxConcurrency: 1,
    });

    expect(results).toHaveLength(2);
    const [firstResult, secondResult] = results;
    expect(firstResult).toBeDefined();
    expect(secondResult).toBeDefined();
    if (!firstResult || !secondResult) throw new Error("Expected two batch results");
    expect(firstResult.success).toBe(true);
    expect(secondResult.success).toBe(false);
    expect(secondResult.errorType).toBe("Promise");
  });

  it("aggregates zero when no video ids provided", async () => {
    const service = new ViewerCountExtractionService(metadataOwner(mockInnertube), {
      logger: noOpLogger,
      YouTubeViewerExtractor: mockExtractor,
    });

    const result = await service.getAggregatedViewerCount([]);

    expect(result.success).toBe(true);
    expect(result.totalCount).toBe(0);
    expect(result.streams).toHaveLength(0);
  });

  it("aggregates mixed stream results and exposes stream details", async () => {
    const service = new ViewerCountExtractionService(metadataOwner(mockInnertube), {
      logger: noOpLogger,
      YouTubeViewerExtractor: mockExtractor,
    });
    service.extractViewerCountsBatch = createMockFn<
      [string[], { maxConcurrency?: unknown }?],
      Promise<ExtractionResponse[]>
    >().mockResolvedValue([
      { success: true, count: 14, videoId: "vid-a", strategy: "view_text" },
      {
        success: false,
        count: 0,
        videoId: "vid-b",
        error: "Extraction failed",
      },
    ]);

    const result = await service.getAggregatedViewerCount(["vid-a", "vid-b"]);

    expect(result.success).toBe(false);
    expect(result.totalCount).toBe(0);
    expect(result.successfulStreams).toBe(1);
    expect(result.failedStreams).toBe(1);
    expect(result.streams).toHaveLength(2);
    const failedStream = result.streams[1];
    expect(failedStream).toBeDefined();
    if (!failedStream) throw new Error("Expected failed stream details");
    expect(failedStream.error).toBe("Extraction failed");
  });

  it("surfaces unavailable aggregation when all stream extractions fail", async () => {
    const service = new ViewerCountExtractionService(metadataOwner(mockInnertube), {
      logger: noOpLogger,
      YouTubeViewerExtractor: mockExtractor,
    });
    service.extractViewerCountsBatch = createMockFn<
      [string[], { maxConcurrency?: unknown }?],
      Promise<ExtractionResponse[]>
    >().mockResolvedValue([
      {
        success: false,
        count: 0,
        videoId: "vid-a",
        error: "Extraction failed",
      },
      {
        success: false,
        count: 0,
        videoId: "vid-b",
        error: "Extraction failed",
      },
    ]);

    const result = await service.getAggregatedViewerCount(["vid-a", "vid-b"]);

    expect(result.success).toBe(false);
    expect(result.totalCount).toBe(0);
    expect(result.successfulStreams).toBe(0);
    expect(result.failedStreams).toBe(2);
  });

  it("marks missing batch members unavailable instead of accepting the available result", async () => {
    const service = new ViewerCountExtractionService(metadataOwner(mockInnertube), { logger: noOpLogger });
    service.extractViewerCountsBatch = createMockFn<[string[]], Promise<ExtractionResponse[]>>().mockResolvedValue([
      { success: true, count: 14, videoId: "test-a" },
    ]);
    expect(await service.getAggregatedViewerCount(["test-a", "test-b"])).toMatchObject({
      success: false, totalCount: 0, successfulStreams: 1, failedStreams: 1,
      streams: [
        { videoId: "test-a", count: 14, success: true },
        { videoId: "test-b", count: 0, success: false, error: "Missing or invalid viewer count" },
      ],
    });
  });

  it("does not trust invalid counts marked successful by a batch result", async () => {
    const service = new ViewerCountExtractionService(metadataOwner(mockInnertube), { logger: noOpLogger });
    service.extractViewerCountsBatch = createMockFn<[string[]], Promise<ExtractionResponse[]>>().mockResolvedValue([
      { success: true, count: Infinity, videoId: "test-a" },
    ]);
    expect(await service.getAggregatedViewerCount(["test-a"])).toMatchObject({
      success: false, totalCount: 0, successfulStreams: 0, failedStreams: 1,
      streams: [{ videoId: "test-a", count: 0, success: false }],
    });
  });

  it("updates config and exposes usage stats", async () => {
    const service = new ViewerCountExtractionService(metadataOwner(mockInnertube), {
      logger: noOpLogger,
      YouTubeViewerExtractor: mockExtractor,
      timeout: 2000,
    });

    service.updateConfig({ timeout: 4500, retries: 2 });
    service._updateStats(true, 40);

    const stats = service.getStats();

    expect(service.config.timeout).toBe(4500);
    expect(service.config.retries).toBe(2);
    expect(stats.totalRequests).toBe(0);
    expect(stats.successRate).toBe("0%");
    expect(typeof stats.uptime).toBe("number");
  });

  it("normalizes non-boolean debug config to false before extraction", async () => {
    mockInnertube.getVideoInfo.mockResolvedValue({ info: true });
    mockExtractor.extractConcurrentViewers.mockImplementation(
      (_info, options = {}) => ({
        success: true,
        count: options.debug === false ? 1 : 2,
        strategy: "view_text",
        metadata: {},
      }),
    );

    const service = new ViewerCountExtractionService(metadataOwner(mockInnertube), {
      logger: noOpLogger,
      debug: "false",
      YouTubeViewerExtractor: mockExtractor,
    });

    const result = await service.extractViewerCount("vid-debug");

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
  });
});
