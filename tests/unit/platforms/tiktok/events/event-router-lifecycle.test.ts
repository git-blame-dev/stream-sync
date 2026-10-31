import { vi, describe, test, expect, afterEach } from 'bun:test';
import { EventEmitter } from "node:events";

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
    vi.restoreAllMocks();
  });

  const createPlatformHarness = (overrides: PlatformHarnessOverrides = {}) => {
    const listeners: ListenerMap = {};
    const emitted: EmittedEvent[] = [];
    const retryCalls: RetryCall[] = [];
    const disconnectionEvents: DisconnectionEvent[] = [];

    const connection = {
      on: vi.fn((eventName: string, handler: Listener) => {
        listeners[eventName] = handler;
      }),
      removeAllListeners: vi.fn<(...args: unknown[]) => unknown>(),
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
        handleConnectionError: vi.fn<(...args: unknown[]) => unknown>(),
        handleEventProcessingError: vi.fn<(...args: unknown[]) => unknown>(),
        handleCleanupError: vi.fn<(...args: unknown[]) => unknown>(),
      },
      constructor: {
        resolveEventTimestampMs: vi.fn(() => null),
      },
      _logIncomingEvent: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      _emitPlatformEvent: (type: string, payload: unknown) => emitted.push({ type, payload }),
      _handleStandardEvent: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      _handleStreamEnd: vi.fn(async () => {
        disconnectionEvents.push({ handler: "streamEnd" });
      }),
      handleConnectionIssue: vi.fn(async () => {
        disconnectionEvents.push({ handler: "connectionIssue" });
      }),
      handleConnectionError: vi.fn<(...args: unknown[]) => unknown>(),
      handleRetry: vi.fn(() => {
        retryCalls.push({ source: "handleRetry" });
        return { action: "retry-queued" };
      }),
      queueRetry: vi.fn(() => {
        retryCalls.push({ source: "queueRetry" });
        return { queued: true };
      }),
      handleTikTokGift: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      handleTikTokFollow: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      handleTikTokSocial: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      connectionActive: false,
      cachedViewerCount: 0,
      connectionTime: 0,
      _getTimestamp: vi.fn(() => "2025-01-02T03:04:05.000Z"),
      _handleChatMessage: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
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
      await requireListener(listeners, platform.ControlEvent.ERROR)(error);
      await requireListener(listeners, platform.WebcastEvent.ERROR)(error);

      expect(retryCalls.length).toBe(1);
    });
  });

  test("cleanup retains observers and retires captured old connection only", () => {
    const oldConnection = new EventEmitter();
    const replacement = new EventEmitter();
    const observer = () => {};
    oldConnection.on("chat", observer);
    oldConnection.on("rawData", observer);
    replacement.on("chat", observer);
    const { platform } = createPlatformHarness({ connection: oldConnection });
    setupTikTokEventListeners(platform);
    setupTikTokEventListeners(platform);
    expect(oldConnection.listenerCount("chat")).toBe(2);
    Object.assign(platform, { connection: replacement });
    cleanupTikTokEventListeners(platform);
    expect(oldConnection.listeners("chat")).toEqual([observer]);
    expect(oldConnection.listeners("rawData")).toEqual([observer]);
    expect(replacement.listeners("chat")).toEqual([observer]);
    setupTikTokEventListeners(platform);
    setupTikTokEventListeners(platform);
    expect(replacement.listenerCount("chat")).toBe(2);
    cleanupTikTokEventListeners(platform);
    expect(replacement.listeners("chat")).toEqual([observer]);
  });

  test.each(["rawData", "control-error", "disconnected", "chat", "gift", "roomUser", "streamEnd"])("contains diagnostic and reporter failure for %s", async (event) => {
    const failure = new Error("synthetic diagnostic failure");
    const report = vi.fn<(...args: [unknown, string, unknown?, string?]) => void>(() => { throw new Error("synthetic reporter failure"); });
    const { platform, listeners } = createPlatformHarness({
      _logIncomingEvent: () => Promise.reject(failure),
      errorHandler: { handleEventProcessingError: report },
    });
    setupTikTokEventListeners(platform);
    await expect(requireListener(listeners, event)({ secret: "synthetic-private-payload" })).resolves.toBeUndefined();
    expect(report.mock.calls).toHaveLength(1);
    expect(report.mock.calls[0]?.slice(0, 3)).toEqual([failure, event === "chat" ? "chat-message" : event, undefined]);
    if (event === "streamEnd") expect(platform._handleStreamEnd.mock.calls).toHaveLength(1);
  });

  test("reconfiguration adopts replacement without requiring an earlier cleanup", () => {
    const oldConnection = new EventEmitter();
    const replacement = new EventEmitter();
    const { platform } = createPlatformHarness({ connection: oldConnection });
    setupTikTokEventListeners(platform);
    Object.assign(platform, { connection: replacement });
    setupTikTokEventListeners(platform);
    expect(oldConnection.listenerCount("chat")).toBe(0);
    expect(replacement.listenerCount("chat")).toBe(1);
    cleanupTikTokEventListeners(platform);
  });

  test("cleanup supports removeListener without off and only removes owned callbacks", () => {
    const emitter = new EventEmitter();
    const connection = {
      on: emitter.on.bind(emitter),
      removeListener: emitter.removeListener.bind(emitter),
    };
    const observer = () => {};
    emitter.on("rawData", observer);
    const { platform } = createPlatformHarness({ connection });
    setupTikTokEventListeners(platform);
    cleanupTikTokEventListeners(platform);
    expect(emitter.listeners("rawData")).toEqual([observer]);
    expect(emitter.listenerCount("chat")).toBe(0);
  });

  test("stream end acts synchronously before diagnostics and captures its generation", async () => {
    const order: string[] = [];
    const { platform, listeners } = createPlatformHarness({
      connectionGeneration: 7,
      _handleStreamEnd: async (_data: unknown, generation: number) => { order.push(`terminal:${generation}`); },
      _logIncomingEvent: async () => { order.push("diagnostic"); },
    });
    setupTikTokEventListeners(platform);
    const pending = requireListener(listeners, "streamEnd")({});
    expect(order).toEqual(["terminal:7"]);
    await pending;
    expect(order).toEqual(["terminal:7", "diagnostic"]);
    Object.assign(platform, { connectionGeneration: 8 });
    await requireListener(listeners, "streamEnd")({});
    expect(order).toEqual(["terminal:7", "diagnostic"]);
  });

  test("contains synchronous diagnostic throws and rejected reporters", async () => {
    const failure = new Error("synthetic sync diagnostic failure");
    const reporter = vi.fn<(...args: [unknown, string, unknown?, (string | undefined)?]) => Promise<void>>(async () => { throw new Error("synthetic async reporter failure"); });
    const { platform, listeners } = createPlatformHarness({
      _logIncomingEvent: () => { throw failure; },
      errorHandler: { handleEventProcessingError: reporter },
    });
    setupTikTokEventListeners(platform);
    await expect(requireListener(listeners, "rawData")({})).resolves.toBeUndefined();
    expect(reporter.mock.calls).toEqual([[failure, "rawData", undefined, undefined]]);
  });

  test("control action waits for incoming diagnostics", async () => {
    let finishLog: (() => void) | undefined;
    const diagnostic = new Promise<void>((resolve) => { finishLog = resolve; });
    const { platform, listeners } = createPlatformHarness({ _logIncomingEvent: () => diagnostic });
    setupTikTokEventListeners(platform);
    const pending = requireListener(listeners, "control-error")(new Error("synthetic control error"));
    expect(platform.handleConnectionError.mock.calls).toHaveLength(0);
    finishLog?.();
    await pending;
    expect(platform.handleConnectionError.mock.calls).toHaveLength(1);
  });

  test("native EventEmitter failures do not become unhandled rejections", async () => {
    const routerPath = require.resolve("../../../../../src/platforms/tiktok/events/event-router.ts");
    const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", `
      import { EventEmitter } from 'node:events';
      import { setImmediate } from 'node:timers/promises';
      const { setupTikTokEventListeners } = await import(${JSON.stringify(routerPath)});
      const connection = new EventEmitter();
      let reports = 0;
      const platform = {
        connection, listenersConfigured: false, connectionGeneration: 1,
        WebcastEvent: { CHAT:'chat', GIFT:'gift', FOLLOW:'follow', SOCIAL:'social', ROOM_USER:'roomUser', ERROR:'webcast-error', DISCONNECT:'disconnect' },
        _logIncomingEvent: () => Promise.reject(new Error('synthetic diagnostic failure')),
        errorHandler: { handleEventProcessingError: () => { reports++; return Promise.reject(new Error('synthetic reporter failure')); } }
      };
      setupTikTokEventListeners(platform);
      connection.emit('rawData', { type: 'synthetic' });
      connection.emit('error', new Error('synthetic control failure'));
      await setImmediate();
      await setImmediate();
      if (reports !== 2) throw new Error('expected exactly two reports');
    `], { env: { PATH: process.env.PATH, NODE_ENV: "test", CHAT_BOT_CONFIG_PATH: process.env.CHAT_BOT_CONFIG_PATH }, stdout: "pipe", stderr: "pipe" });
    const [exitCode, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()]);
    expect(stderr).toBe("");
    expect(exitCode).toBe(0);
  });

  describe("rawData listener cleanup", () => {
    test("cleanup does not bulk-remove unowned rawData listeners", () => {
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
        errorHandler: { handleCleanupError: vi.fn<(...args: unknown[]) => unknown>() },
      };

      cleanupTikTokEventListeners(platform);

      expect(cleanedEvents).toEqual([]);
    });
  });

  describe("DISCONNECT resets listenersConfigured", () => {
    test("listenersConfigured should be set to false on DISCONNECT", async () => {
      const { platform, listeners } = createPlatformHarness({
        connectionActive: true,
      });

      setupTikTokEventListeners(platform);

      expect(platform.listenersConfigured).toBe(true);

      await requireListener(listeners, platform.WebcastEvent.DISCONNECT)();

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
        handleConnectionIssue: vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue(disconnectionError),
        errorHandler: {
          handleConnectionError: vi.fn<(...args: unknown[]) => unknown>(),
          handleEventProcessingError: (
            error: unknown,
            context: string,
            payload: unknown,
            message: string,
          ) => {
            handledErrors.push({ error, context, payload, message });
          },
          handleCleanupError: vi.fn<(...args: unknown[]) => unknown>(),
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
      expect(handledError.payload).toBeUndefined();
      expect(handledError.message).toBe(
        "Error handling disconnected control event",
      );
    });
  });
});
