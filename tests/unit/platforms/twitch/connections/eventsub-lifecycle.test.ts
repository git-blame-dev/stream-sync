import { describe, it, expect, afterEach } from "bun:test";
import { createMockFn } from "../../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../../helpers/mock-factories";
import * as testClock from "../../../../helpers/test-clock";
import { safeSetTimeout } from "../../../../../src/utils/timeout-validator";
import {
  secrets,
  _resetForTesting,
  initializeStaticSecrets,
} from "../../../../../src/core/secrets";

import { TwitchEventSub } from "../../../../../src/platforms/twitch-eventsub.ts";

type CloseCall = { code: number | undefined; reason: string | undefined };
type WebSocketEventHandler = (...args: unknown[]) => void;
type TestWebSocket = {
  readyState: number;
  on: (eventName: string, handler: WebSocketEventHandler) => void;
  close: (code?: number, reason?: string) => void;
  removeAllListeners: () => void;
};

type TwitchAuthOverrides = Partial<{
  ready: boolean;
  userId: string | null;
  refreshTokens: () => Promise<boolean>;
}>;

const createWebSocket = (overrides: Partial<TestWebSocket> = {}): TestWebSocket => ({
  readyState: 1,
  on: () => {},
  close: () => {},
  removeAllListeners: () => {},
  ...overrides,
});

const isRecord = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object";

const requireRecord = (value: unknown): Record<string, unknown> => {
  if (!isRecord(value)) {
    throw new Error("Expected object record");
  }
  return value;
};

class MockWebSocket {
  readyState: number;
  listeners: Record<string, WebSocketEventHandler[]>;

  constructor() {
    this.readyState = 1;
    this.listeners = {};
  }
  on(eventName: string, handler: WebSocketEventHandler): void {
    this.listeners[eventName] = this.listeners[eventName] || [];
    this.listeners[eventName].push(handler);
  }
  close() {}
  removeAllListeners() {
    this.listeners = {};
  }
}

class MockRawPlatformDataLoggingService {
  async logRawPlatformData(): Promise<void> {}
}

const createTwitchAuth = (overrides: TwitchAuthOverrides = {}) => ({
  isReady: () => ("ready" in overrides ? overrides.ready : true),
  refreshTokens: createMockFn().mockResolvedValue(true),
  getUserId: () => overrides.userId || "test-user-123",
  ...overrides,
});

const createEventSub = (
  configOverrides: Record<string, unknown> = {},
  depsOverrides: Record<string, unknown> = {},
): TwitchEventSub => {
  return new TwitchEventSub(
    {
      dataLoggingEnabled: false,
      broadcasterId: "test-broadcaster",
      clientId: "test-client-id",
      ...configOverrides,
    },
    {
      logger: noOpLogger,
      twitchAuth: createTwitchAuth(),
      axios: {
        post: createMockFn(),
        get: createMockFn(),
        delete: createMockFn(),
      },
      WebSocketCtor: MockWebSocket,
      RawPlatformDataLoggingService: MockRawPlatformDataLoggingService,
      ...depsOverrides,
    },
  );
};

