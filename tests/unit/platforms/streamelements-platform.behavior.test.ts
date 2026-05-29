import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { EventEmitter } from "events";
import {
  type TestMockFn,
  createMockFn,
  restoreAllMocks,
  spyOn,
} from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createRecordingLogger } from "../../helpers/recording-logger";
import { createStreamElementsConfigFixture } from "../../helpers/config-fixture";
import {
  useFakeTimers,
  useRealTimers,
  advanceTimersByTime,
} from "../../helpers/bun-timers";
import {
  safeSetInterval,
  safeSetTimeout,
} from "../../../src/utils/timeout-validator";
import { promises as fs } from "fs";
import * as path from "path";
import { StreamElementsPlatform } from "../../../src/platforms/streamelements";
import {
  secrets,
  _resetForTesting,
  initializeStaticSecrets,
} from "../../../src/core/secrets";

type RetrySystemFixture = {
  incrementRetryCount: TestMockFn<[string], number>;
  resetRetryCount: TestMockFn<unknown[], unknown>;
  handleConnectionError: TestMockFn<unknown[], unknown>;
  handleConnectionSuccess: TestMockFn<unknown[], unknown>;
};

type PlatformEventEnvelope = {
  platform: string;
  type: string;
  data: {
    username?: string;
    userId?: string | null;
  };
};

type SentMessage = {
  type?: string;
  topic?: string;
};

type StreamElementsDependencyOverrides = {
  retrySystem?: RetrySystemFixture;
  logger?: unknown;
  eventBus?: unknown;
} & Record<string, unknown>;

type FileSystemPromisesFixture = {
  mkdir: (path: string, options?: { recursive?: boolean }) => Promise<void>;
  appendFile: (path: string, data: string) => Promise<void>;
};

type SpyResult<Args extends unknown[]> = {
  mock: { calls: Args[] };
  mockResolvedValue: (value: unknown) => SpyResult<Args>;
  mockRejectedValue: (error: unknown) => SpyResult<Args>;
};

const fileSystem = fs as unknown as FileSystemPromisesFixture;
const typedSpyOn = spyOn as unknown as <Target, Key extends keyof Target>(
  target: Target,
  key: Key,
) => SpyResult<Target[Key] extends (...args: infer Args) => unknown ? Args : never>;

const asMock = <Args extends unknown[], Return>(
  fn: (...args: Args) => Return,
): TestMockFn<Args, Return> => fn as TestMockFn<Args, Return>;

const getPrivateField = <Value>(target: object, key: string): Value =>
  Reflect.get(target, key) as Value;

const setPrivateField = (target: object, key: string, value: unknown): void => {
  Reflect.set(target, key, value);
};

class MockWebSocket extends EventEmitter {
  static instances: MockWebSocket[] = [];
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSED = 3;

  url: string;
  readyState: number;
  sent: string[];

  constructor(url: string) {
    super();
    this.url = url;
    this.readyState = MockWebSocket.CONNECTING;
    this.sent = [];
    MockWebSocket.instances.push(this);
  }

  send(payload: string): void {
    this.sent.push(payload);
  }

  close(): void {
    this.readyState = MockWebSocket.CLOSED;
  }
}

const createPlatform = (
  configOverrides: Parameters<typeof createStreamElementsConfigFixture>[0] = {},
  dependencyOverrides: StreamElementsDependencyOverrides = {},
) => {
  const retrySystem = dependencyOverrides.retrySystem || {
    incrementRetryCount: createMockFn<[string], number>(() => 10),
    resetRetryCount: createMockFn(),
    handleConnectionError: createMockFn(),
    handleConnectionSuccess: createMockFn(),
  };

  secrets.streamelements.jwtToken = "test-jwt-token";
  const platform = new StreamElementsPlatform(
    createStreamElementsConfigFixture({
      enabled: true,
      youtubeChannelId: "test-youtube-channel",
      twitchChannelId: "test-twitch-channel",
      dataLoggingEnabled: true,
      ...configOverrides,
    }),
    {
      logger: noOpLogger,
      WebSocketCtor: MockWebSocket,
      retrySystem,
      ...dependencyOverrides,
    } as ConstructorParameters<typeof StreamElementsPlatform>[1],
  );

  return { platform, retrySystem };
};

