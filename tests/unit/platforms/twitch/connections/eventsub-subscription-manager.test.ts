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
  signal?: AbortSignal;
  timeout?: number;
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
  test.each([429, 503])("classifies numeric status %s independently of provider prose", (status) => {
    const manager = createManager();
    const definition = createSubscription({ name: "Synthetic", type: "channel.follow", version: "2", getCondition: () => ({}) });
    for (const data of [{ error: "unfamiliar", message: "synthetic failure" }, { error: "Forbidden", message: "synthetic misleading label" }, "synthetic body"]) {
      const result = manager.parseSubscriptionError({ response: { status, data } }, definition);
      expect(result.isRetryable).toBe(true);
      expect(result.isCritical).toBe(false);
      expect(result.status).toBe(status);
    }
  });

  test("does not retry an ambiguous subscription POST 503", async () => {
    let posts = 0;
    const manager = createManager({ axios: { post: async () => {
      posts++;
      throw createHttpError("synthetic unavailable", { status: 503, data: { error: "unfamiliar", message: "synthetic" } });
    } } });
    const result = await manager.setupEventSubscriptions({
      requiredSubscriptions: [createSubscription({ name: "Synthetic", type: "channel.follow", version: "2", getCondition: () => ({}) })],
      userId: "test-user", broadcasterId: "test-broadcaster", sessionId: "test-session", subscriptionDelay: 0,
    });
    expect(posts).toBe(1);
    expect(result.failures[0]?.error.isRetryable).toBe(true);
  });

  test.each([false, true])("cleans matching owned subscriptions across encoded cursor pages (startup=%s)", async (startup) => {
    const urls: string[] = [];
    const deleted: string[] = [];
    const cursor = "synthetic+/=&?opaque";
    const manager = createManager({ axios: {
      get: async (url) => {
        urls.push(url);
        const page = urls.length;
        return createHttpResponse({ data: [
          { id: `test-owned-${page}`, transport: { method: "websocket", session_id: "test-session" } },
          { id: `test-other-${page}`, transport: { method: "websocket", session_id: "other-session" } },
        ], pagination: page === 1 ? { cursor } : {} });
      },
      delete: async (url) => { deleted.push(new URL(url).searchParams.get("id")!); return createHttpResponse({}); },
    } });
    if (startup) await manager.cleanupAllWebSocketSubscriptions({ sessionId: "test-session" });
    else await manager.deleteAllSubscriptions({ sessionId: "test-session" });
    expect(urls).toHaveLength(2);
    expect(new URL(urls[1]!).origin).toBe("https://api.twitch.tv");
    expect(new URL(urls[1]!).searchParams.get("after")).toBe(cursor);
    expect([...new URL(urls[1]!).searchParams.keys()]).toEqual(["after"]);
    expect(deleted.sort()).toEqual(["test-owned-1", "test-owned-2"]);
  });

  test("startup stale filtering applies on every page without an owned session", async () => {
    let pages = 0;
    const deleted: string[] = [];
    const manager = createManager({ axios: {
      get: async () => createHttpResponse({ data: [
        { id: `test-stale-${++pages}`, status: "websocket_disconnected", transport: { method: "websocket" } },
        { id: `test-active-${pages}`, status: "enabled", transport: { method: "websocket" } },
      ], pagination: pages === 1 ? { cursor: "test-next" } : {} }),
      delete: async (url) => { deleted.push(new URL(url).searchParams.get("id")!); return createHttpResponse({}); },
    } });
    await manager.cleanupAllWebSocketSubscriptions();
    expect(pages).toBe(2);
    expect(deleted.sort()).toEqual(["test-stale-1", "test-stale-2"]);
  });

  test.each(["repeat", "limit", "bad-pagination", "bad-cursor", "blank-cursor", "long-cursor", "bad-data", "budget"])("reports incomplete pagination safely: %s", async (mode) => {
    let pages = 0;
    let remaining = 5000;
    let deletes = 0;
    const reports: Array<{ message: string; error: unknown }> = [];
    const manager = createManager({ logError: (message, error) => reports.push({ message, error }), axios: {
      get: async () => {
        pages++;
        if (mode === "budget") remaining = 0;
        const pagination = mode === "bad-pagination" ? "test-invalid"
          : mode === "bad-cursor" ? { cursor: { synthetic: true } }
            : mode === "blank-cursor" ? { cursor: " " }
              : mode === "long-cursor" ? { cursor: "x".repeat(4097) }
                : { cursor: mode === "repeat" ? "test-repeated" : `test-${pages}` };
        return createHttpResponse({ data: mode === "bad-data" ? {} : [], pagination });
      },
      delete: async () => { deletes++; return createHttpResponse({}); },
    } });
    await manager.deleteAllSubscriptions({ sessionId: "test-session", operationContext: { signal: new AbortController().signal, remainingBudgetMs: () => remaining } });
    expect(pages).toBe(mode === "repeat" ? 2 : mode === "limit" ? 100 : 1);
    expect(deletes).toBe(0);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.message).toBe("EventSub remote cleanup incomplete");
    expect(String(reports[0]?.error)).not.toContain("test-repeated");
    const reason = mode === "repeat" ? "Repeated EventSub cleanup cursor"
      : mode === "limit" ? "EventSub cleanup page limit exceeded"
        : mode === "bad-pagination" ? "Invalid EventSub cleanup pagination"
          : mode === "bad-data" ? "Invalid EventSub cleanup page"
            : mode === "budget" ? "EventSub cleanup request failed" : "Invalid EventSub cleanup cursor";
    expect(String(reports[0]?.error)).toBe(`Error: ${reason}`);
  });

  test("accepts exactly 100 pages when the last page has no cursor", async () => {
    let pages = 0;
    const reports: string[] = [];
    const manager = createManager({ logError: (message) => reports.push(message), axios: {
      get: async () => createHttpResponse({ data: [], pagination: ++pages < 100 ? { cursor: `test-${pages}` } : {} }),
    } });
    await manager.deleteAllSubscriptions({ sessionId: "test-session" });
    expect(pages).toBe(100);
    expect(reports).toEqual([]);
  });

  test("parent cancellation after a listed page prevents another page or DELETE", async () => {
    const controller = new AbortController();
    let pages = 0;
    let deletes = 0;
    const manager = createManager({ axios: {
      get: async () => { pages++; controller.abort(new Error("synthetic stop")); return createHttpResponse({ data: [], pagination: { cursor: "test-next" } }); },
      delete: async () => { deletes++; return createHttpResponse({}); },
    } });
    await manager.deleteAllSubscriptions({ sessionId: "test-session", operationContext: { signal: controller.signal, remainingBudgetMs: () => 5000 } });
    expect(pages).toBe(1);
    expect(deletes).toBe(0);
  });

  test("later pages and deletes share the caller's shrinking total budget", async () => {
    let remaining = 4000;
    let pages = 0;
    const timeouts: number[] = [];
    const manager = createManager({ axios: {
      get: async (_url, options) => {
        timeouts.push(options!.timeout!);
        remaining = ++pages === 1 ? 2000 : 1000;
        return createHttpResponse({ data: [{ id: `test-budget-${pages}`, transport: { method: "websocket", session_id: "test-session" } }], pagination: pages === 1 ? { cursor: "test-next" } : {} });
      },
      delete: async (_url, options) => { timeouts.push(options!.timeout!); return createHttpResponse({}); },
    } });
    await manager.deleteAllSubscriptions({ sessionId: "test-session", operationContext: { signal: new AbortController().signal, remainingBudgetMs: () => remaining } });
    expect(timeouts).toHaveLength(4);
    expect(timeouts[0]).toBeLessThanOrEqual(4000);
    expect(timeouts[1]).toBeLessThanOrEqual(2000);
    expect(timeouts[2]).toBeLessThanOrEqual(1000);
    expect(timeouts[3]).toBeLessThanOrEqual(1000);
  });

  test("cleanup reports fixed reasons rather than HTTP URLs or provider bodies", async () => {
    const reports: unknown[] = [];
    const manager = createManager({ logError: (message, error) => reports.push([message, String(error)]), axios: {
      get: async () => { throw new Error("https://synthetic-user:synthetic-password@example.invalid/?after=synthetic-cursor"); },
    } });
    await manager.deleteAllSubscriptions({ sessionId: "test-session" });
    expect(reports).toEqual([["EventSub remote cleanup incomplete", "Error: EventSub cleanup request failed"]]);
  });

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
        return validationCalls <= 3;
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
        const error = Object.assign(new Error("test rate limit"), { response: { status: 429, data: { error: "Too Many Requests", message: "test rate limit" } } });
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

  test("deletes only current session subscriptions without mutating lifecycle-owned local state", async () => {
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
    expect(subscriptions.has("test-ours-ok")).toBe(true);
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

  test("throwing cleanup diagnostics cannot stop remaining deletes or reject retirement", async () => {
    let deletes = 0;
    let reports = 0;
    const manager = createManager({
      axios: {
        get: async () => createHttpResponse({ data: Array.from({ length: 5 }, (_, index) => ({
          id: `test-cleanup-${index}`, type: "test.subscription", status: "enabled",
          transport: { method: "websocket", session_id: "test-session" },
        })) }),
        delete: async () => { deletes++; throw new Error("test delete failed"); },
      },
      logError: () => { reports++; throw new Error("test diagnostic failed"); },
    });
    await expect(manager.deleteAllSubscriptions({ sessionId: "test-session" })).resolves.toBeUndefined();
    expect(deletes).toBe(5);
    expect(reports).toBe(5);
  });

  test("throwing list-failure diagnostics do not reject cleanup", async () => {
    const manager = createManager({
      axios: { get: async () => { throw new Error("test list failed"); } },
      logError: () => { throw new Error("test diagnostic failed"); },
    });
    await expect(manager.deleteAllSubscriptions({ sessionId: "test-session" })).resolves.toBeUndefined();
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
    expect(errorLogs[0]).toContain("EventSub remote cleanup incomplete");
  });
});
