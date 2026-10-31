import { vi, describe, test, expect, afterEach } from 'bun:test';

import { noOpLogger } from "../helpers/mock-factories";
import {
  createTikTokConfigFixture,
  createTwitchConfigFixture,
  createYouTubeConfigFixture,
} from "../helpers/config-fixture";
import { TikTokPlatform } from "../../src/platforms/tiktok";
import { TwitchPlatform } from "../../src/platforms/twitch";
import { YouTubePlatform } from "../../src/platforms/youtube";
import { YouTubeConnectionManager } from "../../src/platforms/youtube/youtube-connection-manager";

const createTikTokConnectionFixture = (isConnected: boolean) => ({
  isConnected,
  connect: async () => undefined,
  disconnect: async () => undefined,
  on: () => undefined,
});

const createTwitchEventSubFixture = (state: {
  isConnected: boolean;
  isActive: boolean;
}) => ({
  initialize: async () => undefined,
  sendMessage: async () => undefined,
  isConnected: () => state.isConnected,
  isActive: () => state.isActive,
});

const createYouTubeConnectionManagerFixture = (connectionCount: number) => {
  const manager = new YouTubeConnectionManager(noOpLogger, { config: {} });
  manager.getConnectionCount = () => connectionCount;
  return manager;
};

const createTikTokPlatform = (configOverrides = {}) => {
  const config = createTikTokConfigFixture(configOverrides);

  return new TikTokPlatform(config, {
    logger: noOpLogger,
    notificationManager: {
      emit: vi.fn<(...args: unknown[]) => unknown>(),
      on: vi.fn<(...args: unknown[]) => unknown>(),
      removeListener: vi.fn<(...args: unknown[]) => unknown>(),
      handleNotification: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
    },
    TikTokWebSocketClient: vi.fn(() => ({
      on: vi.fn<(...args: unknown[]) => unknown>(),
      off: vi.fn<(...args: unknown[]) => unknown>(),
      connect: vi.fn<(...args: unknown[]) => unknown>(),
      disconnect: vi.fn<(...args: unknown[]) => unknown>(),
      isConnecting: false,
      isConnected: false,
    })),
  });
};

const createTwitchPlatform = (configOverrides = {}) => {
  const config = createTwitchConfigFixture(configOverrides);

  return new TwitchPlatform(config, {
    logger: noOpLogger,
    twitchAuth: {
      isReady: () => true,
    },
  });
};

const createYouTubePlatform = (configOverrides = {}) => {
  const config = createYouTubeConfigFixture(configOverrides);

  return new YouTubePlatform(config, {
    logger: noOpLogger,
    USER_AGENTS: ["test-agent"],
    streamDetectionService: {
      detectLiveStreams: vi.fn<(...args: unknown[]) => Promise<{ success: true; videoIds: never[]; }>>().mockResolvedValue({
        success: true,
        videoIds: [],
      }),
    },
  });
};

