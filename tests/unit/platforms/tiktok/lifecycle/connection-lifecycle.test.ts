import { describe, it, expect, afterEach } from "bun:test";
import {
  type TestMockFn,
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../../helpers/mock-factories";
import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";
import { PlatformEvents } from "../../../../../src/interfaces/PlatformEvents";

type WebcastEventMap = {
  CHAT: string;
  GIFT: string;
  FOLLOW: string;
  SOCIAL: string;
  ROOM_USER: string;
  ENVELOPE?: string;
  SUBSCRIBE?: string;
  SUPER_FAN?: string;
  ERROR: string;
  DISCONNECT: string;
  STREAM_END?: string;
};
type PlatformEventPayload = Record<string, unknown> & {
  type?: string;
  platform?: string;
  data?: Record<string, unknown>;
};
type EventHandler = (payload: unknown) => void | Promise<void>;
type TikTokConnectionFake = {
  connect: TestMockFn<[], Promise<unknown>>;
  disconnect: TestMockFn<[], Promise<unknown>>;
  on: TestMockFn<[eventName: string, handler: EventHandler], void>;
  removeAllListeners: TestMockFn<[eventName?: string], void>;
};
type RetrySystemFake = {
  resetRetryCount: TestMockFn<[platform: string], void>;
  handleConnectionError: TestMockFn<
    [
      platform: string,
      error: unknown,
      reconnect: () => Promise<void>,
      cleanup: () => Promise<void>,
    ],
    void
  >;
  isConnected: TestMockFn<[platform: string], boolean | undefined>;
};
type DependencyOverrides = {
  logger?: typeof noOpLogger;
  notificationManager?: unknown;
  connectionFactory?: {
    createConnection: (platform: string, config: unknown, dependencies: unknown) => unknown;
  };
  TikTokWebSocketClient?: unknown;
  WebcastEvent?: WebcastEventMap;
  ControlEvent?: Record<string, string>;
  retrySystem?: RetrySystemFake;
};

const expectDefined = <T>(value: T | undefined): T => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error("Expected value to be defined");
  }
  return value;
};

const isPlatformEventPayload = (payload: unknown): payload is PlatformEventPayload =>
  typeof payload === "object" && payload !== null;

const capturePlatformEvent = (target: PlatformEventPayload[]) => (payload: unknown) => {
  if (isPlatformEventPayload(payload)) {
    target.push(payload);
  }
};

const createConnectionFake = (
  overrides: Partial<TikTokConnectionFake> = {},
): TikTokConnectionFake => ({
  connect: createMockFn<[], Promise<unknown>>().mockResolvedValue(undefined),
  disconnect: createMockFn<[], Promise<unknown>>().mockResolvedValue(undefined),
  on: createMockFn<[eventName: string, handler: EventHandler], void>(),
  removeAllListeners: createMockFn<[eventName?: string], void>(),
  ...overrides,
});

const defaultWebcastEvent = {
  CHAT: "chat",
  GIFT: "gift",
  FOLLOW: "follow",
  SOCIAL: "social",
  ROOM_USER: "roomUser",
  ERROR: "error",
  DISCONNECT: "disconnect",
} satisfies WebcastEventMap;

const createRetrySystem = (): RetrySystemFake => ({
  resetRetryCount: createMockFn<[platform: string], void>(),
  handleConnectionError: createMockFn<
    [
      platform: string,
      error: unknown,
      reconnect: () => Promise<void>,
      cleanup: () => Promise<void>,
    ],
    void
  >(),
  isConnected: createMockFn<[platform: string], boolean | undefined>(),
});

const createPlatform = (
  configOverrides: Record<string, unknown> = {},
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
      emit: createMockFn(),
      ...createConnectionFake(),
    }),
  };

  const TikTokWebSocketClient =
    dependencyOverrides.TikTokWebSocketClient ||
    createMockFn().mockImplementation(() => ({
      on: createMockFn(),
      off: createMockFn(),
      connect: createMockFn().mockResolvedValue(undefined),
      disconnect: createMockFn().mockResolvedValue(undefined),
      getState: createMockFn().mockReturnValue("DISCONNECTED"),
      isConnecting: false,
      isConnected: false,
    }));

  const WebcastEvent = dependencyOverrides.WebcastEvent || defaultWebcastEvent;
  const ControlEvent = dependencyOverrides.ControlEvent || {};

  const config = {
    enabled: true,
    username: "testUser",
    ...configOverrides,
  };

  const dependencies = {
    logger,
    notificationManager,
    TikTokWebSocketClient,
    WebcastEvent,
    ControlEvent,
    connectionFactory,
  };

  return new TikTokPlatform(
    config,
    dependencyOverrides.retrySystem === undefined
      ? dependencies
      : { ...dependencies, retrySystem: dependencyOverrides.retrySystem },
  );
};