describe("TwitchEventSub lifecycle", () => {
  let eventSub: TwitchEventSub | null;

  afterEach(async () => {
    if (eventSub) {
      await eventSub.cleanup().catch(() => {});
      eventSub = null;
    }
    _resetForTesting();
    initializeStaticSecrets();
  });

  describe("periodic cleanup", () => {
    it("uses zero default subscription delay for startup pacing", () => {
      eventSub = createEventSub();

      expect(eventSub.subscriptionDelay).toBe(0);
    });

    it("updates lastCleanup timestamp when cleanup runs", () => {
      eventSub = createEventSub();
      eventSub.memoryUsage.lastCleanup = 0;

      eventSub._performPeriodicCleanup();

      expect(eventSub.memoryUsage.lastCleanup).toBeGreaterThan(0);
    });
  });

  describe("message ID deduplication", () => {
    it("prunes message IDs older than TTL", () => {
      eventSub = createEventSub();
      const now = testClock.now();
      eventSub.recentMessageIds.set("old-msg", now - 10 * 60 * 1000);
      eventSub.recentMessageIds.set("new-msg", now - 1000);

      eventSub._pruneMessageIds(now);

      expect(eventSub.recentMessageIds.has("old-msg")).toBe(false);
      expect(eventSub.recentMessageIds.has("new-msg")).toBe(true);
    });

    it("returns false for missing message_id in metadata", () => {
      eventSub = createEventSub();

      const result = eventSub._isDuplicateMessageId({});

      expect(result).toBe(false);
    });

    it("returns false for null metadata", () => {
      eventSub = createEventSub();

      const result = eventSub._isDuplicateMessageId(null);

      expect(result).toBe(false);
    });

    it("triggers pruning when message ID count exceeds max", () => {
      eventSub = createEventSub();
      eventSub.maxMessageIds = 3;
      const now = testClock.now();
      eventSub.recentMessageIds.set("msg-1", now - 10 * 60 * 1000);
      eventSub.recentMessageIds.set("msg-2", now - 1000);
      eventSub.recentMessageIds.set("msg-3", now - 500);

      eventSub._isDuplicateMessageId({ message_id: "msg-4" });

      expect(eventSub.recentMessageIds.has("msg-1")).toBe(false);
      expect(eventSub.recentMessageIds.has("msg-4")).toBe(true);
    });
  });

  describe("initialization error handling", () => {
    it("initialize rethrows when configuration validation fails", async () => {
      secrets.twitch.accessToken = "test-access-token";
      eventSub = createEventSub({ broadcasterId: "" });
      eventSub.maxRetryAttempts = 0;
      const connectWebSocketMock = createMockFn(async () => {});
      eventSub._connectWebSocket = connectWebSocketMock;

      await expect(eventSub.initialize()).rejects.toThrow(
        "EventSub validation failed",
      );
      expect(connectWebSocketMock.mock.calls).toHaveLength(0);
      expect(eventSub.isInitialized).toBe(false);
    });

    it("initialize rethrows when websocket initialization fails", async () => {
      secrets.twitch.accessToken = "test-access-token";
      eventSub = createEventSub();
      eventSub.maxRetryAttempts = 0;
      eventSub.initialStartupMaxAttempts = 1;
      eventSub._connectWebSocket = createMockFn(async () => {
        throw new Error("ws connect failed");
      });

      await expect(eventSub.initialize()).rejects.toThrow("ws connect failed");
      expect(eventSub.isInitialized).toBe(false);
      expect(eventSub._isConnected).toBe(false);
      expect(eventSub.reconnectTimeout).toBeNull();
    });

    it("initialize retries transient websocket startup errors before succeeding", async () => {
      secrets.twitch.accessToken = "test-access-token";
      eventSub = createEventSub();
      eventSub.initialStartupMaxAttempts = 2;
      eventSub.initialStartupRetryDelay = 1;
      eventSub._cleanupAllWebSocketSubscriptions = createMockFn(async () => {});
      eventSub._deleteAllSubscriptions = createMockFn(async () => {});
      const currentEventSub = eventSub;
      const connectWebSocketMock = createMockFn(async () => {
        if (connectWebSocketMock.mock.calls.length === 1) {
          const error = new Error("socket hang up") as Error & { code?: string };
          error.code = "ECONNRESET";
          throw error;
        }
        currentEventSub.ws = createWebSocket();
        currentEventSub.sessionId = "connected-session";
        currentEventSub._isConnected = true;
        currentEventSub.subscriptionsReady = true;
      });
      eventSub._connectWebSocket = connectWebSocketMock;

      await eventSub.initialize();

      expect(connectWebSocketMock.mock.calls).toHaveLength(2);
      expect(eventSub.isInitialized).toBe(true);
      expect(eventSub._isConnected).toBe(true);
      expect(eventSub.subscriptionsReady).toBe(true);
      expect(eventSub.retryAttempts).toBe(0);
      expect(eventSub.reconnectTimeout).toBeNull();
    });

    it("initialize retries Twitch transient startup close codes before succeeding", async () => {
      secrets.twitch.accessToken = "test-access-token";
      eventSub = createEventSub();
      eventSub.initialStartupMaxAttempts = 2;
      eventSub.initialStartupRetryDelay = 1;
      eventSub._cleanupAllWebSocketSubscriptions = createMockFn(async () => {});
      eventSub._deleteAllSubscriptions = createMockFn(async () => {});
      const currentEventSub = eventSub;
      const connectWebSocketMock = createMockFn(async () => {
        if (connectWebSocketMock.mock.calls.length === 1) {
          const error = new Error("Connection closed before EventSub startup completed") as Error & { closeCode?: number };
          error.closeCode = 4006;
          throw error;
        }
        currentEventSub.ws = createWebSocket();
        currentEventSub.sessionId = "connected-session";
        currentEventSub._isConnected = true;
        currentEventSub.subscriptionsReady = true;
      });
      eventSub._connectWebSocket = connectWebSocketMock;

      await eventSub.initialize();

      expect(connectWebSocketMock.mock.calls).toHaveLength(2);
      expect(eventSub.isInitialized).toBe(true);
    });

    it("initialize cleans up partial websocket timers and state after startup failure", async () => {
      secrets.twitch.accessToken = "test-access-token";
      eventSub = createEventSub();
      eventSub.initialStartupMaxAttempts = 1;
      const closeCalls: CloseCall[] = [];
      const removeListenersCalls: boolean[] = [];
      const deleteAllSubscriptionsMock = createMockFn(async () => {});
      eventSub._deleteAllSubscriptions = deleteAllSubscriptionsMock;
      const currentEventSub = eventSub;
      eventSub._connectWebSocket = createMockFn(async () => {
        currentEventSub.ws = createWebSocket({
          readyState: 1,
          close: (code?: number, reason?: string) => { closeCalls.push({ code, reason }); },
          removeAllListeners: () => removeListenersCalls.push(true),
        });
        currentEventSub.welcomeTimer = safeSetTimeout(() => {}, 10000);
        currentEventSub.reconnectTimeout = safeSetTimeout(() => {}, 10000);
        currentEventSub.sessionId = "partial-session";
        currentEventSub._isConnected = true;
        currentEventSub.subscriptionsReady = true;
        currentEventSub.subscriptions.set("sub-1", { id: "sub-1" });
        throw new Error("fatal startup failure");
      });

      await expect(eventSub.initialize()).rejects.toThrow("fatal startup failure");

      expect(deleteAllSubscriptionsMock.mock.calls).toHaveLength(1);
      expect(closeCalls).toHaveLength(1);
      expect(closeCalls[0]?.code).toBe(1000);
      expect(removeListenersCalls).toHaveLength(1);
      expect(eventSub.ws).toBeNull();
      expect(eventSub.welcomeTimer).toBeNull();
      expect(eventSub.reconnectTimeout).toBeNull();
      expect(eventSub.sessionId).toBeNull();
      expect(eventSub._isConnected).toBe(false);
      expect(eventSub.subscriptionsReady).toBe(false);
      expect(eventSub.isInitialized).toBe(false);
      expect(eventSub.subscriptions.size).toBe(0);
    });

    it("does not schedule hidden retry timers on initialization failure", async () => {
      eventSub = createEventSub();
      eventSub.maxRetryAttempts = 3;
      eventSub.retryDelay = 100;

      eventSub._handleInitializationError(new Error("test error"));

      expect(eventSub.isInitialized).toBe(false);
      expect(eventSub._isConnected).toBe(false);
      expect(eventSub.retryAttempts).toBe(0);
      expect(eventSub.reconnectTimeout).toBeNull();
    });

    it("leaves retry timer unset even after repeated initialization errors", () => {
      eventSub = createEventSub();
      eventSub.maxRetryAttempts = 2;
      eventSub.retryAttempts = 2;

      eventSub._handleInitializationError(new Error("final error"));

      expect(eventSub.retryAttempts).toBe(0);
      expect(eventSub.reconnectTimeout).toBeNull();
    });
  });

  describe("cleanup", () => {
    it("clears all timers and resets state", async () => {
      const mockAxios = {
        get: createMockFn().mockResolvedValue({ data: { data: [] } }),
        delete: createMockFn(),
      };
      eventSub = createEventSub({}, { axios: mockAxios });
      eventSub.reconnectTimeout = safeSetTimeout(() => {}, 10000);
      eventSub.welcomeTimer = safeSetTimeout(() => {}, 10000);
      eventSub.isInitialized = true;
      eventSub._isConnected = true;
      eventSub.subscriptionsReady = true;
      eventSub.sessionId = "test-session";
      eventSub.subscriptions.set("sub-1", { id: "sub-1" });

      await eventSub.cleanup();

      expect(eventSub.reconnectTimeout).toBeNull();
      expect(eventSub.welcomeTimer).toBeNull();
      expect(eventSub.cleanupInterval).toBeNull();
      expect(eventSub.isInitialized).toBe(false);
      expect(eventSub._isConnected).toBe(false);
      expect(eventSub.subscriptionsReady).toBe(false);
      expect(eventSub.sessionId).toBeNull();
      expect(eventSub.subscriptions.size).toBe(0);
    });

    it("closes WebSocket and removes listeners", async () => {
      const mockAxios = {
        get: createMockFn().mockResolvedValue({ data: { data: [] } }),
        delete: createMockFn(),
      };
      eventSub = createEventSub({}, { axios: mockAxios });
      const closeCalled: CloseCall[] = [];
      const removeListenersCalled: boolean[] = [];
      eventSub.ws = createWebSocket({
        readyState: 1,
        close: (code?: number, reason?: string) => { closeCalled.push({ code, reason }); },
        removeAllListeners: () => removeListenersCalled.push(true),
      });

      await eventSub.cleanup();

      expect(closeCalled.length).toBe(1);
      expect(closeCalled[0]?.code).toBe(1000);
      expect(removeListenersCalled.length).toBe(1);
      expect(eventSub.ws).toBeNull();
    });

    it("handles WebSocket close errors gracefully", async () => {
      const mockAxios = {
        get: createMockFn().mockResolvedValue({ data: { data: [] } }),
        delete: createMockFn(),
      };
      eventSub = createEventSub({}, { axios: mockAxios });
      eventSub.ws = createWebSocket({
        readyState: 1,
        close: () => {
          throw new Error("close failed");
        },
        removeAllListeners: () => {},
      });

      await eventSub.cleanup();

      expect(eventSub.ws).toBeNull();
    });
  });

  describe("WebSocket message handling", () => {
    it("does not throw on session_welcome message", async () => {
      eventSub = createEventSub();

      await expect(
        eventSub.handleWebSocketMessage({
          metadata: { message_type: "session_welcome" },
          payload: {
            session: {
              id: "test-session-123",
              keepalive_timeout_seconds: 30,
              status: "connected",
              connected_at: "2024-01-01T00:00:00Z",
            },
          },
        }),
      ).resolves.toBeUndefined();
    });

    it("does not throw on session_keepalive message", async () => {
      eventSub = createEventSub();

      await expect(
        eventSub.handleWebSocketMessage({
          metadata: { message_type: "session_keepalive" },
          payload: {},
        }),
      ).resolves.toBeUndefined();
    });

    it("does not throw on unknown message type", async () => {
      eventSub = createEventSub();

      await expect(
        eventSub.handleWebSocketMessage({
          metadata: { message_type: "unknown_type" },
          payload: {},
        }),
      ).resolves.toBeUndefined();
    });

    it("delegates session_reconnect to wsLifecycle handler", async () => {
      eventSub = createEventSub();
      let reconnectCalled = false;
      eventSub.wsLifecycle = {
        ...eventSub.wsLifecycle,
        handleReconnectRequest: () => {
          reconnectCalled = true;
        },
      };

      await eventSub.handleWebSocketMessage({
        metadata: { message_type: "session_reconnect" },
        payload: { session: { reconnect_url: "wss://new-url" } },
      });

      expect(reconnectCalled).toBe(true);
    });
  });

  describe("status methods", () => {
    it("isActive returns true when fully connected and subscribed", () => {
      eventSub = createEventSub();
      eventSub.isInitialized = true;
      eventSub._isConnected = true;
      eventSub.subscriptionsReady = true;

      expect(eventSub.isActive()).toBe(true);
    });

    it("isActive returns false when not fully ready", () => {
      eventSub = createEventSub();
      eventSub.isInitialized = true;
      eventSub._isConnected = false;
      eventSub.subscriptionsReady = true;

      expect(eventSub.isActive()).toBe(false);
    });

    it("isConnected checks WebSocket readyState", () => {
      eventSub = createEventSub();
      eventSub._isConnected = true;
      eventSub.ws = createWebSocket({ readyState: 1 });

      expect(eventSub.isConnected()).toBe(true);

      eventSub.ws = createWebSocket({ readyState: 3 });
      expect(eventSub.isConnected()).toBe(false);
    });
  });

  describe("event routing delegation", () => {
    it("delegates chat message events to event router", () => {
      eventSub = createEventSub();
      const routedEvents: unknown[] = [];
      eventSub.eventRouter = {
        ...eventSub.eventRouter,
        handleChatMessageEvent: (event) => routedEvents.push(event),
      };

      eventSub._handleChatMessageEvent({ text: "test" });

      expect(routedEvents.length).toBe(1);
      expect(requireRecord(routedEvents[0]).text).toBe("test");
    });

    it("delegates follow events to event router", () => {
      eventSub = createEventSub();
      const routedEvents: unknown[] = [];
      eventSub.eventRouter = {
        ...eventSub.eventRouter,
        handleFollowEvent: (event) => routedEvents.push(event),
      };

      eventSub._handleFollowEvent({ user_name: "testuser" });

      expect(routedEvents.length).toBe(1);
    });

    it("delegates paypiggy events to event router", () => {
      eventSub = createEventSub();
      const routedEvents: unknown[] = [];
      eventSub.eventRouter = {
        ...eventSub.eventRouter,
        handlePaypiggyEvent: (event) => routedEvents.push(event),
      };

      eventSub._handlePaypiggyEvent({ tier: "1000" });

      expect(routedEvents.length).toBe(1);
    });

    it("delegates raid events to event router", () => {
      eventSub = createEventSub();
      const routedEvents: unknown[] = [];
      eventSub.eventRouter = {
        ...eventSub.eventRouter,
        handleRaidEvent: (event) => routedEvents.push(event),
      };

      eventSub._handleRaidEvent({ viewers: 100 });

      expect(routedEvents.length).toBe(1);
    });

    it("delegates bits events to event router", () => {
      eventSub = createEventSub();
      const routedEvents: unknown[] = [];
      eventSub.eventRouter = {
        ...eventSub.eventRouter,
        handleBitsUseEvent: (event) => routedEvents.push(event),
      };

      eventSub._handleBitsUseEvent({ bits: 500 });

      expect(routedEvents.length).toBe(1);
    });

    it("delegates gift paypiggy events to event router", () => {
      eventSub = createEventSub();
      const routedEvents: unknown[] = [];
      eventSub.eventRouter = {
        ...eventSub.eventRouter,
        handlePaypiggyGiftEvent: (event) => routedEvents.push(event),
      };

      eventSub._handlePaypiggyGiftEvent({ total: 5 });

      expect(routedEvents.length).toBe(1);
    });

    it("delegates paypiggy message events to event router", () => {
      eventSub = createEventSub();
      const routedEvents: unknown[] = [];
      eventSub.eventRouter = {
        ...eventSub.eventRouter,
        handlePaypiggyMessageEvent: (event) => routedEvents.push(event),
      };

      eventSub._handlePaypiggyMessageEvent({ message: "test" });

      expect(routedEvents.length).toBe(1);
    });

    it("delegates stream online events to event router", () => {
      eventSub = createEventSub();
      const routedEvents: unknown[] = [];
      eventSub.eventRouter = {
        ...eventSub.eventRouter,
        handleStreamOnlineEvent: (event) => routedEvents.push(event),
      };

      eventSub._handleStreamOnlineEvent({ started_at: "2024-01-01" });

      expect(routedEvents.length).toBe(1);
    });

    it("delegates stream offline events to event router", () => {
      eventSub = createEventSub();
      const routedEvents: unknown[] = [];
      eventSub.eventRouter = {
        ...eventSub.eventRouter,
        handleStreamOfflineEvent: (event) => routedEvents.push(event),
      };

      eventSub._handleStreamOfflineEvent({});

      expect(routedEvents.length).toBe(1);
    });
  });

  describe("sendMessage", () => {
    it("throws when message is empty", async () => {
      eventSub = createEventSub();

      await expect(eventSub.sendMessage("")).rejects.toThrow(
        "non-empty message",
      );
      await expect(eventSub.sendMessage("   ")).rejects.toThrow(
        "non-empty message",
      );
    });

    it("throws when Twitch auth is missing", async () => {
      eventSub = createEventSub();
      Object.defineProperty(eventSub, "twitchAuth", { value: null, writable: true });

      await expect(eventSub.sendMessage("test")).rejects.toThrow("Twitch auth");
    });

    it("throws when user ID is not available", async () => {
      eventSub = createEventSub(
        {},
        {
          twitchAuth: { ...createTwitchAuth(), getUserId: () => null },
        },
      );

      await expect(eventSub.sendMessage("test")).rejects.toThrow("user ID");
    });

    it("throws when client ID is not available", async () => {
      eventSub = createEventSub(
        { clientId: null },
        {
          twitchAuth: createTwitchAuth(),
        },
      );

      await expect(eventSub.sendMessage("test")).rejects.toThrow("clientId");
    });

    it("sends message via API and returns success", async () => {
      const postCalls: Array<{ url: string; payload: Record<string, unknown>; config: unknown }> = [];
      const mockAxios = {
        post: createMockFn().mockImplementation((url: unknown, payload: unknown, config: unknown) => {
          if (typeof url !== "string" || !isRecord(payload)) {
            throw new Error("Expected Twitch sendMessage request payload");
          }
          postCalls.push({ url, payload, config });
          return Promise.resolve({});
        }),
        get: createMockFn(),
        delete: createMockFn(),
      };
      secrets.twitch.accessToken = "test-token";
      eventSub = createEventSub({}, { axios: mockAxios });

      const result = await eventSub.sendMessage("Hello stream!");

      expect(result.success).toBe(true);
      expect(result.platform).toBe("twitch");
      expect(postCalls.length).toBe(1);
      expect(postCalls[0]?.payload.message).toBe("Hello stream!");
    });

    it("retries once after refresh on 401", async () => {
      let callCount = 0;
      const mockAxios = {
        post: createMockFn().mockImplementation(() => {
          callCount += 1;
          if (callCount === 1) {
            const error = new Error("Unauthorized") as Error & { response?: { status: number } };
            error.response = { status: 401 };
            return Promise.reject(error);
          }
          return Promise.resolve({});
        }),
        get: createMockFn(),
        delete: createMockFn(),
      };
      const refreshedToken = "refreshed-token";
      const twitchAuth = createTwitchAuth({
        refreshTokens: async () => {
          secrets.twitch.accessToken = refreshedToken;
          return true;
        },
      });
      secrets.twitch.accessToken = "expired-token";
      eventSub = createEventSub({}, { axios: mockAxios, twitchAuth });

      const result = await eventSub.sendMessage("Retry message");

      expect(result.success).toBe(true);
      expect(mockAxios.post.mock.calls.length).toBe(2);
    });

    it("handles API error and throws", async () => {
      const mockAxios = {
        post: createMockFn().mockRejectedValue(new Error("API error")),
        get: createMockFn(),
        delete: createMockFn(),
      };
      eventSub = createEventSub({}, { axios: mockAxios });

      await expect(eventSub.sendMessage("test")).rejects.toThrow("send failed");
    });
  });

  describe("connection validation", () => {
    it("returns false when session ID is empty", () => {
      eventSub = createEventSub();
      eventSub.sessionId = "   ";
      eventSub._isConnected = true;
      eventSub.ws = createWebSocket({ readyState: 1 });
      eventSub.isInitialized = true;

      expect(eventSub._validateConnectionForSubscriptions()).toBe(false);
    });

    it("returns false when not connected", () => {
      eventSub = createEventSub();
      eventSub.sessionId = "test-session";
      eventSub._isConnected = false;
      eventSub.ws = createWebSocket({ readyState: 1 });
      eventSub.isInitialized = true;

      expect(eventSub._validateConnectionForSubscriptions()).toBe(false);
    });

    it("returns false when WebSocket is missing", () => {
      eventSub = createEventSub();
      eventSub.sessionId = "test-session";
      eventSub._isConnected = true;
      eventSub.ws = null;
      eventSub.isInitialized = true;

      expect(eventSub._validateConnectionForSubscriptions()).toBe(false);
    });

    it("returns false when Twitch auth is not ready", () => {
      secrets.twitch.accessToken = "test-access-token";
      eventSub = createEventSub(
        {},
        {
          twitchAuth: createTwitchAuth({ ready: false }),
        },
      );
      eventSub.sessionId = "test-session";
      eventSub._isConnected = true;
      eventSub.ws = createWebSocket({ readyState: 1 });
      eventSub.isInitialized = true;

      expect(eventSub._validateConnectionForSubscriptions()).toBe(false);
    });

    it("returns true when all conditions are met", () => {
      secrets.twitch.accessToken = "test-access-token";
      eventSub = createEventSub(
        { clientId: "test-client-id" },
        {
          twitchAuth: createTwitchAuth({ ready: true }),
        },
      );
      eventSub.sessionId = "test-session";
      eventSub._isConnected = true;
      eventSub.ws = createWebSocket({ readyState: 1 });
      eventSub.isInitialized = false; // Note: isInitialized is NOT checked during validation

      expect(eventSub._validateConnectionForSubscriptions()).toBe(true);
    });

    it("returns false when token provider is missing", () => {
      secrets.twitch.accessToken = null;
      eventSub = createEventSub(
        { clientId: "test-client-id" },
        {
          twitchAuth: createTwitchAuth(),
        },
      );
      eventSub.sessionId = "test-session";
      eventSub._isConnected = true;
      eventSub.ws = createWebSocket({ readyState: 1 });
      eventSub.isInitialized = true;

      expect(eventSub._validateConnectionForSubscriptions()).toBe(false);
    });
  });

  describe("raw data logging", () => {
    it("delegates to chat file logging service", async () => {
      const logCalls: Array<{
        platform: string;
        type: string;
        data: unknown;
        config: unknown;
      }> = [];
      const mockLoggingService = {
        logRawPlatformData: async (
          platform: string,
          type: string,
          data: unknown,
          config: unknown,
        ): Promise<void> => {
          logCalls.push({ platform, type, data, config });
        },
      };
      eventSub = createEventSub();
      eventSub.rawPlatformDataLoggingService = mockLoggingService;

      await eventSub.logRawPlatformData("chat", { message: "test" });

      expect(logCalls.length).toBe(1);
      const logCall = logCalls[0];
      expect(logCall).toBeDefined();
      expect(logCall?.platform).toBe("twitch");
      expect(logCall?.type).toBe("chat");
    });
  });

  describe("error logging", () => {
    it("handles Error instances via error handler", () => {
      const handledErrors: Array<{ err: Error; type: string; payload: unknown; msg?: string }> = [];
      eventSub = createEventSub();
      eventSub.errorHandler = {
        handleEventProcessingError: (err, type, payload, msg) => {
          const entry: { err: Error; type: string; payload: unknown; msg?: string } = { err, type, payload };
          if (msg !== undefined) {
            entry.msg = msg;
          }
          handledErrors.push(entry);
        },
        logOperationalError: () => {},
      };

      eventSub._logEventSubError(
        "test message",
        new Error("test error"),
        "test-type",
        { data: "test" },
      );

      expect(handledErrors.length).toBe(1);
      expect(handledErrors[0]?.type).toBe("test-type");
    });

    it("logs operational errors for non-Error objects", () => {
      const loggedErrors: Array<{ msg: string; ctx: string; payload: unknown }> = [];
      eventSub = createEventSub();
      eventSub.errorHandler = {
        handleEventProcessingError: () => {},
        logOperationalError: (msg, ctx, payload) => {
          loggedErrors.push({ msg, ctx, payload });
        },
      };

      eventSub._logEventSubError(
        "test message",
        { info: "not an error" },
        "test-type",
      );

      expect(loggedErrors.length).toBe(1);
      expect(loggedErrors[0]?.msg).toBe("test message");
    });
  });

  describe("subscription revocation", () => {
    it("skips resubscription when not initialized", async () => {
      eventSub = createEventSub();
      eventSub.isInitialized = false;
      let resubCalled = false;
      eventSub._setupEventSubscriptions = async () => {
        resubCalled = true;
        return null;
      };

      await eventSub._handleSubscriptionRevocation({
        type: "channel.follow",
        id: "sub-1",
        status: "revoked",
      });

      expect(resubCalled).toBe(false);
    });

    it("skips resubscription when subscription type is missing", async () => {
      eventSub = createEventSub();
      eventSub.isInitialized = true;
      let resubCalled = false;
      eventSub._setupEventSubscriptions = async () => {
        resubCalled = true;
        return null;
      };

      await eventSub._handleSubscriptionRevocation({
        id: "sub-1",
        status: "revoked",
      });

      expect(resubCalled).toBe(false);
    });

    it("marks subscriptions not ready after revocation and resubscribes", async () => {
      eventSub = createEventSub();
      eventSub.isInitialized = true;
      eventSub.subscriptionsReady = true;
      eventSub.sessionId = "test-session";
      eventSub._setupEventSubscriptions = async () => ({ failures: [] });

      await eventSub._handleSubscriptionRevocation({
        type: "channel.follow",
        id: "sub-1",
        status: "revoked",
      });

      expect(eventSub.subscriptionsReady).toBe(true);
    });

    it("recreates only the revoked subscription type", async () => {
      eventSub = createEventSub();
      eventSub.isInitialized = true;
      eventSub.subscriptionsReady = true;
      eventSub.sessionId = "test-session";
      const replacementTypes: string[] = [];
      eventSub._setupEventSubscriptions = async (_validationAlreadyDone, requiredSubscriptions) => {
        replacementTypes.push(...(requiredSubscriptions || []).map((subscription) => subscription.type));
        return { failures: [] };
      };

      await eventSub._handleSubscriptionRevocation({
        type: "channel.follow",
        id: "sub-1",
        status: "revoked",
      });

      expect(replacementTypes).toEqual(["channel.follow"]);
      expect(eventSub.subscriptionsReady).toBe(true);
    });

    it("keeps subscriptions not ready when resubscription fails", async () => {
      eventSub = createEventSub();
      eventSub.isInitialized = true;
      eventSub.subscriptionsReady = true;
      eventSub.sessionId = "test-session";
      eventSub._setupEventSubscriptions = async () => ({
        failures: [{ type: "channel.follow" }],
      });

      await eventSub._handleSubscriptionRevocation({
        type: "channel.follow",
        id: "sub-1",
        status: "revoked",
      });

      expect(eventSub.subscriptionsReady).toBe(false);
    });

    it("handles resubscription errors gracefully", async () => {
      eventSub = createEventSub();
      eventSub.isInitialized = true;
      eventSub.subscriptionsReady = true;
      eventSub.sessionId = "test-session";
      eventSub._setupEventSubscriptions = async () => {
        throw new Error("resubscribe failed");
      };

      await eventSub._handleSubscriptionRevocation({
        type: "channel.follow",
        id: "sub-1",
        status: "revoked",
      });

      expect(eventSub.subscriptionsReady).toBe(false);
    });
  });

  describe("wsLifecycle delegation", () => {
    it("delegates scheduleReconnect to wsLifecycle", () => {
      eventSub = createEventSub();
      let scheduleCalled = false;
      eventSub.wsLifecycle = {
        ...eventSub.wsLifecycle,
        scheduleReconnect: () => {
          scheduleCalled = true;
        },
      };

      eventSub._scheduleReconnect();

      expect(scheduleCalled).toBe(true);
    });

    it("delegates reconnect to wsLifecycle", async () => {
      eventSub = createEventSub();
      let reconnectCalled = false;
      eventSub.wsLifecycle = {
        ...eventSub.wsLifecycle,
        reconnect: async () => {
          reconnectCalled = true;
        },
      };

      await eventSub._reconnect();

      expect(reconnectCalled).toBe(true);
    });

    it("delegates connectWebSocket to wsLifecycle", async () => {
      eventSub = createEventSub();
      let connectCalled = false;
      eventSub.wsLifecycle = {
        ...eventSub.wsLifecycle,
        connectWebSocket: async () => {
          connectCalled = true;
        },
      };

      await eventSub._connectWebSocket();

      expect(connectCalled).toBe(true);
    });
  });
});
