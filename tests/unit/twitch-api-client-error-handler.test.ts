import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMockFn, restoreAllMocks, type TestMockFn } from "../helpers/bun-mock-utils";
import {
  initializeStaticSecrets,
  secrets,
  _resetForTesting,
} from "../../src/core/secrets";
import { TwitchApiClient } from "../../src/utils/api-clients/twitch-api-client.ts";

type TestLogger = {
  debug: TestMockFn;
  info: TestMockFn;
  warn: TestMockFn;
  error: TestMockFn;
};

type TestHttpClient = {
  get: TestMockFn<[string, Record<string, unknown>?], Promise<{ data: unknown }>>;
  post: TestMockFn;
};

describe("TwitchApiClient error handler integration", () => {
  let mockLogger: TestLogger;
  let mockHttpClient: TestHttpClient;
  let apiClient: TwitchApiClient;

  beforeEach(() => {
    _resetForTesting();
    initializeStaticSecrets();
    secrets.twitch.accessToken = "test-access-token";

    mockLogger = {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
    };
    mockHttpClient = {
      get: createMockFn(),
      post: createMockFn(),
    };
    apiClient = new TwitchApiClient(
      null,
      { clientId: "test-client-id" },
      mockLogger,
      { enhancedHttpClient: mockHttpClient },
    );
  });

  afterEach(() => {
    restoreAllMocks();
    _resetForTesting();
    initializeStaticSecrets();
  });

  it("routes getStreamInfo API error through error handler", async () => {
    mockHttpClient.get.mockRejectedValue(new Error("network failure"));

    const result = await apiClient.getStreamInfo("test-channel");

    expect(result.isLive).toBe(false);
  });

  it("does not send token-bearing error messages to injected loggers", async () => {
    const token = "synthetic-diagnostic-token";
    const failure = Object.assign(new Error(`access_token=${token}`), { response: { status: 401 } });
    mockHttpClient.get.mockRejectedValue(failure);
    const client = new TwitchApiClient({ refreshTokens: async () => true }, { clientId: "synthetic-client" }, mockLogger, { enhancedHttpClient: mockHttpClient });
    await expect(client.getUserInfo("synthetic-user")).resolves.toBeNull();
    const output = JSON.stringify(Object.values(mockLogger).flatMap((method) => method.mock.calls));
    expect(output).not.toContain(token);
    expect(mockLogger.warn.mock.calls[0]?.[2]).toMatchObject({ status: 401 });
    expect(mockLogger.error.mock.calls[0]?.[0]).toBe("Failed to get user info");
  });

  it("routes getUserInfo API errors through the error handler", async () => {
    mockHttpClient.get.mockRejectedValue(new Error("user lookup failed"));

    await expect(apiClient.getUserInfo("test-user")).resolves.toBeNull();
  });

  it("routes getChannelInfo API error through error handler", async () => {
    mockHttpClient.get.mockRejectedValue(new Error("channel lookup failed"));

    const result = await apiClient.getChannelInfo("test-channel-id");

    expect(result).toBeNull();
  });

  it("routes getUserById API error through error handler", async () => {
    mockHttpClient.get.mockRejectedValue(new Error("user id lookup failed"));

    const result = await apiClient.getUserById("test-user-id");

    expect(result).toBeNull();
  });

  it("routes getCheermotes API error through error handler", async () => {
    mockHttpClient.get.mockRejectedValue(new Error("cheermotes unavailable"));

    const result = await apiClient.getCheermotes("test-broadcaster-id");

    expect(result).toEqual([]);
  });
});
