import { describe, it, expect, beforeEach } from "bun:test";
import { createMockFn } from "../../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../../helpers/mock-factories";
import {
  secrets,
  _resetForTesting,
  initializeStaticSecrets,
} from "../../../../../src/core/secrets";

import { TwitchEventSub } from "../../../../../src/platforms/twitch-eventsub.ts";

type WebSocketEventHandler = (...args: unknown[]) => void;
type TestWebSocket = {
  readyState: number;
  on: (eventName: string, handler: WebSocketEventHandler) => void;
  close: (code?: number, reason?: string) => void;
  removeAllListeners: () => void;
};

type MockDependencies = ConstructorParameters<typeof TwitchEventSub>[1];
type RoutedPayload = Record<string, unknown> & {
  message?: { text?: string };
  userId?: string;
  username?: string;
  timestamp?: string;
};
type SubscriptionSetupPayload = {
  sessionId: string | null;
  broadcasterId: string;
};
type LoggedEventSubError = {
  message: string;
  error: unknown;
  eventType: string | undefined;
  payload: unknown;
};

const hasSource = (value: unknown): value is { source: unknown } =>
  value !== null && typeof value === "object" && "source" in value;

const createWebSocket = (overrides: Partial<TestWebSocket> = {}): TestWebSocket => ({
  readyState: 1,
  on: () => {},
  close: () => {},
  removeAllListeners: () => {},
  ...overrides,
});

const createSubscriptionDefinition = (type = "channel.follow") => ({
  name: "Test subscription",
  type,
  version: "1",
  getCondition: ({ broadcasterId }: { userId: string; broadcasterId: string }) => ({
    broadcaster_user_id: broadcasterId,
  }),
});

class MockWebSocket {
  readyState: number;

  constructor() {
    this.readyState = 1;
  }
  on(): void {}
  close() {}
  removeAllListeners(): void {}
  send() {}
}

