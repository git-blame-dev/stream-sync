import { vi, type Mock, describe, it, beforeEach, afterEach, expect } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import * as testClock from "../../helpers/test-clock";
import {
  expectNoTechnicalArtifacts,
  validateUserFacingString,
} from "../../helpers/assertion-helpers";
import { YouTubeLiveStreamService } from "../../../src/services/youtube-live-stream-service.ts";
import { withTimeout } from "../../../src/utils/timeout-wrapper";

type InnertubeClient = Parameters<
  typeof YouTubeLiveStreamService.getLiveStreams
>[0];
type ChannelLike = Awaited<ReturnType<InnertubeClient["getChannel"]>>;
type ResolveUrlResult = Awaited<
  ReturnType<NonNullable<InnertubeClient["resolveURL"]>>
>;
type SearchResult = Awaited<
  ReturnType<NonNullable<InnertubeClient["search"]>>
>;
type MockInnertubeClient = InnertubeClient & {
  getChannel: Mock<(...args: [string]) => Promise<ChannelLike>>;
  resolveURL: Mock<(...args: [string]) => Promise<ResolveUrlResult>>;
  search: Mock<(...args: [string, Record<string, unknown>?]) => Promise<SearchResult>>;
};
type LiveStreamResult = Awaited<
  ReturnType<typeof YouTubeLiveStreamService.getLiveStreams>
>;
type LiveStream = LiveStreamResult["streams"][number];

const expectPresent = <T>(value: T | null | undefined): T => {
  expect(value).toBeDefined();
  expect(value).not.toBeNull();
  if (value === null || value === undefined) {
    throw new Error("Expected test value to be present");
  }
  return value;
};

const streamAt = (streams: LiveStream[], index: number): LiveStream =>
  expectPresent(streams[index]);

const lockupView = (options: {
  contentId: string;
  channelId?: string;
  title: string;
  badge?: { text: string; iconName: string; badgeStyle: string };
  duration?: string;
  history?: string;
}) => {
  const overlayBadge = options.badge
    ? {
        text: options.badge.text,
        icon_name: options.badge.iconName,
        badge_style: options.badge.badgeStyle,
      }
    : options.duration
      ? {
          text: options.duration,
          badge_style: "THUMBNAIL_OVERLAY_BADGE_STYLE_DEFAULT",
        }
      : null;

  return {
    type: "LockupView" as const,
    content_type: "VIDEO" as const,
    content_id: options.contentId,
    ...(options.channelId ? { author: { id: options.channelId } } : {}),
    metadata: {
      title: { text: options.title },
      metadata: {
        metadata_rows: options.history
          ? [
              {
                metadata_parts: [{ text: { text: options.history } }],
                badges: [],
              },
            ]
          : [],
      },
    },
    content_image: {
      overlays: overlayBadge ? [{ badges: [overlayBadge] }] : [],
    },
  };
};

