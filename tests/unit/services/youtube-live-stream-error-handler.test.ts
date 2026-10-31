import { vi, describe, it, beforeEach, expect } from 'bun:test';

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
type ChannelLike = { videos?: ChannelVideo[] };
type InnertubeClient = {
  getChannel: ReturnType<typeof vi.fn<(...args: [channelId: string]) => Promise<ChannelLike | null>>>;
  search: ReturnType<typeof vi.fn<(...args: [query: string]) => Promise<{ videos?: ChannelVideo[] }>>>;
};
type TestLogger = {
  debug: ReturnType<typeof vi.fn<(...args: [message: string, scope?: string, payload?: unknown]) => void>>;
  info: ReturnType<typeof vi.fn<(...args: [message: string, scope?: string, payload?: unknown]) => void>>;
  warn: ReturnType<typeof vi.fn<(...args: [message: string, scope?: string, payload?: unknown]) => void>>;
  error: ReturnType<typeof vi.fn<(...args: [message: string, scope?: string, payload?: unknown]) => void>>;
};

describe("YouTubeLiveStreamService error handler integration", () => {
  it("sanitizes returned and injected diagnostic text at acquisition and secondary boundaries", async () => {
    const calls: unknown[][] = [];
    const record = (...args: unknown[]) => { calls.push(args); };
    const logger = { debug: record, info: record, warn: record, error: record };
    const error = new Error("Parser access_token=synthetic-live-token");
    const channelId = "UC" + "d".repeat(22);
    const result = await YouTubeLiveStreamService.getLiveStreamsWithParserTolerance({ getChannel: async () => { throw error; } }, channelId, { logger });
    await YouTubeLiveStreamService.getLiveStreams({ getChannel: async () => ({ videos: [], getLiveStreams: async () => { throw error; } }), search: async () => { throw error; } }, channelId, { logger });
    expect(JSON.stringify(calls)).not.toContain("synthetic-live-token");
    expect(result.error).not.toContain("synthetic-live-token");
    expect(result.parserError).toBe(true);
  });
  let mockInnertube: InnertubeClient;
  let mockLogger: TestLogger;

  beforeEach(() => {
    mockInnertube = {
      getChannel: vi.fn<(...args: [channelId: string]) => Promise<ChannelLike | null>>(),
      search: vi.fn<(...args: [query: string]) => Promise<{ videos?: ChannelVideo[] }>>(),
    };
    mockLogger = {
      debug: vi.fn<(...args: [message: string, scope?: string, payload?: unknown]) => void>(),
      info: vi.fn<(...args: [message: string, scope?: string, payload?: unknown]) => void>(),
      warn: vi.fn<(...args: [message: string, scope?: string, payload?: unknown]) => void>(),
      error: vi.fn<(...args: [message: string, scope?: string, payload?: unknown]) => void>(),
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
    mockInnertube.getChannel = vi.fn<(...args: [channelId: string]) => Promise<ChannelLike | null>
    >().mockRejectedValue(
      new Error("API timeout"),
    );

    const result = await YouTubeLiveStreamService.getLiveStreams(
      mockInnertube,
      "UC" + "e".repeat(22),
      { logger: mockLogger },
    );

    expect(result.success).toBe(false);
    expect(mockLogger.error).toHaveBeenCalled();
    expect(mockInnertube.getChannel).toHaveBeenCalledWith("UC" + "e".repeat(22));
    const errorCall = mockLogger.error.mock.calls[0];
    expect(errorCall).toBeDefined();
    if (!errorCall) {
      throw new Error("Expected logger.error call");
    }
    expect(errorCall[0]).toContain("getLiveStreams failed");
  });
});
