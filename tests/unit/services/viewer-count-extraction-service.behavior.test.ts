import { describe, it, beforeEach, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { ViewerCountExtractionService } from "../../../src/services/viewer-count-extraction-service.ts";

describe("ViewerCountExtractionService", () => {
  let mockInnertube;
  let mockExtractor;

  beforeEach(() => {
    mockInnertube = {
      getVideoInfo: createMockFn(),
    };
    mockExtractor = {
      extractConcurrentViewers: createMockFn(),
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
    service.extractViewerCount = createMockFn((videoId) => {
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
    expect(results[0].success).toBe(true);
    expect(results[1].success).toBe(false);
    expect(results[1].errorType).toBe("Promise");
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
    const internal = service as any;

    internal.extractViewerCountsBatch = createMockFn().mockResolvedValue([
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
    expect((result.streams[1] as any).error).toBe("Extraction failed");
  });

  it("surfaces unavailable aggregation when all stream extractions fail", async () => {
    const service = new ViewerCountExtractionService(mockInnertube, {
      logger: noOpLogger,
      YouTubeViewerExtractor: mockExtractor,
    });
    const internal = service as any;

    internal.extractViewerCountsBatch = createMockFn().mockResolvedValue([
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
    const internal = service as any;

    service.updateConfig({ timeout: 4500, retries: 2 });
    internal._updateStats(true, 40);

    const stats = service.getStats();

    expect(internal.config.timeout).toBe(4500);
    expect(internal.config.retries).toBe(2);
    expect(stats.totalRequests).toBe(0);
    expect(stats.successRate).toBe("0%");
    expect(typeof stats.uptime).toBe("number");
  });

  it("normalizes non-boolean debug config to false before extraction", async () => {
    mockInnertube.getVideoInfo.mockResolvedValue({ info: true });
    mockExtractor.extractConcurrentViewers.mockImplementation(
      (_info, options) => ({
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
