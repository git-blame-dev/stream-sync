import { describe, it, beforeEach, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { ViewerCountExtractionService } from "../../../src/services/viewer-count-extraction-service.ts";
import { InnertubeService } from "../../../src/services/innertube-service";

describe("ViewerCountExtractionService error handler integration", () => {
  type MockInnertube = { getVideoInfo: (videoId: string) => Promise<Record<string, unknown>> };
  type ExtractionResult = { success: boolean; count: number; metadata: Record<string, unknown> };
  type MockExtractor = { extractConcurrentViewers: () => ExtractionResult };
  type MockLogger = {
    debug: ReturnType<typeof createMockFn>;
    info: ReturnType<typeof createMockFn>;
    warn: ReturnType<typeof createMockFn>;
    error: ReturnType<typeof createMockFn>;
  };

  let mockInnertube: MockInnertube;
  let mockExtractor: MockExtractor;
  let mockLogger: MockLogger;

  beforeEach(() => {
    mockInnertube = {
      getVideoInfo: createMockFn(async () => ({})),
    };
    mockExtractor = {
      extractConcurrentViewers: createMockFn(() => ({
        success: false,
        count: 0,
        metadata: {},
      })),
    };
    mockLogger = {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    };
  });

  it("routes extraction error through error handler at visible log level", async () => {
    mockInnertube.getVideoInfo = createMockFn(async () => {
      throw new Error("innertube failed synthetic-private-video access_token=synthetic-secret");
    });

    const owner = new InnertubeService({
      createWithTimeout: async () => ({ getInfo: (id: string) => mockInnertube.getVideoInfo(id) }),
    }, { logger: mockLogger });
    const service = new ViewerCountExtractionService(owner, {
      logger: mockLogger,
      YouTubeViewerExtractor: mockExtractor,
    });

    const result = await service.extractViewerCount("test-vid-1");

    expect(result.success).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
    const errorCall = mockLogger.error.mock.calls[0];
    if (errorCall === undefined) {
      throw new Error("Expected extraction error logger call");
    }
    expect(result.error).toBe("Viewer count extraction failed");
    const diagnostics = JSON.stringify(mockLogger.error.mock.calls) + JSON.stringify(mockLogger.debug.mock.calls);
    expect(diagnostics).not.toContain("test-vid-1");
    expect(diagnostics).not.toContain("synthetic-private-video");
    expect(diagnostics).not.toContain("synthetic-secret");
  });
});
