import { describe, expect, test, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";

import { PlatformEvents } from "../../../src/interfaces/PlatformEvents";
import { TikTokPlatform } from "../../../src/platforms/tiktok";
import { TwitchPlatform } from "../../../src/platforms/twitch";
import { YouTubePlatform } from "../../../src/platforms/youtube";

type PlatformEventEnvelope = {
  platform: unknown;
  type: unknown;
  data: unknown;
};
type PlatformLike = {
  on: (
    eventName: "platform:event",
    handler: (payload: PlatformEventEnvelope) => void,
  ) => unknown;
  _emitPlatformEvent: (type: string, payload: Record<string, unknown>) => void;
  handlers: Record<string, (payload: unknown) => unknown>;
  errorHandler: Record<string, unknown>;
  logger: Record<string, unknown>;
  getStatus: () => { isReady: boolean; issues: string[] };
};

class StubRawPlatformDataLoggingService {
  constructor(_options: unknown) {}
  async logRawPlatformData(): Promise<void> {}
}

const createLogger = () => ({
  debug: createMockFn(),
  info: createMockFn(),
  warn: createMockFn(),
  error: createMockFn(),
});

const requireEnvelope = (
  value: PlatformEventEnvelope | undefined,
): PlatformEventEnvelope => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error("Expected platform:event envelope");
  }
  return value;
};

const captureEnvelope = (platform: PlatformLike): PlatformEventEnvelope[] => {
  const envelopes: PlatformEventEnvelope[] = [];
  platform.on("platform:event", (payload) => envelopes.push(payload));
  return envelopes;
};

const createTikTokPlatform = (): PlatformLike =>
  new TikTokPlatform(
    { enabled: true, username: "test-tiktok" },
    {
      logger: noOpLogger,
      notificationManager: {
        emit: createMockFn(),
        on: createMockFn(),
        removeListener: createMockFn(),
        handleNotification: createMockFn().mockResolvedValue(undefined),
      },
      RawPlatformDataLoggingService: StubRawPlatformDataLoggingService as never,
      TikTokWebSocketClient: createMockFn().mockImplementation(() => ({
        on: createMockFn(),
        off: createMockFn(),
        connect: createMockFn(),
        disconnect: createMockFn(),
        isConnecting: false,
        isConnected: false,
      })),
      WebcastEvent: {
        CHAT: "chat",
        GIFT: "gift",
        FOLLOW: "follow",
        SOCIAL: "social",
        ROOM_USER: "roomUser",
        ERROR: "error",
        DISCONNECT: "disconnect",
      },
      ControlEvent: {},
      retrySystem: {
        resetRetryCount: createMockFn(),
        handleConnectionError: createMockFn(),
      },
    },
  ) as unknown as PlatformLike;

const createTwitchPlatform = (): PlatformLike =>
  new TwitchPlatform(
    {
      enabled: true,
      username: "test-twitch",
      channel: "test-twitch",
      clientId: "test-client-id",
    },
    {
      logger: noOpLogger,
      twitchAuth: { isReady: () => true },
      RawPlatformDataLoggingService: StubRawPlatformDataLoggingService,
    },
  ) as unknown as PlatformLike;

const createYouTubePlatform = (): PlatformLike =>
  new YouTubePlatform(
    { enabled: true, username: "test-youtube" },
    {
      logger: createLogger(),
      USER_AGENTS: ["test-agent"],
      Innertube: null,
      streamDetectionService: {
        detectLiveStreams: createMockFn().mockResolvedValue({
          success: true,
          videoIds: [],
        }),
      },
      RawPlatformDataLoggingService: StubRawPlatformDataLoggingService,
      notificationManager: {
        emit: createMockFn(),
        on: createMockFn(),
        removeListener: createMockFn(),
      },
    },
  ) as unknown as PlatformLike;

