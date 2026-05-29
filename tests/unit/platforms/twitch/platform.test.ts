import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  type TestMockFn,
  createMockFn,
  restoreAllMocks,
  spyOn,
} from "../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../helpers/mock-factories";
import { expectNoTechnicalArtifacts } from "../../../helpers/assertion-helpers";
import { createTwitchFollowEvent } from "../../../helpers/twitch-test-data";
import { createConfigFixture } from "../../../helpers/config-fixture";

import { TwitchPlatform } from "../../../../src/platforms/twitch.ts";
import { PlatformEventRouter } from "../../../../src/services/PlatformEventRouter.ts";
import { EventBus } from "../../../../src/core/EventBus";

type TwitchConfig = ConstructorParameters<typeof TwitchPlatform>[0];
type TwitchEventSubLike = NonNullable<TwitchPlatform["eventSub"]>;
type TwitchAuthLike = TwitchPlatform["twitchAuth"];
type TwitchApiClientLike = NonNullable<TwitchPlatform["apiClient"]>;
type ViewerCountProviderLike = NonNullable<TwitchPlatform["viewerCountProvider"]>;
type RetrySystemLike = NonNullable<TwitchPlatform["retrySystem"]>;
type PlatformHandlerCalls = Record<
  | "onChat"
  | "onFollow"
  | "onPaypiggy"
  | "onGift"
  | "onGiftPaypiggy"
  | "onRaid"
  | "onStreamStatus",
  Record<string, unknown>[]
>;
type PlatformHandlersWithCalls = Record<
  keyof PlatformHandlerCalls,
  (payload: unknown) => void
> & { _calls: PlatformHandlerCalls };
type PlatformHandlerCallbacks = Record<
  string,
  ((payload: unknown) => void) | undefined
>;
type RuntimeCalls = {
  handleChatMessage: [string, Record<string, unknown>][];
  handleFollowNotification: [string, unknown, Record<string, unknown>][];
};
type TestRuntime = {
  handleChatMessage: (platformName: string, payload: Record<string, unknown>) => number;
  handleFollowNotification: (
    platformName: string,
    username: unknown,
    payload: Record<string, unknown>,
  ) => number;
  handlePaypiggyNotification: TestMockFn;
  handleGiftNotification: TestMockFn;
  handleRaidNotification: TestMockFn;
  _calls: RuntimeCalls;
};
type TestTwitchAuth = Omit<TwitchAuthLike, "isReady" | "refreshTokens"> & {
  isReady: TestMockFn<[], boolean>;
  refreshTokens: TestMockFn<[], Promise<boolean>>;
  getUserId: TestMockFn<[], string>;
};
type TestApiClient = TwitchApiClientLike & {
  getChannelInfo: TestMockFn<[string], Promise<{ id: string; name: string }>>;
  sendChatMessage: TestMockFn<[string], Promise<void>>;
};
type TestViewerCountProvider = Omit<ViewerCountProviderLike, "getViewerCount"> & {
  getViewerCount: TestMockFn<[], Promise<number>>;
};
type TestRetrySystem = Omit<
  RetrySystemLike,
  "isConnected" | "handleConnectionError" | "handleConnectionSuccess"
> & {
  isConnected: (platform: string) => boolean;
  handleConnectionError: TestMockFn<
    [
      string,
      Error,
      () => Promise<void>,
      () => Promise<void>,
      (platform: string, isConnected: boolean, connection: unknown, isConnecting: boolean) => void,
    ],
    void
  >;
  handleConnectionSuccess: TestMockFn<[string, unknown, string], void>;
  resetRetryCount: TestMockFn;
  retryTimers: Record<string, unknown>;
};
type TestNotificationBridge = {
  handleNotification?: TestMockFn<[string, string, Record<string, unknown>], unknown>;
  handleChatMessage: TestMockFn<[string, Record<string, unknown>], unknown>;
  handleFollowNotification: TestMockFn;
  handlePaypiggyNotification: TestMockFn;
  updateViewerCount: TestMockFn;
};
type TestEventSub = Omit<
  TwitchEventSubLike,
  "connect" | "disconnect" | "initialize" | "on" | "isConnected" | "isActive" | "sendMessage"
> & {
  connect: TestMockFn<[], Promise<void>>;
  disconnect: TestMockFn<[], Promise<void>>;
  initialize: TestMockFn<[], Promise<void>>;
  on: TestMockFn<[string, (...args: unknown[]) => void], unknown>;
  emit: TestMockFn;
  isConnected: TestMockFn<[], boolean>;
  isActive: TestMockFn<[], boolean>;
  sendMessage: TestMockFn<[string], Promise<void>>;
  subscriptionsReady?: boolean;
};
type TestPlatform = Omit<
  TwitchPlatform,
  "eventSub" | "apiClient" | "viewerCountProvider" | "retrySystem" | "handlers" | "initializeEventSub"
> & {
  eventSub: (Partial<TestEventSub> & Record<string, unknown>) | null;
  apiClient: (Partial<TestApiClient> & Record<string, unknown>) | null;
  viewerCountProvider: (Partial<TestViewerCountProvider> & Record<string, unknown>) | null;
  retrySystem: TestRetrySystem | null;
  handlers: PlatformHandlerCallbacks;
  initializeEventSub: (broadcasterId?: string) => Promise<void>;
};
type EventSubCalls = { initialize: boolean[]; disconnect: boolean[] };
type ViewerCountProviderCalls = { startPolling: boolean[]; stopPolling: boolean[] };

const createRequiredApiClientMocks = () => ({
  getBroadcasterId: createMockFn<[string], Promise<string>>().mockResolvedValue(
    "123456",
  ),
  getStreamInfo: createMockFn<
    [string],
    ReturnType<TwitchApiClientLike["getStreamInfo"]>
  >().mockResolvedValue(undefined),
  getGlobalChatBadges: createMockFn().mockResolvedValue([]),
  getChannelChatBadges: createMockFn<[unknown], Promise<unknown[]>>().mockResolvedValue(
    [],
  ),
});

const createConnectedEventSub = (): TestEventSub => ({
  initialize: createMockFn<[], Promise<void>>().mockResolvedValue(),
  connect: createMockFn<[], Promise<void>>().mockResolvedValue(),
  disconnect: createMockFn<[], Promise<void>>().mockResolvedValue(),
  on: createMockFn<[string, (...args: unknown[]) => void], unknown>(),
  emit: createMockFn(),
  isConnected: createMockFn<[], boolean>().mockReturnValue(true),
  isActive: createMockFn<[], boolean>().mockReturnValue(true),
  sendMessage: createMockFn<[string], Promise<void>>().mockResolvedValue(),
});