describe("TwitchEventSub behavior", () => {
  let mockTwitchAuth: { isReady: () => boolean; refreshTokens: () => Promise<boolean>; getUserId: () => string };
  let MockRawPlatformDataLoggingService: new () => { logRawPlatformData: () => Promise<void> };
  let mockDependencies: MockDependencies;

  beforeEach(() => {
    _resetForTesting();
    initializeStaticSecrets();
    secrets.twitch.accessToken = "testAccessToken";
    mockTwitchAuth = {
      isReady: () => true,
      refreshTokens: createMockFn().mockResolvedValue(true),
      getUserId: () => "testUser123",
    };
    MockRawPlatformDataLoggingService = class {
      async logRawPlatformData(): Promise<void> {}
    };
    mockDependencies = {
      logger: noOpLogger,
      twitchAuth: mockTwitchAuth,
      RawPlatformDataLoggingService: MockRawPlatformDataLoggingService,
      WebSocketCtor: MockWebSocket,
    };
  });

  it("routes follow events to handlers and emits follow event", () => {
    const instance = new TwitchEventSub(
      {
        channel: "testChannel",
        clientId: "testClientId",
        broadcasterId: "test-broadcaster-id",
      },
      mockDependencies,
    );

    const followEvents: RoutedPayload[] = [];
    instance.on("follow", (payload) => followEvents.push(payload));

    instance.handleNotificationEvent("channel.follow", {
      user_name: "testFollower",
      user_id: "test-follower-id",
      user_login: "testfollower",
      followed_at: "2024-01-01T00:00:00Z",
    }, null);

    expect(followEvents.length).toBe(1);
    expect(followEvents[0]?.userId).toBe("test-follower-id");
    expect(followEvents[0]?.username).toBe("testFollower");
    expect(followEvents[0]?.timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("routes chat message events and includes timestamp", () => {
    const instance = new TwitchEventSub(
      {
        channel: "testChannel",
        clientId: "testClientId",
        broadcasterId: "test-broadcaster-id",
      },
      mockDependencies,
    );

    const messageEvents: RoutedPayload[] = [];
    instance.on("chatMessage", (payload) => messageEvents.push(payload));

    instance.handleNotificationEvent(
      "channel.chat.message",
      {
        chatter_user_id: "chatter123",
        broadcaster_user_id: "broadcaster456",
        message: { text: "Hello stream!" },
      },
      {
        message_timestamp: "2024-01-01T12:00:00.321654987Z",
      },
    );

    expect(messageEvents.length).toBe(1);
    expect(messageEvents[0]?.message?.text).toBe("Hello stream!");
    expect(messageEvents[0]?.timestamp).toBe("2024-01-01T12:00:00.321Z");
  });

  it("ignores duplicate notification message ids", () => {
    const instance = new TwitchEventSub(
      {
        channel: "testChannel",
        clientId: "testClientId",
        broadcasterId: "test-broadcaster-id",
      },
      mockDependencies,
    );

    const followEvents: RoutedPayload[] = [];
    instance.on("follow", (payload) => followEvents.push(payload));

    const message = {
      metadata: {
        message_id: "dedupe-test-id",
        message_type: "notification",
      },
      payload: {
        subscription: { type: "channel.follow" },
        event: {
          user_name: "testUser",
          user_id: "test-user-id",
          user_login: "testuser",
          followed_at: "2024-01-01T00:00:00Z",
        },
      },
    };

    instance.handleWebSocketMessage(message);
    instance.handleWebSocketMessage(message);

    expect(followEvents.length).toBe(1);
  });

  it("retries subscriptions when a revocation arrives", async () => {
    const instance = new TwitchEventSub(
      {
        channel: "testChannel",
        clientId: "testClientId",
        broadcasterId: "test-broadcaster-id",
      },
      mockDependencies,
    );
    const resubscribeCalls: SubscriptionSetupPayload[] = [];
    instance.subscriptionManager.setupEventSubscriptions = async (payload) => {
      resubscribeCalls.push(payload);
      return { failures: [], successful: 1, total: 1, timestamp: 1 };
    };
    instance.requiredSubscriptions = [
      {
        name: "Follows",
        type: "channel.follow",
        version: "2",
        getCondition: ({ broadcasterId }) => ({
          broadcaster_user_id: broadcasterId,
        }),
      },
    ];
    instance.sessionId = "testSession123";
    instance._isConnected = true;
    instance.isInitialized = true;
    instance.broadcasterId = "testUser123";

    await instance.handleWebSocketMessage({
      metadata: { message_type: "revocation" },
      payload: {
        subscription: {
          id: "sub-1",
          status: "authorization_revoked",
          type: "channel.follow",
        },
      },
    });

    expect(resubscribeCalls.length).toBe(1);
    expect(resubscribeCalls[0]?.sessionId).toBe("testSession123");
    expect(resubscribeCalls[0]?.broadcasterId).toBe("testUser123");
  });

  it("validates configuration using centralized auth fallback", () => {
    const instance = new TwitchEventSub(
      {
        channel: "testChannel",
        clientId: "testClientId",
        broadcasterId: "test-broadcaster-id",
      },
      mockDependencies,
    );

    const result = instance._validateConfigurationFields();

    expect(result.valid).toBe(true);
    expect(hasSource(result.details.accessToken)).toBe(true);
    if (!hasSource(result.details.accessToken)) {
      throw new Error("Expected access token validation details");
    }
    expect(result.details.accessToken.source).toBe("secrets");
  });

  it("parses subscription errors with critical flag for auth failures", () => {
    const instance = new TwitchEventSub(
      {
        channel: "testChannel",
        clientId: "testClientId",
        broadcasterId: "test-broadcaster-id",
      },
      mockDependencies,
    );

    const parsed = instance._parseSubscriptionError(
      {
        response: {
          data: { error: "Unauthorized", message: "invalid token" },
          status: 401,
        },
      },
      createSubscriptionDefinition("channel.follow"),
    );

    expect(parsed.isCritical).toBe(true);
  });

  it("parses subscription errors with retryable flag for rate limits", () => {
    const instance = new TwitchEventSub(
      {
        channel: "testChannel",
        clientId: "testClientId",
        broadcasterId: "test-broadcaster-id",
      },
      mockDependencies,
    );

    const parsed = instance._parseSubscriptionError(
      {
        response: {
          data: { error: "Too Many Requests", message: "rate limit exceeded" },
          status: 429,
        },
      },
      createSubscriptionDefinition("channel.follow"),
    );

    expect(parsed.isRetryable).toBe(true);
  });

  it("validates connection readiness before subscription setup", () => {
    const instance = new TwitchEventSub(
      {
        channel: "testChannel",
        clientId: "testClientId",
        broadcasterId: "test-broadcaster-id",
      },
      mockDependencies,
    );
    instance.ws = createWebSocket({ readyState: 1 });
    instance._isConnected = true;
    instance.isInitialized = true;
    instance.sessionId = "testSession123";

    const valid = instance._validateConnectionForSubscriptions();

    expect(valid).toBe(true);
  });

  it("continues reconnecting when WebSocket close throws", async () => {
    const instance = new TwitchEventSub(
      {
        channel: "testChannel",
        clientId: "testClientId",
        broadcasterId: "test-broadcaster-id",
      },
      mockDependencies,
    );
    instance.isInitialized = true;
    instance.maxRetryAttempts = 1;
    instance.ws = createWebSocket({
      readyState: 1,
      close: () => {
        throw new Error("close failed");
      },
    });

    let reconnected = false;
    instance._connectWebSocket = async () => {
      reconnected = true;
    };

    await instance._reconnect();

    expect(reconnected).toBe(true);
  });

  it("continues deleting WebSocket subscriptions after a deletion error", async () => {
    const logErrors: LoggedEventSubError[] = [];
    const mockAxios = {
      get: createMockFn().mockResolvedValue({
        data: {
          data: [
            {
              id: "sub-1",
              type: "channel.follow",
              status: "enabled",
              transport: { method: "websocket", session_id: "testSession123" },
            },
            {
              id: "sub-2",
              type: "channel.subscribe",
              status: "enabled",
              transport: { method: "websocket", session_id: "otherSession" },
            },
          ],
        },
      }),
      delete: createMockFn()
        .mockRejectedValueOnce(new Error("delete failed"))
        .mockResolvedValueOnce(undefined),
    };

    const instance = new TwitchEventSub(
      {
        channel: "testChannel",
        clientId: "testClientId",
        broadcasterId: "test-broadcaster-id",
      },
      { ...mockDependencies, axios: mockAxios },
    );
    instance._logEventSubError = (message, error, eventType, payload) => {
      logErrors.push({ message, error, eventType, payload });
    };
    instance.sessionId = "testSession123";

    await instance._cleanupAllWebSocketSubscriptions();

    expect(mockAxios.delete.mock.calls.length).toBe(1);
    expect(
      logErrors.some((entry) => entry.eventType === "subscription-delete"),
    ).toBe(true);
  });

  it("continues deleting session subscriptions after a deletion error", async () => {
    const logErrors: LoggedEventSubError[] = [];
    const mockAxios = {
      get: createMockFn().mockResolvedValue({
        data: {
          data: [
            {
              id: "sub-1",
              type: "channel.follow",
              transport: { method: "websocket", session_id: "testSession123" },
            },
            {
              id: "sub-2",
              type: "channel.subscribe",
              transport: { method: "websocket", session_id: "testSession123" },
            },
            {
              id: "sub-3",
              type: "channel.subscribe",
              transport: { method: "websocket", session_id: "otherSession" },
            },
          ],
        },
      }),
      delete: createMockFn()
        .mockRejectedValueOnce(new Error("delete failed"))
        .mockResolvedValueOnce(undefined),
    };

    const instance = new TwitchEventSub(
      {
        channel: "testChannel",
        clientId: "testClientId",
        broadcasterId: "test-broadcaster-id",
      },
      { ...mockDependencies, axios: mockAxios },
    );
    instance._logEventSubError = (message, error, eventType, payload) => {
      logErrors.push({ message, error, eventType, payload });
    };
    instance.sessionId = "testSession123";
    instance.subscriptions.set("sub-1", { id: "sub-1" });
    instance.subscriptions.set("sub-2", { id: "sub-2" });
    instance.subscriptions.set("sub-3", { id: "sub-3" });

    await instance._deleteAllSubscriptions();

    expect(instance.subscriptions.has("sub-2")).toBe(false);
    expect(instance.subscriptions.has("sub-3")).toBe(true);
    expect(
      logErrors.some((entry) => entry.eventType === "subscription-delete"),
    ).toBe(true);
    expect(logErrors.length).toBeGreaterThan(0);
  });
});
