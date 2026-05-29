import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { setupAutomatedCleanup } from "../helpers/mock-lifecycle";
import { noOpLogger } from "../helpers/mock-factories";
import {
  initializeStaticSecrets,
  secrets,
  _resetForTesting,
} from "../../src/core/secrets";
setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true,
});

import {
  ConnectionState,
  ConnectionStateFactory,
} from "../../src/utils/platform-connection-state";
import { TwitchApiClient } from "../../src/utils/api-clients/twitch-api-client.ts";
import { TwitchViewerCountProvider } from "../../src/utils/viewer-count-providers";

type TwitchConfig = { clientId?: string; channel?: string; username?: string; enabled?: boolean; eventSub?: { isActive: () => boolean } };
type TwitchAuth = { refreshTokens: () => Promise<boolean> };
type HttpGetMock = ReturnType<typeof createMockFn> &
  ((url: string, options?: Record<string, unknown>) => Promise<Record<string, unknown>>);
type HttpClient = { get: HttpGetMock };
type EventSubLike = { isActive: () => boolean; initialize: () => Promise<void> };
type LocalTwitchPlatformDependencies = {
  twitchAuth: TwitchAuth;
  TwitchEventSub: new () => EventSubLike;
  enhancedHttpClient: HttpClient;
};
type StreamInfo = { isLive: boolean; viewerCount: number; stream: unknown };
type MockedTwitchApiClient = TwitchApiClient & { getStreamInfo: ReturnType<typeof createMockFn> };

const createHttpClient = (): HttpClient => ({
  get: createMockFn() as HttpGetMock,
});

class TwitchPlatform {
  config: TwitchConfig;
  twitchAuth: TwitchAuth;
  eventSub: EventSubLike;
  enhancedHttpClient: HttpClient;
  apiClient: TwitchApiClient | null;
  viewerCountProvider: TwitchViewerCountProvider | null;
  logger = noOpLogger;

  constructor(config: TwitchConfig, dependencies: LocalTwitchPlatformDependencies) {
    this.config = config;
    this.twitchAuth = dependencies.twitchAuth;
    this.eventSub = new dependencies.TwitchEventSub();
    this.enhancedHttpClient = dependencies.enhancedHttpClient;
    this.apiClient = null;
    this.viewerCountProvider = null;
  }

  async initialize(_handlers: Record<string, unknown>) {
    this.apiClient = new TwitchApiClient(
      this.twitchAuth,
      this.config.clientId ? { clientId: this.config.clientId } : {},
      this.logger,
      {
        enhancedHttpClient: this.enhancedHttpClient,
      },
    );
    this.viewerCountProvider = new TwitchViewerCountProvider(
      this.apiClient,
      ConnectionStateFactory,
      this.config,
      null,
      this.logger,
    );
    if (this.eventSub.initialize) {
      await this.eventSub.initialize();
    }
  }

  getConnectionState() {
    return ConnectionStateFactory.createTwitchState(this.config, this.eventSub);
  }

  async getViewerCount() {
    if (!this.viewerCountProvider) {
      return 0;
    }
    return await this.viewerCountProvider.getViewerCount();
  }
}

