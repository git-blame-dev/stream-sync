import { vi, describe, expect, beforeEach, it, afterEach } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import { DependencyFactory } from "../../../src/utils/dependency-factory";
import { YouTubeStreamDetectionService } from "../../../src/services/youtube-stream-detection-service";
import {
  _resetForTesting,
  initializeStaticSecrets,
} from "../../../src/core/secrets";
type YoutubeDependencyOverrides = NonNullable<Parameters<DependencyFactory["createYoutubeDependencies"]>[1]>;
type InnertubeDependency = NonNullable<YoutubeDependencyOverrides["Innertube"]>;

describe("DependencyFactory behavior", () => {
  let factory: InstanceType<typeof DependencyFactory>;
  let configFixture: {
    general: { ignoreSelfMessages: boolean };
    twitch: { ignoreSelfMessages: boolean };
    youtube: { ignoreSelfMessages: boolean };
    tiktok: { ignoreSelfMessages: boolean };
  };

  beforeEach(() => {
    factory = new DependencyFactory();
    configFixture = {
      general: { ignoreSelfMessages: false },
      twitch: { ignoreSelfMessages: false },
      youtube: { ignoreSelfMessages: false },
      tiktok: { ignoreSelfMessages: false },
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
    _resetForTesting();
    initializeStaticSecrets();
  });

  describe("YouTube dependency validation", () => {
    it("returns an explicitly caller-owned service when no root owner is injected", async () => {
      let creations = 0;
      const deps = factory.createYoutubeDependencies({ username: "synthetic-channel" }, {
        logger: noOpLogger,
        config: configFixture,
        Innertube: { create: async () => {
          creations += 1;
          return { getInfo: async () => ({}) };
        } },
      });
      expect(creations).toBe(0);
      try {
        await Promise.all([
          deps.innertubeService.withMetadataOperation({}, client => client.getInfo("synthetic-one")),
          deps.innertubeService.withMetadataOperation({}, client => client.getInfo("synthetic-two")),
        ]);
        expect(creations).toBe(1);
      } finally {
        await deps.innertubeService.dispose();
      }
      expect(() => deps.innertubeService.withMetadataOperation({}, async () => true)).toThrow("disposed");
    });

    it("routes default and explicit youtubei discovery and viewer reads through the reused root owner", async () => {
      const channelId = "UC" + "s".repeat(22);
      const reads: string[] = [];
      let creations = 0;
      const root = factory.createYoutubeInnertubeService({
        logger: noOpLogger,
        Innertube: { create: async () => {
          creations += 1;
          return {
            getInfo: async (videoId: string) => {
              reads.push(videoId);
              return { page: [{}, { current_video_endpoint: { payload: { videoId } } }], basic_info: { id: videoId }, primary_info: { view_count: { is_live: true, original_view_count: 37 } } };
            },
            getChannel: async (id: string) => {
              reads.push(id);
              return { getLiveStreams: async () => ({ videos: [{
                id: "test0000001", title: "Synthetic stream", is_live: true,
                author: { id: channelId, name: "Synthetic channel" },
              }] }) };
            },
            search: async () => ({ videos: [] }),
          };
        } },
      });
      try {
        for (const streamDetectionMethod of [undefined, "youtubei"]) {
          const deps = factory.createYoutubeDependencies(
            { username: "synthetic-channel", ...(streamDetectionMethod ? { streamDetectionMethod } : {}) },
            { logger: noOpLogger, config: configFixture, innertubeService: root },
          );
          const discovery = await (deps.streamDetectionService as YouTubeStreamDetectionService).detectLiveStreams(channelId);
          expect(discovery.success).toBe(true);
          expect(discovery.videoIds).toEqual(["test0000001"]);
          expect(await deps.viewerExtractionService.extractViewerCount("test0000001")).toMatchObject({ success: true, count: 37 });
        }
        expect(creations).toBe(1);
        expect(reads).toEqual([channelId, "test0000001", channelId, "test0000001"]);
      } finally {
        await root.dispose();
      }
      expect(() => root.withMetadataOperation({}, async () => true)).toThrow("disposed");
    });
    it("rejects unsupported YouTube API mode", () => {
      _resetForTesting();
      expect(() =>
        factory.createYoutubeDependencies(
          {
            enableAPI: true,
            username: "channel",
          },
          { logger: noOpLogger, config: configFixture },
        ),
      ).toThrow(/YouTube Data API.*not supported/);
    });

    it("creates dependencies object with expected structure when config is valid", () => {
      const deps = factory.createYoutubeDependencies(
        {
          enableAPI: false,
          username: "channel",
        },
        { logger: noOpLogger, config: configFixture },
      );

      expect(deps).toHaveProperty("innertubeFactory");
    });
  });

  describe("Twitch dependency validation", () => {
    it("requires Twitch channel", () => {
      const twitchAuth = { isReady: () => true };
      expect(() =>
        factory.createTwitchDependencies(
          {},
          { logger: noOpLogger, config: configFixture, twitchAuth },
        ),
      ).toThrow(/Twitch channel is required/);
    });

    it("requires twitchAuth to be injected", () => {
      expect(() =>
        factory.createTwitchDependencies(
          { channel: "me" },
          { logger: noOpLogger, config: configFixture },
        ),
      ).toThrow(/createTwitchDependencies requires twitchAuth/);
    });
  });

  describe("Dependency strictness behavior", () => {
    it("lazily creates and caches Innertube for youtubei stream detection", async () => {
      const getChannel = vi.fn<(...args: [string]) => Promise<{
          videos: Array<{
            id: string;
            title: { text: string };
            is_live: boolean;
            author: { name: string; id: string };
          }>;
        }>
      >().mockResolvedValue({
        videos: [
          {
            id: "liveVideo01",
            title: { text: "Test live stream" },
            is_live: true,
            author: { name: "Synthetic Channel", id: "UCabcdefghijklmnopqrstuv" },
          },
        ],
      });
      const createInnertube = vi.fn<(...args: []) => Promise<{
        getInfo: () => Promise<Record<string, unknown>>;
        search: () => Promise<{ results: never[] }>;
        getChannel: typeof getChannel;
      }>>().mockResolvedValue({
        getInfo: async () => ({}),
        search: vi.fn<(...args: unknown[]) => Promise<{ results: never[]; }>>().mockResolvedValue({ results: [] }),
        getChannel,
      });
      const InnertubeClass = { create: createInnertube };

      const deps = factory.createYoutubeDependencies(
        {
          enableAPI: false,
          username: "test-channel",
          streamDetectionMethod: "youtubei",
        },
        {
          logger: noOpLogger,
          config: configFixture,
          Innertube: InnertubeClass as InnertubeDependency,
        },
      );

      const streamDetectionService = deps.streamDetectionService as {
        detectLiveStreams: (
          channel: string,
        ) => Promise<{ success: boolean; videoIds: string[] }>;
        getUsageMetrics: () => Record<string, unknown>;
      };

      expect(typeof streamDetectionService.detectLiveStreams).toBe(
        "function",
      );
      expect(createInnertube).toHaveBeenCalledTimes(0);
      expect(streamDetectionService.getUsageMetrics()).toEqual({
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        errorRate: 0,
        errorsByType: {},
      });

      const firstResult = await streamDetectionService.detectLiveStreams(
        "UCabcdefghijklmnopqrstuv",
      );
      const secondResult = await streamDetectionService.detectLiveStreams(
        "UCabcdefghijklmnopqrstuv",
      );

      expect(firstResult.success).toBe(true);
      expect(secondResult.videoIds).toEqual(["liveVideo01"]);
      expect(createInnertube).toHaveBeenCalledTimes(1);
      expect(getChannel).toHaveBeenCalledTimes(2);
      expect(streamDetectionService.getUsageMetrics()).toMatchObject({
        totalRequests: 2,
        successfulRequests: 2,
        failedRequests: 0,
      });
    });

    it("throws when TikTok websocket client dependency is missing", () => {
      expect(() =>
        factory.createTiktokDependencies(
          { username: "test-user" },
          {
            logger: noOpLogger,
            config: configFixture,
            TikTokWebSocketClient: {},
          },
        ),
      ).toThrow(/Missing TikTok dependencies: TikTokWebSocketClient/);
    });

    it("provides only the current client contract without manufactured connector dependencies", () => {
      function MockTikTokClient(this: Record<string, unknown>) {}

      const deps = factory.createTiktokDependencies(
        { username: "test-user" },
        {
          logger: noOpLogger,
          config: configFixture,
            TikTokWebSocketClient: MockTikTokClient,
        },
      );

      expect(deps.TikTokWebSocketClient).toBe(MockTikTokClient);
      for (const obsolete of ['WebcastEvent', 'ControlEvent', 'WebcastPushConnection', 'tiktokConnector', 'modulePreloader']) {
        expect(deps).not.toHaveProperty(obsolete);
      }
    });
  });
});
