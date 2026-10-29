import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  createMockFn,
  type TestMockFn,
  clearAllMocks,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
type EnhancedHttpClientConstructor =
  typeof import("../../../src/utils/enhanced-http-client").EnhancedHttpClient;
type EnhancedHttpClientConfig = NonNullable<ConstructorParameters<EnhancedHttpClientConstructor>[0]>;
type HttpClientAdapter = EnhancedHttpClientConfig["axios"];
type RequestConfig = Record<string, unknown> & { headers: Record<string, string> };
type MockFunction<Args extends unknown[]> = TestMockFn<Args, Promise<Record<string, unknown>>>;
type MockAxios = {
  get: MockFunction<[string, Record<string, unknown>]>;
  post: MockFunction<[string, unknown, Record<string, unknown>]>;
  put: MockFunction<[string, unknown, Record<string, unknown>]>;
  delete: MockFunction<[string, Record<string, unknown>]>;
};
const transientFailure = () => Object.assign(new Error("synthetic transient HTTP failure"), {
  response: { status: 503, headers: { "retry-after": "0" } },
});

function barrier<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(complete => { resolve = complete; });
  return { promise, resolve };
}

describe("Enhanced HTTP Client", () => {
  let mockAxios: MockAxios;
  let EnhancedHttpClient: EnhancedHttpClientConstructor;
  let client: InstanceType<EnhancedHttpClientConstructor>;

  beforeEach(() => {
    mockAxios = {
      get: createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>(),
      post: createMockFn<[string, unknown, Record<string, unknown>], Promise<Record<string, unknown>>>(),
      put: createMockFn<[string, unknown, Record<string, unknown>], Promise<Record<string, unknown>>>(),
      delete: createMockFn<[string, Record<string, unknown>], Promise<Record<string, unknown>>>(),
    };

    EnhancedHttpClient =
      require("../../../src/utils/enhanced-http-client").EnhancedHttpClient;

    client = new EnhancedHttpClient({
      timeout: 10000,
      userAgents: ["SyntheticAgent/1", "SyntheticAgent/2"],
      axios: mockAxios satisfies NonNullable<HttpClientAdapter>,
      logger: noOpLogger,
    });
  });

  afterEach(() => {
    restoreAllMocks();
    clearAllMocks();
  });

  describe("Authentication Header Abstraction", () => {
    test("should build Bearer authentication headers correctly", () => {
      const headers = client.buildAuthHeaders("test-token", "bearer");
      expect(headers).toEqual({ Authorization: "Bearer test-token" });
    });

    test("should build OAuth authentication headers correctly", () => {
      const headers = client.buildAuthHeaders("oauth-token", "oauth");
      expect(headers).toEqual({ Authorization: "OAuth oauth-token" });
    });

    test("should default to Bearer when auth type not specified", () => {
      const headers = client.buildAuthHeaders("default-token");
      expect(headers).toEqual({ Authorization: "Bearer default-token" });
    });

    test("should return empty headers when no token provided", () => {
      const headers = client.buildAuthHeaders(undefined);
      expect(headers).toEqual({});
    });
  });

  describe("Retry Executor Integration", () => {
    test("admits the retry only after the first held HTTP attempt fails", async () => {
      const firstEntered = barrier<void>();
      const secondEntered = barrier<void>();
      const failFirst = barrier<void>();
      const finishSecond = barrier<Record<string, unknown>>();
      const response = { data: "synthetic-success", status: 200 };
      let admissions = 0;
      mockAxios.get.mockImplementation(async () => {
        if (++admissions === 1) {
          firstEntered.resolve();
          await failFirst.promise;
          throw transientFailure();
        }
        secondEntered.resolve();
        return finishSecond.promise;
      });
      let completed = false;
      const pending = client.get("https://api.test.example.invalid/data", { platform: "twitch" })
        .then(result => { completed = true; return result; });
      try {
        await firstEntered.promise;
        expect(admissions).toBe(1);
        expect(completed).toBe(false);
        failFirst.resolve();
        await secondEntered.promise;
        expect(admissions).toBe(2);
        expect(completed).toBe(false);
        finishSecond.resolve(response);
        expect(await pending).toBe(response);
        expect(mockAxios.get).toHaveBeenCalledTimes(2);
      } finally {
        failFirst.resolve();
        finishSecond.resolve(response);
        await pending;
      }
    });

    test("enforces maxAttempts at the external HTTP boundary", async () => {
      const failure = transientFailure();
      mockAxios.get.mockRejectedValue(failure);
      await expect(client.get("https://api.test.example.invalid/data", { platform: "twitch", maxAttempts: 4 })).rejects.toBe(failure);
      expect(mockAxios.get).toHaveBeenCalledTimes(4);
    });

    test("makes direct requests when no platform is provided", async () => {
      const mockResponse = { data: "test", status: 200 };
      let capturedUrl: string | undefined;
      let capturedConfig: Record<string, unknown> | undefined;
      mockAxios.get.mockImplementation(async (url, config) => {
        capturedUrl = url;
        capturedConfig = config;
        return mockResponse;
      });

      const result = await client.get("https://api.test.example.invalid/data");

      expect(mockAxios.get).toHaveBeenCalledTimes(1);
      expect(capturedUrl).toBe("https://api.test.example.invalid/data");
      expect(capturedConfig).toEqual(expect.objectContaining({
        timeout: 10000,
        headers: expect.objectContaining({
          "User-Agent": expect.any(String),
        }),
      }));
      expect(result).toBe(mockResponse);
    });

    test("does not fabricate a fallback response for terminal provider errors", async () => {
      const failure = Object.assign(new Error("synthetic unauthorized"), { response: { status: 401 } });
      mockAxios.get.mockRejectedValue(failure);
      await expect(client.get("https://api.test.example.invalid/data", { platform: "youtube" })).rejects.toBe(failure);
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
    });

    test("does not retry transient failures without a platform", async () => {
      const failure = transientFailure();
      mockAxios.get.mockRejectedValue(failure);
      await expect(client.get("https://api.test.example.invalid/data")).rejects.toBe(failure);
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
    });

    test("disableRetry prevents a second GET attempt after a transient failure", async () => {
      const failure = transientFailure();
      mockAxios.get.mockRejectedValue(failure);
      await expect(client.get("https://api.test.example.invalid/data", { platform: "twitch", disableRetry: true })).rejects.toBe(failure);
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
    });

    test("retries POST only when explicitly idempotent", async () => {
      const failure = transientFailure();
      const response = { data: "synthetic-created", status: 201 };
      mockAxios.post.mockRejectedValueOnce(failure).mockRejectedValueOnce(failure).mockResolvedValueOnce(response);
      await expect(client.post("https://api.test.example.invalid/create", {}, { platform: "twitch" })).rejects.toBe(failure);
      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(await client.post("https://api.test.example.invalid/create", {}, { platform: "twitch", idempotentRequest: true })).toBe(response);
      expect(mockAxios.post).toHaveBeenCalledTimes(3);
    });

    test("bypasses retry executor when disableRetry is true", async () => {
      const mockResponse = { data: "ok", status: 200 };
      let capturedUrl: string | undefined;
      let capturedData: unknown;
      let capturedConfig: Record<string, unknown> | undefined;
      mockAxios.post.mockImplementation(async (url, data, config) => {
        capturedUrl = url;
        capturedData = data;
        capturedConfig = config;
        return mockResponse;
      });

      const result = await client.post(
        "https://api.test.example.invalid/token",
        { grant_type: "refresh_token" },
        {
          platform: "twitch",
          disableRetry: true,
        },
      );

      expect(mockAxios.post).toHaveBeenCalledTimes(1);
      expect(capturedUrl).toBe("https://api.test.example.invalid/token");
      expect(capturedData).toEqual({ grant_type: "refresh_token" });
      expect(capturedConfig).toEqual(expect.objectContaining({
        headers: expect.objectContaining({
          "User-Agent": expect.any(String),
        }),
      }));
      expect(result).toBe(mockResponse);
    });
  });

  describe("User-Agent Configuration", () => {
    test("uses configured user agent list when provided", () => {
      const customClient = new EnhancedHttpClient({
        timeout: 10000,
        axios: mockAxios satisfies NonNullable<HttpClientAdapter>,
        logger: noOpLogger,
        userAgents: ["ExampleAgent/1.0"],
      });

      const config = customClient.buildRequestConfig();

      expect((config as RequestConfig).headers["User-Agent"]).toBe("ExampleAgent/1.0");
    });
  });

  describe("HTTP Method Support", () => {
    test("supports GET requests with auth tokens", async () => {
      let capturedConfig: Record<string, unknown> | undefined;
      mockAxios.get.mockImplementation(async (_url, config) => {
        capturedConfig = config;
        return { data: "test", status: 200 };
      });

      await client.get("https://api.test.example.invalid/data", {
        authToken: "bearer-token",
        authType: "bearer",
      });

      expect(capturedConfig).toEqual(expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer bearer-token",
          "User-Agent": expect.any(String),
        }),
      }));
    });

    test("supports POST requests with data and auth headers", async () => {
      const postData = { name: "test" };
      let capturedUrl: string | undefined;
      let capturedData: unknown;
      let capturedConfig: Record<string, unknown> | undefined;
      mockAxios.post.mockImplementation(async (url, data, config) => {
        capturedUrl = url;
        capturedData = data;
        capturedConfig = config;
        return { data: "created", status: 201 };
      });

      await client.post("https://api.test.example.invalid/create", postData, {
        authToken: "oauth-token",
        authType: "oauth",
      });

      expect(capturedUrl).toBe("https://api.test.example.invalid/create");
      expect(capturedData).toEqual(postData);
      expect(capturedConfig).toEqual(expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "OAuth oauth-token",
          "Content-Type": "application/json",
          "User-Agent": expect.any(String),
        }),
      }));
    });

    test("should support PUT and DELETE methods", async () => {
      const updated = { data: "synthetic-updated", status: 200 };
      const deleted = { data: "synthetic-deleted", status: 204 };
      mockAxios.put.mockResolvedValue(updated);
      mockAxios.delete.mockResolvedValue(deleted);
      expect(await client.put("https://api.test.example.invalid/update/1", { name: "synthetic-updated" })).toBe(updated);
      expect(await client.delete("https://api.test.example.invalid/delete/1")).toBe(deleted);
      expect(mockAxios.put).toHaveBeenCalledTimes(1);
      expect(mockAxios.put).toHaveBeenCalledWith("https://api.test.example.invalid/update/1", { name: "synthetic-updated" }, expect.objectContaining({ headers: expect.objectContaining({ "Content-Type": "application/json" }) }));
      expect(mockAxios.delete).toHaveBeenCalledTimes(1);
      expect(mockAxios.delete).toHaveBeenCalledWith("https://api.test.example.invalid/delete/1", expect.any(Object));
    });
  });

  describe("User Agent Rotation", () => {
    test("should rotate user agents across requests", async () => {
      mockAxios.get.mockResolvedValue({ data: "test", status: 200 });

      await client.get("https://test.example.invalid/1");
      await client.get("https://test.example.invalid/2");
      await client.get("https://test.example.invalid/3");

      const calls = mockAxios.get.mock.calls;
      const userAgents = calls.map((call) => (call[1] as RequestConfig).headers["User-Agent"]);

      expect(userAgents).toEqual(["SyntheticAgent/1", "SyntheticAgent/2", "SyntheticAgent/1"]);
    });
  });

  describe("Error Handling", () => {
    test("should preserve original error when not using retry executor", async () => {
      const failure = new Error("synthetic API error");
      mockAxios.get.mockRejectedValue(failure);

      await expect(
        client.get("https://test.example.invalid/error"),
      ).rejects.toBe(failure);
      expect(mockAxios.get).toHaveBeenCalledTimes(1);
    });

    test("should let retry executor handle errors when platform specified", async () => {
      const failure = transientFailure();
      mockAxios.get.mockRejectedValue(failure);

      await expect(
        client.get("https://test.example.invalid/error", {
          platform: "tiktok",
        }),
      ).rejects.toBe(failure);
      expect(mockAxios.get).toHaveBeenCalledTimes(3);
    });
  });

  describe("Configuration Options", () => {
    test("uses custom timeout when specified", async () => {
      let capturedConfig: Record<string, unknown> | undefined;
      mockAxios.get.mockImplementation(async (_url, config) => {
        capturedConfig = config;
        return { data: "test", status: 200 };
      });

      await client.get("https://test.example.invalid/data", { timeout: 5000 });

      expect(capturedConfig).toEqual(expect.objectContaining({ timeout: 5000 }));
    });

    test("merges custom headers with auth headers", async () => {
      let capturedConfig: Record<string, unknown> | undefined;
      mockAxios.get.mockImplementation(async (_url, config) => {
        capturedConfig = config;
        return { data: "test", status: 200 };
      });

      await client.get("https://test.example.invalid/data", {
        authToken: "token123",
        headers: {
          "Custom-Header": "custom-value",
          Accept: "application/json",
        },
      });

      expect(capturedConfig).toEqual(expect.objectContaining({
        headers: expect.objectContaining({
          Authorization: "Bearer token123",
          "Custom-Header": "custom-value",
          Accept: "application/json",
          "User-Agent": expect.any(String),
        }),
      }));
    });
  });
});

