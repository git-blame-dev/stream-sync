import { describe, test, expect, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../../helpers/mock-factories";
const {
  cleanupTikTokEventListeners,
  setupTikTokEventListeners,
} = require("../../../../../src/platforms/tiktok/events/event-router.ts");

describe("TikTok event router connection lifecycle", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const createPlatformHarness = (overrides = {}) => {
    const listeners = {};
    const emitted = [];
    const retryCalls = [];
    const disconnectionEvents = [];

    const connection = {
      on: createMockFn((eventName, handler) => {
        listeners[eventName] = handler;
      }),
      removeAllListeners: createMockFn(),
    };

    const platform = {
      listenersConfigured: false,
      connection,
      WebcastEvent: {
        CHAT: "chat",
        GIFT: "gift",
        FOLLOW: "follow",
        SOCIAL: "social",
        ROOM_USER: "roomUser",
        ENVELOPE: "envelope",
        SUBSCRIBE: "subscribe",
        SUPER_FAN: "superfan",
        ERROR: "error",
        DISCONNECT: "disconnect",
        STREAM_END: "streamEnd",
      },
      ControlEvent: {
        CONNECTED: "connected",
        DISCONNECTED: "disconnected",
        ERROR: "control-error",
      },
      platformName: "tiktok",
      timestampService: null,
      selfMessageDetectionService: null,
      config: { enabled: true, dataLoggingEnabled: false },
      logger: noOpLogger,
      errorHandler: {
        handleConnectionError: createMockFn(),
        handleEventProcessingError: createMockFn(),
        handleCleanupError: createMockFn(),
      },
      constructor: {
        resolveEventTimestampMs: createMockFn(() => null),
      },
      _logIncomingEvent: createMockFn().mockResolvedValue(),
      _emitPlatformEvent: (type, payload) => emitted.push({ type, payload }),
      _handleStandardEvent: createMockFn().mockResolvedValue(),
      _handleStreamEnd: createMockFn().mockImplementation(async () => {
        disconnectionEvents.push({ handler: "streamEnd" });
      }),
      handleConnectionIssue: createMockFn().mockImplementation(async () => {
        disconnectionEvents.push({ handler: "connectionIssue" });
      }),
      handleConnectionError: createMockFn(),
      handleRetry: createMockFn().mockImplementation(() => {
        retryCalls.push({ source: "handleRetry" });
        return { action: "retry-queued" };
      }),
      queueRetry: createMockFn().mockImplementation(() => {
        retryCalls.push({ source: "queueRetry" });
        return { queued: true };
      }),
      handleTikTokGift: createMockFn().mockResolvedValue(),
      handleTikTokFollow: createMockFn().mockResolvedValue(),
      handleTikTokSocial: createMockFn().mockResolvedValue(),
      connectionActive: false,
      cachedViewerCount: 0,
      connectionTime: 0,
      _getTimestamp: createMockFn(() => "2025-01-02T03:04:05.000Z"),
      _handleChatMessage: createMockFn().mockResolvedValue(),
      ...overrides,
    };

    return {
      platform,
      connection,
      listeners,
      emitted,
      retryCalls,
      disconnectionEvents,
    };
  };

  describe("error event deduplication", () => {
    test("retry should only be queued once when both error events fire", async () => {
      const { platform, listeners, retryCalls } = createPlatformHarness({
        connectionActive: true,
      });

      setupTikTokEventListeners(platform);

      const error = new Error("connection-lost");

      // Both events fire (as can happen in real scenarios)
      listeners[platform.ControlEvent.ERROR](error);
      listeners[platform.WebcastEvent.ERROR](error);

      // Should only queue retry once, not twice
      expect(retryCalls.length).toBe(1);
    });
  });

  describe("rawData listener cleanup", () => {
    test("rawData listener should be removed during cleanup", () => {
      const cleanedEvents = [];
      const removeAllListeners = (eventName) => {
        cleanedEvents.push(eventName);
      };
      const platform = {
        connection: { removeAllListeners },
        listenersConfigured: true,
        WebcastEvent: {
          CHAT: "chat",
          GIFT: "gift",
          FOLLOW: "follow",
          ROOM_USER: "roomUser",
          ENVELOPE: "envelope",
          SUBSCRIBE: "subscribe",
          SUPER_FAN: "superfan",
          SOCIAL: "social",
          ERROR: "error",
          DISCONNECT: "disconnect",
          STREAM_END: "streamEnd",
        },
        ControlEvent: {
          CONNECTED: "connected",
          DISCONNECTED: "disconnected",
          ERROR: "control-error",
        },
        errorHandler: { handleCleanupError: createMockFn() },
      };

      cleanupTikTokEventListeners(platform);

      // rawData should be included in cleanup
      expect(cleanedEvents).toContain("rawData");
    });
  });

  describe("DISCONNECT resets listenersConfigured", () => {
    test("listenersConfigured should be set to false on DISCONNECT", async () => {
      // Start with listenersConfigured: false so setupTikTokEventListeners actually runs
      const { platform, listeners } = createPlatformHarness({
        connectionActive: true,
      });

      setupTikTokEventListeners(platform);

      // Verify listeners were configured
      expect(platform.listenersConfigured).toBe(true);

      // Trigger DISCONNECT
      listeners[platform.WebcastEvent.DISCONNECT]();

      // listenersConfigured should be false so reconnect can reattach listeners
      expect(platform.listenersConfigured).toBe(false);
    });
  });

  describe("DISCONNECT triggers proper handling", () => {
    test("DISCONNECT should not trigger handleConnectionIssue", async () => {
      // Start with listenersConfigured: false so setup runs
      const { platform, listeners, disconnectionEvents } =
        createPlatformHarness({
          connectionActive: true,
        });

      setupTikTokEventListeners(platform);

      // Trigger DISCONNECT
      await listeners[platform.WebcastEvent.DISCONNECT]();

      expect(disconnectionEvents).toEqual([]);
      expect(platform.connectionActive).toBe(false);
    });
  });

  describe("routes both DISCONNECTED and STREAM_END events", () => {
    test("event-router routes both events to handlers", async () => {
      const { platform, listeners, disconnectionEvents } =
        createPlatformHarness({
          connectionActive: true,
        });

      setupTikTokEventListeners(platform);

      // Simulate 4404: websocket emits both disconnected and streamEnd
      await listeners[platform.ControlEvent.DISCONNECTED]({
        code: 4404,
        reason: "stream not live",
      });
      await listeners[platform.WebcastEvent.STREAM_END]({ code: 4404 });

      // Event-router routes both events to handlers
      // Deduplication is the platform's responsibility (tested in tiktok-connection-lifecycle.test.js)
      expect(disconnectionEvents).toEqual([
        { handler: "connectionIssue" },
        { handler: "streamEnd" },
      ]);
    });

    test("records disconnected event-processing failures without throwing", async () => {
      const disconnectionError = new Error("disconnect handling failed");
      const disconnectedPayload = { code: 4001, reason: "disconnect" };
      const handledErrors = [];
      const { platform, listeners } = createPlatformHarness({
        connectionActive: true,
        handleConnectionIssue: createMockFn().mockRejectedValue(disconnectionError),
        errorHandler: {
          handleConnectionError: createMockFn(),
          handleEventProcessingError: (error, context, payload, message) => {
            handledErrors.push({ error, context, payload, message });
          },
          handleCleanupError: createMockFn(),
        },
      });

      setupTikTokEventListeners(platform);

      await expect(
        listeners[platform.ControlEvent.DISCONNECTED](disconnectedPayload),
      ).resolves.toBeUndefined();

      expect(handledErrors).toHaveLength(1);
      expect(handledErrors[0].error).toBe(disconnectionError);
      expect(handledErrors[0].context).toBe("disconnected");
      expect(handledErrors[0].payload).toEqual(disconnectedPayload);
      expect(handledErrors[0].message).toBe(
        "Error handling disconnected control event",
      );
    });
  });
});
