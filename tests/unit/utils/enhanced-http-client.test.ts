import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  createMockFn,
  clearAllMocks,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createTestRetrySystem } from "../../helpers/test-setup";
type EnhancedHttpClientConstructor =
  typeof import("../../../src/utils/enhanced-http-client").EnhancedHttpClient;
type MockFunction = ReturnType<typeof createMockFn>;
type MockAxios = {
  get: MockFunction;
  post: MockFunction;
  put: MockFunction;
  delete: MockFunction;
};

describe("Enhanced HTTP Client", () => {
  let mockAxios: MockAxios;
  let mockRetrySystem: ReturnType<typeof createTestRetrySystem>;
  let EnhancedHttpClient: EnhancedHttpClientConstructor;
  let client: InstanceType<EnhancedHttpClientConstructor>;

  beforeEach(() => {
    mockAxios = {
      get: createMockFn(),
      post: createMockFn(),
      put: createMockFn(),
      delete: createMockFn(),
    };

    mockRetrySystem = createTestRetrySystem();
    EnhancedHttpClient =
      require("../../../src/utils/enhanced-http-client").EnhancedHttpClient;

    client = new EnhancedHttpClient({
      retrySystem: mockRetrySystem,
      timeout: 10000,
      axios: mockAxios,
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
      const headers = client.buildAuthHeaders();
      expect(headers).toEqual({});
    });
  });

  describe("Retry System Integration", () => {
    test("uses retry system for GET requests when platform is provided", async () => {
      const mockResponse = { data: "test", status: 200 };
      mockAxios.get.mockResolvedValue(mockResponse);
      let observedRetryPlatform: string | undefined;
      let observedRetryResult: unknown;
      mockRetrySystem.executeWithRetry.mockImplementation(
        async (platformName, executeRequest) => {
          observedRetryPlatform = platformName;
          observedRetryResult = await executeRequest();
          return observedRetryResult;
        },
      );

      const result = await client.get("https://api.test.example.invalid/data", {
        authToken: "token123",
        platform: "twitch",
      });

      expect(result).toBe(mockResponse);
      expect(observedRetryPlatform).toBe("twitch");
      expect(observedRetryResult).toBe(mockResponse);
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

      expect(mockRetrySystem.executeWithRetry).not.toHaveBeenCalled();
      expect(capturedUrl).toBe("https://api.test.example.invalid/data");
      expect(capturedConfig).toEqual(expect.objectContaining({
        timeout: 10000,
        headers: expect.objectContaining({
          "User-Agent": expect.any(String),
        }),
      }));
      expect(result).toBe(mockResponse);
    });

    test("returns retry-system fallback response when request execution fails", async () => {
      const mockResponse = { data: "success", status: 200 };
      mockAxios.get.mockRejectedValue(new Error("temporary failure"));
      let observedRetryPlatform: string | undefined;
      let retryFallbackUsed = false;

      mockRetrySystem.executeWithRetry.mockImplementation(
        async (platformName, executeRequest) => {
          observedRetryPlatform = platformName;
          try {
            return await executeRequest();
          } catch {
            retryFallbackUsed = true;
            return mockResponse;
          }
        },
      );

      const result = await client.get("https://api.test.example.invalid/data", {
        platform: "youtube",
      });

      expect(result).toBe(mockResponse);
      expect(observedRetryPlatform).toBe("youtube");
      expect(retryFallbackUsed).toBe(true);
    });

    test("bypasses retry system when disableRetry is true", async () => {
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

      expect(mockRetrySystem.executeWithRetry).not.toHaveBeenCalled();
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
        retrySystem: mockRetrySystem,
        timeout: 10000,
        axios: mockAxios,
        logger: noOpLogger,
        userAgents: ["ExampleAgent/1.0"],
      });

      const config = customClient.buildRequestConfig();

      expect(config.headers["User-Agent"]).toBe("ExampleAgent/1.0");
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
      mockAxios.put.mockResolvedValue({ data: "updated", status: 200 });
      mockAxios.delete.mockResolvedValue({ data: "deleted", status: 204 });

      await client.put("https://api.test.example.invalid/update/1", {
        name: "updated",
      });
      await client.delete("https://api.test.example.invalid/delete/1");

      expect(mockAxios.put).toHaveBeenCalled();
      expect(mockAxios.delete).toHaveBeenCalled();
    });
  });

  describe("User Agent Rotation", () => {
    test("should rotate user agents across requests", async () => {
      mockAxios.get.mockResolvedValue({ data: "test", status: 200 });

      await client.get("https://test.example.invalid/1");
      await client.get("https://test.example.invalid/2");
      await client.get("https://test.example.invalid/3");

      const calls = mockAxios.get.mock.calls;
      const userAgents = calls.map((call) => call[1].headers["User-Agent"]);

      expect(new Set(userAgents).size).toBeGreaterThan(1);
    });
  });

  describe("Error Handling", () => {
    test("should preserve original error when not using retry system", async () => {
      mockAxios.get.mockRejectedValue(new Error("API Error"));

      await expect(
        client.get("https://test.example.invalid/error"),
      ).rejects.toThrow("API Error");
    });

    test("should let retry system handle errors when platform specified", async () => {
      mockRetrySystem.executeWithRetry.mockRejectedValue(
        new Error("Network timeout"),
      );

      await expect(
        client.get("https://test.example.invalid/error", {
          platform: "tiktok",
        }),
      ).rejects.toThrow("Network timeout");
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

describe("Enhanced HTTP Client - Retry System Requirement", () => {
  test("retry system must have executeWithRetry method", () => {
    const mockRetrySystem = createTestRetrySystem();
    expect(typeof mockRetrySystem.executeWithRetry).toBe("function");
  });
});