describe("StreamElementsPlatform behavior", () => {
  beforeEach(() => {
    MockWebSocket.instances = [];
  });

  afterEach(() => {
    useRealTimers();
    restoreAllMocks();
    _resetForTesting();
    initializeStaticSecrets();
  });

  it("initializes disabled platform and fails prerequisites", async () => {
    const platform = new StreamElementsPlatform(
      createStreamElementsConfigFixture({ enabled: false }),
      { logger: noOpLogger },
    );

    const initialized = await platform.initialize({});

    expect(initialized).toBe(false);
    expect(platform.checkConnectionPrerequisites()).toBe(false);
    expect(platform.isConnected()).toBe(false);
  });

  it("initialize calls connect when platform is enabled", async () => {
    const { platform } = createPlatform();
    platform.connect = createMockFn().mockResolvedValue(true);

    const initialized = await platform.initialize({});

    expect(initialized).toBe(true);
    expect(asMock(platform.connect).mock.calls).toHaveLength(1);
  });

  it("initialize skips connect when already connected", async () => {
    const { platform } = createPlatform();
    platform.isConnected = createMockFn(() => true);
    platform.connect = createMockFn().mockResolvedValue(true);

    const initialized = await platform.initialize({});

    expect(initialized).toBe(true);
    expect(asMock(platform.connect).mock.calls).toHaveLength(0);
  });

  it("initialize throws when connection cannot be established", async () => {
    const { platform } = createPlatform();
    platform.connect = createMockFn().mockResolvedValue(false);
    platform.isConnected = createMockFn(() => false);

    await expect(platform.initialize({})).rejects.toThrow(
      "unable to establish connection",
    );
  });

  it("skips connect when already connecting", async () => {
    const { platform } = createPlatform();

    setPrivateField(platform, "isConnecting", true);

    const result = await platform.connect();

    expect(result).toBe(false);
  });

  it("returns false when prerequisites fail", async () => {
    const platform = new StreamElementsPlatform(
      createStreamElementsConfigFixture(),
      { logger: noOpLogger },
    );

    const result = await platform.connect();

    expect(result).toBe(false);
  });

  it("connectToWebSocket resolves when the socket opens", async () => {
    const { platform } = createPlatform();

    const promise = platform.connectToWebSocket();
    const connection = MockWebSocket.instances[0]!;
    connection.readyState = MockWebSocket.OPEN;
    connection.emit("open");

    await expect(promise).resolves.toBeUndefined();
    expect(getPrivateField<MockWebSocket | null>(platform, "connection")).toBe(connection);
  });

  it("connectToWebSocket rejects when the socket errors", async () => {
    const { platform } = createPlatform();

    const promise = platform.connectToWebSocket();
    const connection = MockWebSocket.instances[0]!;
    const error = new Error("test websocket error");
    connection.emit("error", error);

    await expect(promise).rejects.toThrow("test websocket error");
  });

  it("connect opens websocket when prerequisites pass", async () => {
    const { platform } = createPlatform();
    platform.checkConnectionPrerequisites = createMockFn(() => true);
    platform.connectToWebSocket = createMockFn().mockResolvedValue();

    const connected = await platform.connect();

    expect(connected).toBe(true);
    expect(asMock(platform.connectToWebSocket).mock.calls).toHaveLength(1);
  });

  it("connect delegates websocket errors to connection error handler", async () => {
    const { platform } = createPlatform();
    platform.checkConnectionPrerequisites = createMockFn(() => true);
    platform.connectToWebSocket = createMockFn().mockRejectedValue(
      new Error("socket failed"),
    );
    platform.handleConnectionError = createMockFn();

    const connected = await platform.connect();

    expect(connected).toBe(false);
    expect(asMock(platform.handleConnectionError).mock.calls).toHaveLength(1);
  });

  it("setupEventListeners throws when connection is missing", () => {
    const { platform } = createPlatform();
    const errorHandler = { handleConnectionError: createMockFn() };
    setPrivateField(platform, "errorHandler", errorHandler);
    setPrivateField(platform, "connection", null);

    expect(() => platform.setupEventListeners()).toThrow(
      "StreamElements connection missing connection object",
    );
    expect(errorHandler.handleConnectionError.mock.calls).toHaveLength(1);
  });

  it("routes message types to the correct handlers", () => {
    const { platform } = createPlatform();
    platform.handleAuthResponse = createMockFn();
    platform.handleFollowEvent = createMockFn();
    platform.handlePing = createMockFn();

    platform.handleMessage(
      Buffer.from(JSON.stringify({ type: "auth", success: true })),
    );
    platform.handleMessage(
      Buffer.from(JSON.stringify({ type: "event", data: {} })),
    );
    platform.handleMessage(Buffer.from(JSON.stringify({ type: "ping" })));
    platform.handleMessage(Buffer.from(JSON.stringify({ type: "unknown" })));

    expect(asMock(platform.handleAuthResponse).mock.calls).toHaveLength(1);
    expect(asMock(platform.handleFollowEvent).mock.calls).toHaveLength(1);
    expect(asMock(platform.handlePing).mock.calls).toHaveLength(1);
  });

  it("summarizes inbound websocket messages without routine raw payload logging", () => {
    const logger = createRecordingLogger();
    const { platform } = createPlatform({}, { logger });
    platform.handleFollowEvent = createMockFn().mockResolvedValue();
    const inboundPayload = {
      type: "event",
      success: true,
      data: {
        platform: "youtube",
        displayName: "test-private-follower",
        userId: "test-user-id",
        rawText: "test-private-raw-payload",
      },
    };

    platform.handleMessage(Buffer.from(JSON.stringify(inboundPayload)));

    const serializedLogs = JSON.stringify(logger.entries);
    expect(serializedLogs).toContain("messageType");
    expect(serializedLogs).toContain("hasData");
    expect(serializedLogs).not.toContain("test-private-follower");
    expect(serializedLogs).not.toContain("test-private-raw-payload");
  });

  it("summarizes unknown websocket message types without logging provider values", () => {
    const logger = createRecordingLogger();
    const { platform } = createPlatform({}, { logger });

    platform.handleMessage(Buffer.from(JSON.stringify({
      type: "test-private-chat-text test-access-token",
      data: { rawText: "test-private-raw-payload" },
    })));

    const serializedLogs = JSON.stringify(logger.entries);
    expect(serializedLogs).toContain("hasType");
    expect(serializedLogs).not.toContain("test-private-chat-text");
    expect(serializedLogs).not.toContain("test-access-token");
    expect(serializedLogs).not.toContain("test-private-raw-payload");
  });

  it("summarizes auth failures without logging provider error text", () => {
    const logger = createRecordingLogger();
    const { platform } = createPlatform({}, { logger });
    platform.disconnect = createMockFn().mockResolvedValue();

    platform.handleAuthResponse({
      success: false,
      error: "test-private-auth-error test-jwt-token",
    });

    const serializedLogs = JSON.stringify(logger.entries);
    expect(serializedLogs).toContain("authentication failed");
    expect(serializedLogs).not.toContain("test-private-auth-error");
    expect(serializedLogs).not.toContain("test-jwt-token");
  });

  it("summarizes unknown follow platforms without logging provider values", async () => {
    const logger = createRecordingLogger();
    const { platform } = createPlatform({ dataLoggingEnabled: false }, { logger });

    await platform.handleFollowEvent({
      data: {
        platform: "test-private-platform test-access-token",
        displayName: "test-private-follower",
      },
    });

    const serializedLogs = JSON.stringify(logger.entries);
    expect(serializedLogs).toContain("hasPlatform");
    expect(serializedLogs).not.toContain("test-private-platform");
    expect(serializedLogs).not.toContain("test-access-token");
    expect(serializedLogs).not.toContain("test-private-follower");
  });

  it("does not log raw follower display names in routine logs", async () => {
    const logger = createRecordingLogger();
    const { platform } = createPlatform({ dataLoggingEnabled: false }, { logger });
    const emitted: PlatformEventEnvelope[] = [];
    platform.on("platform:event", (payload: PlatformEventEnvelope) => emitted.push(payload));

    await platform.handleFollowEvent({
      data: {
        platform: "youtube",
        displayName: "test-private-follower",
        userId: "test-user-id",
      },
    });

    const serializedLogs = JSON.stringify(logger.entries);
    expect(emitted[0]!.data.username).toBe("test-private-follower");
    expect(serializedLogs).toContain("hasUsername");
    expect(serializedLogs).not.toContain("test-private-follower");
  });

  it("summarizes missing username follow events without provider payload logging", async () => {
    const logger = createRecordingLogger();
    const { platform } = createPlatform({}, { logger });
    const followMessage = {
      data: {
        platform: "youtube",
        displayName: "",
        userId: "test-user-id",
        rawText: "test-private-raw-payload",
      },
    };

    await platform.handleFollowEvent(followMessage);

    const serializedLogs = JSON.stringify(logger.entries);
    expect(serializedLogs).toContain("hasDisplayName");
    expect(serializedLogs).toContain("hasUserId");
    expect(serializedLogs).not.toContain("test-private-raw-payload");
  });

  it("handles auth responses for success and failure", () => {
    const { platform } = createPlatform();
    const errorHandler = { handleAuthenticationError: createMockFn() };
    setPrivateField(platform, "errorHandler", errorHandler);
    platform.subscribeToFollowEvents = createMockFn();
    platform.disconnect = createMockFn();

    platform.handleAuthResponse({ success: true });
    platform.handleAuthResponse({ success: false, error: "denied" });

    expect(asMock(platform.subscribeToFollowEvents).mock.calls).toHaveLength(1);
    expect(errorHandler.handleAuthenticationError.mock.calls).toHaveLength(1);
    expect(asMock(platform.disconnect).mock.calls).toHaveLength(1);
  });

  it("subscribes to configured follow topics after authentication", () => {
    const { platform } = createPlatform({
      youtubeChannelId: "test-youtube-channel",
      twitchChannelId: "test-twitch-channel",
    });
    const sentMessages: SentMessage[] = [];
    platform.sendMessage = createMockFn<[SentMessage], void>((message) =>
      sentMessages.push(message),
    );

    platform.subscribeToFollowEvents();

    expect(sentMessages).toHaveLength(2);
    expect(sentMessages[0]!.topic).toBe("channel.follow.test-youtube-channel");
    expect(sentMessages[1]!.topic).toBe("channel.follow.test-twitch-channel");
  });

  it("emits follow events for supported platforms", async () => {
    const { platform } = createPlatform();
    platform.logRawPlatformData = createMockFn().mockResolvedValue();
    const emitted: PlatformEventEnvelope[] = [];
    platform.on("platform:event", (payload: PlatformEventEnvelope) => emitted.push(payload));

    await platform.handleFollowEvent({
      data: {
        platform: "twitch",
        displayName: "TestFollower",
        userId: "test-user-1",
      },
    });

    expect(emitted).toHaveLength(1);
    expect(emitted[0]!.platform).toBe("twitch");
    expect(emitted[0]!.type).toBe("platform:follow");
    expect(emitted[0]!.data.username).toBe("TestFollower");
    expect(emitted[0]!.data.userId).toBe("test-user-1");
  });

  it("forwards follow events through injected onFollow handlers", async () => {
    const { platform } = createPlatform();
    platform.connect = createMockFn().mockResolvedValue(true);
    platform.logRawPlatformData = createMockFn().mockResolvedValue();
    const onFollow = createMockFn();

    await platform.initialize({ onFollow });
    await platform.handleFollowEvent({
      data: {
        platform: "youtube",
        displayName: "TestFollower",
        userId: "test-user-1",
      },
    });

    expect(onFollow.mock.calls).toHaveLength(1);
    expect(onFollow.mock.calls[0]![0]).toMatchObject({
      platform: "youtube",
      username: "TestFollower",
      source: "streamelements",
    });
  });

  it("routes follow events to event bus through default handlers", async () => {
    const eventBus = { emit: createMockFn<[string, PlatformEventEnvelope], unknown>() };
    const { platform } = createPlatform(
      { dataLoggingEnabled: false },
      { eventBus },
    );

    await platform.handleFollowEvent({
      data: {
        platform: "twitch",
        displayName: "BusFollower",
        userId: "bus-user",
      },
    });

    expect(eventBus.emit.mock.calls).toHaveLength(1);
    const [eventName, payload] = eventBus.emit.mock.calls[0]!;
    expect(eventName).toBe("platform:event");
    expect(payload.platform).toBe("twitch");
    expect(payload.type).toBe("platform:follow");
    expect(payload.data.username).toBe("BusFollower");
  });

  it("skips follow events with unknown platforms or missing usernames", async () => {
    const { platform } = createPlatform();
    platform.logRawPlatformData = createMockFn().mockResolvedValue();
    const emitted: PlatformEventEnvelope[] = [];
    platform.on("platform:event", (payload: PlatformEventEnvelope) => emitted.push(payload));

    await platform.handleFollowEvent({
      data: {
        platform: "unknown",
        displayName: "TestUser",
        userId: "test-user-2",
      },
    });

    await platform.handleFollowEvent({
      data: {
        platform: "youtube",
        displayName: "",
        userId: "test-user-3",
      },
    });

    expect(emitted).toHaveLength(0);
  });

  it("logs raw platform data as NDJSON", async () => {
    const { platform } = createPlatform({ dataLoggingEnabled: true });
    const mkdirSpy = typedSpyOn(fileSystem, "mkdir").mockResolvedValue(undefined);
    const appendSpy = typedSpyOn(fileSystem, "appendFile").mockResolvedValue(undefined);
    const payload = { type: "follow", data: { id: "test-follow" } };

    await platform.logRawPlatformData("follow", payload);

    expect(mkdirSpy.mock.calls).toHaveLength(1);
    expect(appendSpy.mock.calls).toHaveLength(1);

    const [filePath, logLine] = appendSpy.mock.calls[0]!;
    expect(filePath).toBe(
      path.join("./logs", "streamelements-data-log.ndjson"),
    );

    const entry = JSON.parse(logLine as string);
    expect(entry).toMatchObject({
      platform: "streamelements",
      eventType: "follow",
      payload,
    });
    expect(typeof entry.ingestTimestamp).toBe("string");
  });

  it("routes log errors through the error handler", async () => {
    const { platform } = createPlatform({ dataLoggingEnabled: true });
    const errorHandler = { handleDataLoggingError: createMockFn() };
    setPrivateField(platform, "errorHandler", errorHandler);
    typedSpyOn(fileSystem, "mkdir").mockResolvedValue(undefined);
    typedSpyOn(fileSystem, "appendFile").mockRejectedValue(new Error("disk full"));

    await platform.logRawPlatformData("follow", { id: "test-follow" });

    expect(errorHandler.handleDataLoggingError.mock.calls).toHaveLength(1);
  });

  it("summarizes websocket close reasons without logging provider text", () => {
    const logger = createRecordingLogger();
    const { platform } = createPlatform({}, { logger });
    platform.stopKeepAlive = createMockFn();
    platform.cleanup = createMockFn();
    platform.scheduleReconnection = createMockFn();

    platform.handleConnectionClose(4000, "test-private-close-reason test-access-token");

    const serializedLogs = JSON.stringify(logger.entries);
    expect(serializedLogs).toContain("hasReason");
    expect(serializedLogs).not.toContain("test-private-close-reason");
    expect(serializedLogs).not.toContain("test-access-token");
  });

  it("sends auth and ping messages when connected", () => {
    useFakeTimers();
    const { platform } = createPlatform();
    const connection = new MockWebSocket("ws://test");
    connection.readyState = MockWebSocket.OPEN;
    setPrivateField(platform, "connection", connection);

    platform.handleConnectionOpen();
    advanceTimersByTime(30000);

    const sentPayloads = connection.sent.map((payload: string) => JSON.parse(payload) as SentMessage);
    expect(sentPayloads[0]!.type).toBe("auth");
    expect(sentPayloads[1]!.type).toBe("ping");
    expect(getPrivateField<boolean>(platform, "isReady")).toBe(true);
  });

  it("schedules reconnection attempts when requested", () => {
    useFakeTimers();
    const { platform } = createPlatform();
    setPrivateField(platform, "incrementRetryCount", createMockFn(() => 10));
    platform.connect = createMockFn();
    platform.isConnected = createMockFn(() => false);

    platform.scheduleReconnection();
    advanceTimersByTime(10);

    expect(asMock(platform.connect).mock.calls).toHaveLength(1);
  });

  it("cleans up connections when disconnecting", async () => {
    const { platform } = createPlatform();
    const removeAllListeners = createMockFn();
    setPrivateField(platform, "connection", {
      readyState: MockWebSocket.OPEN,
      on: createMockFn(),
      once: createMockFn(),
      send: createMockFn(),
      close: createMockFn(),
      removeAllListeners,
    });
    setPrivateField(platform, "pingInterval", safeSetInterval(() => {}, 1000));
    setPrivateField(platform, "reconnectTimeout", safeSetTimeout(() => {}, 1000));

    await platform.disconnect();

    expect(getPrivateField<unknown>(platform, "connection")).toBe(null);
    expect(getPrivateField<unknown>(platform, "reconnectTimeout")).toBe(null);
    expect(getPrivateField<unknown>(platform, "pingInterval")).toBe(null);
  });

  it("clears connections during cleanup even when listeners throw", () => {
    const { platform } = createPlatform();
    setPrivateField(platform, "connection", {
      readyState: MockWebSocket.OPEN,
      on: createMockFn(),
      once: createMockFn(),
      send: createMockFn(),
      close: createMockFn(),
      removeAllListeners: () => {
        throw new Error("cleanup failed");
      },
    });

    platform.cleanup();

    expect(getPrivateField<unknown>(platform, "connection")).toBe(null);
    expect(getPrivateField<unknown>(platform, "connectionTime")).toBe(null);
  });

  it("does not send messages when the socket is closed", () => {
    const { platform } = createPlatform();
    const send = createMockFn();
    setPrivateField(platform, "connection", {
      readyState: MockWebSocket.CONNECTING,
      on: createMockFn(),
      once: createMockFn(),
      send,
      close: createMockFn(),
      removeAllListeners: createMockFn(),
    });

    platform.sendMessage({ type: "ping" });

    expect(send.mock.calls).toHaveLength(0);
  });
});