describe("YouTube Live Stream Service - Complete User Experience", () => {
  it("never requests a channel for an invalid resolver browse ID", async () => {
    const getChannel = vi.fn<(...args: [string]) => Promise<ChannelLike>>().mockResolvedValue({ videos: [] });
    YouTubeLiveStreamService._channelCache.clear();
    const result = await YouTubeLiveStreamService.getLiveStreams({ getChannel, resolveURL: async () => ({ payload: { browseId: "PLsynthetic-playlist" } }) }, "@synthetic", { logger: noOpLogger });
    expect(result.observationKind).toBe("unavailable");
    expect(getChannel).not.toHaveBeenCalled();
    expect(YouTubeLiveStreamService._channelCache.size).toBe(0);
    const resolveURL = vi.fn<(...args: [string]) => Promise<ResolveUrlResult>>();
    expect((await YouTubeLiveStreamService.getLiveStreams({ getChannel, resolveURL }, "雪".repeat(129), { logger: noOpLogger })).observationKind).toBe("unavailable");
    expect(resolveURL).not.toHaveBeenCalled();
    expect(getChannel).not.toHaveBeenCalled();
  });

  it("re-resolves a poisoned cache entry before channel acquisition", async () => {
    const channelId = "UC" + "a".repeat(22);
    YouTubeLiveStreamService._channelCache.set("synthetic", { channelId: "PLsynthetic-playlist", timestamp: testClock.now() });
    const getChannel = vi.fn<(...args: [string]) => Promise<ChannelLike>>().mockResolvedValue({ videos: [], getLiveStreams: async () => ({ videos: [] }) });
    const resolveURL = vi.fn<(...args: [string]) => Promise<ResolveUrlResult>>().mockResolvedValue({ payload: { browseId: channelId } });
    await YouTubeLiveStreamService.getLiveStreams({ getChannel, resolveURL }, "@synthetic", { logger: noOpLogger });
    expect(resolveURL).toHaveBeenCalledTimes(1);
    expect(getChannel).toHaveBeenCalledWith(channelId);
    expect(YouTubeLiveStreamService._channelCache.get("synthetic")?.channelId).toBe(channelId);
  });

  it("bounds channel cache insertion order to 64 entries and honors the existing TTL", async () => {
    YouTubeLiveStreamService._channelCache.clear();
    const channelId = "UC" + "b".repeat(22);
    const resolveURL = vi.fn<(...args: [string]) => Promise<ResolveUrlResult>>().mockResolvedValue({ payload: { browseId: channelId } });
    const client = { resolveURL, getChannel: async () => ({ videos: [], getLiveStreams: async () => ({ videos: [] }) }) };
    for (let index = 0; index < 65; index++) await YouTubeLiveStreamService.getLiveStreams(client, `@synthetic${index}`, { logger: noOpLogger });
    expect(YouTubeLiveStreamService._channelCache.size).toBe(64);
    expect(YouTubeLiveStreamService._channelCache.has("synthetic0")).toBe(false);
    expect(YouTubeLiveStreamService._channelCache.has("synthetic64")).toBe(true);
    await YouTubeLiveStreamService.getLiveStreams(client, "@synthetic64", { logger: noOpLogger });
    expect(resolveURL).toHaveBeenCalledTimes(65);
    const entry = YouTubeLiveStreamService._channelCache.get("synthetic64");
    if (!entry) throw new Error("Expected synthetic cache entry");
    entry.timestamp = testClock.now() - YouTubeLiveStreamService._channelCacheTtl;
    await YouTubeLiveStreamService.getLiveStreams(client, "@synthetic64", { logger: noOpLogger });
    expect(resolveURL).toHaveBeenCalledTimes(66);
  });

  it("marks caught parser failures unavailable and retains positive secondary observations", async () => {
    const channelId = "UC" + "c".repeat(22);
    const failed = await YouTubeLiveStreamService.getLiveStreamsWithParserTolerance({ getChannel: async () => { throw new Error("YOUTUBEJS Parser synthetic failure"); } }, channelId, { logger: noOpLogger });
    expect(failed).toMatchObject({ success: false, observationKind: "unavailable", qualityReason: "parser_error", parserError: true, streams: [] });
    const partial = await YouTubeLiveStreamService.getLiveStreamsWithParserTolerance({ getChannel: async () => ({ videos: [{ id: "synthetic-live", is_live: true, author: { id: channelId } }], getLiveStreams: async () => { throw new Error("Parser synthetic failure"); } }) }, channelId, { logger: noOpLogger });
    expect(partial).toMatchObject({ success: true, observationKind: "partial", qualityReason: "parser_error", parserError: true, videoIds: ["synthetic-live"] });
    const ordinary = await YouTubeLiveStreamService.getLiveStreamsWithParserTolerance({ getChannel: async () => { throw new Error("synthetic network failure"); } }, channelId, { logger: noOpLogger });
    expect(ordinary.qualityReason).toBe("acquisition_failed");
    expect(ordinary.parserError).not.toBe(true);
  });

  describe("parser classification independent of earlier discovery quality reasons", () => {
    const channelId = "UC" + "k".repeat(22);
    const parserFailure = async (): Promise<never> => { throw new Error("Parser synthetic secondary failure"); };
    const cases = [
      { channel: { getLiveStreams: parserFailure }, qualityReason: "malformed_collection", observationKind: "unavailable", success: false, videoIds: [] },
      { channel: { videos: [] }, qualityReason: "missing_capability", observationKind: "partial", success: false, videoIds: [] },
      { channel: { videos: [null, { id: "synthetic-retained-live", is_live: true, author: { id: channelId } }], getLiveStreams: parserFailure }, qualityReason: "malformed_collection", observationKind: "partial", success: true, videoIds: ["synthetic-retained-live"] },
    ];
    for (const [index, fixture] of cases.entries()) it(`retains secondary parser classification for mixed-quality case ${index}`, async () => {
      const warnings: unknown[][] = [];
      const client = { getChannel: async () => fixture.channel, search: parserFailure } as InnertubeClient;
      const result = await YouTubeLiveStreamService.getLiveStreamsWithParserTolerance(client, channelId, {
        logger: { ...noOpLogger, warn: (...args: unknown[]) => { warnings.push(args); } },
      });
      expect(result).toMatchObject({ success: fixture.success, observationKind: fixture.observationKind, qualityReason: fixture.qualityReason, parserError: true, videoIds: fixture.videoIds });
      expect(warnings).toHaveLength(1);
      expect(JSON.stringify(warnings)).toContain("parser error; discovery is incomplete");
    });
  });
  it("rejects historical live content without a current-live signal", () => {
    expect(YouTubeLiveStreamService.isVideoLive({ is_live_content: true })).toBe(false);
    expect(YouTubeLiveStreamService.isVideoLive({ is_live: true })).toBe(true);
    expect(YouTubeLiveStreamService.isVideoLive({ is_live: true, is_upcoming: true })).toBe(false);
    expect(YouTubeLiveStreamService.isVideoLive({ is_live: true, end_timestamp: "synthetic-ended" })).toBe(false);
  });

  let mockInnertubeClient: MockInnertubeClient;

  beforeEach(() => {
    mockInnertubeClient = {
      getChannel: vi.fn<(...args: [string]) => Promise<ChannelLike>>(),
      search: vi.fn<(...args: [string, Record<string, unknown>?]) => Promise<SearchResult>
      >(),
      resolveURL: vi.fn<(...args: [string]) => Promise<ResolveUrlResult>>(),
    };
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("Live Stream Detection User Experience", () => {
    it("should map horizontal and vertical live LockupView channel entries", async () => {
      const channelId = "UClockup1234567890123456";
      const horizontal = lockupView({
        contentId: "lockup-horizontal-live",
        channelId,
        title: "Horizontal Live Newsroom",
        badge: {
          text: "LIVE",
          iconName: "LIVE",
          badgeStyle: "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE",
        },
      });
      const vertical = lockupView({
        contentId: "lockup-vertical-live",
        channelId,
        title: "Vertical Live Studio",
        badge: {
          text: "LIVE",
          iconName: "LIVE",
          badgeStyle: "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE",
        },
      });
      mockInnertubeClient.getChannel.mockResolvedValue({
        videos: [horizontal, vertical],
      });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger },
      );

      expect(result.streams).toHaveLength(2);
      expect(result.streams.map((stream) => stream.videoId)).toEqual([
        "lockup-horizontal-live",
        "lockup-vertical-live",
      ]);
      expect(result.streams.map((stream) => stream.title)).toEqual([
        "Horizontal Live Newsroom",
        "Vertical Live Studio",
      ]);
      expect(result.streams.every((stream) => stream.isLive)).toBe(true);
    });

    it("should exclude archived LockupView entries with duration and history metadata", async () => {
      const channelId = "UC" + "a".repeat(22);
      const archived = lockupView({
        contentId: "lockup-archived-video",
        channelId,
        title: "Yesterday's Archived Broadcast",
        duration: "42:18",
        history: "2 days ago",
      });
      mockInnertubeClient.getChannel.mockResolvedValue({
        videos: [archived],
      });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger },
      );

      expect(result.streams).toHaveLength(0);
      expect(result.hasContent).toBe(true);
    });

    it("should map live LockupView entries returned in the direct channel API videos array", async () => {
      const channelId = "UC" + "b".repeat(22);
      const apiLockup = lockupView({
        contentId: "lockup-api-live",
        title: "Direct API Live Session",
        badge: {
          text: "LIVE",
          iconName: "LIVE",
          badgeStyle: "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE",
        },
      });
      mockInnertubeClient.getChannel.mockResolvedValue({
        getLiveStreams: vi.fn<(...args: unknown[]) => Promise<{ videos: { type: "LockupView"; content_type: "VIDEO"; content_id: string; metadata: { title: { text: string; }; metadata: { metadata_rows: { metadata_parts: { text: { text: string; }; }[]; badges: never[]; }[]; }; }; content_image: { overlays: { badges: ({ text: string; icon_name: string; badge_style: string; } | { text: string; badge_style: string; icon_name?: never; })[]; }[]; }; }[]; }>>().mockResolvedValue({
          videos: [apiLockup],
        }),
      });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger },
      );

      expect(result.streams).toHaveLength(1);
      expect(streamAt(result.streams, 0).videoId).toBe("lockup-api-live");
      expect(streamAt(result.streams, 0).title).toBe("Direct API Live Session");
    });

    it("should merge unique live streams across channel feed and direct API", async () => {
      const channelId = "UC" + "c".repeat(22);
      const channelLive = {
        id: "live-a",
        title: { text: "Channel Feed Live A" },
        is_live: true,
      };
      const apiLiveB = {
        id: "live-b",
        title: { text: "Direct API Live B" },
        is_live: true,
      };
      const getLiveStreams = vi.fn<(...args: unknown[]) => Promise<{ videos: { id: string; title: { text: string; }; is_live: boolean; }[]; }>>().mockResolvedValue({
        videos: [channelLive, apiLiveB],
      });
      mockInnertubeClient.getChannel.mockResolvedValue({
        videos: [channelLive],
        getLiveStreams,
      });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger },
      );

      expect(getLiveStreams).toHaveBeenCalledTimes(1);
      expect(result.streams.map((stream) => stream.videoId)).toEqual([
        "live-a",
        "live-b",
      ]);
      expect(result.videoIds).toEqual(["live-a", "live-b"]);
      expect(result.count).toBe(2);
      expect(result.hasContent).toBe(true);
      expect(result.detectionMethod).toBe("channel_api");
      expect(mockInnertubeClient.search).not.toHaveBeenCalled();
    });

    it("should deduplicate repeated live LockupView entries", async () => {
      const channelId = "UC" + "d".repeat(22);
      const repeatedLive = lockupView({
        contentId: "repeated-lockup-live",
        channelId,
        title: "Repeated Live Session",
        badge: {
          text: "LIVE",
          iconName: "LIVE",
          badgeStyle: "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE",
        },
      });
      mockInnertubeClient.getChannel.mockResolvedValue({
        videos: [repeatedLive, repeatedLive],
      });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger },
      );

      expect(result.streams).toHaveLength(1);
      expect(streamAt(result.streams, 0).videoId).toBe("repeated-lockup-live");
    });

    it("should provide live streams when user requests active channel streams", async () => {
      const channelId = "UCactive1234567890123456";
      const mockChannel = {
        videos: [
            {
              id: "live123",
              title: { text: "Amazing Gaming Stream" },
              is_live: true,
              author: { id: channelId, name: "Popular Gamer" },
              published: new Date(testClock.now()).toISOString(),
            },
            {
              id: "live456",
              title: { text: "Music Live Performance" },
              is_live: true,
              author: { id: channelId, name: "Music Artist" },
              published: new Date(testClock.now()).toISOString(),
            },
          ],
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger, timeout: 2000 },
      );

      expect(result.success).toBe(true);
      expect(result.streams).toBeDefined();
      expect(result.streams).toHaveLength(2);
      expect(result.count).toBe(2);
      expect(result.hasContent).toBe(true);

      const firstStream = streamAt(result.streams, 0);
      const secondStream = streamAt(result.streams, 1);
      expect(firstStream.videoId).toBe("live123");
      expect(firstStream.title).toBe("Amazing Gaming Stream");
      expect(firstStream.isLive).toBe(true);
      expect(firstStream.author).toBe("Popular Gamer");

      expectNoTechnicalArtifacts(firstStream.title);
      expectNoTechnicalArtifacts(firstStream.author);
      expectNoTechnicalArtifacts(secondStream.title);
      expectNoTechnicalArtifacts(secondStream.author);

      validateUserFacingString(firstStream.title, {
        minLength: 5,
      });
      validateUserFacingString(secondStream.title, {
        minLength: 5,
      });
    });

    it("should still detect live streams when channel does not expose getLiveStreams()", async () => {
      const channelId = "UC" + "n".repeat(22);
      const mockChannel = {
        videos: [
            {
              id: "video789",
              title: { text: "Live Coding Marathon" },
              is_live: true,
              author: { id: channelId, name: "DevCreator" },
            },
          ],
        header: { title: "DevCreator" },
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(true);
      expect(result.streams).toHaveLength(1);
      expect(streamAt(result.streams, 0).videoId).toBe("video789");
      expect(result.detectionMethod).toBe("channel_videos");
      expect(mockInnertubeClient.search).not.toHaveBeenCalled();
    });

    it("should handle channel with no live streams gracefully for users", async () => {
      const channelId = "UCinactive12345678901234";
      const mockChannel = { videos: [], getLiveStreams: async () => ({ videos: [] }) };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);
      mockInnertubeClient.search.mockResolvedValue({ videos: [] });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(true);
      expect(result.streams).toHaveLength(0);
      expect(result.count).toBe(0);
      expect(result.hasContent).toBe(false);
      expect(result.streams).toBeDefined();
      expect(Array.isArray(result.streams)).toBe(true);
    });

    it("should fall back to search detection when channel data lacks live entries", async () => {
      const username = "fallbackCreator";
      const resolvedChannelId = "UC" + "f".repeat(22);
      const mockChannel = {
        videos: [],
        header: { title: "Fallback Creator" },
      };

      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);
      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: { browseId: resolvedChannelId },
      });
      mockInnertubeClient.search.mockResolvedValue({
        videos: [
          {
            id: "searchLive123",
            title: { text: "Live 🔴 Trading Session" },
            author: { id: resolvedChannelId, name: "Fallback Creator" },
            is_live: true,
          },
        ],
      });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        username,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(true);
      expect(result.streams).toHaveLength(1);
      expect(streamAt(result.streams, 0).videoId).toBe("searchLive123");
      expect(result.detectionMethod).toBe("search");
      expect(mockInnertubeClient.search).toHaveBeenCalledTimes(1);
    });

    it("should map and deduplicate owned live LockupView search entries", async () => {
      const username = "lockupSearchCreator";
      const resolvedChannelId = "UC" + "s".repeat(22);
      const baseSearchLockup = lockupView({
        contentId: "search-lockup-live",
        title: "Search Lockup Live Session",
        badge: {
          text: "LIVE",
          iconName: "LIVE",
          badgeStyle: "THUMBNAIL_OVERLAY_BADGE_STYLE_LIVE",
        },
      });
      const searchLockup = {
        ...baseSearchLockup,
        metadata: {
          ...baseSearchLockup.metadata,
          metadata: {
            metadata_rows: [
              {
                metadata_parts: [
                  {
                    text: {
                      text: "Synthetic playlist",
                      endpoint: { payload: { browseId: "VLsyntheticplaylist" } },
                    },
                  },
                  {
                    text: {
                      text: "Fallback Creator",
                      endpoint: { payload: { browseId: resolvedChannelId } },
                    },
                  },
                ],
                badges: [],
              },
            ],
          },
        },
      };

      mockInnertubeClient.getChannel.mockResolvedValue({ videos: [] });
      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: { browseId: resolvedChannelId },
      });
      mockInnertubeClient.search.mockResolvedValue({
        videos: [searchLockup, searchLockup],
      });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        username,
        { logger: noOpLogger },
      );

      expect(result.streams).toHaveLength(1);
      expect(streamAt(result.streams, 0).videoId).toBe("search-lockup-live");
      expect(streamAt(result.streams, 0).title).toBe(
        "Search Lockup Live Session",
      );
      expect(result.detectionMethod).toBe("search");
    });

    it("should reject similarly named live search results from another channel", async () => {
      const username = "news";
      const resolvedChannelId = "UC" + "r".repeat(22);
      mockInnertubeClient.getChannel.mockResolvedValue({ videos: [] });
      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: { browseId: resolvedChannelId },
      });
      mockInnertubeClient.search.mockResolvedValue({
        videos: [
          {
            id: "unrelated-live-video",
            title: { text: "Unrelated Live News" },
            author: {
              id: "UC" + "x".repeat(22),
              name: "Daily News Network",
            },
            is_live: true,
          },
        ],
      });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        username,
        { logger: noOpLogger },
      );

      expect(result.streams).toHaveLength(0);
      expect(result.hasContent).toBe(false);
    });

    it("should provide stream metadata for user content discovery", async () => {
      const channelId = "UCdiverse123456789012345";
      const mockChannel = {
        getLiveStreams: vi.fn<(...args: unknown[]) => Promise<{ videos: { id: string; title: { text: string; }; is_live: true; author: { name: string; }; published: string; view_count: string; }[]; }>>().mockResolvedValue({
          videos: [
            {
              id: "educational123",
              title: { text: "Learn JavaScript - Interactive Coding Session" },
              is_live: true,
              author: { name: "CodeEducator" },
              published: new Date(testClock.now()).toISOString(),
              view_count: "1,245 watching",
            },
          ],
        }),
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(true);
      const stream = streamAt(result.streams, 0);
      expect(stream.title).toBe(
        "Learn JavaScript - Interactive Coding Session",
      );
      expect(stream.author).toBe("CodeEducator");
      expect(stream.isLive).toBe(true);
      expect(stream.videoId).toBe("educational123");

      expectNoTechnicalArtifacts(stream.title);
      validateUserFacingString(stream.title, {
        minLength: 10,
        mustContain: ["JavaScript"],
      });
    });
  });

  describe("Input Format Flexibility User Experience", () => {
    it("should accept Channel ID format directly from users", async () => {
      const channelId = "UCaBcDeFgHiJkLmNoPqRsTuV";
      const mockChannel = {
        getLiveStreams: vi.fn<(...args: unknown[]) => Promise<{ videos: { id: string; title: { text: string; }; is_live: true; author: { name: string; }; }[]; }>>().mockResolvedValue({
          videos: [
            {
              id: "channelid123",
              title: { text: "Channel ID Stream" },
              is_live: true,
              author: { name: "Channel Author" },
            },
          ],
        }),
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(true);
      const stream = streamAt(result.streams, 0);
      expect(stream.videoId).toBe("channelid123");
      expect(stream.title).toBe("Channel ID Stream");

      expectNoTechnicalArtifacts(stream.title);
      expectNoTechnicalArtifacts(stream.author);
    });

    it("should resolve username input for user convenience", async () => {
      const username = "popularcreator";
      const resolvedChannelId = "UC" + "u".repeat(22);
      const mockChannel = {
        getLiveStreams: vi.fn<(...args: unknown[]) => Promise<{ videos: { id: string; title: { text: string; }; is_live: true; author: { name: string; }; }[]; }>>().mockResolvedValue({
          videos: [
            {
              id: "username123",
              title: { text: "Creator Live Stream" },
              is_live: true,
              author: { name: "Popular Creator" },
            },
          ],
        }),
      };

      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: { browseId: resolvedChannelId },
      });
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        username,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(true);
      const stream = streamAt(result.streams, 0);
      expect(stream.videoId).toBe("username123");
      expect(stream.title).toBe("Creator Live Stream");
      expect(stream.author).toBe("Popular Creator");
      expect(mockInnertubeClient.getChannel).toHaveBeenCalledWith(resolvedChannelId);

      expectNoTechnicalArtifacts(stream.title);
      validateUserFacingString(stream.author, {
        minLength: 5,
      });
    });

    it("should handle @username handle format for users", async () => {
      const handleInput = "@creativechannel";
      const resolvedChannelId = "UC" + "h".repeat(22);
      const mockChannel = {
        getLiveStreams: vi.fn<(...args: unknown[]) => Promise<{ videos: { id: string; title: { text: string; }; is_live: true; author: { name: string; }; }[]; }>>().mockResolvedValue({
          videos: [
            {
              id: "handle123",
              title: { text: "Creative Live Stream" },
              is_live: true,
              author: { name: "Creative Channel" },
            },
          ],
        }),
      };

      mockInnertubeClient.resolveURL.mockResolvedValue({
        payload: { browseId: resolvedChannelId },
      });
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        handleInput,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(true);
      const stream = streamAt(result.streams, 0);
      expect(stream.videoId).toBe("handle123");
      expect(stream.title).toBe("Creative Live Stream");

      expectNoTechnicalArtifacts(stream.title);
      expectNoTechnicalArtifacts(stream.author);
    });
  });

  describe("Error Handling User Experience", () => {
    it("should provide clear feedback when user input cannot be resolved", async () => {
      const nonExistentChannel = "nonexistentchannel";
      mockInnertubeClient.resolveURL.mockResolvedValue({ payload: {} });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        nonExistentChannel,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Channel not found");
      expect(result.streams).toHaveLength(0);
      expect(result.count).toBe(0);

      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, {
        minLength: 5,
        mustNotContain: ["undefined", "null", "API", "search"],
      });
    });

    it("should handle service errors gracefully for users", async () => {
      const channelId = "UCerrortest1234567890123";
      mockInnertubeClient.getChannel.mockRejectedValue(
        new Error("Service temporarily unavailable"),
      );

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        channelId,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Service temporarily unavailable");
      expect(result.streams).toHaveLength(0);

      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, {
        minLength: 10,
      });
    });

    it("should handle null/undefined Channel responses for users", async () => {
      const problematicChannelId = "UCnulltest12345678901234";
      mockInnertubeClient.getChannel.mockResolvedValue(null);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        problematicChannelId,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain("Channel not found");
      expect(result.error).toContain(problematicChannelId);
      expect(result.streams).toHaveLength(0);
      expect(expectPresent(result.error).length).toBeGreaterThan(20);
    });

    it("settles the actual discovery timeout and recovers on the next request", async () => {
      let release!: (channel: ChannelLike) => void;
      const heldChannel = new Promise<ChannelLike>(resolve => { release = resolve; });
      mockInnertubeClient.getChannel.mockImplementation(() => heldChannel);
      const operation = YouTubeLiveStreamService.getLiveStreams(mockInnertubeClient,
        "UCtimeout123456789012345", { logger: noOpLogger, timeout: 100 });
      const recoveredChannel = { getLiveStreams: async () => ({ videos: [{
        id: "synthetic-recovered-stream", title: { text: "Synthetic recovered stream" }, is_live: true,
        author: { name: "Synthetic Creator" },
      }] }) };
      try {
        // This outer bound rejects a hung operation; it cannot count as success.
        const result = await withTimeout(operation, 2000, "Synthetic discovery acceptance");
        expect(result.success).toBe(false);
        expect(result.error).toMatch(/timeout/i);
        expect(result.streams).toEqual([]);
        expect(mockInnertubeClient.getChannel).toHaveBeenCalledTimes(1);
        release(recoveredChannel);
        await heldChannel;
        mockInnertubeClient.getChannel.mockResolvedValue(recoveredChannel);
        const recovered = await withTimeout(YouTubeLiveStreamService.getLiveStreams(mockInnertubeClient,
          "UCtimeout123456789012345", { logger: noOpLogger, timeout: 100 }), 2000);
        expect(recovered).toMatchObject({ success: true, count: 1 });
        expect(recovered.streams.map(stream => stream.videoId)).toEqual(["synthetic-recovered-stream"]);
        expect(mockInnertubeClient.getChannel).toHaveBeenCalledTimes(2);
      } finally {
        release(recoveredChannel);
        await Promise.allSettled([heldChannel, operation]);
      }
    });
  });

  describe("International Content User Experience", () => {
    it("should handle international stream titles correctly for global users", async () => {
      const internationalChannelId = "UCinternational123456789";
      const mockChannel = {
        getLiveStreams: vi.fn<(...args: unknown[]) => Promise<{ videos: { id: string; title: { text: string; }; is_live: true; author: { name: string; }; }[]; }>>().mockResolvedValue({
          videos: [
            {
              id: "intl123",
              title: {
                text: "Live Stream - 中文直播 - العربية المباشرة - ライブ配信",
              },
              is_live: true,
              author: { name: "国际创作者 International Creator" },
            },
          ],
        }),
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        internationalChannelId,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(true);
      const stream = streamAt(result.streams, 0);
      expect(stream.title).toContain("中文直播");
      expect(stream.title).toContain("العربية المباشرة");
      expect(stream.title).toContain("ライブ配信");
      expect(stream.author).toContain("国际创作者");

      expectNoTechnicalArtifacts(stream.title);
      expectNoTechnicalArtifacts(stream.author);
    });

    it("should handle emoji-rich content for modern user expectations", async () => {
      const emojiChannelId = "UCemojichannel1234567890";
      const mockChannel = {
        getLiveStreams: vi.fn<(...args: unknown[]) => Promise<{ videos: { id: string; title: { text: string; }; is_live: true; author: { name: string; }; }[]; }>>().mockResolvedValue({
          videos: [
            {
              id: "emoji123",
              title: { text: "🎮 EPIC Gaming Stream! 🔥🚀 Join the Fun! 🎉✨" },
              is_live: true,
              author: { name: "GamerPro 🎮🏆" },
            },
          ],
        }),
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        emojiChannelId,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(true);
      const stream = streamAt(result.streams, 0);
      expect(stream.title).toContain("🎮");
      expect(stream.title).toContain("🔥");
      expect(stream.title).toContain("🎉");
      expect(stream.author).toContain("🎮");
      expect(stream.author).toContain("🏆");

      expectNoTechnicalArtifacts(stream.title);
      expectNoTechnicalArtifacts(stream.author);
      validateUserFacingString(stream.title, {
        minLength: 15,
      });
    });

    it("should preserve special characters in user content", async () => {
      const specialCharChannelId = "UCspecial123456789012345";
      const mockChannel = {
        getLiveStreams: vi.fn<(...args: unknown[]) => Promise<{ videos: { id: string; title: { text: string; }; is_live: true; author: { name: string; }; }[]; }>>().mockResolvedValue({
          videos: [
            {
              id: "special123",
              title: {
                text: 'Music & Arts: "Live Concert" — Café Sessions (50% Off!)',
              },
              is_live: true,
              author: { name: "Café Music & Arts™" },
            },
          ],
        }),
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        specialCharChannelId,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(true);
      const stream = streamAt(result.streams, 0);
      expect(stream.title).toContain("&");
      expect(stream.title).toContain('"');
      expect(stream.title).toContain("—");
      expect(stream.title).toContain("(");
      expect(stream.title).toContain("%");
      expect(stream.author).toContain("™");

      expectNoTechnicalArtifacts(stream.title);
      expectNoTechnicalArtifacts(stream.author);
    });
  });

  describe("Edge Cases and Resilience User Experience", () => {
    it("should handle empty/whitespace input gracefully for users", async () => {
      const emptyInputs = ["", "   ", "\t", "\n", null, undefined];

      for (const emptyInput of emptyInputs) {
        const result = await YouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          emptyInput,
          { logger: noOpLogger },
        );

        expect(result.success).toBe(false);
        expect(result.streams).toHaveLength(0);
        expect(result.error).toBeDefined();

        if (result.error) {
          expect(result.error.length).toBeGreaterThan(5);
          expect(typeof result.error).toBe("string");
        }
      }
    });

    it("should handle very long input strings from users", async () => {
      const longInput = "very".repeat(100) + "longchannelname";
      mockInnertubeClient.resolveURL.mockResolvedValue({ payload: {} });

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        longInput,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Channel not found");
      expect(result.streams).toHaveLength(0);

      expectNoTechnicalArtifacts(result.error);
    });

    it("should handle malformed Channel ID format gracefully", async () => {
      const malformedChannelId = "UCinvalidformat123456789";
      mockInnertubeClient.getChannel.mockRejectedValue(
        new Error("Invalid channel format"),
      );

      const result = await YouTubeLiveStreamService.getLiveStreams(
        mockInnertubeClient,
        malformedChannelId,
        { logger: noOpLogger },
      );

      expect(result.success).toBe(false);
      expect(result.error).toBe("Invalid channel format");
      expect(result.streams).toHaveLength(0);

      expectNoTechnicalArtifacts(result.error);
      validateUserFacingString(result.error, {
        minLength: 5,
      });
    });

    it("should maintain consistent response structure across all scenarios", async () => {
      const testScenarios = [
        {
          name: "successful_streams",
          setupMock: () => {
            const mockChannel = {
              getLiveStreams: vi.fn<(...args: unknown[]) => Promise<{ videos: { id: string; title: { text: string; }; is_live: true; author: { name: string; }; }[]; }>>().mockResolvedValue({
                videos: [
                  {
                    id: "test",
                    title: { text: "Test" },
                    is_live: true,
                    author: { name: "Test" },
                  },
                ],
              }),
            };
            mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);
          },
          input: "UCconsistent123456789012",
        },
        {
          name: "no_streams",
          setupMock: () => {
            const mockChannel = {
              getLiveStreams: vi.fn<(...args: unknown[]) => Promise<{ videos: never[]; }>>().mockResolvedValue({ videos: [] }),
            };
            mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);
          },
          input: "UCempty1234567890123456",
        },
        {
          name: "channel_not_found",
          setupMock: () => {
            mockInnertubeClient.resolveURL.mockResolvedValue({ payload: {} });
          },
          input: "nonexistent",
        },
      ];

      for (const scenario of testScenarios) {
        vi.clearAllMocks();
        scenario.setupMock();

        const result = await YouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          scenario.input,
          { logger: noOpLogger },
        );

        expect(result).toHaveProperty("success");
        expect(result).toHaveProperty("streams");
        expect(result).toHaveProperty("count");
        expect(Array.isArray(result.streams)).toBe(true);
        expect(typeof result.success).toBe("boolean");
        expect(typeof result.count).toBe("number");

        if (!result.success) {
          expect(result).toHaveProperty("error");
          expect(typeof result.error).toBe("string");
          expectNoTechnicalArtifacts(result.error);
        }

        expect(result.count).toBe(result.streams.length);
      }
    });
  });

  describe("Service Reliability User Experience", () => {
    it("should provide reliable service behavior for repeat users", async () => {
      const reliableChannelId = "UCreliable12345678901234";
      const mockChannel = {
        getLiveStreams: vi.fn<(...args: unknown[]) => Promise<{ videos: { id: string; title: { text: string; }; is_live: true; author: { name: string; }; }[]; }>>().mockResolvedValue({
          videos: [
            {
              id: "reliable123",
              title: { text: "Reliable Stream Content" },
              is_live: true,
              author: { name: "Reliable Creator" },
            },
          ],
        }),
      };
      mockInnertubeClient.getChannel.mockResolvedValue(mockChannel);

      const requestCount = 5;
      const results: LiveStreamResult[] = [];

      for (let i = 0; i < requestCount; i++) {
        const result = await YouTubeLiveStreamService.getLiveStreams(
          mockInnertubeClient,
          reliableChannelId,
          { logger: noOpLogger },
        );
        results.push(result);
      }

      results.forEach((result) => {
        expect(result.success).toBe(true);
        expect(result.streams).toHaveLength(1);
        const stream = streamAt(result.streams, 0);
        expect(stream.videoId).toBe("reliable123");
        expect(stream.title).toBe("Reliable Stream Content");

        expectNoTechnicalArtifacts(stream.title);
        expectNoTechnicalArtifacts(stream.author);
      });

      expect(results.every((r) => r.success)).toBe(true);
      expect(results.every((r) => r.count === 1)).toBe(true);
    });

    it("returns the same exact stream across three completed discovery requests", async () => {
      mockInnertubeClient.getChannel.mockResolvedValue({ getLiveStreams: async () => ({ videos: [{
        id: "synthetic-repeat-stream", title: { text: "Synthetic repeated stream" }, is_live: true,
        author: { name: "Synthetic Creator" },
      }] }) });
      for (let index = 0; index < 3; index++) {
        const result = await YouTubeLiveStreamService.getLiveStreams(mockInnertubeClient,
          "UCperformance12345678901", { logger: noOpLogger });
        expect(result.success).toBe(true);
        expect(result.count).toBe(1);
        expect(result.streams).toHaveLength(1);
        expect(streamAt(result.streams, 0)).toMatchObject({ videoId: "synthetic-repeat-stream",
          title: "Synthetic repeated stream", author: "Synthetic Creator" });
      }
      expect(mockInnertubeClient.getChannel).toHaveBeenCalledTimes(3);
    });
  });
});