describe("platform public contracts", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("pins canonical event constant strings used by platform:event envelopes", () => {
    expect({
      chat: PlatformEvents.CHAT_MESSAGE,
      chatConnected: PlatformEvents.CHAT_CONNECTED,
      chatDisconnected: PlatformEvents.CHAT_DISCONNECTED,
      follow: PlatformEvents.FOLLOW,
      share: PlatformEvents.SHARE,
      paypiggy: PlatformEvents.PAYPIGGY,
      giftpaypiggy: PlatformEvents.GIFTPAYPIGGY,
      gift: PlatformEvents.GIFT,
      envelope: PlatformEvents.ENVELOPE,
      raid: PlatformEvents.RAID,
      connection: PlatformEvents.PLATFORM_CONNECTION,
      notification: PlatformEvents.PLATFORM_NOTIFICATION,
      viewerCount: PlatformEvents.VIEWER_COUNT,
      streamStatus: PlatformEvents.STREAM_STATUS,
      streamDetected: PlatformEvents.STREAM_DETECTED,
      error: PlatformEvents.ERROR,
    }).toEqual({
      chat: "platform:chat-message",
      chatConnected: "platform:chat-connected",
      chatDisconnected: "platform:chat-disconnected",
      follow: "platform:follow",
      share: "platform:share",
      paypiggy: "platform:paypiggy",
      giftpaypiggy: "platform:giftpaypiggy",
      gift: "platform:gift",
      envelope: "platform:envelope",
      raid: "platform:raid",
      connection: "platform:connection",
      notification: "platform:notification",
      viewerCount: "platform:viewer-count",
      streamStatus: "platform:stream-status",
      streamDetected: "platform:stream-detected",
      error: "platform:error",
    });
  });

  test("all platform adapters emit the public platform:event envelope before per-type handlers", () => {
    const cases = [
      {
        platformName: "tiktok",
        platform: createTikTokPlatform(),
        type: PlatformEvents.FOLLOW,
        handlerName: "onFollow",
      },
      {
        platformName: "twitch",
        platform: createTwitchPlatform(),
        type: PlatformEvents.FOLLOW,
        handlerName: "onFollow",
      },
      {
        platformName: "youtube",
        platform: createYouTubePlatform(),
        type: PlatformEvents.VIEWER_COUNT,
        handlerName: "onViewerCount",
      },
    ];

    for (const { platformName, platform, type, handlerName } of cases) {
      const order: string[] = [];
      const received = captureEnvelope(platform);
      platform.on("platform:event", () => order.push("envelope"));
      const handlerCalls: unknown[] = [];
      platform.handlers[handlerName] = (payload) => {
        order.push("handler");
        handlerCalls.push(payload);
      };
      const payload = { platform: platformName, username: "contract-user", count: 7 };

      platform._emitPlatformEvent(type, payload);

      expect(handlerCalls).toEqual([payload]);
      expect(requireEnvelope(received[0])).toEqual({
        platform: platformName,
        type,
        data: payload,
      });
      expect(order).toEqual(["envelope", "handler"]);
    }
  });

  test("all platform adapters expose lifecycle status, logger, and error-handler contracts", () => {
    const platforms = [
      createTikTokPlatform(),
      createTwitchPlatform(),
      createYouTubePlatform(),
    ];

    for (const platform of platforms) {
      expect(Object.keys(platform.getStatus()).sort()).toEqual(["isReady", "issues"]);
      expect(typeof platform.getStatus().isReady).toBe("boolean");
      expect(Array.isArray(platform.getStatus().issues)).toBe(true);

      for (const loggerMethod of ["debug", "info", "warn", "error"]) {
        expect(typeof platform.logger[loggerMethod]).toBe("function");
      }

      for (const handlerMethod of [
        "handleConnectionError",
        "handleEventProcessingError",
        "handleCleanupError",
      ]) {
        expect(typeof platform.errorHandler[handlerMethod]).toBe("function");
      }
    }
  });
});