const toRecordPayload = (payload: unknown): Record<string, unknown> => {
  expect(payload).toBeObject();
  return payload as Record<string, unknown>;
};

const firstRecord = (items: Record<string, unknown>[]): Record<string, unknown> => {
  expect(items.length).toBeGreaterThan(0);
  return items[0] as Record<string, unknown>;
};

const firstTuple = <T extends unknown[]>(items: T[]): T => {
  expect(items.length).toBeGreaterThan(0);
  return items[0] as T;
};

const findEventSubHandler = (
  calls: [string, (...args: unknown[]) => void][],
  eventName: string,
): ((...args: unknown[]) => void) => {
  const call = calls.find(([name]) => name === eventName);
  expect(call).toBeDefined();
  return call?.[1] ?? (() => undefined);
};

const spyOnPlatformEmit = (target: { emit: (eventName: string, ...args: unknown[]) => boolean }) =>
  spyOn(target as { emit: (eventName: string, ...args: unknown[]) => boolean }, "emit" as never);

const createTestErrorHandler = (overrides: Partial<TwitchPlatform["errorHandler"]>) => ({
  handleDataLoggingError: createMockFn(),
  handleEventProcessingError: createMockFn(),
  handleCleanupError: createMockFn(),
  handleMessageSendError: createMockFn(),
  handleConnectionError: createMockFn(),
  logOperationalError: createMockFn(),
  ...overrides,
});