const replaceCreateIntervalWithMock = (platform: ReturnType<typeof createPlatform>) => {
  const createInterval = createMockFn<
    Parameters<typeof platform.intervalManager.createInterval>,
    ReturnType<typeof platform.intervalManager.createInterval>
  >();
  platform.intervalManager.createInterval = createInterval;
  return createInterval;
};

const createSharePayload = (overrides: Record<string, unknown> = {}) => ({
  user: {
    userId: "test-share-user-id",
    uniqueId: "test-share-user",
    nickname: "Test Share User",
  },
  common: {
    msgId: "test-share-msg-1",
    displayText: {
      displayType: "pm_mt_guidance_share",
      defaultPattern: "{0:user} shared the LIVE",
    },
    createTime: Date.parse("2024-01-01T00:00:00Z"),
  },
  ...overrides,
});

describe("TikTokPlatform connection lifecycle", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  describe("initialize", () => {
    it("stores handlers and merges with defaults", async () => {
      const platform = createPlatform();
      platform._connect = createMockFn().mockResolvedValue();
      const testHandler = createMockFn();

      await platform.initialize({ onChat: testHandler });

      expect(platform.handlers.onChat).toBe(testHandler);
    });

    it("propagates error when connection fails", async () => {
      const platform = createPlatform();
      platform._connect = createMockFn().mockRejectedValue(
        new Error("connection failed"),
      );

      await expect(platform.initialize({})).rejects.toThrow(
        "connection failed",
      );
    });

    it("schedules deferred reconnect checks for offline initialization failures", async () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      platform.intervalManager.hasInterval = createMockFn().mockReturnValue(false);
      const createInterval = replaceCreateIntervalWithMock(platform);
      platform._connect = createMockFn().mockRejectedValue(
        new Error("Connection closed: User is not live"),
      );

      await expect(platform.initialize({})).rejects.toThrow(
        "Connection closed: User is not live",
      );
      expect(retrySystem.handleConnectionError).not.toHaveBeenCalled();
      expect(createInterval).toHaveBeenCalledTimes(1);
      expect(expectDefined(createInterval.mock.calls[0])[0]).toBe(
        "tiktok-stream-reconnect",
      );
    });
  });

  describe("handleConnectionSuccess", () => {
    it("returns early when connectionActive is already true", async () => {
      const platform = createPlatform();
      platform.connectionActive = true;
      const emittedEvents: PlatformEventPayload[] = [];
      platform.on("platform:event", capturePlatformEvent(emittedEvents));

      await platform.handleConnectionSuccess();

      expect(emittedEvents).toHaveLength(0);
    });

    it("sets connectionActive=true and records connectionTime", async () => {
      const platform = createPlatform();
      platform.connectionActive = false;
      platform.connectionTime = 0;

      await platform.handleConnectionSuccess();

      expect(platform.connectionActive).toBe(true);
      expect(platform.connectionTime).toBeGreaterThan(0);
    });

    it("resets isPlannedDisconnection flag", async () => {
      const platform = createPlatform();
      platform.connectionActive = false;
      platform.isPlannedDisconnection = true;

      await platform.handleConnectionSuccess();

      expect(platform.isPlannedDisconnection).toBe(false);
    });

    it("emits CHAT_CONNECTED event", async () => {
      const platform = createPlatform();
      platform.connectionActive = false;
      const emittedEvents: PlatformEventPayload[] = [];
      platform.on("platform:event", capturePlatformEvent(emittedEvents));

      await platform.handleConnectionSuccess();

      const connectedEvent = expectDefined(emittedEvents.find(
        (e) => e.type === PlatformEvents.CHAT_CONNECTED,
      ));
      expect(connectedEvent).toBeDefined();
      expect(connectedEvent.platform).toBe("tiktok");
    });
  });

  describe("handleConnectionError", () => {
    it("cleans up event listeners and resets connection state", () => {
      const platform = createPlatform();
      platform.connection = createConnectionFake();
      platform.listenersConfigured = true;
      platform.connectionActive = true;

      platform.handleConnectionError(new Error("test error"));

      expect(platform.connection).toBeNull();
      expect(platform.listenersConfigured).toBe(false);
      expect(platform.connectionActive).toBe(false);
    });

    it("clears tracked share actors when stream is not live", async () => {
      const platform = createPlatform();
      const shares: PlatformEventPayload[] = [];
      platform.handlers = {
        ...platform.handlers,
        onShare: (data) => {
          if (isPlatformEventPayload(data)) {
            shares.push(data);
          }
        },
      };

      await platform._handleShare(
        createSharePayload({
          common: {
            msgId: "test-share-msg-error-a",
            createTime: Date.parse("2024-01-01T00:00:00Z"),
          },
        }),
      );
      platform.handleConnectionError({
        message: "Stream is not live",
        code: 4404,
      });
      await platform._handleShare(
        createSharePayload({
          common: {
            msgId: "test-share-msg-error-b",
            createTime: Date.parse("2024-01-01T00:00:01Z"),
          },
        }),
      );

      expect(shares).toHaveLength(2);
    });

    it("keeps tracked share actors on recoverable connection errors", async () => {
      const platform = createPlatform();
      const shares: PlatformEventPayload[] = [];
      platform.handlers = {
        ...platform.handlers,
        onShare: (data) => {
          if (isPlatformEventPayload(data)) {
            shares.push(data);
          }
        },
      };

      await platform._handleShare(
        createSharePayload({
          common: {
            msgId: "test-share-msg-error-c",
            createTime: Date.parse("2024-01-01T00:00:00Z"),
          },
        }),
      );
      platform.handleConnectionError(new Error("network timeout"));
      await platform._handleShare(
        createSharePayload({
          common: {
            msgId: "test-share-msg-error-d",
            createTime: Date.parse("2024-01-01T00:00:01Z"),
          },
        }),
      );

      expect(shares).toHaveLength(1);
    });
  });

  describe("handleRetry", () => {
    it("returns skipped result for non-recoverable errors", () => {
      const platform = createPlatform();

      const result = platform.handleRetry(new Error("username is required"));

      expect(result).toEqual({ action: "skipped", reason: "non-recoverable" });
    });

    it("returns retry-queued result for recoverable errors", () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      platform.retryLock = false;

      const result = platform.handleRetry(new Error("connection timeout"));

      expect(result).toEqual({ action: "retry-queued" });
    });

    it("schedules deferred reconnect checks for not-live disconnects", () => {
      const platform = createPlatform();
      platform.intervalManager.hasInterval = createMockFn().mockReturnValue(false);
      const createInterval = replaceCreateIntervalWithMock(platform);

      const result = platform.handleRetry(
        new Error("Connection closed: User is not live"),
      );

      expect(result).toEqual({ action: "deferred-reconnect-scheduled" });
      expect(createInterval).toHaveBeenCalledTimes(1);
    });
  });

  describe("queueRetry", () => {
    it("returns queued=true and sets retryLock when successful", () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      platform.retryLock = false;

      const result = platform.queueRetry(new Error("test"));

      expect(result).toEqual({ queued: true });
      expect(platform.retryLock).toBe(true);
    });

    it("returns queued=false with reason locked when already locked", () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      platform.retryLock = true;

      const result = platform.queueRetry(new Error("test"));

      expect(result).toEqual({ queued: false, reason: "locked" });
      expect(platform.retryLock).toBe(true);
    });

    it("routes reconnect callback failures through handleRetry", async () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      platform.retryLock = false;
      platform._connect = createMockFn().mockRejectedValue(
        new Error("Connection closed: User is not live"),
      );
      const handleRetry = createMockFn<
        [err: unknown],
        { action: string; reason?: string }
      >().mockReturnValue({
        action: "skipped",
        reason: "non-recoverable",
      });
      platform.handleRetry = handleRetry;

      platform.queueRetry(new Error("connection timeout"));
      const reconnectFn = expectDefined(
        retrySystem.handleConnectionError.mock.calls[0],
      )[2];

      await reconnectFn();

      expect(handleRetry).toHaveBeenCalledTimes(1);
      const retryError = expectDefined(handleRetry.mock.calls[0])[0];
      expect(retryError).toBeInstanceOf(Error);
      expect(retryError instanceof Error ? retryError.message : undefined).toBe(
        "Connection closed: User is not live",
      );
    });
  });

  describe("handleConnectionIssue", () => {
    it("sets connectionActive=false and cleans up", async () => {
      const platform = createPlatform();
      platform.connectionActive = true;
      platform.connection = createConnectionFake();

      await platform.handleConnectionIssue("stream ended");

      expect(platform.connectionActive).toBe(false);
      expect(platform.connection).toBeNull();
    });

    it("emits disconnection event", async () => {
      const platform = createPlatform();
      const emittedEvents: PlatformEventPayload[] = [];
      platform.on("platform:event", capturePlatformEvent(emittedEvents));

      await platform.handleConnectionIssue("stream ended");

      const disconnectEvent = emittedEvents.find(
        (e) => e.type === PlatformEvents.CHAT_DISCONNECTED,
      );
      expect(disconnectEvent).toBeDefined();
    });

    it("returns issueType=disconnection for regular disconnections", async () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      platform.retryLock = false;

      const result = await platform.handleConnectionIssue("stream ended");

      expect(result.issueType).toBe("disconnection");
      expect(result.retryResult).toEqual({ queued: true });
    });

    it("returns issueType=error when isError=true", async () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      platform.retryLock = false;

      const result = await platform.handleConnectionIssue(
        new Error("test error"),
        true,
      );

      expect(result.issueType).toBe("error");
      expect(result.retryResult).toEqual({ queued: true });
    });

    it("returns issueType=stream-not-live for not-live messages", async () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      platform.retryLock = false;

      const result = await platform.handleConnectionIssue({
        message: "Stream is not live",
        code: 4404,
      });

      expect(result.issueType).toBe("stream-not-live");
      expect(result.retryResult).toEqual({
        queued: false,
        reason: "deferred-reconnect-scheduled",
      });
    });

    it("emits stream-status disconnects with willReconnect=true for not-live issues", async () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      platform.intervalManager.hasInterval = createMockFn().mockReturnValue(false);
      const createInterval = replaceCreateIntervalWithMock(platform);
      const emittedEvents: PlatformEventPayload[] = [];
      platform.on("platform:event", capturePlatformEvent(emittedEvents));

      await platform.handleConnectionIssue({
        message: "Stream is not live",
        code: 4404,
      });

      const disconnectEvent = expectDefined(emittedEvents.find(
        (e) => e.type === PlatformEvents.CHAT_DISCONNECTED,
      ));
      expect(disconnectEvent).toBeDefined();
      expect(expectDefined(disconnectEvent.data).willReconnect).toBe(true);
      expect(createInterval).toHaveBeenCalledTimes(1);
    });

    it("keeps tracked share actors on transient disconnection", async () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      const shares: PlatformEventPayload[] = [];
      platform.handlers = {
        ...platform.handlers,
        onShare: (data) => {
          if (isPlatformEventPayload(data)) {
            shares.push(data);
          }
        },
      };

      await platform._handleShare(
        createSharePayload({
          common: {
            msgId: "test-share-msg-a",
            createTime: Date.parse("2024-01-01T00:00:00Z"),
          },
        }),
      );
      await platform.handleConnectionIssue("temporary network interruption");
      await platform._handleShare(
        createSharePayload({
          common: {
            msgId: "test-share-msg-b",
            createTime: Date.parse("2024-01-01T00:00:01Z"),
          },
        }),
      );

      expect(shares).toHaveLength(1);
    });

    it("clears tracked share actors on stream-not-live boundary", async () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      const shares: PlatformEventPayload[] = [];
      platform.handlers = {
        ...platform.handlers,
        onShare: (data) => {
          if (isPlatformEventPayload(data)) {
            shares.push(data);
          }
        },
      };

      await platform._handleShare(
        createSharePayload({
          common: {
            msgId: "test-share-msg-c",
            createTime: Date.parse("2024-01-01T00:00:00Z"),
          },
        }),
      );
      await platform.handleConnectionIssue({
        message: "Stream is not live",
        code: 4404,
      });
      await platform._handleShare(
        createSharePayload({
          common: {
            msgId: "test-share-msg-d",
            createTime: Date.parse("2024-01-01T00:00:01Z"),
          },
        }),
      );

      expect(shares).toHaveLength(2);
    });

    it("skips retry when platform is disabled", async () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({ enabled: false }, { retrySystem });
      platform.queueRetry = createMockFn().mockReturnValue({ queued: true });

      const result = await platform.handleConnectionIssue("stream ended");

      expect(result.retryResult).toEqual({
        queued: false,
        reason: "no-retry-needed",
      });
    });

    it("skips retry when disconnection is planned", async () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      platform.queueRetry = createMockFn().mockReturnValue({ queued: true });
      platform.isPlannedDisconnection = true;

      const result = await platform.handleConnectionIssue("stream ended");

      expect(result.retryResult).toEqual({
        queued: false,
        reason: "no-retry-needed",
      });
    });

    it("skips retry for terminal account/config disconnect reasons", async () => {
      const retrySystem = createRetrySystem();
      const platform = createPlatform({}, { retrySystem });
      platform.queueRetry = createMockFn().mockReturnValue({ queued: true });

      const result = await platform.handleConnectionIssue("private account");

      expect(result.retryResult).toEqual({
        queued: false,
        reason: "terminal-error",
      });
      expect(platform.queueRetry).not.toHaveBeenCalled();
    });
  });

  describe("_handleStreamEnd", () => {
    it("clears tracked share actors when stream end is handled", async () => {
      const platform = createPlatform();
      const shares: PlatformEventPayload[] = [];
      platform.handlers = {
        ...platform.handlers,
        onShare: (data) => {
          if (isPlatformEventPayload(data)) {
            shares.push(data);
          }
        },
      };
      platform.intervalManager.hasInterval =
        createMockFn().mockReturnValue(true);

      await platform._handleShare(
        createSharePayload({
          common: {
            msgId: "test-share-msg-e",
            createTime: Date.parse("2024-01-01T00:00:00Z"),
          },
        }),
      );
      await platform._handleStreamEnd();
      await platform._handleShare(
        createSharePayload({
          common: {
            msgId: "test-share-msg-f",
            createTime: Date.parse("2024-01-01T00:00:01Z"),
          },
        }),
      );

      expect(shares).toHaveLength(2);
    });

    it("keeps stream-end reconnect polling active after an offline disconnect cycle", async () => {
      const platform = createPlatform();
      platform.intervalManager.hasInterval =
        createMockFn().mockReturnValueOnce(false).mockReturnValue(true);
      const createInterval = replaceCreateIntervalWithMock(platform);

      await platform.handleConnectionIssue({
        message: "Stream is not live",
        code: 4404,
      });
      await platform._handleStreamEnd({ reason: "User is not live" });

      expect(createInterval).toHaveBeenCalledTimes(1);
      expect(expectDefined(createInterval.mock.calls[0])[0]).toBe(
        "tiktok-stream-reconnect",
      );
    });

    it("starts stream-end reconnect polling for normal stream-end handling", async () => {
      const platform = createPlatform();
      platform.intervalManager.hasInterval =
        createMockFn().mockReturnValue(false);
      const createInterval = replaceCreateIntervalWithMock(platform);

      await platform._handleStreamEnd({});

      expect(createInterval).toHaveBeenCalledTimes(1);
      expect(expectDefined(createInterval.mock.calls[0])[0]).toBe(
        "tiktok-stream-reconnect",
      );
    });

    it("emits disconnect lifecycle with willReconnect=true for stream-not-live end", async () => {
      const platform = createPlatform();
      platform.intervalManager.hasInterval =
        createMockFn().mockReturnValue(false);
      const createInterval = replaceCreateIntervalWithMock(platform);
      const emittedEvents: PlatformEventPayload[] = [];
      platform.on("platform:event", capturePlatformEvent(emittedEvents));

      await platform._handleStreamEnd({
        message: "Stream is not live",
        code: 4404,
      });

      const disconnectEvent = expectDefined(emittedEvents.find(
        (e) => e.type === PlatformEvents.CHAT_DISCONNECTED,
      ));
      expect(disconnectEvent).toBeDefined();
      expect(expectDefined(disconnectEvent.data).willReconnect).toBe(true);
      expect(createInterval).toHaveBeenCalledTimes(1);
    });
  });
});
