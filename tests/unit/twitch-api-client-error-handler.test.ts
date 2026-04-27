import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import {
  initializeStaticSecrets,
  secrets,
  _resetForTesting,
} from "../../src/core/secrets";
import { TwitchApiClient } from "../../src/utils/api-clients/twitch-api-client.ts";

describe("TwitchApiClient error handler integration", () => {
  let mockLogger;
  let mockHttpClient;
  let apiClient;

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

  it("routes getUserInfo API error through error handler", async () => {
    mockHttpClient.get.mockRejectedValue(new Error("user lookup failed"));

    const result = await apiClient.getUserInfo("test-user");

    expect(result).toBeNull();
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
