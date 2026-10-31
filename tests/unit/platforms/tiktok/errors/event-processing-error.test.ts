import { vi, describe, it, expect, afterEach } from 'bun:test';

import { noOpLogger } from "../../../../helpers/mock-factories";
import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";
import { PlatformEvents } from "../../../../../src/interfaces/PlatformEvents";

type UnknownRecord = Record<string, unknown>;
type EmittedPlatformEvent = { data: UnknownRecord };
type DependencyOverrides = {
  logger?: unknown;
  notificationManager?: unknown;
  connectionFactory?: { createConnection: (...args: unknown[]) => unknown };
  TikTokWebSocketClient?: unknown;
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
    emit: vi.fn<(...args: unknown[]) => unknown>(),
    on: vi.fn<(...args: unknown[]) => unknown>(),
    removeListener: vi.fn<(...args: unknown[]) => unknown>(),
    handleNotification: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
  };
  const connectionFactory = dependencyOverrides.connectionFactory || {
    createConnection: vi.fn<(...args: unknown[]) => { on: import("bun:test").Mock<(...args: unknown[]) => unknown>; emit: import("bun:test").Mock<(...args: unknown[]) => unknown>; removeAllListeners: import("bun:test").Mock<(...args: unknown[]) => unknown>; connect: import("bun:test").Mock<(..._args: unknown[]) => Promise<boolean>>; disconnect: import("bun:test").Mock<(..._args: unknown[]) => Promise<boolean>>; }>().mockReturnValue({
      on: vi.fn<(...args: unknown[]) => unknown>(),
      emit: vi.fn<(...args: unknown[]) => unknown>(),
      removeAllListeners: vi.fn<(...args: unknown[]) => unknown>(),
      connect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
      disconnect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
    }),
  };

  const TikTokWebSocketClient =
    dependencyOverrides.TikTokWebSocketClient ||
    vi.fn(() => ({
      on: vi.fn<(...args: unknown[]) => unknown>(),
      off: vi.fn<(...args: unknown[]) => unknown>(),
      connect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
      disconnect: vi.fn<(...args: unknown[]) => Promise<boolean>>().mockResolvedValue(true),
      getState: vi.fn<(...args: unknown[]) => string>().mockReturnValue("DISCONNECTED"),
      isConnecting: false,
      isConnected: false,
    }));

  const config = {
    enabled: true,
    username: "testUser",
    ...configOverrides,
  };

  return new TikTokPlatform(config, {
    logger,
    notificationManager,
    TikTokWebSocketClient,
    connectionFactory,
    ...dependencyOverrides,
  });
};

describe("TikTokPlatform _handleEventProcessingError", () => {
  afterEach(() => {
    vi.restoreAllMocks();
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
