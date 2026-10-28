import { describe, expect, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { EnhancedHttpClient } from "../../../src/utils/enhanced-http-client";
import { HttpRetryExecutor } from "../../../src/utils/http-retry-executor";
type EnhancedHttpClientConfig = NonNullable<ConstructorParameters<typeof EnhancedHttpClient>[0]>;
type HttpClientAdapter = EnhancedHttpClientConfig["axios"];
type RetryExecutorAdapter = EnhancedHttpClientConfig["retryExecutor"];
type RequestConfig = { headers: Record<string, string>; timeout?: unknown };

const createHttpAdapter = (overrides: Partial<NonNullable<HttpClientAdapter>> = {}): NonNullable<HttpClientAdapter> => ({
  get: createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 }),
  post: createMockFn<[string, unknown, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 }),
  put: createMockFn<[string, unknown, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 }),
  delete: createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 }),
  ...overrides,
});

const asRequestConfig = (config: Record<string, unknown>): RequestConfig => config as RequestConfig;

describe("EnhancedHttpClient behavior", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it("admits only positive scalar integer timeouts and retains native timer ceiling semantics", async () => {
    const axios = createHttpAdapter();
    const fallback = new EnhancedHttpClient({ axios, logger: noOpLogger }).defaultTimeout;
    const client = new EnhancedHttpClient({ axios, logger: noOpLogger, timeout: 1234, reachabilityTimeoutMs: 4321 });
    for (const timeout of [true, false, [], [1000], {}, null, NaN, Infinity, -1, 0, 1.5, "1.5", "", " ", "bad"]) {
      expect(client.buildRequestConfig({ timeout }).timeout).toBe(1234);
      expect(new EnhancedHttpClient({ axios, logger: noOpLogger, timeout }).defaultTimeout).toBe(fallback);
    }
    expect(client.buildRequestConfig({ timeout: "2500" }).timeout).toBe(2500);
    expect(client.buildRequestConfig({ timeout: 2147483648 }).timeout).toBe(2147483647);
    expect(client.buildRequestConfig({ timeout: "2147483648", operationContext: { operationType: "tokenValidation" } }).timeout).toBe(2147483647);
    await client.isReachable("https://synthetic.example.invalid/health", { timeout: true });
    expect(axios.get).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ timeout: 4321 }));
  });

  it("protects generated request headers from every caller spelling while retaining unrelated options", async () => {
    const get = createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 });
    const client = new EnhancedHttpClient({ axios: createHttpAdapter({ get }), logger: noOpLogger });
    const headers = { authorization: "caller-a", AUTHORIZATION: "caller-b", Authorization: "caller-c", " Authorization ": "caller-d", "user-agent": "caller-a", "USER-AGENT": "caller-b", "User-Agent": "caller-c", " User-Agent ": "caller-d", Accept: "application/json", "X-Synthetic": "retained" };
    await client.get("https://synthetic.example.invalid/headers", {
      authToken: "synthetic-owned-token", userAgent: " SyntheticAgent/1 ", timeout: "2345", responseType: "json",
      headers,
    });
    const config = asRequestConfig(get.mock.calls[0]?.[1] ?? {});
    expect(config).toMatchObject({ timeout: 2345, responseType: "json" });
    expect(config.headers).toEqual({ Accept: "application/json", "X-Synthetic": "retained", Authorization: "Bearer synthetic-owned-token", "User-Agent": "SyntheticAgent/1" });
    expect(headers.Authorization).toBe("caller-c");
    expect(headers["User-Agent"]).toBe("caller-c");
  });

  it("preserves deliberate caller authorization when no generated credential owns the request", async () => {
    const get = createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 });
    const client = new EnhancedHttpClient({ axios: createHttpAdapter({ get }), logger: noOpLogger, userAgents: [] });
    await client.get("https://synthetic.example.invalid/caller-auth", { headers: { authorization: "Bearer synthetic-caller-token", "user-agent": " ", Accept: "application/json" } });
    expect(asRequestConfig(get.mock.calls[0]?.[1] ?? {}).headers).toEqual({ authorization: "Bearer synthetic-caller-token", Accept: "application/json" });
    await client.get("https://synthetic.example.invalid/caller-ua", { headers: { authorization: "Bearer synthetic-caller-token", "user-agent": "CallerAgent/1" } });
    expect(asRequestConfig(get.mock.calls[1]?.[1] ?? {}).headers).toEqual({ authorization: "Bearer synthetic-caller-token", "user-agent": "CallerAgent/1" });
  });

  it("explicitly nulls Axios Basic auth only when generated credentials own the request", async () => {
    const get = createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 });
    const client = new EnhancedHttpClient({ axios: createHttpAdapter({ get }), logger: noOpLogger });
    const auth = { username: "synthetic-user", password: "synthetic-password" };
    const options = { auth, authToken: "synthetic-owned-token" };
    await client.get("https://synthetic.example.invalid/owned", options);
    expect(get.mock.calls[0]?.[1].auth).toBeNull();
    await client.get("https://synthetic.example.invalid/default-basic", { authToken: "synthetic-owned-token" });
    expect(get.mock.calls[1]?.[1].auth).toBeNull();
    await client.get("https://synthetic.example.invalid/caller-basic", { auth });
    expect(get.mock.calls[2]?.[1].auth).toBe(auth);
    await client.get("https://synthetic.example.invalid/default-auth");
    expect(get.mock.calls[3]?.[1]).not.toHaveProperty("auth");
    expect(options.auth).toBe(auth);
    expect(auth).toEqual({ username: "synthetic-user", password: "synthetic-password" });
  });

  it("leaves malformed URL handling to the adapter instead of changing it during authentication checks", async () => {
    const get = createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 });
    const client = new EnhancedHttpClient({ axios: createHttpAdapter({ get }), logger: noOpLogger });
    const url = "https://%ZZ.invalid/synthetic";
    await client.get(url, { authToken: "synthetic-owned-token", baseURL: "synthetic relative base" });
    expect(get.mock.calls[0]?.[0]).toBe(url);
    await client.get("synthetic-user:synthetic-password@%ZZ.invalid/synthetic", { authToken: "synthetic-owned-token", baseURL: "http://" });
    expect(get.mock.calls[1]?.[0]).toBe("synthetic-user:synthetic-password@%ZZ.invalid/synthetic");
  });

  it("trims direct UA pools, omits empty pools, and honors an explicitly blank UA", async () => {
    const get = createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 });
    const client = new EnhancedHttpClient({ axios: createHttpAdapter({ get }), logger: noOpLogger, userAgents: [" ", " SyntheticAgent/1 ", "", "SyntheticAgent/2"] });
    await client.get("https://synthetic.example.invalid/one");
    await client.get("https://synthetic.example.invalid/two");
    expect(asRequestConfig(get.mock.calls[0]?.[1] ?? {}).headers["User-Agent"]).toBe("SyntheticAgent/1");
    expect(asRequestConfig(get.mock.calls[1]?.[1] ?? {}).headers["User-Agent"]).toBe("SyntheticAgent/2");
    await client.get("https://synthetic.example.invalid/none", { userAgent: " ", headers: { "user-agent": "CallerAgent", "USER-AGENT": " ", " User-Agent ": "CallerAgent" } });
    expect(asRequestConfig(get.mock.calls[2]?.[1] ?? {}).headers).toEqual({});
    expect(asRequestConfig(new EnhancedHttpClient({ axios: createHttpAdapter(), logger: noOpLogger, userAgents: [" ", ""] }).buildRequestConfig()).headers).toEqual({});
  });

  it("normalizes supported schemes and rejects unknown schemes without reflecting their contents", async () => {
    const get = createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 });
    const client = new EnhancedHttpClient({ axios: createHttpAdapter({ get }), logger: noOpLogger });
    for (const [authType, scheme] of [[" OAuth ", "OAuth"], [" BEARER ", "Bearer"], [" APP ", "Bearer"], [null, "Bearer"], [undefined, "Bearer"]] as const) {
      await client.get("https://synthetic.example.invalid/scheme", { authToken: "synthetic-token", authType });
      expect(asRequestConfig(get.mock.calls.at(-1)?.[1] ?? {}).headers.Authorization).toBe(`${scheme} synthetic-token`);
    }
    const count = get.mock.calls.length;
    await expect(client.get("https://synthetic.example.invalid/rejected", { authToken: "synthetic-token", authType: "synthetic-unsupported secret-value" })).rejects.toThrow(/^Unsupported auth type$/);
    await expect(client.get("https://synthetic.example.invalid/rejected-without-token", { authType: "synthetic-unsupported" })).rejects.toThrow(/^Unsupported auth type$/);
    expect(get).toHaveBeenCalledTimes(count);
  });

  for (const method of ["post", "put"] as const) {
    it(`encodes ${method} plain form records without replacing explicit falsy fields`, async () => {
      const send = createMockFn<[string, unknown, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 });
      const client = new EnhancedHttpClient({ axios: createHttpAdapter({ [method]: send }), logger: noOpLogger });
      const headers = { "Content-Type": "application/json", " cOnTeNt-TyPe ": "Application/X-WWW-Form-Urlencoded; charset=utf-8" };
      await client[method]("https://synthetic.example.invalid/form", { zero: 0, flag: false, empty: "", absent: null, missing: undefined, words: "two words" }, { headers });
      expect(send.mock.calls[0]?.[1]).toBe("zero=0&flag=false&empty=&words=two+words");
      expect(asRequestConfig(send.mock.calls[0]?.[2] ?? {}).headers).toMatchObject({ "Content-Type": "Application/X-WWW-Form-Urlencoded; charset=utf-8" });
      expect(Object.keys(asRequestConfig(send.mock.calls[0]?.[2] ?? {}).headers).filter((name) => name.toLowerCase() === "content-type")).toHaveLength(1);
      expect(headers["Content-Type"]).toBe("application/json");
    });

    it(`passes through ${method} non-record form bodies including an explicit empty string`, async () => {
      const send = createMockFn<[string, unknown, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 });
      const client = new EnhancedHttpClient({ axios: createHttpAdapter({ [method]: send }), logger: noOpLogger });
      for (const body of ["", "already=encoded", 0, false, null, [], new URLSearchParams({ synthetic: "value" }), new Date(0), new Uint8Array([1, 2])]) {
        await client[method]("https://synthetic.example.invalid/passthrough", body, { headers: { "Content-Type": "application/x-www-form-urlencoded" } });
        expect(send.mock.calls.at(-1)?.[1]).toBe(body);
      }
    });
  }

  it("sanitizes successful request diagnostics without changing the functional URL", async () => {
    const messages: string[] = [];
    const logger = { ...noOpLogger, debug: (message: string) => { messages.push(message); } };
    const get = createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 });
    const client = new EnhancedHttpClient({ axios: createHttpAdapter({ get }), logger });
    const url = "https://synthetic-user:synthetic-password@synthetic.example.invalid/%ZZ?access_token=synthetic-success-token";
    await client.get(url);
    expect(get.mock.calls[0]?.[0]).toBe(url);
    expect(messages.some((message) => message.startsWith("HTTP GET Success:"))).toBe(true);
    for (const secret of ["synthetic-user", "synthetic-password", "synthetic-success-token"]) expect(messages.join("\n")).not.toContain(secret);
  });

  it("retains the original failure when terminal reporting throws", async () => {
    const failure = new Error("synthetic request failure");
    const get = createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockRejectedValue(failure);
    const logger = { ...noOpLogger, debug: (message: string) => {
      if (message.startsWith("HTTP GET Error:")) throw new Error("synthetic reporting failure");
    } };
    const client = new EnhancedHttpClient({ axios: createHttpAdapter({ get }), logger });
    await expect(client.get("https://synthetic.example.invalid/failure", { retryScope: "synthetic" })).rejects.toBe(failure);
  });

  it("reports opaque HTTP status failures without rendering provider bodies", async () => {
    const messages: string[] = [];
    const render = createMockFn<[], string>(() => "synthetic-private-provider-body");
    const failure = { response: { status: 503, data: { content: "synthetic-private-provider-body" } }, toString: render };
    const logger = { ...noOpLogger, debug: (message: string) => { messages.push(message); }, warn: (message: string) => { messages.push(message); } };
    const get = createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockRejectedValue(failure);
    const client = new EnhancedHttpClient({ axios: createHttpAdapter({ get }), logger, retryExecutor: new HttpRetryExecutor({ logger, safeDelay: createMockFn().mockResolvedValue(undefined) }) });
    await expect(client.get("https://synthetic.example.invalid/status", { retryScope: "synthetic", maxAttempts: 2 })).rejects.toBe(failure);
    expect(get).toHaveBeenCalledTimes(2);
    expect(render).not.toHaveBeenCalled();
    expect(messages.join("\n")).not.toContain("synthetic-private-provider-body");
    expect(messages.join("\n")).toContain("503");
  });

  for (const retried of [false, true]) {
    it(`sanitizes direct logger arguments and observes terminal failure once with retry=${retried}`, async () => {
      const messages: string[] = [];
      const logger = { ...noOpLogger, debug: (message: string) => { messages.push(message); }, warn: (message: string) => { messages.push(message); }, info: (message: string) => { messages.push(message); } };
      const failure = Object.assign(new Error("Failed https://synthetic.example.invalid/error?refresh_token=synthetic-error-token Authorization: Bearer synthetic-bearer"), { code: "ECONNRESET" });
      const url = "https://synthetic-user:synthetic-password@synthetic.example.invalid/path?access_token=synthetic-request-token&bad=%ZZ";
      const get = createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockRejectedValue(failure);
      const client = new EnhancedHttpClient({ axios: createHttpAdapter({ get }), logger, retryExecutor: new HttpRetryExecutor({ logger, safeDelay: createMockFn().mockResolvedValue(undefined) }) });
      await expect(client.get(url, { retryScope: "synthetic-scope", disableRetry: !retried, maxAttempts: 2 })).rejects.toBe(failure);
      expect(get).toHaveBeenCalledTimes(retried ? 2 : 1);
      expect(get.mock.calls.every(([target]) => target === url)).toBe(true);
      const logs = messages.join("\n");
      expect(messages.filter((message) => message.startsWith("HTTP GET Error:"))).toHaveLength(1);
      for (const secret of ["synthetic-user", "synthetic-password", "synthetic-request-token", "synthetic-error-token", "synthetic-bearer"]) expect(logs).not.toContain(secret);
    });
  }

  it("rotates user agents across requests", () => {
    const axios = createHttpAdapter();
    const logger = noOpLogger;

    const client = new EnhancedHttpClient({ axios, logger });
    client.userAgents = ["testAgentA", "testAgentB"];

    const firstConfig = asRequestConfig(client.buildRequestConfig({}));
    const secondConfig = asRequestConfig(client.buildRequestConfig({}));
    const thirdConfig = asRequestConfig(client.buildRequestConfig({}));

    expect(firstConfig.headers["User-Agent"]).toBe("testAgentA");
    expect(secondConfig.headers["User-Agent"]).toBe("testAgentB");
    expect(thirdConfig.headers["User-Agent"]).toBe("testAgentA");
  });

  it("uses explicit timeout when provided", () => {
    const axios = createHttpAdapter();
    const logger = noOpLogger;

    const client = new EnhancedHttpClient({ axios, logger });
    const config = client.buildRequestConfig({ timeout: 5000 });

    expect(config.timeout).toBe(5000);
  });

  it("uses default timeout when no explicit timeout provided", () => {
    const axios = createHttpAdapter();
    const logger = noOpLogger;

    const client = new EnhancedHttpClient({ axios, logger, timeout: 3000 });
    const config = client.buildRequestConfig({});

    expect(config.timeout).toBe(3000);
  });

  it("wraps requests with retry system when platform is provided", async () => {
    const axios = createHttpAdapter({ get: createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 204 }) });
    const logger = noOpLogger;
    let executedThroughRetry = false;

    const retryExecutor = {
      executeWithRetry: createMockFn(async (_platform: string, handler: () => Promise<Record<string, unknown>>) => {
        executedThroughRetry = true;
        return handler();
      }),
    } as Partial<NonNullable<RetryExecutorAdapter>> as NonNullable<RetryExecutorAdapter>;

    const client = new EnhancedHttpClient({ axios, logger, retryExecutor });
    const response = await client.get("https://example.com", {
      platform: "twitch",
    });

    expect(executedThroughRetry).toBe(true);
    expect(response.status).toBe(204);
  });

  it("forwards maxAttempts rather than maxRetries to the retry system", async () => {
    const axios = createHttpAdapter();
    const executeWithRetry = createMockFn(async (_platform: string, handler: () => Promise<Record<string, unknown>>, maxAttempts?: number) => handler());
    const retryExecutor = { executeWithRetry } as Partial<NonNullable<RetryExecutorAdapter>> as NonNullable<RetryExecutorAdapter>;
    const client = new EnhancedHttpClient({ axios, logger: noOpLogger, retryExecutor });

    await client.get("https://example.com", { platform: "twitch", maxAttempts: 4 });

    expect(executeWithRetry.mock.calls[0]?.[2]).toBe(4);
  });

  it("rejects the ambiguous legacy maxRetries option", async () => {
    const client = new EnhancedHttpClient({ axios: createHttpAdapter(), logger: noOpLogger });

    await expect(client.get("https://example.com", { maxRetries: 4 })).rejects.toThrow(
      "maxRetries is not supported; use maxAttempts",
    );
  });

  it("uses retryScope without leaking retry metadata to the HTTP adapter", async () => {
    const get = createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockResolvedValue({ status: 200 });
    const axios = createHttpAdapter({ get });
    const executeWithRetry = createMockFn(async (_scope: string, handler: () => Promise<Record<string, unknown>>) => handler());
    const retryExecutor = { executeWithRetry } as Partial<NonNullable<RetryExecutorAdapter>> as NonNullable<RetryExecutorAdapter>;
    const client = new EnhancedHttpClient({ axios, logger: noOpLogger, retryExecutor });

    await client.get("https://example.com", { retryScope: "twitch-startup", maxAttempts: 3 });

    expect(executeWithRetry.mock.calls[0]?.[0]).toBe("twitch-startup");
    expect(get.mock.calls[0]?.[1]).not.toHaveProperty("retryScope");
    expect(get.mock.calls[0]?.[1]).not.toHaveProperty("maxAttempts");
  });

  it("does not retry POST requests without explicit unsafe-method approval", async () => {
    const post = createMockFn<[string, unknown, Record<string, unknown>], Promise<Record<string, unknown>>>()
      .mockResolvedValue({ status: 201 });
    const retryExecutor = {
      executeWithRetry: createMockFn(async (_scope: string, handler: () => Promise<Record<string, unknown>>) => handler()),
    } as NonNullable<RetryExecutorAdapter>;
    const client = new EnhancedHttpClient({
      axios: createHttpAdapter({ post }),
      logger: noOpLogger,
      retryExecutor,
    });

    await client.post("https://example.com/messages", { message: "test" }, { retryScope: "message" });

    expect(retryExecutor.executeWithRetry).not.toHaveBeenCalled();
    expect(post).toHaveBeenCalledTimes(1);
  });

  it("retries POST requests only when the caller asserts idempotency", async () => {
    const post = createMockFn<[string, unknown, Record<string, unknown>], Promise<Record<string, unknown>>>()
      .mockRejectedValueOnce(Object.assign(new Error("connection reset"), { code: "ECONNRESET" }))
      .mockResolvedValueOnce({ status: 201 });
    const retryExecutor = new HttpRetryExecutor({
      logger: noOpLogger,
      safeDelay: createMockFn().mockResolvedValue(undefined),
    });
    const client = new EnhancedHttpClient({
      axios: createHttpAdapter({ post }),
      logger: noOpLogger,
      retryExecutor,
    });

    await client.post(
      "https://example.com/idempotent-operation",
      { value: "test" },
      { retryScope: "idempotent-operation", idempotentRequest: true },
    );

    expect(post).toHaveBeenCalledTimes(2);
    expect(post.mock.calls[0]?.[2]).not.toHaveProperty("idempotentRequest");
  });

  it("bypasses retry system when disableRetry is true", async () => {
    const axios = {
      get: createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockRejectedValue(new Error("testNetworkError")),
    };
    const logger = noOpLogger;
    const retryExecutor = {
      executeWithRetry: createMockFn(async (_platform: string, handler: () => Promise<Record<string, unknown>>) => handler()),
    } as Partial<NonNullable<RetryExecutorAdapter>> as NonNullable<RetryExecutorAdapter>;

    const client = new EnhancedHttpClient({ axios: createHttpAdapter(axios), logger, retryExecutor });

    await expect(
      client.get("https://example.com", {
        platform: "twitch",
        disableRetry: true,
      }),
    ).rejects.toThrow("testNetworkError");
    expect(retryExecutor.executeWithRetry).not.toHaveBeenCalled();
  });

  it("encodes urlencoded post bodies", async () => {
    let postedBody!: string;
    let postedConfig!: { headers: Record<string, string> };
    const axios = {
      post: createMockFn(async (_url: string, body: unknown, config: Record<string, unknown>) => {
        postedBody = body as string;
        postedConfig = config as { headers: Record<string, string> };
        return { status: 201 };
      }),
    };
    const logger = noOpLogger;
    const client = new EnhancedHttpClient({ axios: createHttpAdapter(axios), logger });

    const response = await client.post(
      "https://example.com",
      { a: 1, b: "two" },
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
      },
    );

    expect(typeof postedBody).toBe("string");
    expect(postedBody).toContain("a=1");
    expect(postedBody).toContain("b=two");
    expect(postedConfig.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded",
    );
    expect(response.status).toBe(201);
  });

  it("encodes urlencoded bodies when content type includes charset", async () => {
    let postedBody!: string;
    const axios = {
      post: createMockFn(async (_url: string, body: unknown) => {
        postedBody = body as string;
        return { status: 201 };
      }),
    };
    const logger = noOpLogger;
    const client = new EnhancedHttpClient({ axios: createHttpAdapter(axios), logger });

    await client.post(
      "https://example.com",
      { a: 1, b: "two" },
      {
        headers: { "Content-Type": "application/x-www-form-urlencoded; charset=utf-8" },
      },
    );

    expect(typeof postedBody).toBe("string");
    expect(postedBody).toContain("a=1");
    expect(postedBody).toContain("b=two");
  });

  it("returns false when reachability check fails", async () => {
    const axios = {
      get: createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockRejectedValue(new Error("testNetworkFailure")),
    };
    const logger = noOpLogger;
    const client = new EnhancedHttpClient({ axios: createHttpAdapter(axios), logger });

    const reachable = await client.isReachable("https://example.com");

    expect(reachable).toBe(false);
  });

  it("builds auth headers for bearer tokens", () => {
    const axios = createHttpAdapter();
    const logger = noOpLogger;
    const client = new EnhancedHttpClient({ axios, logger });

    const bearerHeaders = client.buildAuthHeaders("testToken123", "bearer");
    const oauthHeaders = client.buildAuthHeaders("testToken456", "oauth");

    expect(bearerHeaders.Authorization).toBe("Bearer testToken123");
    expect(oauthHeaders.Authorization).toBe("OAuth testToken456");
  });

  it("preserves class-based logger prototype methods", async () => {
    let debugCalls = 0;

    class PrototypeLogger {
      debug() {
        debugCalls += 1;
      }

      info() {}

      warn() {}

      error() {}
    }

    const axios = createHttpAdapter();
    const logger = new PrototypeLogger();
    const client = new EnhancedHttpClient({ axios, logger });

    await client.get("https://example.com");

    expect(debugCalls).toBeGreaterThan(0);
  });
});
