import { describe, it, expect, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../../helpers/mock-factories";
import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";
import { PlatformEvents } from "../../../../../src/interfaces/PlatformEvents";

type UnknownRecord = Record<string, unknown>;
type EmittedPlatformEvent = { data: UnknownRecord };
type WebcastEventMap = {
  CHAT: string;
  GIFT: string;
  FOLLOW: string;
  SOCIAL: string;
  ROOM_USER: string;
  ERROR: string;
  DISCONNECT: string;
};
type DependencyOverrides = {
  logger?: unknown;
  notificationManager?: unknown;
  connectionFactory?: { createConnection: (...args: unknown[]) => unknown };
  TikTokWebSocketClient?: unknown;
  WebcastEvent?: Partial<WebcastEventMap>;
  ControlEvent?: Record<string, string>;
};

const requireFirst = <T>(items: T[]): T => {
  const first = items[0];
  if (first === undefined) {
    throw new Error("Expected at least one emitted event");
  }
  return first;
};

const createPlatform = (
  configOverrides: UnknownRecord = {},
  dependencyOverrides: DependencyOverrides = {},
) => {
  const logger = dependencyOverrides.logger || noOpLogger;
  const notificationManager = dependencyOverrides.notificationManager || {
    emit: createMockFn(),
    on: createMockFn(),
    removeListener: createMockFn(),
    handleNotification: createMockFn().mockResolvedValue(),
  };
  const connectionFactory = dependencyOverrides.connectionFactory || {
    createConnection: createMockFn().mockReturnValue({
      on: createMockFn(),
      emit: createMockFn(),
      removeAllListeners: createMockFn(),
      connect: createMockFn().mockResolvedValue(true),
      disconnect: createMockFn().mockResolvedValue(true),
    }),
  };

  const TikTokWebSocketClient =
    dependencyOverrides.TikTokWebSocketClient ||
    createMockFn().mockImplementation(() => ({
      on: createMockFn(),
      off: createMockFn(),
      connect: createMockFn().mockResolvedValue(true),
      disconnect: createMockFn().mockResolvedValue(true),
      getState: createMockFn().mockReturnValue("DISCONNECTED"),
      isConnecting: false,
      isConnected: false,
    }));

  const WebcastEvent: WebcastEventMap = {
    CHAT: "chat",
    GIFT: "gift",
    FOLLOW: "follow",
    SOCIAL: "social",
    ROOM_USER: "roomUser",
    ERROR: "error",
    DISCONNECT: "disconnect",
    ...dependencyOverrides.WebcastEvent,
  };
  const ControlEvent = dependencyOverrides.ControlEvent || {};
  const {
    WebcastEvent: _webcastEventOverride,
    ControlEvent: _controlEventOverride,
    ...remainingDependencyOverrides
  } = dependencyOverrides;

  const config = {
    enabled: true,
    username: "testUser",
    ...configOverrides,
  };

  return new TikTokPlatform(config, {
    logger,
    notificationManager,
    TikTokWebSocketClient,
    WebcastEvent,
    ControlEvent,
    connectionFactory,
    ...remainingDependencyOverrides,
  });
};

describe("TikTokPlatform _handleEventProcessingError", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  describe("non-monetization events", () => {
    it("returns payloadEmitted=false with reason non-monetization for chat errors", () => {
      const platform = createPlatform();

      const result = platform._handleEventProcessingError(
        PlatformEvents.CHAT_MESSAGE,
        { userId: "123", username: "testUser" },
        new Error("processing failed"),
      );

      expect(result.payloadEmitted).toBe(false);
      expect(result.reason).toBe("non-monetization");
    });

    it("returns payloadEmitted=false for follow events", () => {
      const platform = createPlatform();

      const result = platform._handleEventProcessingError(
        PlatformEvents.FOLLOW,
        { userId: "123", username: "testUser" },
        new Error("processing failed"),
      );

      expect(result.payloadEmitted).toBe(false);
      expect(result.reason).toBe("non-monetization");
    });
  });

  describe("monetization events with valid data", () => {
    it("returns payloadEmitted=true for gift errors with valid identity", () => {
      const platform = createPlatform();
      const emittedEvents: EmittedPlatformEvent[] = [];
      platform.on("platform:event", (event: EmittedPlatformEvent) => emittedEvents.push(event));

      const result = platform._handleEventProcessingError(
        PlatformEvents.GIFT,
        {
          userId: "123",
          username: "testGifter",
          amount: 100,
          currency: "coins",
        },
        new Error("processing failed"),
      );

      expect(result.payloadEmitted).toBe(true);
      expect(emittedEvents).toHaveLength(1);
      expect(requireFirst(emittedEvents).data.username).toBe("testGifter");
    });

    it("returns payloadEmitted=true for envelope errors with valid identity", () => {
      const platform = createPlatform();
      const emittedEvents: EmittedPlatformEvent[] = [];
      platform.on("platform:event", (event: EmittedPlatformEvent) => emittedEvents.push(event));

      const result = platform._handleEventProcessingError(
        PlatformEvents.ENVELOPE,
        { userId: "456", username: "testEnvelope", amount: 50 },
        new Error("processing failed"),
      );

      expect(result.payloadEmitted).toBe(true);
      expect(emittedEvents).toHaveLength(1);
    });
  });

  describe("monetization events with incomplete data", () => {
    it("emits error payload even without identity data", () => {
      const platform = createPlatform();
      const emittedEvents: EmittedPlatformEvent[] = [];
      platform.on("platform:event", (event: EmittedPlatformEvent) => emittedEvents.push(event));

      const result = platform._handleEventProcessingError(
        PlatformEvents.GIFT,
        {},
        new Error("processing failed"),
      );

      expect(result.payloadEmitted).toBe(true);
      expect(emittedEvents).toHaveLength(1);
      expect(requireFirst(emittedEvents).data.isError).toBe(true);
    });

    it("emits error payload with partial identity", () => {
      const platform = createPlatform();
      const emittedEvents: EmittedPlatformEvent[] = [];
      platform.on("platform:event", (event: EmittedPlatformEvent) => emittedEvents.push(event));

      const result = platform._handleEventProcessingError(
        PlatformEvents.GIFT,
        { username: "partialUser" },
        new Error("processing failed"),
      );

      expect(result.payloadEmitted).toBe(true);
      expect(requireFirst(emittedEvents).data.isError).toBe(true);
    });
  });

  describe("error payload structure", () => {
    it("includes isError flag in emitted payload", () => {
      const platform = createPlatform();
      const emittedEvents: EmittedPlatformEvent[] = [];
      platform.on("platform:event", (event: EmittedPlatformEvent) => emittedEvents.push(event));

      platform._handleEventProcessingError(
        PlatformEvents.GIFT,
        { userId: "123", username: "testGifter" },
        new Error("processing failed"),
      );

      const emittedEvent = requireFirst(emittedEvents);
      expect(emittedEvent.data.isError).toBe(true);
      expect(emittedEvent.data.platform).toBe("tiktok");
    });

    it("includes identity fields when available", () => {
      const platform = createPlatform();
      const emittedEvents: EmittedPlatformEvent[] = [];
      platform.on("platform:event", (event: EmittedPlatformEvent) => emittedEvents.push(event));

      platform._handleEventProcessingError(
        PlatformEvents.ENVELOPE,
        { userId: "456", username: "testEnvelope" },
        new Error("processing failed"),
      );

      const emittedEvent = requireFirst(emittedEvents);
      expect(emittedEvent.data.username).toBe("testEnvelope");
      expect(emittedEvent.data.userId).toBe("456");
    });
  });
});
