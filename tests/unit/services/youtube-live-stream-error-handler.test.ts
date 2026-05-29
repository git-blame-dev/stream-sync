import { describe, it, beforeEach, expect } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { YouTubeLiveStreamService } from "../../../src/services/youtube-live-stream-service.ts";

type ChannelVideo = {
  id?: string;
  video_id?: string;
  title?: { text?: string } | string;
  is_live?: boolean;
  is_live_content?: boolean;
  badges?: Array<{ label?: string; text?: string; style?: string }>;
  author?: { id?: string; name?: string; handle?: string };
};
type ChannelLike = { videos?: { contents?: ChannelVideo[] } };
type InnertubeClient = {
  getChannel: ReturnType<typeof createMockFn<[channelId: string], Promise<ChannelLike | null>>>;
  search: ReturnType<typeof createMockFn<[query: string], Promise<{ videos?: ChannelVideo[] }>>>;
};
type TestLogger = {
  debug: ReturnType<typeof createMockFn<[message: string, scope?: string, payload?: unknown], void>>;
  info: ReturnType<typeof createMockFn<[message: string, scope?: string, payload?: unknown], void>>;
  warn: ReturnType<typeof createMockFn<[message: string, scope?: string, payload?: unknown], void>>;
  error: ReturnType<typeof createMockFn<[message: string, scope?: string, payload?: unknown], void>>;
};

describe("YouTubeLiveStreamService error handler integration", () => {
  let mockInnertube: InnertubeClient;
  let mockLogger: TestLogger;

  beforeEach(() => {
    mockInnertube = {
      getChannel: createMockFn<[channelId: string], Promise<ChannelLike | null>>(),
      search: createMockFn<[query: string], Promise<{ videos?: ChannelVideo[] }>>(),
    };
    mockLogger = {
      debug: createMockFn<[message: string, scope?: string, payload?: unknown], void>(),
      info: createMockFn<[message: string, scope?: string, payload?: unknown], void>(),
      warn: createMockFn<[message: string, scope?: string, payload?: unknown], void>(),
      error: createMockFn<[message: string, scope?: string, payload?: unknown], void>(),
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
    mockInnertube.getChannel = createMockFn<
      [channelId: string],
      Promise<ChannelLike | null>
    >().mockRejectedValue(
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
    expect(errorCall).toBeDefined();
    if (!errorCall) {
      throw new Error("Expected logger.error call");
    }
    expect(errorCall[0]).toContain("getLiveStreams failed");
  });
});
