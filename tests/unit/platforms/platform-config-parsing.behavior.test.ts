import { describe, test, expect, afterEach } from "bun:test";
import { noOpLogger } from "../../helpers/mock-factories";
import { createStreamElementsConfigFixture } from "../../helpers/config-fixture";
import {
  secrets,
  _resetForTesting,
  initializeStaticSecrets,
} from "../../../src/core/secrets";

import { TwitchEventSub } from "../../../src/platforms/twitch-eventsub";
import { StreamElementsPlatform } from "../../../src/platforms/streamelements";

type StreamElementsConfigSnapshot = {
  enabled: boolean;
  youtubeChannelId?: string;
  twitchChannelId?: string;
  jwtToken?: string;
  dataLoggingEnabled: boolean;
  dataLoggingPath?: string;
};

const isStreamElementsConfigSnapshot = (
  value: unknown,
): value is StreamElementsConfigSnapshot => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const config = value as Record<string, unknown>;
  return (
    typeof config.enabled === "boolean" &&
    typeof config.dataLoggingEnabled === "boolean"
  );
};

const readStreamElementsConfig = (
  platform: object,
): StreamElementsConfigSnapshot => {
  if (!("config" in platform)) {
    throw new Error("StreamElementsPlatform config snapshot is unavailable");
  }

  const config = platform.config;
  if (!isStreamElementsConfigSnapshot(config)) {
    throw new Error(
      "StreamElementsPlatform config snapshot has unexpected shape",
    );
  }

  return config;
};

describe("platform config parsing behavior", () => {
  afterEach(() => {
    _resetForTesting();
    initializeStaticSecrets();
  });

  class MockWebSocket {
    readyState: number;

    constructor() {
      this.readyState = 0;
    }
    close() {}
  }

  test("TwitchEventSub stores normalized config values", () => {
    secrets.twitch.accessToken = "test-token";
    const twitchAuth = {
      isReady: () => true,
      refreshTokens: async () => true,
      getUserId: () => "test-user-id",
    };
    const eventSub = new TwitchEventSub(
      {
        dataLoggingEnabled: true,
        broadcasterId: "test-broadcaster-id",
        dataLoggingPath: "./logs",
        clientId: "test-client-id",
      },
      { logger: noOpLogger, WebSocketCtor: MockWebSocket, twitchAuth },
    );

    try {
      expect(eventSub.config.dataLoggingEnabled).toBe(true);
    } finally {
      if (eventSub.cleanupInterval) {
        clearInterval(eventSub.cleanupInterval);
        eventSub.cleanupInterval = null;
      }
    }
  });

  test("StreamElementsPlatform stores normalized config values", () => {
    const platform = new StreamElementsPlatform(
      createStreamElementsConfigFixture(),
      { logger: noOpLogger },
    );

    const config = readStreamElementsConfig(platform);

    expect(config.enabled).toBe(true);
    expect(config.dataLoggingEnabled).toBe(false);
  });

  test("StreamElementsPlatform uses provided channel IDs and paths", () => {
    const jwtToken = "test-jwt-token";
    secrets.streamelements.jwtToken = jwtToken;
    const platform = new StreamElementsPlatform(
      createStreamElementsConfigFixture({
        youtubeChannelId: "test-youtube-channel",
        twitchChannelId: "test-twitch-channel",
        dataLoggingPath: "./custom-logs",
      }),
      { logger: noOpLogger },
    );

    const config = readStreamElementsConfig(platform);

    expect(config.jwtToken).toBe(jwtToken);
    expect(config.youtubeChannelId).toBe("test-youtube-channel");
    expect(config.twitchChannelId).toBe("test-twitch-channel");
    expect(config.dataLoggingPath).toBe("./custom-logs");
  });
});