describe("TwitchPlatform Modular Refactor", () => {
  afterEach(() => {
    restoreAllMocks();
    _resetForTesting();
    initializeStaticSecrets();
  });

  describe("ConnectionState Module", () => {
    describe("when creating connection state", () => {
      it("should provide consistent interface across platforms", () => {
        const params = {
          isConnected: true,
          platform: "twitch",
          channel: "test_channel",
          username: "test_user",
        };

        const state = new ConnectionState(params);

        expect(state.isConnected).toBe(true);
        expect(state.platform).toBe("twitch");
        expect(state.channel).toBe("test_channel");
        expect(state.username).toBe("test_user");
        expect(state.isApiReady()).toBe(true);
      });

      it("should identify when not ready for API calls", () => {
        const params = {
          isConnected: false,
          platform: "twitch",
          channel: "",
          username: "test_user",
        };

        const state = new ConnectionState(params);

        expect(state.isApiReady()).toBe(false);
      });
    });

    describe("when using ConnectionStateFactory", () => {
      it("should create Twitch state correctly", () => {
        const config = { channel: "test_channel", username: "test_user" };
        const mockEventSub = { isActive: () => true };

        const state = ConnectionStateFactory.createTwitchState(
          config,
          mockEventSub,
        );

        expect(state.isConnected).toBe(true);
        expect(state.platform).toBe("twitch");
        expect(state.channel).toBe("test_channel");
        expect(state.username).toBe("test_user");
      });

      it("should handle disconnected EventSub", () => {
        const config = { channel: "test_channel", username: "test_user" };
        const mockEventSub = { isActive: () => false };

        const state = ConnectionStateFactory.createTwitchState(
          config,
          mockEventSub,
        );

        expect(state.isConnected).toBe(false);
        expect(state.isApiReady()).toBe(false);
      });

      it("should treat missing EventSub dependency as disconnected", () => {
        const config = { channel: "test_channel", username: "test_user" };

        const state = ConnectionStateFactory.createTwitchState(config, null);

        expect(state.isConnected).toBe(false);
        expect(state.platform).toBe("twitch");
      });

      it("should create YouTube and TikTok states with consistent platform metadata", () => {
        const config = { username: "test_user" };

        const youtubeState = ConnectionStateFactory.createYouTubeState(config, {
          stream1: {},
        });
        const tikTokState = ConnectionStateFactory.createTikTokState(config, {
          connected: true,
        });

        expect(youtubeState.isConnected).toBe(true);
        expect(youtubeState.platform).toBe("youtube");
        expect(youtubeState.channel).toBe("test_user");
        expect(tikTokState.isConnected).toBe(true);
        expect(tikTokState.platform).toBe("tiktok");
        expect(tikTokState.channel).toBe("test_user");
      });
    });
  });

  describe("TwitchApiClient Module", () => {
    let mockTwitchAuth: TwitchAuth;
    let mockHttpClient: HttpClient;
    let mockLogger: typeof noOpLogger;
    let apiClient: TwitchApiClient;

    beforeEach(() => {
      _resetForTesting();
      initializeStaticSecrets();
      secrets.twitch.accessToken = "test_token";
      mockLogger = noOpLogger;
      mockTwitchAuth = {
        refreshTokens: createMockFn().mockResolvedValue(true),
      };
      mockHttpClient = createHttpClient();
      apiClient = new TwitchApiClient(
        mockTwitchAuth,
        { clientId: "test_client_id" },
        mockLogger,
        { enhancedHttpClient: mockHttpClient },
      );
    });

    describe("when making API requests", () => {
      it("requests Twitch API using configured authentication headers", async () => {
        const mockAxiosResponse = {
          data: { data: [] },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {},
        };
        mockHttpClient.get.mockResolvedValue(mockAxiosResponse);

        await apiClient.makeRequest("/test");

        expect(mockHttpClient.get).toHaveBeenCalledTimes(1);
        const getCall = mockHttpClient.get.mock.calls[0];
        if (!getCall) {
          throw new Error("Expected Twitch API request to be recorded");
        }
        const [requestUrl, requestConfig] = getCall;
        expect(requestUrl).toBe("https://api.twitch.tv/helix/test");
        expect(requestConfig).toEqual(
          expect.objectContaining({
            authToken: "test_token",
            authType: "app",
            clientId: "test_client_id",
          }),
        );
      });

      it("should handle API errors gracefully", async () => {
        const error = new Error("Request failed with status code 401") as Error & {
          response?: { status: number; statusText: string };
        };
        error.response = {
          status: 401,
          statusText: "Unauthorized",
        };
        mockHttpClient.get.mockRejectedValue(error);

        await expect(apiClient.makeRequest("/test")).rejects.toThrow(
          "Request failed with status code 401",
        );
      });
    });

    describe("when getting stream info", () => {
      it("should return correct stream data for live stream", async () => {
        const mockAxiosResponse = {
          data: {
            data: [
              {
                viewer_count: 42,
                user_name: "test_channel",
              },
            ],
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {},
        };
        mockHttpClient.get.mockResolvedValue(mockAxiosResponse);

        const result = await apiClient.getStreamInfo("test_channel");

        expect(result.isLive).toBe(true);
        expect(result.viewerCount).toBe(42);
        expect(result.stream).toEqual(
          expect.objectContaining({
            viewer_count: 42,
            user_name: "test_channel",
          }),
        );
      });

      it("should return offline status for no stream data", async () => {
        const mockAxiosResponse = {
          data: { data: [] },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {},
        };
        mockHttpClient.get.mockResolvedValue(mockAxiosResponse);

        const result = await apiClient.getStreamInfo("test_channel");

        expect(result.isLive).toBe(false);
        expect(result.viewerCount).toBe(0);
        expect(result.stream).toBe(null);
      });
    });
  });

  describe("TwitchViewerCountProvider Module", () => {
    let mockApiClient: MockedTwitchApiClient;
    let configFixture: TwitchConfig;
    let mockLogger: typeof noOpLogger;
    let provider: TwitchViewerCountProvider;

    beforeEach(() => {
      mockLogger = noOpLogger;
      const apiClientFixture = new TwitchApiClient(
        { refreshTokens: createMockFn().mockResolvedValue(true) },
        { clientId: "test_client_id" },
        noOpLogger,
        { enhancedHttpClient: createHttpClient() },
      );
      const getStreamInfo = createMockFn();
      mockApiClient = Object.assign(apiClientFixture, { getStreamInfo });
      configFixture = {
        channel: "test_channel",
        eventSub: { isActive: () => true },
      };
      provider = new TwitchViewerCountProvider(
        mockApiClient,
        ConnectionStateFactory,
        configFixture,
        null,
        mockLogger,
      );
    });

    describe("when provider is ready", () => {
      it("returns the configured channel viewer count when ready", async () => {
        mockApiClient.getStreamInfo.mockImplementation(async (channel: unknown): Promise<StreamInfo> => ({
          isLive: true,
          viewerCount: channel === "test_channel" ? 123 : 0,
          stream: null,
        }));

        const count = await provider.getViewerCount();

        expect(count).toBe(123);
      });

      it("should return 0 for offline stream", async () => {
        mockApiClient.getStreamInfo.mockResolvedValue({
          isLive: false,
          viewerCount: 0,
        });

        const count = await provider.getViewerCount();

        expect(count).toBe(0);
      });
    });

    describe("when provider is not ready", () => {
      beforeEach(() => {
        const notReadyConfig = { ...configFixture, channel: "" };
        provider = new TwitchViewerCountProvider(
          mockApiClient,
          ConnectionStateFactory,
          notReadyConfig,
          null,
          mockLogger,
        );
      });

      it("should return 0 without making API call", async () => {
        const count = await provider.getViewerCount();

        expect(count).toBe(0);
        expect(mockApiClient.getStreamInfo).not.toHaveBeenCalled();
      });
    });

    describe("when API call fails", () => {
      it("should return 0 and handle error gracefully", async () => {
        mockApiClient.getStreamInfo.mockRejectedValue(new Error("API Error"));

        const count = await provider.getViewerCount();

        expect(count).toBe(0);
      });
    });
  });

  describe("TwitchPlatform Integration", () => {
    let mockTwitchAuth: TwitchAuth;
    let mockEventSub: EventSubLike;
    let mockHttpClient: HttpClient;
    let twitchPlatform: TwitchPlatform;

    beforeEach(() => {
      _resetForTesting();
      initializeStaticSecrets();
      secrets.twitch.accessToken = "test_token";
      mockTwitchAuth = {
        refreshTokens: createMockFn().mockResolvedValue(true),
      };

      mockEventSub = {
        isActive: () => true,
        initialize: createMockFn().mockResolvedValue(),
      };
      mockHttpClient = createHttpClient();

      const config = {
        enabled: true,
        channel: "test_channel",
        username: "test_user",
      };

      class MockTwitchEventSub implements EventSubLike {
        isActive = mockEventSub.isActive;
        initialize = async (): Promise<void> => { await mockEventSub.initialize?.(); };
      }

      twitchPlatform = new TwitchPlatform(config, {
        twitchAuth: mockTwitchAuth,
        enhancedHttpClient: mockHttpClient,
        TwitchEventSub: MockTwitchEventSub,
      });
    });

    describe("when platform initializes", () => {
      it("should create all modular components", async () => {
        await twitchPlatform.initialize({});

        expect(twitchPlatform.apiClient).toBeDefined();
        expect(twitchPlatform.viewerCountProvider).toBeDefined();
        expect(twitchPlatform.eventSub).toBeDefined();
      });
    });

    describe("when getting connection state", () => {
      beforeEach(async () => {
        await twitchPlatform.initialize({});
      });

      it("returns Twitch connection metadata from platform state", () => {
        const state = twitchPlatform.getConnectionState();

        expect(state).toHaveProperty("isConnected", true);
        expect(state).toHaveProperty("platform", "twitch");
        expect(state).toHaveProperty("channel", "test_channel");
        expect(state).toHaveProperty("username", "test_user");
      });
    });

    describe("when getting viewer count", () => {
      beforeEach(async () => {
        await twitchPlatform.initialize({});

        mockHttpClient.get.mockResolvedValue({
          data: {
            data: [{ viewer_count: 456 }],
          },
          status: 200,
          statusText: "OK",
          headers: {},
          config: {},
        });
      });

      it("returns viewer count data from the active Twitch stream", async () => {
        const count = await twitchPlatform.getViewerCount();

        expect(count).toBe(456);
      });

      it("should return 0 when provider not initialized", async () => {
        twitchPlatform.viewerCountProvider = null;

        const count = await twitchPlatform.getViewerCount();

        expect(count).toBe(0);
      });
    });
  });

describe("connection state interface consistency", () => {
    it("should reuse connection state logic across platforms", () => {
      const config = { channel: "test", username: "test" };

      const twitchState = ConnectionStateFactory.createTwitchState(config, {
        isActive: () => true,
      });
      const youtubeState = ConnectionStateFactory.createYouTubeState(config, {
        stream1: {},
      });

      expect(twitchState).toHaveProperty("isConnected");
      expect(twitchState).toHaveProperty("platform");
      expect(youtubeState).toHaveProperty("isConnected");
      expect(youtubeState).toHaveProperty("platform");
      expect(typeof twitchState.isApiReady).toBe("function");
      expect(typeof youtubeState.isApiReady).toBe("function");
    });

    it("should provide consistent viewer count interface", () => {
      const mockApiClient = new TwitchApiClient(
        { refreshTokens: createMockFn().mockResolvedValue(true) },
        { clientId: "test_client_id" },
        noOpLogger,
        { enhancedHttpClient: createHttpClient() },
      );
      const config = { channel: "test", eventSub: { isActive: () => true } };

      const provider = new TwitchViewerCountProvider(
        mockApiClient,
        ConnectionStateFactory,
        config,
        null,
        noOpLogger,
      );

      expect(typeof provider.getViewerCount).toBe("function");
      expect(typeof provider.isReady).toBe("function");
      expect(provider.platform).toBe("twitch");
    });
  });
});
