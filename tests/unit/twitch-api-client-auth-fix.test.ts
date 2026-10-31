import { vi, type Mock, afterEach, beforeEach, describe, expect, it, spyOn } from 'bun:test';
import fs from "node:fs";

import { noOpLogger } from "../helpers/mock-factories";
import {
  initializeStaticSecrets,
  secrets,
  _resetForTesting,
} from "../../src/core/secrets";
import { TwitchAuth } from "../../src/auth/TwitchAuth";
import { TWITCH_OAUTH_SCOPES } from "../../src/auth/twitch-oauth-scopes";
import { TwitchApiClient } from "../../src/utils/api-clients/twitch-api-client.ts";
import { TwitchViewerCountProvider } from "../../src/utils/viewer-count-providers";
import { ViewerCountSystem } from "../../src/utils/viewer-count";
import { createConfigFixture } from "../helpers/config-fixture";

type TestHttpResponse = {
  status: number;
  data: unknown;
};

type TestRequestOptions = Record<string, unknown> & {
  authToken?: string;
  clientId?: string;
};

type TestHttpClient = {
  get: Mock<(...args: [string, TestRequestOptions?]) => Promise<TestHttpResponse>>;
  post: Mock<(...args: unknown[]) => unknown>;
};

type AuthHttpClient = {
  get: Mock<(...args: [string, unknown?]) => Promise<{ data?: unknown }>>;
  post: Mock<(...args: [string, unknown?, unknown?]) => Promise<{ data?: unknown }>>;
};

const IN_MEMORY_TOKEN_STORE_PATH = "/synthetic-in-memory-token-store/tokens.json";

