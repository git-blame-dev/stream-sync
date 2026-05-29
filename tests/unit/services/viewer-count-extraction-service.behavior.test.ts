import { describe, it, beforeEach, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { ViewerCountExtractionService } from "../../../src/services/viewer-count-extraction-service.ts";

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

describe("ViewerCountExtractionService", () => {
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

    const service = new ViewerCountExtractionService(mockInnertube, {
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

    const service = new ViewerCountExtractionService(mockInnertube, {
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

    const service = new ViewerCountExtractionService(mockInnertube, {
      logger: noOpLogger,
      YouTubeViewerExtractor: mockExtractor,
    });

    const result = await service.extractViewerCount("vid1");

    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
    expect(service.stats.failedExtractions).toBe(1);
  });

  it("handles batch extraction with rejected promises", async () => {
    const service = new ViewerCountExtractionService(mockInnertube, {
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
    const service = new ViewerCountExtractionService(mockInnertube, {
      logger: noOpLogger,
      YouTubeViewerExtractor: mockExtractor,
    });

    const result = await service.getAggregatedViewerCount([]);

    expect(result.success).toBe(true);
    expect(result.totalCount).toBe(0);
    expect(result.streams).toHaveLength(0);
  });

  it("aggregates mixed stream results and exposes stream details", async () => {
    const service = new ViewerCountExtractionService(mockInnertube, {
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

    expect(result.success).toBe(true);
    expect(result.totalCount).toBe(14);
    expect(result.successfulStreams).toBe(1);
    expect(result.failedStreams).toBe(1);
    expect(result.streams).toHaveLength(2);
    const failedStream = result.streams[1];
    expect(failedStream).toBeDefined();
    if (!failedStream) throw new Error("Expected failed stream details");
    expect(failedStream.error).toBe("Extraction failed");
  });

  it("surfaces unavailable aggregation when all stream extractions fail", async () => {
    const service = new ViewerCountExtractionService(mockInnertube, {
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

  it("updates config and exposes usage stats", async () => {
    const service = new ViewerCountExtractionService(mockInnertube, {
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

    const service = new ViewerCountExtractionService(mockInnertube, {
      logger: noOpLogger,
      debug: "false",
      YouTubeViewerExtractor: mockExtractor,
    });

    const result = await service.extractViewerCount("vid-debug");

    expect(result.success).toBe(true);
    expect(result.count).toBe(1);
  });
});
