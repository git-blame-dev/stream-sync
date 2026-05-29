import { describe, test, expect } from "bun:test";
import type { AxiosResponse } from "axios";
import { noOpLogger } from "../../../../helpers/mock-factories";
import { createTwitchEventSubSubscriptionManager } from "../../../../../src/platforms/twitch/connections/eventsub-subscription-manager.ts";
import {
  secrets,
  _resetForTesting,
  initializeStaticSecrets,
} from "../../../../../src/core/secrets";

type HttpHeaders = Record<string, string>;

type HttpOptions = {
  headers?: HttpHeaders;
};

type HttpResponse<T = unknown> = AxiosResponse<T>;

type HttpClient = {
  get: (url: string, options?: HttpOptions) => Promise<HttpResponse>;
  post: (
    url: string,
    payload?: SubscriptionRequestPayload,
    options?: HttpOptions,
  ) => Promise<HttpResponse>;
  delete: (url: string, options?: HttpOptions) => Promise<HttpResponse>;
};

type SubscriptionDefinition = {
  name: string;
  type: string;
  version: string;
  getCondition: (input: {
    userId: string;
    broadcasterId: string;
  }) => Record<string, unknown>;
};

type SubscriptionRequestPayload = {
  type: string;
  version?: string;
  condition?: Record<string, unknown>;
  transport?: Record<string, unknown>;
};

type PostCall = {
  url: string;
  payload: SubscriptionRequestPayload;
  headers?: HttpHeaders | undefined;
};

type RequestCall = {
  url: string;
  headers?: HttpHeaders | undefined;
};

type ErrorWithResponse = Error & {
  response: {
    data: { error: string; message: string };
    status: number;
  };
};

type ManagerOverrides = {
  axios?: Partial<HttpClient>;
  subscriptions?: Map<string, Record<string, unknown>>;
  getClientId?: () => string | null;
  validateConnectionForSubscriptions?: () => boolean;
  logError?: (message: string, error?: unknown) => void;
  now?: () => number;
};

type SubscriptionManagerOptions = NonNullable<
  Parameters<typeof createTwitchEventSubSubscriptionManager>[0]
>;

const createHttpError = (
  message: string,
  response: ErrorWithResponse["response"],
): ErrorWithResponse => {
  const error = new Error(message) as ErrorWithResponse;
  error.response = response;
  return error;
};

const createHttpResponse = <T>(data: T): HttpResponse<T> =>
  ({ data }) as HttpResponse<T>;

const first = <T>(items: T[]): T => {
  const [item] = items;
  if (!item) {
    throw new Error("expected at least one item");
  }
  return item;
};

const missingHttpMethod = async (): Promise<HttpResponse> => {
  throw new Error("unexpected HTTP call");
};

const createSubscription = (
  definition: SubscriptionDefinition,
): SubscriptionDefinition => definition;

const createTwitchAuth = (overrides: Record<string, unknown> = {}) => ({
  refreshTokens: async () => true,
  isReady: () => true,
  ...overrides,
});

const createManager = (overrides: ManagerOverrides = {}) => {
  _resetForTesting();
  initializeStaticSecrets();
  secrets.twitch.accessToken = "testAccessToken";
  const { axios: axiosOverrides } = overrides;
  const axios: HttpClient = {
    get: missingHttpMethod,
    post: missingHttpMethod,
    delete: missingHttpMethod,
    ...axiosOverrides,
  };
  const managerOptions: SubscriptionManagerOptions = {
    logger: noOpLogger,
    twitchAuth: createTwitchAuth(),
    config: { clientId: "testClientId" },
    subscriptions: overrides.subscriptions ?? new Map<string, Record<string, unknown>>(),
    axios: axios as NonNullable<SubscriptionManagerOptions["axios"]>,
    getClientId: overrides.getClientId ?? (() => "testClientId"),
    validateConnectionForSubscriptions:
      overrides.validateConnectionForSubscriptions ?? (() => true),
    logError: overrides.logError ?? (() => {}),
  };
  if (overrides.now) {
    managerOptions.now = overrides.now;
  }
  return createTwitchEventSubSubscriptionManager({
    ...managerOptions,
  });
};

