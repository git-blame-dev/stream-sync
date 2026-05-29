import { describe, it, expect, afterEach } from "bun:test";
import { createMockFn } from "../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../helpers/mock-factories";

import { PlatformEvents } from "../../../../src/interfaces/PlatformEvents";
import { TwitchPlatform } from "../../../../src/platforms/twitch.ts";

type TwitchPlatformInstance = InstanceType<typeof TwitchPlatform>;
type TwitchConfig = ConstructorParameters<typeof TwitchPlatform>[0];
type TwitchDependencies = NonNullable<ConstructorParameters<typeof TwitchPlatform>[1]>;
type TwitchAuthDependency = NonNullable<TwitchDependencies["twitchAuth"]>;
type TwitchAuth = NonNullable<TwitchDependencies["twitchAuth"]> & {
  getUserId: () => string;
};
type TwitchEventSub = NonNullable<TwitchPlatformInstance["eventSub"]>;
type TwitchEventSubConstructor = NonNullable<TwitchDependencies["TwitchEventSub"]>;
type ViewerCountProvider = NonNullable<TwitchPlatformInstance["viewerCountProvider"]>;
type EventSubWiring = NonNullable<TwitchPlatformInstance["eventSubWiring"]>;
type RawPlatformDataCall = [
  platform: string,
  eventType: string,
  data: unknown,
  config: TwitchConfig,
];
type PlatformEventEnvelope = {
  type: string;
  data: Record<string, unknown>;
};
type StreamStatusPayload = {
  metadata?: { correlationId?: string };
};
type ChatPayload = {
  message: Record<string, unknown>;
};
type RaidPayload = {
  username?: string;
  raider?: unknown;
};

const isPlatformEventEnvelope = (value: unknown): value is PlatformEventEnvelope => {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.type === "string" &&
    candidate.data !== null &&
    typeof candidate.data === "object"
  );
};

const requireDefined = <T>(value: T | undefined, label: string): T => {
  expect(value).toBeDefined();
  if (value === undefined) {
    throw new Error(`${label} was not captured`);
  }
  return value;
};

const requireStubChatFileLoggingService = (
  value: TwitchPlatformInstance["chatFileLoggingService"],
): StubChatFileLoggingService => {
  expect(value).toBeInstanceOf(StubChatFileLoggingService);
  if (!(value instanceof StubChatFileLoggingService)) {
    throw new Error("Expected stub chat file logging service");
  }
  return value;
};

const createReadyTwitchAuth = (): TwitchAuth => ({
  isReady: () => true,
  getUserId: () => "test-user-id",
});

class StubChatFileLoggingService {
  logRawPlatformDataCalls: RawPlatformDataCall[];

  constructor() {
    this.logRawPlatformDataCalls = [];
  }

  async logRawPlatformData(...args: RawPlatformDataCall): Promise<void> {
    this.logRawPlatformDataCalls.push(args);
  }
}

const flushAsync = () => new Promise((resolve) => setImmediate(resolve));

class StubTwitchApiClient {
  constructor(_twitchAuth: TwitchAuthDependency, _config: TwitchConfig) {}

  getBroadcasterId = createMockFn<[string], Promise<string>>().mockResolvedValue(
    "test-broadcaster-id",
  );
  getStreamInfo = createMockFn<
    [],
    Promise<{ isLive: boolean; stream: unknown; viewerCount: number }>
  >().mockResolvedValue({ isLive: false, stream: null, viewerCount: 0 });
  getGlobalChatBadges = createMockFn().mockResolvedValue([]);
  getChannelChatBadges = createMockFn().mockResolvedValue([]);
}

const createEventSub = (overrides: Partial<TwitchEventSub> = {}): TwitchEventSub => ({
  initialize: async () => {},
  sendMessage: async () => {},
  isConnected: () => true,
  isActive: () => true,
  ...overrides,
});

