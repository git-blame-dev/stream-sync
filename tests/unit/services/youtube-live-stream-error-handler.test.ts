import { describe, it, beforeEach, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { YouTubeLiveStreamService } from "../../../src/services/youtube-live-stream-service.ts";

describe("YouTubeLiveStreamService error handler integration", () => {
  let mockInnertube;
  let mockLogger;

  beforeEach(() => {
    mockInnertube = {
      getChannel: createMockFn(),
      search: createMockFn(),
    };
    mockLogger = {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    };
    YouTubeLiveStreamService._channelCache = new Map();
  });

  it("routes channel not found error through error handler at warn level", async () => {
    const result = await YouTubeLiveStreamService.getLiveStreams(
      mockInnertube,
      "",
      { logger: mockLogger },
    );

    expect(result.success).toBe(false);
    expect(mockLogger.warn).toHaveBeenCalled();
  });

  it("routes API failure through error handler at error level", async () => {
    mockInnertube.getChannel = createMockFn().mockRejectedValue(
      new Error("API timeout"),
    );

    const result = await YouTubeLiveStreamService.getLiveStreams(
      mockInnertube,
      "UC_TEST_CHANNEL_00000000",
      { logger: mockLogger },
    );

    expect(result.success).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
    const errorCall = mockLogger.error.mock.calls[0];
    expect(errorCall[0]).toContain("getLiveStreams failed");
  });
});
