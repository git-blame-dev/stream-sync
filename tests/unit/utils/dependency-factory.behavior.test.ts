import { describe, expect, beforeEach, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { DependencyFactory } from "../../../src/utils/dependency-factory";
import {
  _resetForTesting,
  initializeStaticSecrets,
} from "../../../src/core/secrets";
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
    it("builds youtubei dependencies with deferred stream detection service", () => {
      const InnertubeClass = {
        create: createMockFn().mockResolvedValue({
          search: createMockFn().mockResolvedValue({ results: [] }),
          getChannel: createMockFn().mockResolvedValue({ videos: [] }),
        }),
      };

      const deps = factory.createYoutubeDependencies(
        {
          enableAPI: false,
          username: "test-channel",
          streamDetectionMethod: "youtubei",
        },
        {
          logger: noOpLogger,
          config: configFixture,
          Innertube: InnertubeClass,
        },
      );

      expect(typeof deps.streamDetectionService.detectLiveStreams).toBe(
        "function",
      );
      expect(deps.streamDetectionService.getUsageMetrics()).toEqual({
        totalRequests: 0,
        successfulRequests: 0,
        failedRequests: 0,
        averageResponseTime: 0,
        errorRate: 0,
        errorsByType: {},
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

    it("provides fallback TikTok event maps when connector enums are omitted", () => {
      const deps = factory.createTiktokDependencies(
        { username: "test-user" },
        {
          logger: noOpLogger,
          config: configFixture,
          TikTokWebSocketClient: function MockTikTokClient() {},
        },
      );

      expect(deps.WebcastEvent.CHAT).toBe("chat");
      expect(deps.ControlEvent.CONNECTED).toBe("connected");
      expect(typeof deps.WebcastPushConnection).toBe("function");
    });
  });
});