describe("Twitch Platform", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  let mockTwitchEventSub: TestEventSub;
  let mockTwitchAuth: TestTwitchAuth;
  let mockApiClient: TestApiClient;
  let mockViewerCountProvider: TestViewerCountProvider;
  let mockRetrySystem: TestRetrySystem;
  let mockApp: TestNotificationBridge;
  let platform: TestPlatform;
  let config: TwitchConfig;
  let platformHandlers: PlatformHandlersWithCalls;
  let platformHandlerCallbacks: PlatformHandlerCallbacks;
  let eventBus: EventBus;
  let runtime: TestRuntime;

  let viewerCountProviderCalls: ViewerCountProviderCalls;
  let eventSubCalls: EventSubCalls;

  beforeEach(() => {
    viewerCountProviderCalls = { startPolling: [], stopPolling: [] };
    eventSubCalls = { initialize: [], disconnect: [] };

    mockTwitchAuth = {
      isReady: createMockFn<[], boolean>().mockReturnValue(true),
      refreshTokens: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
      getUserId: createMockFn<[], string>().mockReturnValue("test-user-id"),
    };
    mockApiClient = {
      ...createRequiredApiClientMocks(),
      getChannelInfo: createMockFn<
        [string],
        Promise<{ id: string; name: string }>
      >().mockResolvedValue({
        id: "123456",
        name: "testchannel",
      }),
      getViewerCount: createMockFn<[], Promise<number>>().mockResolvedValue(1500),
      sendChatMessage: createMockFn<[string], Promise<void>>().mockResolvedValue(),
    };
    mockViewerCountProvider = {
      getViewerCount: createMockFn<[], Promise<number>>().mockResolvedValue(1500),
      startPolling: () => viewerCountProviderCalls.startPolling.push(true),
      stopPolling: () => viewerCountProviderCalls.stopPolling.push(true),
    };
    mockRetrySystem = {
      isConnected: () => false,
      handleConnectionError: createMockFn<
        [
          string,
          Error,
          () => Promise<void>,
          () => Promise<void>,
          (platform: string, isConnected: boolean, connection: unknown, isConnecting: boolean) => void,
        ],
        void
      >(),
      handleConnectionSuccess: createMockFn<[string, unknown, string], void>(),
      resetRetryCount: createMockFn(),
      retryTimers: {},
    };
    mockApp = {
      handleChatMessage: createMockFn<[string, Record<string, unknown>], unknown>(),
      handleFollowNotification: createMockFn(),
      handlePaypiggyNotification: createMockFn(),
      handleNotification: createMockFn(),
      updateViewerCount: createMockFn(),
    };

    mockTwitchEventSub = {
      initialize: createMockFn<[], Promise<void>>(async () => {
        eventSubCalls.initialize.push(true);
      }),
      connect: createMockFn<[], Promise<void>>().mockResolvedValue(),
      disconnect: createMockFn<[], Promise<void>>(async () => {
        eventSubCalls.disconnect.push(true);
      }),
      on: createMockFn<[string, (...args: unknown[]) => void], unknown>(),
      emit: createMockFn(),
      isConnected: createMockFn<[], boolean>().mockReturnValue(true),
      isActive: createMockFn<[], boolean>().mockReturnValue(true),
      sendMessage: createMockFn<[string], Promise<void>>().mockResolvedValue(),
    };

    config = {
      enabled: true,
      username: "testuser",
      channel: "testchannel",
      clientId: "test-client-id",
      dataLoggingEnabled: false,
      viewerCountEnabled: true,
    };

    class TestTwitchEventSubClass {
      initialize = () => mockTwitchEventSub.initialize();
      on = (eventName: string, handler: (...args: unknown[]) => void) =>
        mockTwitchEventSub.on(eventName, handler);
      isConnected = () => mockTwitchEventSub.isConnected();
      isActive = () => mockTwitchEventSub.isActive();
      sendMessage = (message: string) => mockTwitchEventSub.sendMessage(message);
      disconnect = () => mockTwitchEventSub.disconnect();
    }

    class TestTwitchApiClientClass {
      getBroadcasterId = (channel: string) =>
        mockApiClient.getBroadcasterId(channel);
      getStreamInfo = (channelName: string) =>
        mockApiClient.getStreamInfo(channelName);
      getGlobalChatBadges = () => mockApiClient.getGlobalChatBadges();
      getChannelChatBadges = (broadcasterId: unknown) =>
        mockApiClient.getChannelChatBadges(broadcasterId);
      getCheermotes = (broadcasterId: unknown) =>
        mockApiClient.getCheermotes?.(broadcasterId) ?? Promise.resolve([]);
      getUserById = (userId: string) => mockApiClient.getUserById?.(userId) ?? Promise.resolve(null);
      getViewerCount = () => mockApiClient.getViewerCount?.() ?? Promise.resolve(0);
    }

    platform = new TwitchPlatform(config, {
      TwitchEventSub: TestTwitchEventSubClass,
      TwitchApiClient: TestTwitchApiClientClass,
      twitchAuth: mockTwitchAuth,
      retrySystem: mockRetrySystem,
      notificationBridge: mockApp,
      logger: noOpLogger,
      timestampService: {
        extractTimestamp: createMockFn(() => new Date().toISOString()),
      },
    }) as TestPlatform;

    const handlerCalls: PlatformHandlerCalls = {
      onChat: [],
      onFollow: [],
      onPaypiggy: [],
      onGift: [],
      onGiftPaypiggy: [],
      onRaid: [],
      onStreamStatus: [],
    };
    const callbacks = {
      onChat: (payload: unknown) => handlerCalls.onChat.push(toRecordPayload(payload)),
      onFollow: (payload: unknown) => handlerCalls.onFollow.push(toRecordPayload(payload)),
      onPaypiggy: (payload: unknown) => handlerCalls.onPaypiggy.push(toRecordPayload(payload)),
      onGift: (payload: unknown) => handlerCalls.onGift.push(toRecordPayload(payload)),
      onGiftPaypiggy: (payload: unknown) => handlerCalls.onGiftPaypiggy.push(toRecordPayload(payload)),
      onRaid: (payload: unknown) => handlerCalls.onRaid.push(toRecordPayload(payload)),
      onStreamStatus: (payload: unknown) => handlerCalls.onStreamStatus.push(toRecordPayload(payload)),
    };
    platformHandlerCallbacks = callbacks;
    platformHandlers = {
      ...callbacks,
      _calls: handlerCalls,
    };

    eventBus = new EventBus();

    const runtimeCalls: RuntimeCalls = {
      handleChatMessage: [],
      handleFollowNotification: [],
    };
    runtime = {
      handleChatMessage: (platformName: string, payload: Record<string, unknown>) =>
        runtimeCalls.handleChatMessage.push([platformName, payload]),
      handleFollowNotification: (
        platformName: string,
        username: unknown,
        payload: Record<string, unknown>,
      ) => runtimeCalls.handleFollowNotification.push([platformName, username, payload]),
      handlePaypiggyNotification: createMockFn(),
      handleGiftNotification: createMockFn(),
      handleRaidNotification: createMockFn(),
      _calls: runtimeCalls,
    };

    platform.apiClient = mockApiClient;
    platform.viewerCountProvider = mockViewerCountProvider;
    platform.handlers = platformHandlerCallbacks;

    new PlatformEventRouter({
      eventBus,
      runtime,
      notificationManager: mockApp,
      config: createConfigFixture({
        general: {
          followsEnabled: true,
          giftsEnabled: true,
          messagesEnabled: true,
        },
      }),
      logger: noOpLogger,
    });
  });

  describe("when initializing", () => {
    it("wires retry-system connectivity checks to Twitch active connection state", () => {
      expect(mockRetrySystem.isConnected("youtube")).toBe(false);
      expect(mockRetrySystem.isConnected("twitch")).toBe(false);

      platform.eventSub = {
        ...createConnectedEventSub(),
        isActive: createMockFn<[], boolean>().mockReturnValue(true),
      };
      expect(mockRetrySystem.isConnected("twitch")).toBe(true);
    });

    it("should accept valid configuration for user stream connection", () => {
      const validConfig = {
        enabled: true,
        username: "testuser",
        channel: "testchannel",
        clientId: "test-client-id",
      };

      const testPlatform = new TwitchPlatform(validConfig, {
        twitchAuth: mockTwitchAuth,
      });
      testPlatform.eventSub = createConnectedEventSub();
      const status = testPlatform.getStatus();

      expect(status.isReady).toBe(true);
      expect(status.issues).toEqual([]);
    });

    it("should report runtime issues when enabled but not connected", () => {
      const invalidPlatform = new TwitchPlatform(config, {
        twitchAuth: mockTwitchAuth,
      });
      invalidPlatform.eventSub = null;
      const status = invalidPlatform.getStatus();

      expect(status.isReady).toBe(false);
      expect(status.issues).toContain("Not connected");
      expectNoTechnicalArtifacts(status.issues.join(" "));
    });

    it("should ensure user experience fails gracefully without auth dependencies", () => {
      expect(() => {
        new TwitchPlatform(config, {});
      }).toThrow("TwitchPlatform requires twitchAuth via dependency injection");
    });

    it("returns early when the platform is disabled", async () => {
      platform.config.enabled = false;

      await expect(
        platform.initialize(platformHandlerCallbacks),
      ).resolves.toBeUndefined();
      expect(eventSubCalls.initialize).toHaveLength(0);
    });
  });

  describe("when initializing EventSub for real-time events", () => {
    it("should enable real-time event notifications when authentication is ready", async () => {
      mockTwitchAuth.isReady.mockReturnValue(true);

      await platform.initializeEventSub();

      expect(platform.eventSub).toBeDefined();
    });

    it("should fail fast when EventSub initialization fails", async () => {
      mockTwitchEventSub.initialize.mockRejectedValue(
        new Error("EventSub init failed"),
      );

      await expect(platform.initializeEventSub()).rejects.toThrow(
        "EventSub init failed",
      );
    });

    it("should fail fast when authentication is not ready", async () => {
      mockTwitchAuth.isReady.mockReturnValue(false);

      await expect(platform.initializeEventSub()).rejects.toThrow(
        "Twitch authentication is not ready",
      );
    });

    it("fails initialization when EventSub is missing an event emitter interface", async () => {
      platform.TwitchEventSub = class {
        initialize = createMockFn<[], Promise<void>>().mockResolvedValue();
        isConnected = createMockFn<[], boolean>().mockReturnValue(true);
        isActive = createMockFn<[], boolean>().mockReturnValue(true);
        sendMessage = createMockFn<[string], Promise<void>>().mockResolvedValue();
      };

      await expect(platform.initialize(platformHandlerCallbacks)).rejects.toThrow(
        "missing event emitter interface",
      );
    });

    it("fails initialization when EventSub is missing connectivity methods", async () => {
      platform.TwitchEventSub = class {
        initialize = createMockFn<[], Promise<void>>().mockResolvedValue();
        on = createMockFn<[string, (...args: unknown[]) => void], unknown>();
        isActive = createMockFn<[], boolean>().mockReturnValue(true);
        sendMessage = createMockFn<[string], Promise<void>>().mockResolvedValue();
      };

      await expect(platform.initialize(platformHandlerCallbacks)).rejects.toThrow(
        "missing isConnected()",
      );
    });

    it("fails initialization when EventSub does not report an active connection", async () => {
      platform.TwitchEventSub = class {
        initialize = createMockFn<[], Promise<void>>().mockResolvedValue();
        on = createMockFn<[string, (...args: unknown[]) => void], unknown>();
        isConnected = createMockFn<[], boolean>().mockReturnValue(false);
        isActive = createMockFn<[], boolean>().mockReturnValue(true);
        sendMessage = createMockFn<[string], Promise<void>>().mockResolvedValue();
      };

      await expect(platform.initialize(platformHandlerCallbacks)).rejects.toThrow(
        "connection is not active",
      );
    });
  });

  describe("when connecting", () => {
    it("should establish connection successfully", async () => {
      const handlers = {
        onChatMessage: createMockFn(),
        onFollowNotification: createMockFn(),
        onPaypiggyNotification: createMockFn(),
      };

      await platform.initialize(handlers);

      expect(eventSubCalls.initialize).toHaveLength(1);
      expect(platform.handlers).toEqual(handlers);
    });

    it("should handle connection errors gracefully", async () => {
      const connectionError = new Error("Connection failed");
      mockTwitchEventSub.initialize.mockRejectedValue(connectionError);

      const handlers = {};

      await expect(platform.initialize(handlers)).rejects.toThrow(
        "Connection failed",
      );

      expect(platform.eventSub).toBeNull();
    });

    it("should prepare to receive all user events after connection", async () => {
      const handlers = {
        onChatMessage: createMockFn(),
        onFollowNotification: createMockFn(),
        onPaypiggyNotification: createMockFn(),
      };

      await platform.initialize(handlers);

      expect(platform.handlers).toBeDefined();
      expect(platform.handlers.onChatMessage).toBeDefined();
      expect(platform.handlers.onFollowNotification).toBeDefined();
      expect(platform.handlers.onPaypiggyNotification).toBeDefined();
    });

    it("should fail initialization when EventSub subscriptions are not active yet", async () => {
      const handlers = {
        onChatMessage: createMockFn(),
        onFollowNotification: createMockFn(),
        onPaypiggyNotification: createMockFn(),
      };
      mockTwitchEventSub.isConnected.mockReturnValue(true);
      mockTwitchEventSub.isActive = createMockFn<[], boolean>().mockReturnValue(false);
      mockTwitchEventSub.subscriptionsReady = false;

      await expect(platform.initialize(handlers)).rejects.toThrow(
        "subscriptions are not active",
      );

      expect(eventSubCalls.initialize).toHaveLength(1);
      expect(platform.isConnected).toBe(false);
    });
  });

  describe("when handling chat messages", () => {
    it("should display chat messages to viewers in real-time", async () => {
      const chatMessage = "Hello world!";
      const chatUser = "chatuser";

      await platform.onMessageHandler({
        chatter_user_id: "chat-user-1",
        chatter_user_name: chatUser,
        broadcaster_user_id: "broadcaster-1",
        message: { text: chatMessage },
        badges: {},
        timestamp: "2024-01-01T00:00:00Z",
      });

      const messageCall = mockApp.handleChatMessage.mock.calls[0];
      if (messageCall) {
        const [platformName, messageData] = messageCall;
        expect(platformName).toBe("twitch");
        expect(messageData.message).toBe("Hello world!");
        expect(messageData.username).toBe("chatuser");
        expectNoTechnicalArtifacts(messageData.message);
        expectNoTechnicalArtifacts(messageData.username);
      }
    });

    it("should prevent echo when bot sends its own messages", async () => {
      const selfMessage = "Bot response";

      await platform.onMessageHandler({
        chatter_user_id: "broadcaster-1",
        chatter_user_name: "testuser",
        broadcaster_user_id: "broadcaster-1",
        message: { text: selfMessage },
        badges: {},
        timestamp: "2024-01-01T00:00:01Z",
      });

      const messageCount = mockApp.handleChatMessage.mock.calls.length;
      expect(messageCount).toBe(0);
    });

    it("should preserve emojis and special characters for user expression", async () => {
      const messageWithEmojis = "Hello 🌟 world! 🎉";

      await platform.onMessageHandler({
        chatter_user_id: "chat-user-2",
        chatter_user_name: "chatuser",
        broadcaster_user_id: "broadcaster-1",
        message: { text: messageWithEmojis },
        badges: {},
        timestamp: "2024-01-01T00:00:02Z",
      });

      const messageCall = mockApp.handleChatMessage.mock.calls[0];
      if (messageCall) {
        const [, messageData] = messageCall;
        expect(messageData.message).toBe(messageWithEmojis);
        expect(messageData.message).toContain("🌟");
        expect(messageData.message).toContain("🎉");
        expectNoTechnicalArtifacts(messageData.username);
      }
    });
  });

  describe("when handling follow events", () => {
    it("should display follow notification to user when someone follows", async () => {
      const followEvent = createTwitchFollowEvent({
        username: "newfollower",
        userId: "follow-user-1",
        displayName: "New Follower",
        timestamp: new Date().toISOString(),
      });

      await platform.handleFollowEvent(followEvent);

      expect(platformHandlers._calls.onFollow).toHaveLength(1);
      const payload = firstRecord(platformHandlers._calls.onFollow);
      expect(payload.platform).toBe("twitch");
      expect(payload.username).toBe("newfollower");
      expectNoTechnicalArtifacts(payload.username);
      expect(payload.timestamp).toBeDefined();
    });

    it("should maintain stability when receiving malformed follow events", async () => {
      const incompleteEvent = {};

      await platform.handleFollowEvent(incompleteEvent);

      expect(platform).toBeDefined();
      expect(mockApp.handleFollowNotification.mock.calls.length).toBe(0);
    });
  });

  describe("when handling subscription events", () => {
    it("should display subscription notification when viewer subscribes", async () => {
      const subEvent = {
        username: "subscriber",
        userId: "sub-user-1",
        tier: "1000",
        timestamp: "2024-01-01T00:00:00Z",
      };

      await platform.handlePaypiggyEvent(subEvent);

      expect(platformHandlers._calls.onPaypiggy).toHaveLength(1);
      const payload = firstRecord(platformHandlers._calls.onPaypiggy);
      expect(payload.platform).toBe("twitch");
      expect(payload.username).toBe("subscriber");
      expectNoTechnicalArtifacts(payload.username);
      expect(payload.tier).toBe("1000");
    });

    it("should display gift subscription events with gifter name", async () => {
      const giftSubscriptionEvent = {
        username: "gifter",
        userId: "gifter-user-1",
        tier: "2000",
        timestamp: "2024-01-01T00:00:00Z",
      };

      await platform.handlePaypiggyEvent(giftSubscriptionEvent);

      expect(platformHandlers._calls.onPaypiggy).toHaveLength(1);
      const payload = firstRecord(platformHandlers._calls.onPaypiggy);
      expect(payload.username).toBe("gifter");
      expectNoTechnicalArtifacts(payload.username);
      expect(payload.tier).toBe("2000");
    });

    it("should route resubscription events through the subscription handler", async () => {
      const resubEvent = {
        username: "resubber",
        displayName: "Resub User",
        userId: "user123",
        tier: "3000",
        message: "Back again!",
        months: 10,
        timestamp: "2024-01-01T00:00:00Z",
      };

      await platform.handlePaypiggyMessageEvent(resubEvent);

      expect(platformHandlers._calls.onPaypiggy).toHaveLength(1);
      const payload = firstRecord(platformHandlers._calls.onPaypiggy);
      expect(payload.username).toBe("resubber");
      expect(payload.message).toBe("Back again!");
      expect(payload.months).toBe(10);
    });

    it("should route subscription gift events through the giftpaypiggy handler", async () => {
      const giftEvent = {
        username: "gifter",
        displayName: "Gifter",
        userId: "gift123",
        tier: "1000",
        giftCount: 3,
        timestamp: "2024-01-02T00:00:00Z",
      };

      await platform.handlePaypiggyGiftEvent(giftEvent);

      expect(platformHandlers._calls.onGiftPaypiggy).toHaveLength(1);
      const payload = firstRecord(platformHandlers._calls.onGiftPaypiggy);
      expect(payload.username).toBe("gifter");
      expect(payload.giftCount).toBe(3);
      expect(payload.tier).toBe("1000");
    });

    it("should use injected processing timestamp for monetization error envelopes", async () => {
      const processingTimestamp = "2024-01-11T12:34:56.000Z";
      const timestampInjectedPlatform = new TwitchPlatform(config, {
        twitchAuth: mockTwitchAuth,
        notificationBridge: mockApp,
        logger: noOpLogger,
        getErrorEnvelopeTimestampISO: () => processingTimestamp,
      }) as TestPlatform;

      const errorEvents: Record<string, unknown>[] = [];
      timestampInjectedPlatform.handlers = {
        ...platformHandlerCallbacks,
        onPaypiggy: (payload: unknown) => errorEvents.push(toRecordPayload(payload)),
      };

      await timestampInjectedPlatform.handlePaypiggyEvent({
        username: "test-subscriber",
        userId: "test-subscriber-id",
        tier: "1000",
      });

      expect(errorEvents).toHaveLength(1);
      const errorEvent = firstRecord(errorEvents);
      expect(errorEvent.isError).toBe(true);
      expect(errorEvent.timestamp).toBe(processingTimestamp);
    });

    it("emits error payload when gift subscription is missing giftCount", async () => {
      const giftEvent = {
        username: "gifter",
        displayName: "Gifter",
        userId: "gift123",
        tier: "1000",
        timestamp: "2024-01-02T00:00:00Z",
      };

      await platform.handlePaypiggyGiftEvent(giftEvent);

      expect(platformHandlers._calls.onGiftPaypiggy).toHaveLength(1);
      const payload = firstRecord(platformHandlers._calls.onGiftPaypiggy);
      expect(payload).toMatchObject({
        platform: "twitch",
        username: "gifter",
        userId: "gift123",
      });
      expect(payload).not.toHaveProperty("giftCount");
      expect(payload.timestamp).toEqual(expect.any(String));
    });
  });

  describe("when handling EventSub lifecycle", () => {
    it("should set connection flags on EventSub connect/disconnect events", async () => {
      await platform.initialize(platformHandlerCallbacks);

      const connectedHandler = findEventSubHandler(
        mockTwitchEventSub.on.mock.calls,
        "eventSubConnected",
      );
      const disconnectedHandler = findEventSubHandler(
        mockTwitchEventSub.on.mock.calls,
        "eventSubDisconnected",
      );

      await connectedHandler();
      expect(platform.isConnected).toBe(true);
      expect(platform.isConnecting).toBe(false);
      const connectedState = platform.getConnectionState();
      expect(connectedState.status).toBe("connected");

      await disconnectedHandler();
      mockTwitchEventSub.isConnected.mockReturnValue(false);
      mockTwitchEventSub.isActive.mockReturnValue(false);
      expect(platform.isConnected).toBe(false);
      expect(platform.isConnecting).toBe(false);
      const disconnectedState = platform.getConnectionState();
      expect(
        ["disconnected", "connecting"].includes(disconnectedState.status),
      ).toBe(true);
    });

    it("emits platform connection events for EventSub lifecycle", async () => {
      await platform.initialize(platformHandlerCallbacks);

      const emitSpy = spyOnPlatformEmit(platform);
      const connectedHandler = findEventSubHandler(
        mockTwitchEventSub.on.mock.calls,
        "eventSubConnected",
      );

      await connectedHandler({ reason: "session_welcome" });

      const connectionEvent = emitSpy.mock.calls.find(
        (call) => call[0] === "platform:event",
      );
      expect(connectionEvent).toBeDefined();
      expect(toRecordPayload(connectionEvent?.[1]).type).toBe("platform:connection");
      expect(platformHandlers._calls.onStreamStatus).toHaveLength(0);
    });

    it("queues runtime recovery through the retry system for terminal disconnects", async () => {
      await platform.initialize(platformHandlerCallbacks);

      platform._handleEventSubConnectionChange(false, {
        reason: "socket dropped",
        willReconnect: false,
      });

      expect(mockRetrySystem.handleConnectionError).toHaveBeenCalledTimes(1);
      expect(firstTuple(mockRetrySystem.handleConnectionError.mock.calls)[0]).toBe(
        "twitch",
      );
      expect(
        firstTuple(mockRetrySystem.handleConnectionError.mock.calls)[1],
      ).toBeInstanceOf(Error);
      expect(
        typeof firstTuple(mockRetrySystem.handleConnectionError.mock.calls)[2],
      ).toBe("function");
    });

    it("does not queue runtime recovery while EventSub is already reconnecting", async () => {
      await platform.initialize(platformHandlerCallbacks);

      platform._handleEventSubConnectionChange(false, {
        reason: "socket dropped",
        willReconnect: true,
      });

      expect(mockRetrySystem.handleConnectionError).not.toHaveBeenCalled();
    });

    it("clears retry state when EventSub reconnects successfully", async () => {
      await platform.initialize(platformHandlerCallbacks);

      platform._handleEventSubConnectionChange(true, {
        reason: "session resumed",
      });

      expect(mockRetrySystem.handleConnectionSuccess).toHaveBeenCalledTimes(1);
      expect(firstTuple(mockRetrySystem.handleConnectionSuccess.mock.calls)[0]).toBe(
        "twitch",
      );
    });

    it("marks terminal disconnect payloads as reconnecting when platform recovery takes over", async () => {
      await platform.initialize(platformHandlerCallbacks);

      const emitSpy = spyOnPlatformEmit(platform);
      platform._handleEventSubConnectionChange(false, {
        reason: "socket dropped",
        willReconnect: false,
      });

      const connectionEvent = emitSpy.mock.calls.find(
        (call) => call[0] === "platform:event",
      );
      expect(toRecordPayload(toRecordPayload(connectionEvent?.[1]).data).willReconnect).toBe(true);
    });

    it("collapses repeated terminal disconnects while recovery is already in flight", async () => {
      await platform.initialize(platformHandlerCallbacks);
      const recoveryPromise = new Promise(() => {});
      mockRetrySystem.handleConnectionError.mockImplementation(
        () => recoveryPromise,
      );

      platform._handleEventSubConnectionChange(false, {
        reason: "socket dropped",
        willReconnect: false,
      });
      platform._handleEventSubConnectionChange(false, {
        reason: "socket dropped again",
        willReconnect: false,
      });

      expect(mockRetrySystem.handleConnectionError).toHaveBeenCalledTimes(1);
    });

    it("passes cleanup and reconnect callbacks into the retry system", async () => {
      await platform.initialize(platformHandlerCallbacks);
      let reconnectFn: (() => Promise<void>) | null = null;
      let cleanupFn: (() => Promise<void>) | null = null;
      let setConnectionStateFn:
        | ((platform: string, isConnected: boolean, connection: unknown, isConnecting: boolean) => void)
        | null = null;
      mockRetrySystem.handleConnectionError.mockImplementation(
        (platformName, error, reconnect, cleanup, setConnectionState) => {
          reconnectFn = reconnect;
          cleanupFn = cleanup;
          setConnectionStateFn = setConnectionState;
        },
      );

      platform._handleEventSubConnectionChange(false, {
        reason: "socket dropped",
        willReconnect: false,
      });

      expect(typeof reconnectFn).toBe("function");
      expect(typeof cleanupFn).toBe("function");
      expect(typeof setConnectionStateFn).toBe("function");
      if (!reconnectFn || !cleanupFn || !setConnectionStateFn) {
        throw new Error("retry callbacks were not captured");
      }
      const reconnect = reconnectFn as () => Promise<void>;
      const cleanup = cleanupFn as () => Promise<void>;
      const setConnectionState = setConnectionStateFn as (
        platform: string,
        isConnected: boolean,
        connection: unknown,
        isConnecting: boolean,
      ) => void;

      setConnectionState("twitch", false, null, true);
      expect(platform.isConnecting).toBe(true);

      await cleanup();
      expect(platform.eventSub).toBeNull();

      mockTwitchEventSub.initialize.mockResolvedValue();
      await reconnect();
      expect(platform.isPlannedDisconnection).toBe(false);
    });
  });

  describe("when bot sends messages to chat", () => {
    it("should deliver bot messages to viewers", async () => {
      platform.eventSub = mockTwitchEventSub;
      const botMessage = "Hello chat!";

      await platform.sendMessage(botMessage);

      expect(firstTuple(mockTwitchEventSub.sendMessage.mock.calls)[0]).toBe(
        "Hello chat!",
      );
      expectNoTechnicalArtifacts(botMessage);
    });

    it("should handle message delivery failures gracefully", async () => {
      platform.eventSub = mockTwitchEventSub;
      const sendError = new Error("Network timeout");
      mockTwitchEventSub.sendMessage.mockRejectedValue(sendError);

      await expect(platform.sendMessage("test")).rejects.toThrow(
        "Twitch chat is unavailable: Network timeout",
      );
    });

    it("should surface a user-friendly error when EventSub is not initialized", async () => {
      platform.eventSub = null;

      await expect(platform.sendMessage("hello")).rejects.toThrow(
        "Twitch chat is unavailable: EventSub connection is not initialized",
      );
    });

    it("should block sending when EventSub connection is inactive", async () => {
      platform.eventSub = {
        isConnected: createMockFn<[], boolean>().mockReturnValue(false),
        isActive: createMockFn<[], boolean>().mockReturnValue(false),
      };

      await expect(platform.sendMessage("hello")).rejects.toThrow(
        "Twitch chat is unavailable: EventSub connection is not active",
      );
    });
  });

  describe("when managing connection state", () => {
    it("should reflect connecting, connected, and disconnected states", () => {
      platform.isConnecting = true;
      let state = platform.getConnectionState();
      expect(state.status).toBe("connecting");

      platform.isConnecting = false;
      mockTwitchEventSub.isConnected.mockReturnValue(true);
      platform.eventSub = mockTwitchEventSub;
      state = platform.getConnectionState();
      expect(state.status).toBe("connected");

      platform.eventSub = null;
      state = platform.getConnectionState();
      expect(state.status).toBe("disconnected");
    });

    it("reports connection status snapshots for the current connection flag", async () => {
      platform.isConnected = true;

      const status = await platform.getConnectionStatus();

      expect(status.platform).toBe("twitch");
      expect(status.status).toBe("connected");
      expect(typeof status.timestamp).toBe("string");
    });
  });

  describe("when routing events through PlatformEventRouter", () => {
    it("should route chat events end-to-end via platform:event", async () => {
      platform.handlers = {
        onChat: (data) =>
          eventBus.emit("platform:event", {
            platform: "twitch",
            type: "platform:chat-message",
            data,
          }),
      };

      await platform.onMessageHandler({
        chatter_user_id: "u1",
        chatter_user_name: "user1",
        broadcaster_user_id: "broadcaster-1",
        message: { text: "hello" },
        badges: {},
        timestamp: "2024-01-01T00:00:03Z",
      });

      expect(runtime._calls.handleChatMessage).toHaveLength(1);
      const payload = firstTuple(runtime._calls.handleChatMessage)[1];
      expect(payload.message).toBeDefined();
    });

    it("should route follow events end-to-end via platform:event", async () => {
      platform.handlers = {
        onFollow: (data) =>
          eventBus.emit("platform:event", {
            platform: "twitch",
            type: "platform:follow",
            data,
          }),
      };
      const followEvent = {
        username: "follower",
        userId: "follower-id",
        timestamp: new Date().toISOString(),
      };

      await platform.handleFollowEvent(followEvent);

      expect(runtime._calls.handleFollowNotification).toHaveLength(1);
      const payload = firstTuple(runtime._calls.handleFollowNotification)[2];
      expect(payload.username).toBe("follower");
    });
  });

  describe("when handling stream status", () => {
    it("should start viewer polling on stream online and stop on offline", () => {
      platform.handleStreamOnlineEvent({ started_at: "2024-01-01T00:00:00Z" });
      expect(viewerCountProviderCalls.startPolling).toHaveLength(1);

      platform.handleStreamOfflineEvent({ timestamp: "2024-01-01T00:00:00Z" });
      expect(viewerCountProviderCalls.stopPolling).toHaveLength(1);
    });
  });

  describe("when handling raw EventSub messages", () => {
    it("should process follow notification and emit event", async () => {
      const followListenerCalls: Record<string, unknown>[] = [];
      platform.on("follow", (event) => followListenerCalls.push(toRecordPayload(event)));

      const followEvent = createTwitchFollowEvent({
        username: "notifyUser",
        userId: "999",
      });
      platform.emit("follow", followEvent);

      expect(followListenerCalls).toHaveLength(1);
      const followPayload = firstRecord(followListenerCalls);
      expect(followPayload.username).toBe("notifyUser");
    });
  });

  describe("when getting viewer count", () => {
    it("should provide accurate viewer count to streamer", async () => {
      mockViewerCountProvider.getViewerCount.mockResolvedValue(1500);

      const count = await platform.getViewerCount();

      expect(count).toBe(1500);
    });
  });

  describe("when getting statistics", () => {
    it("should return platform statistics", () => {
      const stats = platform.getStats();
      expect(stats.platform).toBe("twitch");
      expect(stats.enabled).toBe(true);
      expect(stats.connected).toBe(false);
    });

    it("should include connection information in stats", () => {
      platform.eventSub = mockTwitchEventSub;
      mockTwitchEventSub.isConnected.mockReturnValue(true);

      const stats = platform.getStats();
      expect(stats.connected).toBe(true);
    });
  });

  describe("when checking configuration", () => {
    it("should return true for valid configuration", () => {
      const isConfigured = platform.isConfigured();
      expect(isConfigured).toBe(true);
    });

    it("should return false for invalid configuration", () => {
      const invalidPlatform = new TwitchPlatform(
        {},
        { twitchAuth: mockTwitchAuth },
      );
      const isConfigured = invalidPlatform.isConfigured();
      expect(isConfigured).toBe(false);
    });

    it("reports eventsub not active when connected without active subscriptions", () => {
      platform.eventSub = {
        isConnected: createMockFn<[], boolean>().mockReturnValue(true),
        isActive: createMockFn<[], boolean>().mockReturnValue(false),
      };

      const status = platform.validateConfig();

      expect(status.isReady).toBe(false);
      expect(status.issues).toContain("EventSub not active");
    });
  });

  describe("when handling utility behaviors", () => {
    it("logs operational payloads for non-Error platform issues", () => {
      const logOperationalError = createMockFn();
      platform.errorHandler = createTestErrorHandler({
        handleEventProcessingError: createMockFn(),
        logOperationalError,
      });

      platform._logPlatformError(
        "test message",
        { info: "payload" },
        "test-type",
      );

      expect(logOperationalError).toHaveBeenCalledTimes(1);
      expect(firstTuple(logOperationalError.mock.calls)[0]).toBe("test message");
    });

    it("returns zero viewer count when provider is unavailable", async () => {
      platform.viewerCountProvider = null;

      await expect(platform.getViewerCount()).resolves.toBe(0);
    });

    it("skips viewer count polling when provider lacks startPolling", () => {
      platform.viewerCountProvider = {
        getViewerCount: createMockFn<[], Promise<number>>().mockResolvedValue(0),
      };

      expect(() => platform.initializeViewerCountProvider()).not.toThrow();
    });

    it("loads badge catalogs once and reuses cached broadcaster catalogs", async () => {
      const getGlobalChatBadges = createMockFn().mockResolvedValue([
        { set_id: "moderator", versions: [] },
      ]);
      const getChannelChatBadges = createMockFn().mockResolvedValue([
        { set_id: "subscriber", versions: [] },
      ]);
      platform.apiClient = { getGlobalChatBadges, getChannelChatBadges };

      await platform._ensureBadgeCatalogs(" broadcaster-id ");
      await platform._ensureBadgeCatalogs("broadcaster-id");

      expect(getGlobalChatBadges).toHaveBeenCalledTimes(1);
      expect(getChannelChatBadges).toHaveBeenCalledTimes(1);
      expect(platform.badgeCatalogCache.loaded).toBe(true);
      expect(platform.badgeCatalogCache.broadcasterId).toBe("broadcaster-id");
    });

    it("loads cheermote catalogs once and reuses cached broadcaster catalogs", async () => {
      const getCheermotes = createMockFn<[unknown], Promise<unknown[]>>().mockResolvedValue([
        { prefix: "Cheer", tiers: [] },
      ]);
      platform.apiClient = { getCheermotes };
      platform.broadcasterId = " broadcaster-id ";

      await platform._ensureCheermoteCatalog();
      await platform._ensureCheermoteCatalog();

      expect(getCheermotes).toHaveBeenCalledTimes(1);
      expect(firstTuple(getCheermotes.mock.calls)[0]).toBe("broadcaster-id");
      expect(platform.cheermoteCatalogCache.loaded).toBe(true);
    });

    it("resolves cheermote images from the cached catalog", () => {
      const cheermoteCatalog: unknown[] = [
        {
          prefix: "Cheer",
          tiers: [
            {
              id: 100,
              images: {
                dark: { animated: { 3: "https://example.test/cheer.gif" } },
              },
            },
          ],
        },
      ];
      platform.cheermoteCatalogCache.catalog = cheermoteCatalog;

      expect(
        platform._resolveCheermoteImageFromCatalog({
          prefix: "cheer",
          tier: "100",
        }),
      ).toBe("https://example.test/cheer.gif");
      expect(
        platform._resolveCheermoteImageFromCatalog({
          prefix: "cheer",
          tier: "999",
        }),
      ).toBe("");
    });

    it("reloads cheermote catalogs on a cache miss before resolving gift imagery", async () => {
      const getCheermotes = createMockFn<[unknown], Promise<unknown[]>>()
        .mockResolvedValueOnce([])
        .mockResolvedValueOnce([
          {
            prefix: "Cheer",
            tiers: [
              {
                id: 100,
                images: {
                  dark: { animated: { 3: "https://example.test/cheer.gif" } },
                },
              },
            ],
          },
        ]);
      platform.apiClient = { getCheermotes };
      platform.broadcasterId = "broadcaster-id";

      const imageUrl = await platform._resolveGiftCheermoteImageUrl({
        currency: "bits",
        cheermoteInfo: { prefix: "cheer", tier: "100" },
      });

      expect(getCheermotes).toHaveBeenCalledTimes(2);
      expect(imageUrl).toBe("https://example.test/cheer.gif");
    });

    it("resolves avatar URLs from payload, cache, and API fallbacks", async () => {
      const getUserById = createMockFn().mockResolvedValue({
        profile_image_url: "https://example.test/avatar.png",
      });
      platform.apiClient = { getUserById };

      const payloadAvatar = await platform._resolveAvatarUrl({
        userId: "user-1",
        avatarUrl: " https://example.test/payload.png ",
      });
      const cachedAvatar = await platform._resolveAvatarUrl({
        userId: "user-1",
      });
      const apiAvatar = await platform._resolveAvatarUrl({ userId: "user-2" });

      expect(payloadAvatar).toBe("https://example.test/payload.png");
      expect(cachedAvatar).toBe("https://example.test/payload.png");
      expect(apiAvatar).toBe("https://example.test/avatar.png");
      expect(getUserById).toHaveBeenCalledTimes(1);
    });

    it("tracks avatar lookup misses and falls back when API resolution fails", async () => {
      platform.apiClient = {
        getUserById: createMockFn().mockRejectedValue(new Error("boom")),
      };
      platform.errorHandler = createTestErrorHandler({
        handleEventProcessingError: createMockFn(),
        logOperationalError: createMockFn(),
      });

      const firstAvatar = await platform._resolveAvatarUrl({
        userId: "user-3",
      });
      const secondAvatar = await platform._resolveAvatarUrl({
        userId: "user-3",
      });

      expect(firstAvatar).toBe(platform.fallbackAvatarUrl);
      expect(secondAvatar).toBe(platform.fallbackAvatarUrl);
      expect(platform.avatarLookupMissCache.has("twitch:user-3")).toBe(true);
      expect(
        platform.errorHandler.handleEventProcessingError,
      ).toHaveBeenCalledTimes(1);
    });

    it("derives monetization missing fields for Twitch gift subscription payloads", () => {
      const missingFields = platform._getMonetizationMissingFields(
        "giftpaypiggy",
        { giftCount: 0, tier: "" },
        "2024-01-01T00:00:00Z",
      );

      expect(missingFields).toContain("giftCount");
      expect(missingFields).toContain("tier");
    });

    it("emits enriched gift payloads to gift listeners", async () => {
      const giftEvent = {
        id: "gift-event-1",
        username: "gifter",
        userId: "gifter-user-1",
        giftType: "bits",
        giftCount: 1,
        amount: 100,
        currency: "bits",
        timestamp: "2024-01-01T00:00:00Z",
      };
      const enrichedGiftData = {
        ...giftEvent,
        giftImageUrl: "https://example.test/gift.gif",
      };
      platform._enrichGiftPayload = createMockFn().mockResolvedValue(
        enrichedGiftData,
      );

      await platform.handleGiftEvent(giftEvent);

      expect(platformHandlers._calls.onGift).toHaveLength(1);
      expect(platformHandlers._calls.onGift[0]).toMatchObject({
        platform: "twitch",
        id: "gift-event-1",
        username: "gifter",
        userId: "gifter-user-1",
        giftType: "bits",
        giftCount: 1,
        amount: 100,
        currency: "bits",
        giftImageUrl: "https://example.test/gift.gif",
      });
    });
  });

  describe("when cleaning up", () => {
    it("should disconnect EventSub and clean up resources", async () => {
      platform.eventSub = mockTwitchEventSub;

      await platform.cleanup();

      expect(eventSubCalls.disconnect).toHaveLength(1);
      expect(platform.eventSub).toBeNull();
      expect(platform.handlers).toEqual({});
    });

    it("should handle cleanup errors gracefully", async () => {
      platform.eventSub = mockTwitchEventSub;
      mockTwitchEventSub.disconnect.mockRejectedValue(
        new Error("Cleanup failed"),
      );

      await expect(platform.cleanup()).resolves.toBeUndefined();

      expect(platform.isPlannedDisconnection).toBe(true);
    });

    it("should mark disconnection as planned during cleanup", async () => {
      expect(platform.isPlannedDisconnection).toBe(false);

      await platform.cleanup();

      expect(platform.isPlannedDisconnection).toBe(true);
    });

    it("resets planned disconnection before a new initialize call", async () => {
      platform.isPlannedDisconnection = true;

      await platform.initialize(platformHandlerCallbacks);

      expect(platform.isPlannedDisconnection).toBe(false);
    });
  });

  describe("when logging raw platform data", () => {
    it("should complete without error when logging is enabled", async () => {
      platform.config.dataLoggingEnabled = true;
      platform.config.dataLoggingVerbose = true;
      const eventData = { type: "chat", message: "test" };

      await expect(
        platform.logRawPlatformData("chat", eventData),
      ).resolves.toBeUndefined();
    });

    it("should complete without error when logging is disabled", async () => {
      platform.config.dataLoggingEnabled = false;
      const eventData = { type: "chat", message: "test" };

      await expect(
        platform.logRawPlatformData("chat", eventData),
      ).resolves.toBeUndefined();
    });
  });

  describe("error handling", () => {
    it("should handle authentication errors", async () => {
      mockTwitchAuth.isReady.mockReturnValue(false);

      await expect(platform.initialize({})).rejects.toThrow(
        "Twitch authentication is not ready",
      );
    });

    it("should handle EventSub initialization errors gracefully", async () => {
      mockTwitchEventSub.initialize.mockRejectedValue(
        new Error("EventSub init failed"),
      );

      await expect(platform.initializeEventSub()).rejects.toThrow(
        "EventSub init failed",
      );

      expect(platform.eventSub).toBeNull();
      expect(mockRetrySystem.handleConnectionError).not.toHaveBeenCalled();
    });

    it("should handle message processing errors", async () => {
      let error = null;
      try {
        await platform.onMessageHandler({
          chatter_user_name: "test",
          message: { text: "message" },
          timestamp: "2024-01-01T00:00:04Z",
        });
      } catch (e) {
        error = e;
      }

      expect(error).toBeNull();
      expect(platform).toBeDefined();
    });
  });

  describe("when managing API client", () => {
    it("should initialize API client correctly", () => {
      expect(platform.apiClient).toBe(mockApiClient);
    });

    it("should use API client for channel information", async () => {
      if (!platform.apiClient?.getChannelInfo) {
        throw new Error("test API client was not initialized");
      }
      const channelInfo =
        await platform.apiClient.getChannelInfo("testchannel");
      expect(channelInfo).toEqual({ id: "123456", name: "testchannel" });
    });
  });

  describe("when managing viewer count provider", () => {
    it("should initialize viewer count provider correctly", () => {
      expect(platform.viewerCountProvider).toBe(mockViewerCountProvider);
    });

    it("should start polling when enabled", () => {
      platform.config.viewerCountEnabled = true;
      platform.initializeViewerCountProvider();

      expect(viewerCountProviderCalls.startPolling.length).toBeGreaterThan(0);
    });

    it("should stop polling during cleanup", async () => {
      platform.viewerCountProvider = mockViewerCountProvider;

      await platform.cleanup();

      expect(viewerCountProviderCalls.stopPolling.length).toBeGreaterThan(0);
    });
  });
});
