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

type Listener = (payload?: unknown) => unknown;
type ListenerMap = Record<string, Listener>;
type EmittedEvent = { type: string; payload: unknown };
type RetryCall = { source: string };
type DisconnectionEvent = { handler: string };
type HandledError = {
  error: unknown;
  context: string;
  payload: unknown;
  message: string;
};
type PlatformHarnessOverrides = Record<string, unknown>;

const requireListener = (listeners: ListenerMap, eventName: string): Listener => {
  const listener = listeners[eventName];
  if (!listener) {
    throw new Error(`Expected listener for ${eventName}`);
  }
  return listener;
};

const requireFirst = <T>(items: T[]): T => {
  const first = items[0];
  if (first === undefined) {
    throw new Error("Expected at least one item");
  }
  return first;
};

describe("TikTok event router connection lifecycle", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const createPlatformHarness = (overrides: PlatformHarnessOverrides = {}) => {
    const listeners: ListenerMap = {};
    const emitted: EmittedEvent[] = [];
    const retryCalls: RetryCall[] = [];
    const disconnectionEvents: DisconnectionEvent[] = [];

    const connection = {
      on: createMockFn((eventName: string, handler: Listener) => {
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
      _emitPlatformEvent: (type: string, payload: unknown) => emitted.push({ type, payload }),
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
      requireListener(listeners, platform.ControlEvent.ERROR)(error);
      requireListener(listeners, platform.WebcastEvent.ERROR)(error);

      expect(retryCalls.length).toBe(1);
    });
  });

  describe("rawData listener cleanup", () => {
    test("rawData listener should be removed during cleanup", () => {
      const cleanedEvents: string[] = [];
      const removeAllListeners = (eventName: string) => {
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

      expect(cleanedEvents).toContain("rawData");
    });
  });

  describe("DISCONNECT resets listenersConfigured", () => {
    test("listenersConfigured should be set to false on DISCONNECT", async () => {
      const { platform, listeners } = createPlatformHarness({
        connectionActive: true,
      });

      setupTikTokEventListeners(platform);

      expect(platform.listenersConfigured).toBe(true);

      requireListener(listeners, platform.WebcastEvent.DISCONNECT)();

      expect(platform.listenersConfigured).toBe(false);
    });
  });

  describe("DISCONNECT triggers proper handling", () => {
    test("DISCONNECT should not trigger handleConnectionIssue", async () => {
      const { platform, listeners, disconnectionEvents } =
        createPlatformHarness({
          connectionActive: true,
        });

      setupTikTokEventListeners(platform);

      await requireListener(listeners, platform.WebcastEvent.DISCONNECT)();

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
      await requireListener(listeners, platform.ControlEvent.DISCONNECTED)({
        code: 4404,
        reason: "stream not live",
      });
      await requireListener(listeners, platform.WebcastEvent.STREAM_END)({ code: 4404 });

      expect(disconnectionEvents).toEqual([
        { handler: "connectionIssue" },
        { handler: "streamEnd" },
      ]);
    });

    test("records disconnected event-processing failures without throwing", async () => {
      const disconnectionError = new Error("disconnect handling failed");
      const disconnectedPayload = { code: 4001, reason: "disconnect" };
      const handledErrors: HandledError[] = [];
      const { platform, listeners } = createPlatformHarness({
        connectionActive: true,
        handleConnectionIssue: createMockFn().mockRejectedValue(disconnectionError),
        errorHandler: {
          handleConnectionError: createMockFn(),
          handleEventProcessingError: (
            error: unknown,
            context: string,
            payload: unknown,
            message: string,
          ) => {
            handledErrors.push({ error, context, payload, message });
          },
          handleCleanupError: createMockFn(),
        },
      });

      setupTikTokEventListeners(platform);

      await expect(
        requireListener(listeners, platform.ControlEvent.DISCONNECTED)(disconnectedPayload),
      ).resolves.toBeUndefined();

      expect(handledErrors).toHaveLength(1);
      const handledError = requireFirst(handledErrors);
      expect(handledError.error).toBe(disconnectionError);
      expect(handledError.context).toBe("disconnected");
      expect(handledError.payload).toEqual(disconnectedPayload);
      expect(handledError.message).toBe(
        "Error handling disconnected control event",
      );
    });
  });
});