describe("Enhanced HTTP Client - Retry Executor Requirement", () => {
  test("rejects an invalid injected retry dependency when executing, before HTTP admission", async () => {
    const { EnhancedHttpClient } = await import("../../../src/utils/enhanced-http-client");
    let admissions = 0;
    const transport = async () => { admissions++; return { status: 200 }; };
    const client = new EnhancedHttpClient({
      retryExecutor: {} as NonNullable<EnhancedHttpClientConfig["retryExecutor"]>,
      axios: { get: transport, post: transport, put: transport, delete: transport },
      logger: noOpLogger,
    });
    await expect(client.get("https://synthetic.example.invalid/invalid-dependency", { platform: "twitch" })).rejects.toThrow(TypeError);
    expect(admissions).toBe(0);
  });
});

for (const mode of ["cancel", "deadline"] as const) {
  test(`HTTP ${mode} aborts the admitted request and fences late success without another attempt`, async () => {
    const { EnhancedHttpClient } = await import("../../../src/utils/enhanced-http-client");
    const entered = barrier<AbortSignal>();
    const release = barrier<Record<string, unknown>>();
    const settled = barrier<void>();
    let admissions = 0;
    const transport = async (_url: string, config: Record<string, unknown>) => {
      admissions++;
      entered.resolve(config.signal as AbortSignal);
      try { return await release.promise; } finally { settled.resolve(); }
    };
    const client = new EnhancedHttpClient({
      axios: { get: transport, post: async () => ({}), put: async () => ({}), delete: transport },
      logger: noOpLogger,
    });
    const controller = new AbortController();
    const reason = new DOMException("synthetic cancellation", "AbortError");
    const pending = client.get("https://synthetic.example.invalid/held", {
      platform: "youtube", parentAbortSignal: controller.signal, overallBudgetMs: mode === "deadline" ? 10 : 8000,
    });
    // Attach rejection observation before triggering cancellation or the deadline.
    const outcome = pending.then(value => ({ value, error: undefined }), (error: unknown) => ({ value: undefined, error }));
    try {
      const signal = await entered.promise;
      if (mode === "cancel") controller.abort(reason);
      const result = await outcome;
      expect(result.value).toBeUndefined();
      if (mode === "cancel") expect(result.error).toBe(reason);
      else expect(result.error).toMatchObject({ message: "HTTP GET deadline exceeded after 10ms" });
      expect(signal.aborted).toBe(true);
      expect(admissions).toBe(1);
      release.resolve({ status: 200, data: "synthetic-too-late" });
      await settled.promise;
      expect(await outcome).toEqual(result);
      expect(admissions).toBe(1);
    } finally {
      release.resolve({ status: 200 });
      await settled.promise;
      await outcome;
    }
  });
}
