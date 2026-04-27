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

    expect(platform.config.enabled).toBe(true);
    expect(platform.config.dataLoggingEnabled).toBe(false);
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

    expect(platform.config.jwtToken).toBe(jwtToken);
    expect(platform.config.youtubeChannelId).toBe("test-youtube-channel");
    expect(platform.config.twitchChannelId).toBe("test-twitch-channel");
    expect(platform.config.dataLoggingPath).toBe("./custom-logs");
  });
});