const createEventSubConstructor = (eventSub: TwitchEventSub): TwitchEventSubConstructor => {
  class ReusableTwitchEventSub {
    initialize = eventSub.initialize;
    sendMessage = eventSub.sendMessage;

    constructor(_config: Record<string, unknown>, _dependencies: Record<string, unknown>) {
      return eventSub;
    }
  }

  return ReusableTwitchEventSub;
};

const createPlatform = (
  configOverrides: Partial<TwitchConfig> = {},
  depsOverrides: Partial<TwitchDependencies> = {},
): TwitchPlatformInstance => {
  const config = {
    enabled: true,
    username: "teststreamer",
    channel: "teststreamer",
    clientId: "test-client-id",
    dataLoggingEnabled: false,
    ...configOverrides,
  };
  if (!depsOverrides.twitchAuth) {
    throw new Error("twitchAuth is required - provide explicit mock");
  }
  const twitchAuth = depsOverrides.twitchAuth;

  return new TwitchPlatform(config, {
    logger: noOpLogger,
    twitchAuth,
    timestampService: { extractTimestamp: () => new Date().toISOString() },
    ChatFileLoggingService: StubChatFileLoggingService,
    TwitchApiClient: StubTwitchApiClient,
    ...depsOverrides,
  });
};

describe("TwitchPlatform core behavior", () => {
  let platform: TwitchPlatformInstance | undefined;

  afterEach(() => {
    if (platform?.cleanup) {
      platform.cleanup().catch(() => {});
    }
  });

  it("returns isReady=false with issue when enabled but not connected", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    platform.eventSub = null;

    const status = platform.getStatus();

    expect(status.isReady).toBe(false);
    expect(status.issues).toContain("Not connected");
  });

  it("returns isReady=true when EventSub is connected and active", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    platform.eventSub = createEventSub({
      isConnected: () => true,
      isActive: () => true,
    });

    const status = platform.getStatus();

    expect(status.isReady).toBe(true);
    expect(status.issues).toEqual([]);
  });

  it("returns isReady=false when EventSub is connected but inactive", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    platform.eventSub = createEventSub({
      isConnected: () => true,
      isActive: () => false,
    });

    const status = platform.getStatus();

    expect(status.isReady).toBe(false);
    expect(status.issues).toContain("EventSub not active");
  });

  it("fails EventSub initialization when auth is not ready", async () => {
    const pendingAuth: TwitchAuth = { isReady: () => false, getUserId: () => "test-user-id" };
    platform = createPlatform(
      {},
      { twitchAuth: pendingAuth, TwitchEventSub: createEventSubConstructor(createEventSub()) },
    );

    await expect(platform.initializeEventSub("test-user-id")).rejects.toThrow(
      "Twitch authentication is not ready",
    );
    expect(platform.eventSub).toBeNull();
  });

  it("fails platform initialization when EventSub has no event binding interface", async () => {
    const eventSubWithoutOn = {
      initialize: createMockFn<[], Promise<void>>().mockResolvedValue(),
      sendMessage: createMockFn<[string], Promise<void>>().mockResolvedValue(),
      isConnected: () => true,
    };
    platform = createPlatform(
      {},
      {
        twitchAuth: createReadyTwitchAuth(),
        TwitchEventSub: createEventSubConstructor(eventSubWithoutOn),
      },
    );

    await expect(platform.initialize({})).rejects.toThrow(
      "Twitch EventSub connection missing event emitter interface (on)",
    );
  });

  it("fails platform initialization when EventSub has no connectivity interface", async () => {
    const eventSubWithoutConnectivity = {
      initialize: createMockFn<[], Promise<void>>().mockResolvedValue(),
      sendMessage: createMockFn<[string], Promise<void>>().mockResolvedValue(),
      on: createMockFn(),
    };
    platform = createPlatform(
      {},
      {
        twitchAuth: createReadyTwitchAuth(),
        TwitchEventSub: createEventSubConstructor(eventSubWithoutConnectivity),
      },
    );

    await expect(platform.initialize({})).rejects.toThrow(
      "Twitch EventSub connection missing isConnected()",
    );
  });

  it("fails platform initialization when EventSub has no active-state interface", async () => {
    const eventSubWithoutActiveState = {
      initialize: createMockFn<[], Promise<void>>().mockResolvedValue(),
      sendMessage: createMockFn<[string], Promise<void>>().mockResolvedValue(),
      on: createMockFn(),
      isConnected: () => true,
    };
    platform = createPlatform(
      {},
      {
        twitchAuth: createReadyTwitchAuth(),
        TwitchEventSub: createEventSubConstructor(eventSubWithoutActiveState),
      },
    );

    await expect(platform.initialize({})).rejects.toThrow(
      "Twitch EventSub connection missing isActive()",
    );
  });

  it("fails platform initialization when EventSub is not connected after initialize", async () => {
    const disconnectedEventSub = {
      initialize: createMockFn<[], Promise<void>>().mockResolvedValue(),
      sendMessage: createMockFn<[string], Promise<void>>().mockResolvedValue(),
      on: createMockFn(),
      isConnected: () => false,
      isActive: () => false,
    };
    platform = createPlatform(
      {},
      {
        twitchAuth: createReadyTwitchAuth(),
        TwitchEventSub: createEventSubConstructor(disconnectedEventSub),
      },
    );

    await expect(platform.initialize({})).rejects.toThrow(
      "Twitch EventSub initialization failed: connection is not active",
    );
  });

  it("resets connection state when platform initialization fails", async () => {
    const disconnectedEventSub = {
      initialize: createMockFn<[], Promise<void>>().mockResolvedValue(),
      sendMessage: createMockFn<[string], Promise<void>>().mockResolvedValue(),
      on: createMockFn(),
      isConnected: () => false,
      isActive: () => false,
    };
    platform = createPlatform(
      {},
      {
        twitchAuth: createReadyTwitchAuth(),
        TwitchEventSub: createEventSubConstructor(disconnectedEventSub),
      },
    );
    platform.isConnected = true;

    await expect(platform.initialize({})).rejects.toThrow(
      "Twitch EventSub initialization failed: connection is not active",
    );
    expect(platform.isConnected).toBe(false);
    expect(platform.isConnecting).toBe(false);
  });

  it("fails platform initialization when EventSub is connected but inactive after initialize", async () => {
    const inactiveEventSub = {
      initialize: createMockFn<[], Promise<void>>().mockResolvedValue(),
      sendMessage: createMockFn<[string], Promise<void>>().mockResolvedValue(),
      on: createMockFn(),
      isConnected: () => true,
      isActive: () => false,
    };
    platform = createPlatform(
      {},
      {
        twitchAuth: createReadyTwitchAuth(),
        TwitchEventSub: createEventSubConstructor(inactiveEventSub),
      },
    );

    await expect(platform.initialize({})).rejects.toThrow(
      "Twitch EventSub initialization failed: subscriptions are not active",
    );
    expect(platform.isConnected).toBe(false);
  });

  it("clears stale EventSub references when initialization fails", async () => {
    platform = createPlatform(
      {},
      {
        twitchAuth: { isReady: () => false },
      },
    );
    platform.eventSub = createEventSub({
      isConnected: () => true,
      isActive: () => true,
    });
    platform.eventSubListeners = [
      { eventName: "chatMessage", handler: () => {} },
    ];
    platform.eventSubWiring = {
      bindAll: createMockFn<[Record<string, unknown>], void>(),
      unbindAll: createMockFn<[], void>(),
    } satisfies EventSubWiring;

    await expect(platform.initialize({})).rejects.toThrow(
      "Twitch authentication is not ready",
    );
    expect(platform.eventSub).toBeNull();
    expect(platform.eventSubListeners).toHaveLength(0);
    expect(platform.eventSubWiring).toBeNull();
  });

  it("guards stream-status handlers so consumer errors are captured without throwing", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    platform.handlers = {
      onStreamStatus: () => {
        throw new Error("boom");
      },
    };

    expect(() =>
      requireDefined(platform, "platform").handleStreamOnlineEvent({ started_at: "2024-01-01T00:00:00Z" }),
    ).not.toThrow();
  });

  it("adds correlation metadata to stream-status events", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    let emittedPayload: StreamStatusPayload | undefined;
    platform.handlers = {
      onStreamStatus: (payload) => {
        emittedPayload = payload as StreamStatusPayload;
      },
    };

    platform.handleStreamOnlineEvent({ started_at: "2024-01-01T00:00:00Z" });

    const payload = requireDefined(emittedPayload, "stream status payload");
    expect(payload.metadata).toBeDefined();
    expect(payload.metadata?.correlationId).toEqual(expect.any(String));
  });

  it("does not emit stream status when stream online lacks started_at", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    const emitted: Record<string, unknown>[] = [];
    platform.on("platform:event", (payload) => {
      if (isPlatformEventEnvelope(payload) && payload.type === PlatformEvents.STREAM_STATUS) {
        emitted.push(payload.data);
      }
    });

    platform.handleStreamOnlineEvent({});

    expect(emitted).toHaveLength(0);
  });

  it("does not emit stream status when stream offline lacks timestamp", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    const emitted: Record<string, unknown>[] = [];
    platform.on("platform:event", (payload) => {
      if (isPlatformEventEnvelope(payload) && payload.type === PlatformEvents.STREAM_STATUS) {
        emitted.push(payload.data);
      }
    });

    platform.handleStreamOfflineEvent({});

    expect(emitted).toHaveLength(0);
  });

  it("logs raw platform data for non-chat events when enabled", async () => {
    platform = createPlatform(
      { dataLoggingEnabled: true },
      { twitchAuth: createReadyTwitchAuth() },
    );

    await platform.handleFollowEvent({
      userId: "test-123",
      username: "testuser123",
      displayName: "Test User 123",
      timestamp: "2024-01-01T00:00:00Z",
    });

    const chatFileLoggingService = requireStubChatFileLoggingService(
      platform.chatFileLoggingService,
    );
    expect(chatFileLoggingService.logRawPlatformDataCalls).toHaveLength(1);
  });

  it("rejects sending messages when EventSub is unavailable", async () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });

    await expect(platform.sendMessage("hello")).rejects.toThrow(/eventsub/i);
  });

  it("surfaces a friendly error when EventSub is disconnected before sending", async () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    const sendMessageCalls: string[] = [];
    const mockEventSub: TwitchEventSub = {
      initialize: async () => {},
      sendMessage: async (msg: string) => {
        sendMessageCalls.push(msg);
      },
      isConnected: () => false,
      isActive: () => false,
    };
    platform.eventSub = mockEventSub;

    await expect(platform.sendMessage("hi")).rejects.toThrow(/unavailable/i);
    expect(sendMessageCalls).toHaveLength(0);
  });

  it("surfaces a friendly error when EventSub active-state interface is missing before sending", async () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    const sendMessageCalls: string[] = [];
    const mockEventSub: TwitchEventSub = {
      initialize: async () => {},
      sendMessage: async (msg: string) => {
        sendMessageCalls.push(msg);
      },
      isConnected: () => true,
    };
    platform.eventSub = mockEventSub;

    await expect(platform.sendMessage("hi")).rejects.toThrow(/unavailable/i);
    expect(sendMessageCalls).toHaveLength(0);
  });

  it("keeps emitting chat events when logging fails", async () => {
    platform = createPlatform(
      { dataLoggingEnabled: true },
      { twitchAuth: createReadyTwitchAuth() },
    );
    platform._logRawEvent = createMockFn().mockRejectedValue(
      new Error("disk full"),
    );
    let emittedChat: ChatPayload | undefined;
    platform.handlers = {
      onChat: (payload) => {
        emittedChat = payload as ChatPayload;
      },
    };

    const unhandled: unknown[] = [];
    const listener = (err: unknown) => unhandled.push(err);
    process.on("unhandledRejection", listener);

    try {
      await platform.onMessageHandler({
        chatter_user_id: "test-1",
        chatter_user_name: "testviewer1",
        broadcaster_user_id: "broadcaster-1",
        message: { text: "Hello world" },
        badges: {},
        timestamp: "2024-01-01T00:00:00Z",
      });
      await flushAsync();
    } finally {
      process.off("unhandledRejection", listener);
    }

    expect(requireDefined(emittedChat, "chat payload").message).toEqual({
      text: "Hello world",
    });
    expect(unhandled).toHaveLength(0);
  });

  it("emits canonical raid payloads without duplicate user fields", async () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    let emittedRaid: RaidPayload | undefined;
    platform.handlers = {
      onRaid: (payload) => {
        emittedRaid = payload as RaidPayload;
      },
    };

    await platform.handleRaidEvent({
      username: "testraider",
      displayName: "TestRaider",
      userId: "test-r1",
      viewerCount: 42,
      timestamp: "2024-01-01T00:00:00Z",
    });

    const payload = requireDefined(emittedRaid, "raid payload");
    expect(payload.username).toBe("testraider");
    expect(payload.raider).toBeUndefined();
  });

  it("cleans up EventSub listeners and prevents double-binding on reinitialize", async () => {
    const eventSubStub = (() => {
      const listeners: Record<string, Array<(...args: unknown[]) => void>> = {};
      const stub: TwitchEventSub & {
        listeners: typeof listeners;
        on: (event: string, handler: (...args: unknown[]) => void) => void;
        off: (event: string, handler: (...args: unknown[]) => void) => void;
        removeListener: (event: string, handler: (...args: unknown[]) => void) => void;
      } = {
        listeners,
        on: createMockFn((event: string, handler: (...args: unknown[]) => void) => {
          listeners[event] = listeners[event] || [];
          listeners[event].push(handler);
        }),
        off: createMockFn((event: string, handler: (...args: unknown[]) => void) => {
          listeners[event] = (listeners[event] || []).filter(
            (h: (...args: unknown[]) => void) => h !== handler,
          );
        }),
        removeListener: createMockFn((event: string, handler: (...args: unknown[]) => void) => {
          listeners[event] = (listeners[event] || []).filter(
            (h: (...args: unknown[]) => void) => h !== handler,
          );
        }),
        removeAllListeners: createMockFn(() => {
          Object.keys(listeners).forEach((key) => delete listeners[key]);
        }),
        initialize: createMockFn().mockResolvedValue(),
        sendMessage: createMockFn<[string], Promise<void>>().mockResolvedValue(),
        cleanup: createMockFn().mockResolvedValue(),
        disconnect: createMockFn().mockResolvedValue(),
        isConnected: createMockFn(() => true),
        isActive: createMockFn(() => true),
      };
      return stub;
    })();

    platform = createPlatform(
      {},
      {
        TwitchEventSub: createEventSubConstructor(eventSubStub),
        twitchAuth: { isReady: () => true },
      },
    );

    await platform.initialize({});
    const listenersAfterFirstInit =
      eventSubStub.listeners.chatMessage?.length || 0;

    await platform.initialize({});
    const listenersAfterSecondInit =
      eventSubStub.listeners.chatMessage?.length || 0;

    await platform.cleanup();

    expect(listenersAfterFirstInit).toBe(1);
    expect(listenersAfterSecondInit).toBe(1);
    expect(eventSubStub.listeners.chatMessage || []).toHaveLength(0);
    expect(platform.eventSubListeners).toEqual([]);
  });

  it("does not throw when viewer count stop fails during stream offline", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    platform.viewerCountProvider = {
      stopPolling: () => {
        throw new Error("stop failed");
      },
      getViewerCount: async () => 0,
    } satisfies ViewerCountProvider;

    expect(() =>
      requireDefined(platform, "platform").handleStreamOfflineEvent({ timestamp: "2024-01-01T00:00:00Z" }),
    ).not.toThrow();
  });

  it("sends messages successfully when EventSub is connected and active", async () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    const sendMessageCalls: string[] = [];
    const mockEventSub = createEventSub({
      sendMessage: async (msg: string) => {
        sendMessageCalls.push(msg);
      },
      isConnected: () => true,
      isActive: () => true,
    });
    platform.eventSub = mockEventSub;

    await platform.sendMessage("test message");

    expect(sendMessageCalls).toHaveLength(1);
    expect(sendMessageCalls[0]).toBe("test message");
  });

  it("returns connection state with EventSub active status", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    const mockEventSub = createEventSub({
      isConnected: () => true,
      isActive: () => true,
    });
    platform.eventSub = mockEventSub;

    const state = platform.getConnectionState();

    expect(state.status).toBe("connected");
    expect(state.eventSubActive).toBe(true);
    expect(state.platform).toBe("twitch");
  });

  it("returns stats with EventSub connection state", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    const mockEventSub = createEventSub({
      isConnected: () => true,
      isActive: () => true,
    });
    platform.eventSub = mockEventSub;

    const stats = platform.getStats();

    expect(stats.platform).toBe("twitch");
    expect(stats.connected).toBe(true);
    expect(stats.eventsub).toBe(true);
  });

  it("returns status with issues when not connected", () => {
    platform = createPlatform({}, { twitchAuth: { isReady: () => false } });

    const status = platform.getStatus();

    expect(status.isReady).toBe(false);
    expect(status.issues).toContain("Not connected");
  });

  it("returns configured status based on validation result", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });

    const isConfigured = platform.isConfigured();

    expect(isConfigured).toBe(true);
  });

  it("initializes viewer count provider when stream comes online", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    const startPollingCalls: boolean[] = [];
    const mockProvider = {
      startPolling: () => {
        startPollingCalls.push(true);
      },
      getViewerCount: async () => 0,
    } satisfies ViewerCountProvider;
    platform.viewerCountProvider = mockProvider;
    platform.handlers = { onStreamStatus: () => {} };

    platform.handleStreamOnlineEvent({ started_at: "2024-01-01T00:00:00Z" });

    expect(startPollingCalls).toHaveLength(1);
  });

  it("returns zero viewer count when provider is not initialized", async () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    platform.viewerCountProvider = null;

    const count = await platform.getViewerCount();

    expect(count).toBe(0);
  });

  it("returns zero viewer count when provider throws", async () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    platform.viewerCountProvider = {
      getViewerCount: async () => {
        throw new Error("API error");
      },
    };

    const count = await platform.getViewerCount();

    expect(count).toBe(0);
  });

  it("cleans up EventSub and resets connection state", async () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    const cleanupCalls: boolean[] = [];
    const disconnectCalls: boolean[] = [];
    const mockEventSub = createEventSub({
      removeAllListeners: () => {},
      cleanup: async () => {
        cleanupCalls.push(true);
      },
      disconnect: async () => {
        disconnectCalls.push(true);
      },
    });
    platform.eventSub = mockEventSub;
    platform.viewerCountProvider = {
      stopPolling: () => {},
      getViewerCount: async () => 0,
    } satisfies ViewerCountProvider;

    await platform.cleanup();

    expect(cleanupCalls).toHaveLength(1);
    expect(disconnectCalls).toHaveLength(1);
    expect(platform.eventSub).toBeNull();
    expect(platform.isConnected).toBe(false);
  });

  it("emits connection events on EventSub state changes", () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });
    const emitted: Record<string, unknown>[] = [];
    platform.on("platform:event", (payload) => {
      if (isPlatformEventEnvelope(payload) && payload.type === PlatformEvents.PLATFORM_CONNECTION) {
        emitted.push(payload.data);
      }
    });

    platform._handleEventSubConnectionChange(true, {
      reason: "session_welcome",
    });

    expect(emitted).toHaveLength(1);
    expect(requireDefined(emitted[0], "connection event").status).toBe("connected");
    expect(platform.isConnected).toBe(true);
  });

  it("returns connection status with timestamp", async () => {
    platform = createPlatform({}, { twitchAuth: createReadyTwitchAuth() });

    const status = await platform.getConnectionStatus();

    expect(status.platform).toBe("twitch");
    expect(status.status).toBe("disconnected");
    expect(status.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