describe("TwitchApiClient authentication", () => {
  const ownedSystems = new Set<ViewerCountSystem>();
  let mockLogger: typeof noOpLogger;
  let mockHttpClient: TestHttpClient;
  let authHttpClient: AuthHttpClient;
  let twitchAuth: TwitchAuth;
  let refreshTokensSpy: ReturnType<typeof spyOn<TwitchAuth, "refreshTokens">>;
  let apiClient: TwitchApiClient;
  let inMemoryTokenFiles: Map<string, string>;
  let fsSpies: Array<{ mockRestore: () => void }>;

  const createMockHttpClient = (): TestHttpClient => ({
    get: vi.fn<(...args: [string, TestRequestOptions?]) => Promise<TestHttpResponse>>(),
    post: vi.fn<(...args: unknown[]) => unknown>(),
  });

  const createAuthHttpClient = (): AuthHttpClient => ({
    get: vi.fn<(...args: [string, unknown?]) => Promise<{ data?: unknown }>>().mockResolvedValue({
      data: {
        client_id: "test-client-id",
        user_id: "test-user-id",
        login: "test-channel",
        scopes: [...TWITCH_OAUTH_SCOPES],
      },
    }),
    post: vi.fn<(...args: [string, unknown?, unknown?]) => Promise<{ data?: unknown }>>().mockResolvedValue({
      data: {
        access_token: "refreshed-access-token",
        refresh_token: "refreshed-refresh-token",
        expires_in: 3600,
      },
    }),
  });

  const ownSystem = (system: ViewerCountSystem) => {
    ownedSystems.add(system);
    return system;
  };

  beforeEach(async () => {
    _resetForTesting();
    initializeStaticSecrets();
    secrets.twitch.clientSecret = "test-client-secret";
    secrets.twitch.accessToken = "test-access-token";
    secrets.twitch.refreshToken = "test-refresh-token";

    inMemoryTokenFiles = new Map([
      [
        IN_MEMORY_TOKEN_STORE_PATH,
        JSON.stringify({
          twitch: {
            accessToken: "test-access-token",
            refreshToken: "test-refresh-token",
          },
        }),
      ],
    ]);

    const io = fs.promises;
    const origMkdir = io.mkdir.bind(io);
    const origChmod = io.chmod.bind(io);
    const origReadFile = io.readFile.bind(io);
    const origWriteFile = io.writeFile.bind(io);
    const origRename = io.rename.bind(io);
    const origUnlink = io.unlink.bind(io);

    fsSpies = [
      spyOn(io, "mkdir").mockImplementation((async (targetPath, options) => {
        if (String(targetPath).startsWith("/synthetic-in-memory-token-store")) {
          return undefined;
        }
        return origMkdir(targetPath, options);
      }) as typeof io.mkdir),
      spyOn(io, "chmod").mockImplementation((async (targetPath, mode) => {
        if (String(targetPath).startsWith("/synthetic-in-memory-token-store")) {
          return undefined;
        }
        return origChmod(targetPath, mode);
      }) as typeof io.chmod),
      spyOn(io, "readFile").mockImplementation((async (targetPath, options) => {
        const key = String(targetPath);
        if (key.startsWith("/synthetic-in-memory-token-store")) {
          const content = inMemoryTokenFiles.get(key);
          if (content === undefined) {
            throw Object.assign(new Error(`ENOENT: no such file or directory, open '${key}'`), {
              code: "ENOENT",
            });
          }
          return content;
        }
        return origReadFile(targetPath, options as BufferEncoding);
      }) as typeof io.readFile),
      spyOn(io, "writeFile").mockImplementation((async (targetPath, data, options) => {
        const key = String(targetPath);
        if (key.startsWith("/synthetic-in-memory-token-store")) {
          inMemoryTokenFiles.set(key, String(data));
          return undefined;
        }
        return origWriteFile(targetPath, data, options);
      }) as typeof io.writeFile),
      spyOn(io, "rename").mockImplementation((async (oldPath, newPath) => {
        const fromKey = String(oldPath);
        const toKey = String(newPath);
        if (
          fromKey.startsWith("/synthetic-in-memory-token-store") ||
          toKey.startsWith("/synthetic-in-memory-token-store")
        ) {
          const content = inMemoryTokenFiles.get(fromKey) ?? "";
          inMemoryTokenFiles.delete(fromKey);
          inMemoryTokenFiles.set(toKey, content);
          return undefined;
        }
        return origRename(oldPath, newPath);
      }) as typeof io.rename),
      spyOn(io, "unlink").mockImplementation((async (targetPath) => {
        const key = String(targetPath);
        if (key.startsWith("/synthetic-in-memory-token-store")) {
          inMemoryTokenFiles.delete(key);
          return undefined;
        }
        return origUnlink(targetPath);
      }) as typeof io.unlink),
    ];

    mockLogger = noOpLogger;
    mockHttpClient = createMockHttpClient();
    authHttpClient = createAuthHttpClient();
    twitchAuth = new TwitchAuth({
      tokenStorePath: IN_MEMORY_TOKEN_STORE_PATH,
      clientId: "test-client-id",
      expectedUsername: "test-channel",
      logger: mockLogger,
      httpClient: authHttpClient,
    });
    await twitchAuth.initialize();
    refreshTokensSpy = spyOn(twitchAuth, "refreshTokens");

    apiClient = new TwitchApiClient(
      twitchAuth,
      { clientId: "test-client-id", channel: "test-channel" },
      mockLogger,
      { enhancedHttpClient: mockHttpClient },
    );
  });

  afterEach(async () => {
    try {
      for (const system of ownedSystems) {
        system.stopPolling();
        await system.cleanup();
      }
      ownedSystems.clear();
      if (twitchAuth) {
        await twitchAuth.dispose();
      }
    } finally {
      refreshTokensSpy?.mockRestore();
      for (const spy of (fsSpies ?? []).reverse()) {
        spy.mockRestore();
      }
      vi.restoreAllMocks();
      _resetForTesting();
      initializeStaticSecrets();
    }
  });

  describe("API request authentication", () => {
    it("keeps owner authentication authoritative while retaining transport options", async () => {
      mockHttpClient.get.mockResolvedValue({ status: 200, data: { data: [] } });
      const signal = new AbortController().signal;
      const auth = { username: "synthetic-user", password: "synthetic-password" };
      await apiClient.makeRequest("/users", {
        authToken: "synthetic-caller-token", authType: "caller", clientId: "caller-id",
        auth,
        headers: { authorization: "caller", AUTHORIZATION: "caller2", "CLIENT-ID": "caller", "X-Test": "retained" },
        signal, maxAttempts: 3, totalTimeout: 1234,
      });
      expect(mockHttpClient.get.mock.calls[0]?.[1]).toMatchObject({
        authToken: "test-access-token", authType: "app", clientId: "test-client-id",
        auth: null,
        headers: { Authorization: "Bearer test-access-token", "Client-Id": "test-client-id", "X-Test": "retained" },
        signal, maxAttempts: 3, totalTimeout: 1234,
      });
      expect(Object.keys(mockHttpClient.get.mock.calls[0]?.[1]?.headers as object).sort()).toEqual(["Authorization", "Client-Id", "X-Test"]);
      expect(auth).toEqual({ username: "synthetic-user", password: "synthetic-password" });
    });

    it("does not use caller client identity when owner identity is absent", async () => {
      mockHttpClient.get.mockResolvedValue({ status: 200, data: { data: [] } });
      const client = new TwitchApiClient(null, {}, mockLogger, { enhancedHttpClient: mockHttpClient });
      await client.makeRequest("/users", { clientId: "caller", headers: { "client-id": "caller" } });
      expect(mockHttpClient.get.mock.calls[0]?.[1]?.clientId).toBeUndefined();
      expect(mockHttpClient.get.mock.calls[0]?.[1]?.headers).toEqual({ Authorization: "Bearer test-access-token" });
    });

    it("encodes query values exactly once as data", async () => {
      mockHttpClient.get.mockResolvedValue({ status: 200, data: { data: [{ id: "synthetic-id", viewer_count: 0 }] } });
      const value = "synthetic&other=?\u96ea%20";
      await apiClient.getStreamInfo(value);
      await apiClient.getUserInfo(value);
      await apiClient.getBroadcasterId(value);
      await apiClient.getChannelInfo(value);
      expect(mockHttpClient.get.mock.calls.map(([url]) => url)).toEqual([
        `https://api.twitch.tv/helix/streams?user_login=${encodeURIComponent(value)}`,
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(value)}`,
        `https://api.twitch.tv/helix/users?login=${encodeURIComponent(value)}`,
        `https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(value)}`,
      ]);
    });
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

    it("rejects malformed live JSON counts instead of fabricating offline zero", async () => {
      for (const viewer_count of [NaN, Infinity, -Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "12", null, undefined]) {
        mockHttpClient.get.mockResolvedValue({ status: 200, data: { data: [{ viewer_count }] } });
        await expect(apiClient.getStreamInfo("synthetic-channel")).rejects.toThrow("Invalid Twitch viewer count");
      }
    });

    it("accepts live zero and maximum safe integer counts", async () => {
      for (const viewer_count of [0, Number.MAX_SAFE_INTEGER]) {
        mockHttpClient.get.mockResolvedValue({ status: 200, data: { data: [{ viewer_count }] } });
        expect(await apiClient.getStreamInfo("synthetic-channel")).toMatchObject({ isLive: true, viewerCount: viewer_count });
      }
    });

    it("rejects HTTP failures unchanged and malformed stream-list bodies", async () => {
      for (const failure of [new Error("synthetic network failure"), { response: { status: 401 } }, { response: { status: 500 } }]) {
        mockHttpClient.get.mockRejectedValue(failure);
        await expect(apiClient.getStreamInfo("synthetic-channel")).rejects.toBe(failure);
      }
      for (const data of [null, undefined, {}, { data: null }, { data: {} }, { data: "" }]) {
        mockHttpClient.get.mockResolvedValue({ status: 200, data });
        await expect(apiClient.getStreamInfo("synthetic-channel")).rejects.toThrow("Invalid Twitch stream response");
      }
    });

    it("retains actual last-good state through HTTP/auth/body failures until confirmed offline", async () => {
      const provider = new TwitchViewerCountProvider(apiClient, {}, { channel: "synthetic-channel" }, null, noOpLogger);
      const system = ownSystem(new ViewerCountSystem({ platforms: { twitch: provider }, logger: noOpLogger, config: createConfigFixture() }));
      system.streamStatus.twitch = true;
      mockHttpClient.get.mockResolvedValue({ status: 200, data: { data: [{ viewer_count: 12 }] } });
      await system.pollPlatform("twitch");
      const before = system.getViewerCountSnapshot("twitch");
      const updates: unknown[] = [];
      system.addObserver({ getObserverId: () => "synthetic-unavailable-observer", onViewerCountUpdate: value => { updates.push(value); } });
      let errors = 0;
      for (const failure of [new Error("synthetic network failure"), { response: { status: 401 } }, { response: { status: 500 } }]) {
        mockHttpClient.get.mockRejectedValue(failure);
        await system.pollPlatform("twitch");
        expect(system.getViewerCount("twitch")).toBe(12);
        expect(system.getViewerCountSnapshot("twitch")).toEqual(before);
        expect(provider.getErrorStats().consecutiveErrors).toBe(++errors);
      }
      for (const data of [null, {}, { data: null }, { data: {} }]) {
        mockHttpClient.get.mockResolvedValue({ status: 200, data });
        await system.pollPlatform("twitch");
        expect(system.getViewerCount("twitch")).toBe(12);
        expect(system.getViewerCountSnapshot("twitch")).toEqual(before);
        expect(provider.getErrorStats().consecutiveErrors).toBe(++errors);
      }
      secrets.twitch.accessToken = null;
      const requests = mockHttpClient.get.mock.calls.length;
      await system.pollPlatform("twitch");
      expect(mockHttpClient.get.mock.calls).toHaveLength(requests);
      expect(system.getViewerCountSnapshot("twitch")).toEqual(before);
      expect(provider.getErrorStats().consecutiveErrors).toBe(++errors);
      expect(updates).toHaveLength(0);
      secrets.twitch.accessToken = "synthetic-restored-token";
      mockHttpClient.get.mockResolvedValue({ status: 200, data: { data: [] } });
      await system.pollPlatform("twitch");
      expect(system.getViewerCount("twitch")).toBe(0);
      expect(updates).toHaveLength(1);
      expect(provider.getErrorStats().consecutiveErrors).toBe(0);
    });

    it("preserves real Helix measurement when channel configuration becomes blank", async () => {
      const config = { channel: "synthetic-channel" };
      const provider = new TwitchViewerCountProvider(apiClient, {}, config, null, noOpLogger);
      const system = ownSystem(new ViewerCountSystem({ platforms: { twitch: provider }, logger: noOpLogger, config: createConfigFixture() }));
      system.streamStatus.twitch = true;
      mockHttpClient.get.mockResolvedValue({ status: 200, data: { data: [{ viewer_count: 12 }] } });
      await system.pollPlatform("twitch");
      const before = system.getViewerCountSnapshot("twitch");
      const updates: unknown[] = [];
      system.addObserver({ getObserverId: () => "synthetic-blank-helix-observer", onViewerCountUpdate: value => { updates.push(value); } });
      provider._handleProviderError(new Error("prior failure"));
      for (const channel of ["", " \t "]) {
        config.channel = channel;
        expect(await provider.getViewerCount()).toBeNull();
        await system.pollPlatform("twitch");
        expect(system.getViewerCount("twitch")).toBe(12);
        expect(system.getViewerCountSnapshot("twitch")).toEqual(before);
        expect(provider.getErrorStats().consecutiveErrors).toBe(1);
      }
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
      expect(updates).toHaveLength(0);
    });

    it("preserves the last real poll through malformed Helix responses and admits a subsequent live zero", async () => {
      const provider = new TwitchViewerCountProvider(apiClient, {}, { channel: "synthetic-channel" }, null, noOpLogger);
      const system = ownSystem(new ViewerCountSystem({ platforms: { twitch: provider }, logger: noOpLogger, config: createConfigFixture() }));
      system.streamStatus.twitch = true;
      mockHttpClient.get.mockResolvedValue({ status: 200, data: { data: [{ viewer_count: 12 }] } });
      await system.pollPlatform("twitch");
      const before = system.getViewerCountSnapshot("twitch");
      const updates: unknown[] = [];
      system.addObserver({ getObserverId: () => "synthetic-helix-observer", onViewerCountUpdate: value => { updates.push(value); } });
      for (const viewer_count of [NaN, Infinity, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, "12", null, undefined]) {
        mockHttpClient.get.mockResolvedValue({ status: 200, data: { data: [{ viewer_count }] } });
        await system.pollPlatform("twitch");
        expect(system.getViewerCount("twitch")).toBe(12);
        expect(system.getViewerCountSnapshot("twitch")).toEqual(before);
      }
      expect(updates).toHaveLength(0);
      expect(provider.getErrorStats().consecutiveErrors).toBe(8);
      mockHttpClient.get.mockResolvedValue({ status: 200, data: { data: [{ viewer_count: 0 }] } });
      await system.pollPlatform("twitch");
      expect(system.getViewerCount("twitch")).toBe(0);
      expect(updates).toHaveLength(1);
      expect(provider.getErrorStats().consecutiveErrors).toBe(0);
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
    it("recognizes common transport status shapes without refreshing twice", async () => {
      for (const failure of [{ statusCode: "401" }, { status: 401 }, { response: { statusCode: 401 } }]) {
        mockHttpClient.get.mockRejectedValueOnce(failure).mockResolvedValueOnce({ status: 200, data: { data: [] } });
        await expect(apiClient.makeRequest("/users")).resolves.toEqual({ data: [] });
      }
      expect(refreshTokensSpy).toHaveBeenCalledTimes(3);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(6);
    });
    it("rotates protected credentials once and preserves the terminal error", async () => {
      const failure = { response: { status: 401 } };
      mockHttpClient.get.mockRejectedValue(failure);
      authHttpClient.post.mockResolvedValueOnce({
        data: {
          access_token: "synthetic-rotated-token",
          refresh_token: "synthetic-rotated-refresh",
          expires_in: 3600,
        },
      });
      const options = { authToken: "caller", auth: { username: "synthetic-user", password: "synthetic-password" }, headers: { authorization: "caller" } };
      await expect(apiClient.makeRequest("/users", options)).rejects.toBe(failure);
      expect(refreshTokensSpy).toHaveBeenCalledTimes(1);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(2);
      expect(mockHttpClient.get.mock.calls[0]?.[1]?.auth).toBeNull();
      expect(mockHttpClient.get.mock.calls[1]?.[1]).toMatchObject({ auth: null, authToken: "synthetic-rotated-token", disableRetry: true, headers: { Authorization: "Bearer synthetic-rotated-token" } });
      expect(options.auth).toEqual({ username: "synthetic-user", password: "synthetic-password" });
    });

    it("preserves the original 401 when refresh declines", async () => {
      const failure = { response: { status: 401 } };
      mockHttpClient.get.mockRejectedValue(failure);
      refreshTokensSpy.mockResolvedValue(false);
      await expect(apiClient.makeRequest("/users")).rejects.toBe(failure);
      expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
    });
    it("retries request after refreshing token on 401", async () => {
      mockHttpClient.get
        .mockRejectedValueOnce({ response: { status: 401 } })
        .mockResolvedValueOnce({
          status: 200,
          data: { data: [{ id: "test-user-id", login: "testuser" }] },
        });

      secrets.twitch.accessToken = "expired-token";
      authHttpClient.post.mockResolvedValueOnce({
        data: {
          access_token: "refreshed-token",
          refresh_token: "refreshed-refresh-token",
          expires_in: 3600,
        },
      });

      const result = await apiClient.getUserInfo("testuser");

      expect(result).toEqual({ id: "test-user-id", login: "testuser" });
      expect(refreshTokensSpy).toHaveBeenCalledTimes(1);
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
      authHttpClient.post.mockResolvedValueOnce({
        data: {
          access_token: "new-refreshed-token",
          refresh_token: "new-refreshed-refresh-token",
          expires_in: 3600,
        },
      });

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
    it("rejects missing authentication without making an HTTP request", async () => {
      secrets.twitch.accessToken = null;
      await expect(apiClient.getStreamInfo("test-channel")).rejects.toThrow("No access token available for Twitch API");
      expect(mockHttpClient.get).not.toHaveBeenCalled();
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
