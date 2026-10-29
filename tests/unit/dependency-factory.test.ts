import { describe, expect, beforeEach, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { DependencyFactory } from "../../src/utils/dependency-factory";
import { NotificationManager } from "../../src/notifications/NotificationManager";
import { TwitchAuth } from "../../src/auth/TwitchAuth";
import { TikTokWebSocketClient } from "../../src/platforms/tiktok-websocket-client";
import { YouTubeStreamDetectionService } from "../../src/services/youtube-stream-detection-service";
import { createMainPresentationFixture } from "../helpers/main-presentation-fixture";
import { PlatformConnectionFactory } from "../../src/utils/platform-connection-factory";
import {
  secrets,
  _resetForTesting,
  initializeStaticSecrets,
} from "../../src/core/secrets";

type TikTokConnectionCtor = new (
  username: string,
  config: Record<string, unknown>,
) => Record<string, unknown>;

function expectRecordProperty<K extends string>(
  value: unknown,
  key: K,
): asserts value is Record<K, unknown> {
  expect(value).toHaveProperty(key);
  if (!value || typeof value !== "object" || !(key in value)) {
    throw new Error(`Expected object to contain ${key}`);
  }
}

function expectTikTokClientConstructor(
  value: unknown,
): asserts value is TikTokConnectionCtor {
  expect(typeof value).toBe("function");
  if (typeof value !== "function") {
    throw new Error("Expected TikTokWebSocketClient constructor");
  }
}

describe("DependencyFactory", () => {
  afterEach(async () => {
    try {
      await Promise.all([...owners.map(owner => owner.dispose()), twitchAuth.dispose()]);
    } finally {
      owners = [];
      restoreAllMocks();
      _resetForTesting();
      initializeStaticSecrets();
    }
  });

  let owners: Array<{ dispose: () => Promise<void> }> = [];
  let twitchAuth: TwitchAuth;
  let factory: InstanceType<typeof DependencyFactory>;
  let configFixture: {
    general: { ignoreSelfMessages: boolean };
    youtube: {
      username: string;
      enabled: boolean;
      ignoreSelfMessages: boolean;
    };
    tiktok: {
      username: string;
      enabled: boolean;
      ignoreSelfMessages: boolean;
    };
    twitch: {
      channel?: string;
      clientId: string;
      accessToken: string;
      refreshToken: string;
      enabled: boolean;
      ignoreSelfMessages: boolean;
    };
  };

  beforeEach(() => {
    factory = new DependencyFactory();
    twitchAuth = new TwitchAuth({ tokenStorePath: "", clientId: "synthetic-client", logger: factory.createValidatedLogger("twitch") });
    // Observe the real method so every successfully returned owner is retired.
    const createYoutubeDependencies = factory.createYoutubeDependencies.bind(factory);
    factory.createYoutubeDependencies = (...args) => {
      const result = createYoutubeDependencies(...args);
      owners.push(result.innertubeService);
      return result;
    };

    configFixture = {
      general: { ignoreSelfMessages: false },
      youtube: {
        username: "test-channel-username",
        enabled: true,
        ignoreSelfMessages: false,
      },
      tiktok: {
        username: "test-user",
        enabled: true,
        ignoreSelfMessages: false,
      },
      twitch: {
        channel: "test-channel",
        clientId: "client-id",
        accessToken: "access-token",
        refreshToken: "refresh-token",
        enabled: true,
        ignoreSelfMessages: false,
      },
    };
  });

  describe("createYoutubeDependencies", () => {
    it("should preserve supplied real root dependencies across platform factories", async () => {
      const root = await createMainPresentationFixture();
      root.config.logging.file.enabled = false;
      root.config.logging.chat.enabled = false;
      root.config.general.logChatMessages = false;
      try {
        expect(await root.start()).toMatchObject({ success: true });
        const notificationManager = root.runtime.notificationManager;
        expect(notificationManager).toBeInstanceOf(NotificationManager);
        const options = {
          notificationManager,
          config: configFixture,
        };

        const result = factory.createYoutubeDependencies(
          configFixture.youtube,
          options,
        );

        expect(result).toHaveProperty("logger");
        expect(result).toHaveProperty("streamDetectionService");

        expect(typeof result.logger.debug).toBe("function");
        expect(typeof result.logger.info).toBe("function");
        expect(typeof result.logger.warn).toBe("function");
        expect(typeof result.logger.error).toBe("function");
        expectRecordProperty(result, "notificationManager");
        expect(result.notificationManager).toBe(notificationManager);
        const tiktok = factory.createTiktokDependencies(configFixture.tiktok, options);
        const twitch = factory.createTwitchDependencies(configFixture.twitch, { ...options, twitchAuth });
        expectRecordProperty(tiktok, "notificationManager");
        expect(tiktok.notificationManager).toBe(notificationManager);
        expectRecordProperty(twitch, "notificationManager");
        expect(twitch.notificationManager).toBe(notificationManager);
        expect(twitch.twitchAuth).toBe(twitchAuth);
        // Dependency assembly accepts an auth owner; it does not initialize it.
        expect(twitchAuth.isReady()).toBe(false);
        expect(result.logger).toBe(tiktok.logger);
        expect(tiktok.logger).toBe(twitch.logger);
      } finally { await root.dispose(); }
    });

    it("should require config in options", () => {
      expect(() => {
        factory.createYoutubeDependencies(configFixture.youtube, {});
      }).toThrow("createYoutubeDependencies requires config object in options");
    });

    it("should create YouTube dependencies with proper validation", () => {
      const result = factory.createYoutubeDependencies(configFixture.youtube, {
        config: configFixture,
      });

      expect(result.logger).toBeDefined();
    });

    it("should pass options through to created dependencies", () => {
      const customOptions = {
        retryAttempts: 5,
        timeout: 30000,
        config: configFixture,
      };

      const result = factory.createYoutubeDependencies(
        configFixture.youtube,
        customOptions,
      );

      expectRecordProperty(result, "retryAttempts");
      expectRecordProperty(result, "timeout");
      expect(result.retryAttempts).toBe(5);
      expect(result.timeout).toBe(30000);
    });

    it("should reuse injected stream detection service without recreating it", async () => {
      const channelId = "UC" + "s".repeat(22);
      let creations = 0;
      const owner = factory.createYoutubeInnertubeService({
        Innertube: { create: async () => {
          creations += 1;
          return {
            getInfo: async () => ({ video_details: { concurrent_viewers: 37 } }),
            getChannel: async () => ({ getLiveStreams: async () => ({ videos: [{
              id: "synthetic-live", title: "Synthetic stream", is_live: true,
              author: { id: channelId, name: "Synthetic channel" },
            }] }) }),
            search: async () => ({ videos: [] }),
          };
        } },
      });
      owners.push(owner);
      const injectedService = new YouTubeStreamDetectionService(owner, { logger: factory.createValidatedLogger("youtube") });

      try {
        const result = factory.createYoutubeDependencies(configFixture.youtube, {
          streamDetectionService: injectedService,
          innertubeService: owner,
          config: configFixture,
        });
        expect(result.streamDetectionService).toBe(injectedService);
        expect(result.innertubeService).toBe(owner);
        const detection = await injectedService.detectLiveStreams(channelId);
        expect(detection).toMatchObject({ success: true, videoIds: ["synthetic-live"] });
        expect(await result.viewerExtractionService.extractViewerCount("synthetic-live")).toMatchObject({ success: true, count: 37 });
        expect(creations).toBe(1);
      } finally { await injectedService.cleanup(); }
    });
  });

  describe("createTiktokDependencies", () => {
    it("should create complete TikTok dependencies with all required services", () => {
      const options = {
        WebcastPushConnection: TikTokWebSocketClient,
        TikTokWebSocketClient,
        config: configFixture,
      };

      const result = factory.createTiktokDependencies(
        configFixture.tiktok,
        options,
      );

      expect(result).toHaveProperty("logger");
      expect(result).toHaveProperty("WebcastPushConnection");
      expect(result).toHaveProperty("TikTokWebSocketClient");
      expect(result).toHaveProperty("connectionFactory");

      expect(typeof result.logger.debug).toBe("function");
      expect(typeof result.logger.info).toBe("function");
      expect(typeof result.logger.warn).toBe("function");
      expect(typeof result.logger.error).toBe("function");
    });

    it("should require config in options", () => {
      expect(() => {
        factory.createTiktokDependencies(configFixture.tiktok, {});
      }).toThrow("createTikTokDependencies requires config object in options");
    });

    it("should create TikTok dependencies with proper validation", () => {
      const result = factory.createTiktokDependencies(configFixture.tiktok, {
        config: configFixture,
      });

      expect(result.logger).toBeDefined();
      expect(result.connectionFactory).toBeDefined();
    });

    it("should provide WebcastPushConnection from options", () => {
      const suppliedConstructor = TikTokWebSocketClient;
      const options = {
        WebcastPushConnection: suppliedConstructor,
        TikTokWebSocketClient,
        config: configFixture,
      };

      const result = factory.createTiktokDependencies(
        configFixture.tiktok,
        options,
      );

      expect(result.WebcastPushConnection).toBe(suppliedConstructor);
    });

    it("should expose the actual TikTok client to the actual connection factory", () => {
      const result = factory.createTiktokDependencies(configFixture.tiktok, {
        TikTokWebSocketClient,
        config: configFixture,
      });
      expect(result.TikTokWebSocketClient).toBe(TikTokWebSocketClient);
      expectTikTokClientConstructor(result.TikTokWebSocketClient);
      const platformFactory = new PlatformConnectionFactory(result.logger);
      const connection = platformFactory.createConnection("tiktok", configFixture.tiktok, {
        ...result, TikTokWebSocketClient: result.TikTokWebSocketClient,
      });
      expect(connection).toBeInstanceOf(TikTokWebSocketClient);
      if (!(connection instanceof TikTokWebSocketClient)) throw new Error("Expected actual TikTok client");
      try {
        expect(connection.username).toBe(configFixture.tiktok.username);
        expect(connection.isConnected).toBe(false);
        expect(connection.isConnecting).toBe(false);
      } finally { connection.disconnect(); }
    });
  });

  describe("createTwitchDependencies", () => {
    it("should create complete Twitch dependencies with all required services", () => {
      const options = {
        config: configFixture,
        twitchAuth,
      };

      const result = factory.createTwitchDependencies(
        configFixture.twitch,
        options,
      );

      expect(result).toHaveProperty("logger");
      expect(result).toHaveProperty("twitchAuth");

      expect(typeof result.logger.debug).toBe("function");
      expect(typeof result.logger.info).toBe("function");
      expect(typeof result.logger.warn).toBe("function");
      expect(typeof result.logger.error).toBe("function");
    });

    it("should require config in options", () => {
      expect(() => {
        factory.createTwitchDependencies(configFixture.twitch, { twitchAuth });
      }).toThrow("createTwitchDependencies requires config object in options");
    });

    it("should validate Twitch configuration before creating dependencies", () => {
      const invalidConfig = { enabled: true };

      expect(() => {
        factory.createTwitchDependencies(invalidConfig, {
          config: configFixture,
          twitchAuth,
        });
      }).toThrow("Twitch channel is required");
    });

    it("should create Twitch dependencies with proper validation", () => {
      const result = factory.createTwitchDependencies(configFixture.twitch, {
        config: configFixture,
        twitchAuth,
      });

      expect(result.logger).toBeDefined();
      expect(result.twitchAuth).toBeDefined();
    });

    it("should validate Twitch channel configuration", () => {
      const configWithoutChannel = { ...configFixture.twitch };
      delete configWithoutChannel.channel;

      expect(() => {
        factory.createTwitchDependencies(configWithoutChannel, {
          config: configFixture,
          twitchAuth,
        });
      }).toThrow("Twitch channel is required");
    });

    it("should require twitchAuth when missing", () => {
      expect(() => {
        factory.createTwitchDependencies(configFixture.twitch, {
          config: configFixture,
        });
      }).toThrow("createTwitchDependencies requires twitchAuth");
    });
  });

  describe("createValidatedLogger", () => {
    it("should create a logger with all required methods", () => {
      const logger = factory.createValidatedLogger("test");

      expect(typeof logger.debug).toBe("function");
      expect(typeof logger.info).toBe("function");
      expect(typeof logger.warn).toBe("function");
      expect(typeof logger.error).toBe("function");
    });

    it("should return a shared logger instance for different types", () => {
      const logger1 = factory.createValidatedLogger("youtube");
      const logger2 = factory.createValidatedLogger("tiktok");

      expect(logger1).toBe(logger2);
    });

    it("should validate logger interface after creation", () => {
      const logger = factory.createValidatedLogger("test");

      expect(() => {
        factory.validateDependencyInterface(logger, "logger");
      }).not.toThrow();
    });

    it("should handle logger creation failures gracefully", () => {
      expect(() => {
        factory.createValidatedLogger(null);
      }).toThrow("Logger type is required");
    });
  });

  describe("validateDependencyInterface", () => {
    it("should validate logger interface correctly", () => {
      const validLogger = {
        debug: createMockFn(),
        info: createMockFn(),
        warn: createMockFn(),
        error: createMockFn(),
      };

      expect(() => {
        factory.validateDependencyInterface(validLogger, "logger");
      }).not.toThrow();
    });

    it("should reject invalid logger interface", () => {
      const invalidLogger = {
        debug: createMockFn(),
        info: createMockFn(),
      };

      expect(() => {
        factory.validateDependencyInterface(invalidLogger, "logger");
      }).toThrow("Logger interface validation failed");
    });

    it("should validate notification manager interface", () => {
      const validNotificationManager = {
        emit: createMockFn(),
        on: createMockFn(),
        removeListener: createMockFn(),
      };

      expect(() => {
        factory.validateDependencyInterface(
          validNotificationManager,
          "notificationManager",
        );
      }).not.toThrow();
    });

    it("should reject invalid notification manager interface", () => {
      const invalidNotificationManager = {
        emit: createMockFn(),
      };

      expect(() => {
        factory.validateDependencyInterface(
          invalidNotificationManager,
          "notificationManager",
        );
      }).toThrow("NotificationManager interface validation failed");
    });

    it("should handle unknown interface types", () => {
      expect(() => {
        factory.validateDependencyInterface({}, "unknownInterface");
      }).toThrow("Unknown interface type: unknownInterface");
    });

    it("should validate that dependency is an object", () => {
      expect(() => {
        factory.validateDependencyInterface(null, "logger");
      }).toThrow("Dependency must be an object");

      expect(() => {
        factory.validateDependencyInterface("string", "logger");
      }).toThrow("Dependency must be an object");
    });
  });

  describe("Integration Tests", () => {
    it("should create all platform dependencies with consistent interfaces", () => {
      const youtubeDeps = factory.createYoutubeDependencies(
        configFixture.youtube,
        { config: configFixture },
      );
      const tiktokDeps = factory.createTiktokDependencies(
        configFixture.tiktok,
        { config: configFixture },
      );
      const twitchDeps = factory.createTwitchDependencies(
        configFixture.twitch,
        {
          config: configFixture,
          twitchAuth,
        },
      );

      expect(typeof youtubeDeps.logger.debug).toBe("function");
      expect(typeof tiktokDeps.logger.debug).toBe("function");
      expect(typeof twitchDeps.logger.debug).toBe("function");

      expect(() => {
        factory.validateDependencyInterface(youtubeDeps.logger, "logger");
        factory.validateDependencyInterface(tiktokDeps.logger, "logger");
        factory.validateDependencyInterface(twitchDeps.logger, "logger");
      }).not.toThrow();
    });

    it("should handle dependency creation errors gracefully", () => {
      const invalidConfig = {};

      expect(() => {
        factory.createTwitchDependencies(invalidConfig, {
          config: configFixture,
        });
      }).toThrow();
    });

    it("should maintain platform dependency creation contracts", () => {
      const youtubeDeps = factory.createYoutubeDependencies(
        configFixture.youtube,
        { config: configFixture },
      );
      const tiktokDeps = factory.createTiktokDependencies(
        configFixture.tiktok,
        { config: configFixture },
      );
      const twitchDeps = factory.createTwitchDependencies(
        configFixture.twitch,
        { config: configFixture, twitchAuth },
      );

      expect(youtubeDeps).toHaveProperty("logger");
      expect(tiktokDeps).toHaveProperty("logger");
      expect(twitchDeps).toHaveProperty("logger");

      expect(tiktokDeps).toHaveProperty("WebcastPushConnection");
      expect(twitchDeps).toHaveProperty("twitchAuth");
    });
  });

  describe("Error Handling", () => {
    it("should provide clear error messages for missing configuration", () => {
      expect(() => {
        Reflect.apply(factory.createYoutubeDependencies, factory, [
          null,
          { config: configFixture },
        ]);
      }).toThrow("Configuration is required");

      expect(() => {
        Reflect.apply(factory.createTiktokDependencies, factory, [
          undefined,
          { config: configFixture },
        ]);
      }).toThrow("Configuration is required");

      expect(() => {
        factory.createTwitchDependencies(
          {},
          {
            config: configFixture,
            twitchAuth,
          },
        );
      }).toThrow("Twitch channel is required");
    });

    it("should provide clear error messages for invalid options", () => {
      expect(() => {
        Reflect.apply(factory.createYoutubeDependencies, factory, [
          configFixture.youtube,
          null,
        ]);
      }).toThrow("Options must be an object");

      expect(() => {
        Reflect.apply(factory.createTiktokDependencies, factory, [
          configFixture.tiktok,
          "invalid",
        ]);
      }).toThrow("Options must be an object");
    });
  });

  describe("Configuration Validation", () => {
    it("should reject unsupported YouTube API mode", () => {
      _resetForTesting();
      secrets.youtube.apiKey = null;

      expect(() => {
        factory.createYoutubeDependencies(
          { enableAPI: true, username: "test-channel" },
          { config: configFixture },
        );
      }).toThrow(/YouTube Data API.*not supported/);
    });

    it("should distinguish invalid Twitch channels from missing auth", () => {
      for (const channel of [undefined, "", "   ", 7]) {
        expect(() => factory.createTwitchDependencies({ channel }, { config: configFixture, twitchAuth }))
          .toThrow("Twitch channel is required");
      }
      expect(() => factory.createTwitchDependencies({ channel: "synthetic-channel" }, { config: configFixture }))
        .toThrow("createTwitchDependencies requires twitchAuth");
    });
  });
});