describe("Twitch EventSub subscription manager", () => {
  test("categorizes subscription errors as critical or retryable", () => {
    const manager = createManager();

    const critical = manager.parseSubscriptionError(
      {
        response: {
          data: { error: "Unauthorized", message: "bad" },
          status: 401,
        },
      },
      createSubscription({
        name: "Follows",
        type: "channel.follow",
        version: "2",
        getCondition: () => ({ broadcaster_user_id: "broadcaster-1" }),
      }),
    );
    const retryable = manager.parseSubscriptionError(
      {
        response: {
          data: { error: "Too Many Requests", message: "rate" },
          status: 429,
        },
      },
      createSubscription({
        name: "Follows",
        type: "channel.follow",
        version: "2",
        getCondition: () => ({ broadcaster_user_id: "broadcaster-1" }),
      }),
    );

    expect(critical.isCritical).toBe(true);
    expect(retryable.isRetryable).toBe(true);
  });

  test("retries subscription creation for retryable failures", async () => {
    const postCalls: PostCall[] = [];
    let callCount = 0;
    const post: HttpClient["post"] = async (url, payload, options) => {
      if (!payload) {
        throw new Error("subscription payload is required");
      }
      postCalls.push({ url, payload, headers: options?.headers });
      callCount++;
      if (callCount === 1) {
        throw createHttpError("Too Many Requests", {
          data: { error: "Too Many Requests", message: "rate" },
          status: 429,
        });
      }
      return createHttpResponse({ data: [{ id: "sub-1", status: "enabled" }] });
    };
    const manager = createManager({
      axios: { post },
      getClientId: () => "testClientId",
    });

    const result = await manager.setupEventSubscriptions({
      requiredSubscriptions: [
        {
          name: "Follows",
          type: "channel.follow",
          version: "2",
          getCondition: () => ({ broadcaster_user_id: "broadcaster-1" }),
        },
      ],
      userId: "user-1",
      broadcasterId: "broadcaster-1",
      sessionId: "session-1",
      subscriptionDelay: 0,
    });

    expect(result.failures).toHaveLength(0);
    expect(result.successful).toBe(1);
    expect(postCalls.length).toBeGreaterThan(1);
    expect(first(postCalls).url).toContain("/eventsub/subscriptions");
    expect(first(postCalls).payload.type).toBe("channel.follow");
  });

  test("uses config clientId and secrets token for subscription requests", async () => {
    const postCalls: PostCall[] = [];
    const post: HttpClient["post"] = async (url, payload, options) => {
      if (!payload) {
        throw new Error("subscription payload is required");
      }
      postCalls.push({ url, payload, headers: options?.headers });
      return createHttpResponse({ data: [{ id: "sub-1", status: "enabled" }] });
    };
    const manager = createManager({ axios: { post } });
    secrets.twitch.accessToken = "authToken";

    const result = await manager.setupEventSubscriptions({
      requiredSubscriptions: [
        {
          name: "Chat",
          type: "channel.chat.message",
          version: "1",
          getCondition: () => ({
            broadcaster_user_id: "broadcaster-1",
            user_id: "user-1",
          }),
        },
      ],
      userId: "user-1",
      broadcasterId: "broadcaster-1",
      sessionId: "session-1",
      subscriptionDelay: 0,
    });

    expect(result.successful).toBe(1);
    expect(postCalls).toHaveLength(1);
    expect(first(postCalls).headers?.["Client-Id"]).toBe("testClientId");
    expect(first(postCalls).headers?.["Authorization"]).toBe("Bearer authToken");
    expect(first(postCalls).payload.type).toBe("channel.chat.message");
  });

  test("processes multiple subscriptions successfully when subscriptionDelay is zero", async () => {
    const post: HttpClient["post"] = async (_url, payload) => {
      if (!payload) {
        throw new Error("subscription payload is required");
      }
      return createHttpResponse({
        data: [{ id: `sub-${payload.type}`, status: "enabled" }],
      });
    };
    const manager = createManager({ axios: { post } });

    const result = await manager.setupEventSubscriptions({
      requiredSubscriptions: [
        {
          name: "Chat",
          type: "channel.chat.message",
          version: "1",
          getCondition: () => ({
            broadcaster_user_id: "test-broadcaster-1",
            user_id: "test-user-1",
          }),
        },
        {
          name: "Follows",
          type: "channel.follow",
          version: "2",
          getCondition: () => ({
            broadcaster_user_id: "test-broadcaster-1",
            moderator_user_id: "test-user-1",
          }),
        },
      ],
      userId: "test-user-1",
      broadcasterId: "test-broadcaster-1",
      sessionId: "test-session-1",
      subscriptionDelay: 0,
    });

    expect(result.successful).toBe(2);
    expect(result.failures).toHaveLength(0);
  });

  test("stops subscription setup immediately when connection validation fails before the next request", async () => {
    const postCalls: string[] = [];
    const post: HttpClient["post"] = async (_url, payload) => {
      if (!payload) {
        throw new Error("subscription payload is required");
      }
      postCalls.push(payload.type);
      return createHttpResponse({
        data: [{ id: `sub-${payload.type}`, status: "enabled" }],
      });
    };
    let validationCalls = 0;
    const manager = createManager({
      axios: { post },
      validateConnectionForSubscriptions: () => {
        validationCalls += 1;
        return validationCalls <= 2;
      },
      now: (() => {
        const values = [0, 1000, 1000, 1000];
        return () => values.shift() ?? 1000;
      })(),
    });

    const result = await manager.setupEventSubscriptions({
      requiredSubscriptions: [
        {
          name: "Chat",
          type: "channel.chat.message",
          version: "1",
          getCondition: () => ({
            broadcaster_user_id: "test-broadcaster-1",
            user_id: "test-user-1",
          }),
        },
        {
          name: "Follows",
          type: "channel.follow",
          version: "2",
          getCondition: () => ({
            broadcaster_user_id: "test-broadcaster-1",
            moderator_user_id: "test-user-1",
          }),
        },
      ],
      userId: "test-user-1",
      broadcasterId: "test-broadcaster-1",
      sessionId: "test-session-1",
      subscriptionDelay: 0,
    });

    expect(postCalls).toEqual(["channel.chat.message"]);
    expect(result.successful).toBe(1);
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe("connection-lost");
  });

  test("does not retry a subscription after the websocket session is lost", async () => {
    const postCalls: string[] = [];
    let hasOpenSocket = true;
    const post: HttpClient["post"] = async (_url, payload) => {
      if (!payload) {
        throw new Error("subscription payload is required");
      }
      postCalls.push(payload.type);
      hasOpenSocket = false;
      const error = new Error("socket hang up") as Error & { code?: string };
      error.code = "ECONNRESET";
      throw error;
    };
    const manager = createManager({
      axios: { post },
      validateConnectionForSubscriptions: () => hasOpenSocket,
    });

    const result = await manager.setupEventSubscriptions({
      requiredSubscriptions: [
        {
          name: "Chat",
          type: "channel.chat.message",
          version: "1",
          getCondition: () => ({
            broadcaster_user_id: "test-broadcaster-1",
            user_id: "test-user-1",
          }),
        },
        {
          name: "Follows",
          type: "channel.follow",
          version: "2",
          getCondition: () => ({
            broadcaster_user_id: "test-broadcaster-1",
            moderator_user_id: "test-user-1",
          }),
        },
      ],
      userId: "test-user-1",
      broadcasterId: "test-broadcaster-1",
      sessionId: "test-session-1",
      subscriptionDelay: 0,
    });

    expect(postCalls).toEqual(["channel.chat.message"]);
    expect(result.successful).toBe(0);
    expect(result.failures).toHaveLength(1);
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe("connection-lost");
  });

  test("aborts when a retry attempt receives a dead websocket session response", async () => {
    const postCalls: string[] = [];
    let callCount = 0;
    const post: HttpClient["post"] = async (_url, payload) => {
      if (!payload) {
        throw new Error("subscription payload is required");
      }
      postCalls.push(payload.type);
      callCount += 1;
      if (callCount === 1) {
        const error = new Error("socket hang up") as Error & { code?: string };
        error.code = "ECONNRESET";
        throw error;
      }

      const error = new Error("dead session") as Error & { response?: unknown };
      error.response = {
        data: {
          error: "Bad Request",
          message: "websocket session has already disconnected",
        },
        status: 400,
      };
      throw error;
    };
    const manager = createManager({ axios: { post } });

    const result = await manager.setupEventSubscriptions({
      requiredSubscriptions: [
        {
          name: "Chat",
          type: "channel.chat.message",
          version: "1",
          getCondition: () => ({
            broadcaster_user_id: "test-broadcaster-1",
            user_id: "test-user-1",
          }),
        },
        {
          name: "Follows",
          type: "channel.follow",
          version: "2",
          getCondition: () => ({
            broadcaster_user_id: "test-broadcaster-1",
            moderator_user_id: "test-user-1",
          }),
        },
      ],
      userId: "test-user-1",
      broadcasterId: "test-broadcaster-1",
      sessionId: "test-session-1",
      subscriptionDelay: 0,
    });

    expect(postCalls).toEqual(["channel.chat.message", "channel.chat.message"]);
    expect(result.failures).toHaveLength(1);
    expect(first(result.failures).error.message).toContain(
      "websocket session has already disconnected",
    );
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe("connection-lost");
  });

  test("treats dead websocket session responses as terminal for the current setup pass", async () => {
    const postCalls: string[] = [];
    const post: HttpClient["post"] = async (_url, payload) => {
      if (!payload) {
        throw new Error("subscription payload is required");
      }
      postCalls.push(payload.type);
      if (payload.type === "channel.chat.message") {
        throw createHttpError("dead session", {
          data: {
            error: "Bad Request",
            message: "websocket session has already disconnected",
          },
          status: 400,
        });
      }
      return createHttpResponse({
        data: [{ id: `sub-${payload.type}`, status: "enabled" }],
      });
    };
    const manager = createManager({ axios: { post } });

    const result = await manager.setupEventSubscriptions({
      requiredSubscriptions: [
        {
          name: "Chat",
          type: "channel.chat.message",
          version: "1",
          getCondition: () => ({
            broadcaster_user_id: "test-broadcaster-1",
            user_id: "test-user-1",
          }),
        },
        {
          name: "Follows",
          type: "channel.follow",
          version: "2",
          getCondition: () => ({
            broadcaster_user_id: "test-broadcaster-1",
            moderator_user_id: "test-user-1",
          }),
        },
      ],
      userId: "test-user-1",
      broadcasterId: "test-broadcaster-1",
      sessionId: "test-session-1",
      subscriptionDelay: 0,
    });

    expect(postCalls).toEqual(["channel.chat.message"]);
    expect(result.failures).toHaveLength(1);
    expect(first(result.failures).error.message).toContain(
      "websocket session has already disconnected",
    );
    expect(result.aborted).toBe(true);
    expect(result.abortReason).toBe("connection-lost");
  });

  test("uses config clientId and secrets token for cleanup", async () => {
    const getCalls: RequestCall[] = [];
    const deleteCalls: RequestCall[] = [];
    const get: HttpClient["get"] = async (url, options) => {
      getCalls.push({ url, headers: options?.headers });
      return createHttpResponse({
        data: [
          {
            id: "sub-1",
            status: "websocket_disconnected",
            transport: { method: "websocket", session_id: "session-1" },
          },
        ],
      });
    };
    const deleteCall: HttpClient["delete"] = async (url, options) => {
      deleteCalls.push({ url, headers: options?.headers });
      return createHttpResponse({});
    };
    const manager = createManager({ axios: { get, delete: deleteCall } });
    secrets.twitch.accessToken = "authToken";

    await manager.cleanupAllWebSocketSubscriptions({ sessionId: "session-1" });

    expect(getCalls).toHaveLength(1);
    expect(first(getCalls).headers?.["Client-Id"]).toBe("testClientId");
    expect(first(getCalls).headers?.["Authorization"]).toBe("Bearer authToken");
    expect(deleteCalls).toHaveLength(1);
    expect(first(deleteCalls).url).toContain("sub-1");
  });

  test("cleanup deletes websocket subscriptions with bounded parallelism", async () => {
    let inFlightDeletes = 0;
    let maxInFlightDeletes = 0;
    let releaseDeletes: () => void = () => {};
    const deleteBarrier = new Promise<void>((resolve) => {
      releaseDeletes = resolve;
    });

    const get: HttpClient["get"] = async () => {
      return createHttpResponse({
        data: [
          {
            id: "sub-1",
            status: "websocket_disconnected",
            transport: { method: "websocket", session_id: "session-a" },
          },
          {
            id: "sub-2",
            status: "websocket_disconnected",
            transport: { method: "websocket", session_id: "session-b" },
          },
          {
            id: "sub-3",
            status: "websocket_disconnected",
            transport: { method: "websocket", session_id: "session-c" },
          },
          {
            id: "sub-4",
            status: "websocket_disconnected",
            transport: { method: "websocket", session_id: "session-d" },
          },
        ],
      });
    };

    const deleteCall: HttpClient["delete"] = async () => {
      inFlightDeletes += 1;
      if (inFlightDeletes > maxInFlightDeletes) {
        maxInFlightDeletes = inFlightDeletes;
      }

      await deleteBarrier;
      inFlightDeletes -= 1;
      return createHttpResponse({});
    };

    const manager = createManager({ axios: { get, delete: deleteCall } });

    const cleanupPromise = manager.cleanupAllWebSocketSubscriptions();

    for (let i = 0; i < 20 && maxInFlightDeletes <= 1; i++) {
      await Promise.resolve();
    }

    expect(maxInFlightDeletes).toBeGreaterThan(1);
    expect(maxInFlightDeletes).toBeLessThanOrEqual(3);

    releaseDeletes();

    await cleanupPromise;
  });

  test("cleanup skips websocket_connected subscriptions when no sessionId is provided", async () => {
    const deleteCalls: string[] = [];
    const get: HttpClient["get"] = async () =>
      createHttpResponse({
        data: [
          {
            id: "enabled-sub",
            status: "enabled",
            transport: { method: "websocket", session_id: "session-other" },
          },
          {
            id: "connected-sub",
            status: "websocket_connected",
            transport: { method: "websocket", session_id: "session-live" },
          },
          {
            id: "disconnected-sub",
            status: "websocket_disconnected",
            transport: { method: "websocket", session_id: "session-stale" },
          },
        ],
      });
    const deleteCall: HttpClient["delete"] = async (url) => {
      deleteCalls.push(url);
      return createHttpResponse({});
    };

    const manager = createManager({ axios: { get, delete: deleteCall } });
    await manager.cleanupAllWebSocketSubscriptions();

    expect(deleteCalls).toHaveLength(1);
    expect(first(deleteCalls)).toContain("disconnected-sub");
  });

  test("deletes only current session subscriptions and updates local state", async () => {
    const deleteCalls: string[] = [];
    const errorLogs: string[] = [];
    const subscriptions = new Map<string, Record<string, unknown>>([
      ["test-ours-ok", { id: "test-ours-ok" }],
      ["test-ours-fail", { id: "test-ours-fail" }],
      ["test-other", { id: "test-other" }],
    ]);

    const get: HttpClient["get"] = async () =>
      createHttpResponse({
        data: [
          {
            id: "test-ours-ok",
            type: "channel.chat.message",
            transport: { method: "websocket", session_id: "test-session-1" },
          },
          {
            id: "test-ours-fail",
            type: "channel.follow",
            transport: { method: "websocket", session_id: "test-session-1" },
          },
          {
            id: "test-other",
            type: "channel.subscribe",
            transport: { method: "websocket", session_id: "test-session-2" },
          },
          {
            id: "test-ignored",
            type: "channel.raid",
            transport: { method: "webhook" },
          },
        ],
      });
    const deleteCall: HttpClient["delete"] = async (url) => {
      deleteCalls.push(url);
      if (url.includes("test-ours-fail")) {
        throw new Error("delete failed");
      }
      return createHttpResponse({});
    };

    const manager = createManager({
      subscriptions,
      axios: { get, delete: deleteCall },
      logError: (message: string) => errorLogs.push(message),
    });

    await manager.deleteAllSubscriptions({ sessionId: "test-session-1" });

    expect(deleteCalls).toHaveLength(2);
    expect(first(deleteCalls)).toContain("test-ours-ok");
    expect(deleteCalls.at(1)).toContain("test-ours-fail");
    expect(subscriptions.has("test-ours-ok")).toBe(false);
    expect(subscriptions.has("test-ours-fail")).toBe(true);
    expect(subscriptions.has("test-other")).toBe(true);
    expect(errorLogs.length).toBe(1);
  });

  test("skips deleteAllSubscriptions when authentication is missing", async () => {
    let getCalls = 0;
    const manager = createManager({
      axios: {
        get: async () => {
          getCalls += 1;
          return createHttpResponse({ data: [] });
        },
        delete: async () => createHttpResponse({}),
      },
    });
    secrets.twitch.accessToken = "";

    await manager.deleteAllSubscriptions({ sessionId: "test-session-1" });

    expect(getCalls).toBe(0);
  });

  test("reports top-level cleanup failure when listing subscriptions fails", async () => {
    const errorLogs: string[] = [];
    const manager = createManager({
      axios: {
        get: async () => {
          throw new Error("list failed");
        },
        delete: async () => createHttpResponse({}),
      },
      logError: (message: string) => errorLogs.push(message),
    });

    await manager.deleteAllSubscriptions({ sessionId: "test-session-1" });

    expect(errorLogs.length).toBe(1);
    expect(errorLogs[0]).toContain("Failed to cleanup EventSub subscriptions");
  });
});