describe("Platform getStatus() interface standardization", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("TikTok getStatus()", () => {
    test("returns standardized shape { isReady, issues }", () => {
      const platform = createTikTokPlatform();

      const status = platform.getStatus();

      expect(status).toHaveProperty("isReady");
      expect(status).toHaveProperty("issues");
      expect(typeof status.isReady).toBe("boolean");
      expect(Array.isArray(status.issues)).toBe(true);
    });

    test("isReady is true when enabled and connected", () => {
      const platform = createTikTokPlatform({ enabled: true });
      platform.connection = createTikTokConnectionFixture(true);

      const status = platform.getStatus();

      expect(status.isReady).toBe(true);
      expect(status.issues).toEqual([]);
    });

    test("isReady is false when disabled with no issues (by design)", () => {
      const platform = createTikTokPlatform({ enabled: false });

      const status = platform.getStatus();

      expect(status.isReady).toBe(false);
      expect(status.issues).toEqual([]);
    });

    test("isReady is false with issue when enabled but not connected", () => {
      const platform = createTikTokPlatform({ enabled: true });
      platform.connection = null;

      const status = platform.getStatus();

      expect(status.isReady).toBe(false);
      expect(status.issues).toContain("Not connected");
    });
  });

  describe("Twitch getStatus()", () => {
    test("returns standardized shape { isReady, issues }", () => {
      const platform = createTwitchPlatform();

      const status = platform.getStatus();

      expect(status).toHaveProperty("isReady");
      expect(status).toHaveProperty("issues");
      expect(typeof status.isReady).toBe("boolean");
      expect(Array.isArray(status.issues)).toBe(true);
    });

    test("isReady is true when enabled and EventSub is connected + active", () => {
      const platform = createTwitchPlatform({ enabled: true });
      platform.eventSub = createTwitchEventSubFixture({
        isConnected: true,
        isActive: true,
      });

      const status = platform.getStatus();

      expect(status.isReady).toBe(true);
      expect(status.issues).toEqual([]);
    });

    test("isReady is false with issue when EventSub is connected but inactive", () => {
      const platform = createTwitchPlatform({ enabled: true });
      platform.eventSub = createTwitchEventSubFixture({
        isConnected: true,
        isActive: false,
      });

      const status = platform.getStatus();

      expect(status.isReady).toBe(false);
      expect(status.issues).toContain("EventSub not active");
    });

    test("isReady is false when disabled with no issues (by design)", () => {
      const platform = createTwitchPlatform({ enabled: false });

      const status = platform.getStatus();

      expect(status.isReady).toBe(false);
      expect(status.issues).toEqual([]);
    });

    test("isReady is false with issue when enabled but not connected", () => {
      const platform = createTwitchPlatform({ enabled: true });
      platform.eventSub = null;

      const status = platform.getStatus();

      expect(status.isReady).toBe(false);
      expect(status.issues).toContain("Not connected");
    });
  });

  describe("YouTube getStatus()", () => {
    test("returns standardized shape { isReady, issues }", () => {
      const platform = createYouTubePlatform();

      const status = platform.getStatus();

      expect(status).toHaveProperty("isReady");
      expect(status).toHaveProperty("issues");
      expect(typeof status.isReady).toBe("boolean");
      expect(Array.isArray(status.issues)).toBe(true);
    });

    test("isReady is true when enabled and has connections", () => {
      const platform = createYouTubePlatform({ enabled: true });
      platform.connectionManager = createYouTubeConnectionManagerFixture(1);

      const status = platform.getStatus();

      expect(status.isReady).toBe(true);
      expect(status.issues).toEqual([]);
    });

    test("isReady is false when disabled with no issues (by design)", () => {
      const platform = createYouTubePlatform({ enabled: false });

      const status = platform.getStatus();

      expect(status.isReady).toBe(false);
      expect(status.issues).toEqual([]);
    });

    test("isReady is false with issue when enabled but no connections", () => {
      const platform = createYouTubePlatform({ enabled: true });
      platform.connectionManager = createYouTubeConnectionManagerFixture(0);

      const status = platform.getStatus();

      expect(status.isReady).toBe(false);
      expect(status.issues).toContain("Not connected");
    });
  });

  describe("Cross-platform interface consistency", () => {
    test("all platforms return identical getStatus() structure", () => {
      const tiktok = createTikTokPlatform();
      const twitch = createTwitchPlatform();
      const youtube = createYouTubePlatform();

      const tiktokStatus = tiktok.getStatus();
      const twitchStatus = twitch.getStatus();
      const youtubeStatus = youtube.getStatus();

      const expectedKeys = ["isReady", "issues"];
      expect(Object.keys(tiktokStatus).sort()).toEqual(expectedKeys);
      expect(Object.keys(twitchStatus).sort()).toEqual(expectedKeys);
      expect(Object.keys(youtubeStatus).sort()).toEqual(expectedKeys);
    });
  });
});
