import { describe, expect, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { EnhancedHttpClient } from "../../../src/utils/enhanced-http-client";
type EnhancedHttpClientConfig = NonNullable<ConstructorParameters<typeof EnhancedHttpClient>[0]>;
type HttpClientAdapter = EnhancedHttpClientConfig["axios"];
type RetrySystemAdapter = EnhancedHttpClientConfig["retrySystem"];
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

    const retrySystem = {
      executeWithRetry: createMockFn(async (_platform: string, handler: () => Promise<Record<string, unknown>>) => {
        executedThroughRetry = true;
        return handler();
      }),
    } as Partial<NonNullable<RetrySystemAdapter>> as NonNullable<RetrySystemAdapter>;

    const client = new EnhancedHttpClient({ axios, logger, retrySystem });
    const response = await client.get("https://example.com", {
      platform: "twitch",
    });

    expect(executedThroughRetry).toBe(true);
    expect(response.status).toBe(204);
  });

  it("bypasses retry system when disableRetry is true", async () => {
    const axios = {
      get: createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>().mockRejectedValue(new Error("testNetworkError")),
    };
    const logger = noOpLogger;
    const retrySystem = {
      executeWithRetry: createMockFn(async (_platform: string, handler: () => Promise<Record<string, unknown>>) => handler()),
    } as Partial<NonNullable<RetrySystemAdapter>> as NonNullable<RetrySystemAdapter>;

    const client = new EnhancedHttpClient({ axios: createHttpAdapter(axios), logger, retrySystem });

    await expect(
      client.get("https://example.com", {
        platform: "twitch",
        disableRetry: true,
      }),
    ).rejects.toThrow("testNetworkError");
    expect(retrySystem.executeWithRetry).not.toHaveBeenCalled();
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
