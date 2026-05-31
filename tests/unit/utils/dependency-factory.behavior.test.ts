import { describe, expect, beforeEach, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { DependencyFactory } from "../../../src/utils/dependency-factory";
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
    restoreAllMocks();
    _resetForTesting();
    initializeStaticSecrets();
  });

  describe("YouTube dependency validation", () => {
    it("requires API key when YouTube API is enabled", () => {
      _resetForTesting();
      expect(() =>
        factory.createYoutubeDependencies(
          {
            enableAPI: true,
            username: "channel",
          },
          { logger: noOpLogger, config: configFixture },
        ),
      ).toThrow(/YouTube API key is required/);
    });

    it("creates dependencies object with expected structure when config is valid", () => {
      const deps = factory.createYoutubeDependencies(
        {
          enableAPI: false,
          username: "channel",
        },
        { logger: noOpLogger, config: configFixture },
      );

      expect(deps).toHaveProperty("apiClient");
      expect(deps).toHaveProperty("connectionManager");
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

  describe("Strictness migration behavior", () => {
    it("lazily creates and caches Innertube for youtubei stream detection", async () => {
      const getChannel = createMockFn<
        [string],
        Promise<{
          videos: {
            contents: Array<{
              id: string;
              title: { text: string };
              is_live: boolean;
              author: { name: string };
            }>;
          };
        }>
      >().mockResolvedValue({
        videos: {
          contents: [
            {
              id: "liveVideo01",
              title: { text: "Test live stream" },
              is_live: true,
              author: { name: "Test Channel" },
            },
          ],
        },
      });
      const createInnertube = createMockFn<[], Promise<{
        search: () => Promise<{ results: never[] }>;
        getChannel: typeof getChannel;
      }>>().mockResolvedValue({
        search: createMockFn().mockResolvedValue({ results: [] }),
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

    it("provides fallback TikTok event maps when connector enums are omitted", () => {
      function MockTikTokClient(this: Record<string, unknown>) {}

      const deps = factory.createTiktokDependencies(
        { username: "test-user" },
        {
          logger: noOpLogger,
          config: configFixture,
            TikTokWebSocketClient: MockTikTokClient,
        },
      );

      const webcastEvent = deps.WebcastEvent as { CHAT: string };
      const controlEvent = deps.ControlEvent as { CONNECTED: string };

      expect(webcastEvent.CHAT).toBe("chat");
      expect(controlEvent.CONNECTED).toBe("connected");
      expect(typeof deps.WebcastPushConnection).toBe("function");
    });
  });
});
