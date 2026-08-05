import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMockFn, restoreAllMocks, type TestMockFn } from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";
import {
  initializeStaticSecrets,
  secrets,
  _resetForTesting,
} from "../../src/core/secrets";
import { TwitchApiClient } from "../../src/utils/api-clients/twitch-api-client.ts";

type TestHttpResponse = {
  status: number;
  data: unknown;
};

type TestRequestOptions = Record<string, unknown> & {
  authToken?: string;
  clientId?: string;
};

type TestHttpClient = {
  get: TestMockFn<[string, TestRequestOptions?], Promise<TestHttpResponse>>;
  post: TestMockFn;
};

type TestTwitchAuth = {
  refreshTokens: TestMockFn<[], Promise<boolean>>;
  isReady: TestMockFn<[], boolean>;
};

describe("TwitchApiClient authentication", () => {
  let mockLogger: typeof noOpLogger;
  let mockHttpClient: TestHttpClient;
  let mockTwitchAuth: TestTwitchAuth;
  let apiClient: TwitchApiClient;

  const createMockHttpClient = (): TestHttpClient => ({
    get: createMockFn<[string, TestRequestOptions?], Promise<TestHttpResponse>>(),
    post: createMockFn(),
  });

  const createMockTwitchAuth = (overrides: Partial<TestTwitchAuth> = {}): TestTwitchAuth => ({
    refreshTokens: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
    isReady: createMockFn<[], boolean>().mockReturnValue(true),
    ...overrides,
  });

  beforeEach(() => {
    _resetForTesting();
    initializeStaticSecrets();
    secrets.twitch.accessToken = "test-access-token";
    mockLogger = noOpLogger;
    mockHttpClient = createMockHttpClient();
    mockTwitchAuth = createMockTwitchAuth();

    apiClient = new TwitchApiClient(
      mockTwitchAuth,
      { clientId: "test-client-id", channel: "test-channel" },
      mockLogger,
      { enhancedHttpClient: mockHttpClient },
    );
  });

  afterEach(() => {
    restoreAllMocks();
    _resetForTesting();
    initializeStaticSecrets();
  });

  describe("API request authentication", () => {
    it("includes Bearer token and Client-Id in requests", async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        data: { data: [] },
      });

      await apiClient.makeRequest("/test-endpoint");

      const requestOptions = mockHttpClient.get.mock.calls[0]?.[1];
      expect(requestOptions?.authToken).toBe("test-access-token");
      expect(requestOptions?.clientId).toBe("test-client-id");
    });

    it("returns stream info when channel is live", async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        data: {
          data: [
            {
              viewer_count: 42,
              game_name: "Test Game",
            },
          ],
        },
      });

      const result = await apiClient.getStreamInfo("test-channel");

      expect(result.isLive).toBe(true);
      expect(result.viewerCount).toBe(42);
    });

    it("returns offline status when channel is not live", async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        data: { data: [] },
      });

      const result = await apiClient.getStreamInfo("test-channel");

      expect(result.isLive).toBe(false);
      expect(result.viewerCount).toBe(0);
    });
  });

  describe("getBroadcasterId", () => {
    it("passes the explicit Twitch startup retry scope and three-attempt limit", async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        data: { data: [{ id: "startup-broadcaster-id", login: "testchannel" }] },
      });

      await apiClient.getBroadcasterId("testchannel");

      expect(mockHttpClient.get.mock.calls[0]?.[1]).toMatchObject({
        retryScope: "twitch-startup",
        maxAttempts: 3,
      });
    });

    it("returns user ID from channel name", async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        data: { data: [{ id: "123456789", login: "testchannel" }] },
      });

      const broadcasterId = await apiClient.getBroadcasterId("testchannel");

      expect(broadcasterId).toBe("123456789");
    });

    it("throws when channel not found", async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        data: { data: [] },
      });

      await expect(apiClient.getBroadcasterId("nonexistent")).rejects.toThrow(
        "Could not resolve broadcaster ID for channel: nonexistent",
      );
    });

    it("throws when API returns null user", async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        data: { data: null },
      });

      await expect(apiClient.getBroadcasterId("badchannel")).rejects.toThrow(
        "Could not resolve broadcaster ID for channel: badchannel",
      );
    });

    it("preserves an exhausted transport error from the enhanced HTTP boundary", async () => {
      const exhaustedError = new Error("transport retries exhausted");
      mockHttpClient.get.mockRejectedValue(exhaustedError);

      await expect(apiClient.getBroadcasterId("unreachable-channel")).rejects.toBe(exhaustedError);
    });

    it("propagates terminal HTTP errors immediately", async () => {
      const terminalError = { response: { status: 403 } };
      mockHttpClient.get.mockRejectedValue(terminalError);

      await expect(apiClient.getBroadcasterId("terminal-channel")).rejects.toBe(terminalError);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
    });

    it("still maps a successful empty response to channel-not-found", async () => {
      mockHttpClient.get.mockResolvedValue({ status: 200, data: { data: [] } });

      await expect(apiClient.getBroadcasterId("empty-channel")).rejects.toThrow(
        "Could not resolve broadcaster ID for channel: empty-channel",
      );
    });
  });

  describe("getUserById", () => {
    it("returns user payload when id lookup succeeds", async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        data: {
          data: [
            {
              id: "test-user-id",
              login: "testuser",
              profile_image_url: "https://example.invalid/avatar.png",
            },
          ],
        },
      });

      const user = await apiClient.getUserById("test-user-id");

      expect(user).toEqual({
        id: "test-user-id",
        login: "testuser",
        profile_image_url: "https://example.invalid/avatar.png",
      });
    });

    it("returns null when id lookup has no rows", async () => {
      mockHttpClient.get.mockResolvedValue({
        status: 200,
        data: { data: [] },
      });

      const user = await apiClient.getUserById("missing-user-id");

      expect(user).toBeNull();
    });
  });

  describe("401 retry with token refresh", () => {
    it("retries request after refreshing token on 401", async () => {
      mockHttpClient.get
        .mockRejectedValueOnce({ response: { status: 401 } })
        .mockResolvedValueOnce({
          status: 200,
          data: { data: [{ id: "test-user-id", login: "testuser" }] },
        });

      secrets.twitch.accessToken = "expired-token";
      mockTwitchAuth.refreshTokens = createMockFn<[], Promise<boolean>>().mockImplementation(
        async () => {
          secrets.twitch.accessToken = "refreshed-token";
          return true;
        },
      );

      const result = await apiClient.getUserInfo("testuser");

      expect(result).toEqual({ id: "test-user-id", login: "testuser" });
      expect(mockTwitchAuth.refreshTokens).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
    });

    it("uses refreshed token in retry request", async () => {
      mockHttpClient.get
        .mockRejectedValueOnce({ response: { status: 401 } })
        .mockResolvedValueOnce({
          status: 200,
          data: { data: [{ id: "user-123" }] },
        });

      secrets.twitch.accessToken = "old-token";
      mockTwitchAuth.refreshTokens = createMockFn<[], Promise<boolean>>().mockImplementation(
        async () => {
          secrets.twitch.accessToken = "new-refreshed-token";
          return true;
        },
      );

      await apiClient.getUserInfo("testuser");

      const retryRequestOptions = mockHttpClient.get.mock.calls[1]?.[1];
      expect(retryRequestOptions?.authToken).toBe("new-refreshed-token");
      expect(retryRequestOptions?.disableRetry).toBe(true);
    });

    it("throws when retry after 401 also fails", async () => {
      mockHttpClient.get
        .mockRejectedValueOnce({ response: { status: 401 } })
        .mockRejectedValueOnce({ response: { status: 401 } });

      await expect(apiClient.makeRequest("/test")).rejects.toMatchObject({
        response: { status: 401 },
      });
    });

    it("does not retry on non-401 errors", async () => {
      mockHttpClient.get.mockRejectedValueOnce({
        response: { status: 500 },
      });

      await expect(apiClient.makeRequest("/test")).rejects.toMatchObject({
        response: { status: 500 },
      });
    });
  });

  describe("auth failure handling", () => {
    it("returns offline status when getAccessToken throws", async () => {
      secrets.twitch.accessToken = null;

      const result = await apiClient.getStreamInfo("test-channel");

      expect(result.isLive).toBe(false);
      expect(result.viewerCount).toBe(0);
    });

    it("throws when no access token available", async () => {
      secrets.twitch.accessToken = null;

      await expect(apiClient.makeRequest("/test")).rejects.toThrow(
        "No access token available for Twitch API",
      );
    });
  });

  describe("getCheermotes", () => {
    it("requests broadcaster-aware cheermotes and returns catalog rows", async () => {
      mockHttpClient.get.mockImplementation(async (url: string) => {
        if (
          typeof url === "string" &&
          url.includes("/bits/cheermotes?broadcaster_id=test-broadcaster-id")
        ) {
          return {
            status: 200,
            data: {
              data: [
                {
                  prefix: "Cheer",
                  tiers: [
                    {
                      id: "100",
                      images: {
                        dark: {
                          animated: {
                            "3": "https://example.invalid/cheer-100-dark-animated-3.gif",
                          },
                        },
                      },
                    },
                  ],
                },
              ],
            },
          };
        }

        return {
          status: 200,
          data: {
            data: [],
          },
        };
      });

      const cheermotes = await apiClient.getCheermotes("test-broadcaster-id");

      expect(cheermotes).toEqual([
        {
          prefix: "Cheer",
          tiers: [
            {
              id: "100",
              images: {
                dark: {
                  animated: {
                    "3": "https://example.invalid/cheer-100-dark-animated-3.gif",
                  },
                },
              },
            },
          ],
        },
      ]);
    });
  });
});
