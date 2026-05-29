import { describe, it, expect, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";
import { noOpLogger } from "../../../../helpers/mock-factories";
import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";

type UnknownRecord = Record<string, unknown>;
type TestConnection = {
  isConnecting?: boolean;
  isConnected?: boolean;
  connectionId?: string;
  connect: () => Promise<unknown>;
  disconnect: () => Promise<unknown>;
  on: (eventName: string, handler: (payload: unknown) => void) => void;
};
type StatsConfig = {
  username?: string;
  viewerCountEnabled?: boolean;
  greetingsEnabled?: boolean;
};
type WebcastEventMap = {
  CHAT: string;
  GIFT: string;
  FOLLOW: string;
  SOCIAL: string;
  ROOM_USER: string;
  ERROR: string;
  DISCONNECT: string;
};
type DependencyOverrides = {
  logger?: unknown;
  notificationManager?: unknown;
  connectionFactory?: { createConnection: (...args: unknown[]) => unknown };
  TikTokWebSocketClient?: unknown;
  WebcastEvent?: Partial<WebcastEventMap>;
  ControlEvent?: Record<string, string>;
};

const createTestConnection = (
  overrides: Partial<TestConnection> = {},
): TestConnection => ({
  connect: createMockFn().mockResolvedValue(true),
  disconnect: createMockFn().mockResolvedValue(true),
  on: createMockFn(),
  ...overrides,
});

const requireStatsConfig = (value: unknown): StatsConfig => {
  if (!value || typeof value !== "object") {
    throw new Error("Expected stats.config to be an object");
  }
  return value;
};

const createPlatform = (
  configOverrides: UnknownRecord = {},
  dependencyOverrides: DependencyOverrides = {},
) => {
  const logger = dependencyOverrides.logger || noOpLogger;
  const notificationManager = dependencyOverrides.notificationManager || {
    emit: createMockFn(),
    on: createMockFn(),
    removeListener: createMockFn(),
    handleNotification: createMockFn().mockResolvedValue(),
  };
  const connectionFactory = dependencyOverrides.connectionFactory || {
    createConnection: createMockFn().mockReturnValue({
      on: createMockFn(),
      emit: createMockFn(),
      removeAllListeners: createMockFn(),
      connect: createMockFn().mockResolvedValue(true),
      disconnect: createMockFn().mockResolvedValue(true),
    }),
  };

  const TikTokWebSocketClient =
    dependencyOverrides.TikTokWebSocketClient ||
    createMockFn().mockImplementation(() => ({
      on: createMockFn(),
      off: createMockFn(),
      connect: createMockFn().mockResolvedValue(true),
      disconnect: createMockFn().mockResolvedValue(true),
      getState: createMockFn().mockReturnValue("DISCONNECTED"),
      isConnecting: false,
      isConnected: false,
    }));

  const WebcastEvent: WebcastEventMap = {
    CHAT: "chat",
    GIFT: "gift",
    FOLLOW: "follow",
    SOCIAL: "social",
    ROOM_USER: "roomUser",
    ERROR: "error",
    DISCONNECT: "disconnect",
    ...dependencyOverrides.WebcastEvent,
  };
  const ControlEvent = dependencyOverrides.ControlEvent || {};
  const {
    WebcastEvent: _webcastEventOverride,
    ControlEvent: _controlEventOverride,
    ...remainingDependencyOverrides
  } = dependencyOverrides;

  const config = {
    enabled: true,
    username: "testUser",
    ...configOverrides,
  };

  return new TikTokPlatform(config, {
    logger,
    notificationManager,
    TikTokWebSocketClient,
      WebcastEvent,
    ControlEvent,
    connectionFactory,
    ...remainingDependencyOverrides,
  });
};

describe("TikTokPlatform connection state", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  describe("checkConnectionPrerequisites", () => {
    it("returns canConnect=false when platform disabled", () => {
      const platform = createPlatform({ enabled: false, username: "testUser" });

      const result = platform.checkConnectionPrerequisites();

      expect(result.canConnect).toBe(false);
      expect(result.reasons).toContain("Platform disabled in configuration");
      expect(result.reason).toBe("Platform disabled in configuration");
    });

    it("returns canConnect=false when connection.isConnecting is true", () => {
      const platform = createPlatform();
      platform.connection = createTestConnection({ isConnecting: true, isConnected: false });

      const result = platform.checkConnectionPrerequisites();

      expect(result.canConnect).toBe(false);
      expect(result.reasons).toContain("Already connecting");
    });

    it("returns canConnect=false when connection.isConnected is true", () => {
      const platform = createPlatform();
      platform.connection = createTestConnection({ isConnecting: false, isConnected: true });

      const result = platform.checkConnectionPrerequisites();

      expect(result.canConnect).toBe(false);
      expect(result.reasons).toContain("Already connected");
    });

    it("returns canConnect=true when all prerequisites met", () => {
      const platform = createPlatform({ enabled: true, username: "testUser" });
      platform.connection = null;

      const result = platform.checkConnectionPrerequisites();

      expect(result.canConnect).toBe(true);
      expect(result.reasons).toEqual([]);
      expect(result.reason).toBeUndefined();
    });
  });

  describe("connectionStatus getter", () => {
    it("returns false when connection is null", () => {
      const platform = createPlatform();
      platform.connection = null;

      expect(platform.connectionStatus).toBe(false);
    });

    it("returns true when connection.isConnected is true", () => {
      const platform = createPlatform();
      platform.connection = createTestConnection({ isConnected: true });

      expect(platform.connectionStatus).toBe(true);
    });

    it("returns false when connection.isConnected is false", () => {
      const platform = createPlatform();
      platform.connection = createTestConnection({ isConnected: false });

      expect(platform.connectionStatus).toBe(false);
    });
  });

  describe("isConnecting getter", () => {
    it("returns false when connection is null", () => {
      const platform = createPlatform();
      platform.connection = null;

      expect(platform.isConnecting).toBe(false);
    });

    it("returns true when connection.isConnecting is true", () => {
      const platform = createPlatform();
      platform.connection = createTestConnection({ isConnecting: true });

      expect(platform.isConnecting).toBe(true);
    });

    it("returns false when connection.isConnecting is false", () => {
      const platform = createPlatform();
      platform.connection = createTestConnection({ isConnecting: false });

      expect(platform.isConnecting).toBe(false);
    });
  });

  describe("getConnectionState", () => {
    it("returns isConnected/isConnecting from connection when present", () => {
      const platform = createPlatform();
      platform.connection = createTestConnection({
        isConnected: true,
        isConnecting: false,
        connectionId: "test-conn-123",
      });
      platform.connectionTime = 1704067200000;

      const state = platform.getConnectionState();

      expect(state.isConnected).toBe(true);
      expect(state.isConnecting).toBe(false);
      expect(state.hasConnection).toBe(true);
      expect(state.connectionId).toBe("test-conn-123");
      expect(state.connectionTime).toBe(1704067200000);
    });

    it("returns hasConnection=false when connection is null", () => {
      const platform = createPlatform();
      platform.connection = null;

      const state = platform.getConnectionState();

      expect(state.hasConnection).toBe(false);
      expect(state.isConnected).toBe(false);
      expect(state.isConnecting).toBe(false);
      expect(state.connectionId).toBe("N/A");
    });
  });

  describe("getStats", () => {
    it("returns platform, enabled, connected state", () => {
      const platform = createPlatform({ enabled: true, username: "testUser" });
      platform.connection = createTestConnection({ isConnected: true, isConnecting: false });

      const stats = platform.getStats();

      expect(stats.platform).toBe("tiktok");
      expect(stats.enabled).toBe(true);
      expect(stats.connected).toBe(true);
      expect(stats.connecting).toBe(false);
    });

    it("returns config subset with username, viewerCountEnabled, greetingsEnabled", () => {
      const platform = createPlatform({
        enabled: true,
        username: "testStreamer",
        viewerCountEnabled: true,
        greetingsEnabled: false,
      });

      const stats = platform.getStats();

      const statsConfig = requireStatsConfig(stats.config);
      expect(statsConfig.username).toBe("testStreamer");
      expect(statsConfig.viewerCountEnabled).toBe(true);
      expect(statsConfig.greetingsEnabled).toBe(false);
    });
  });

  describe("getStatus", () => {
    it("returns isReady=true when enabled and connected", () => {
      const platform = createPlatform({
        enabled: true,
        username: "testStreamer",
      });
      platform.connection = createTestConnection({
        isConnected: true,
        isConnecting: false,
        connectionId: "conn-456",
      });

      const status = platform.getStatus();

      expect(status.isReady).toBe(true);
      expect(status.issues).toEqual([]);
    });

    it("returns isReady=false with issues when not connected", () => {
      const platform = createPlatform({ enabled: true, username: "testUser" });
      platform.connection = null;

      const status = platform.getStatus();

      expect(status.isReady).toBe(false);
      expect(status.issues).toContain("Not connected");
    });
  });

  describe("isConfigured", () => {
    it("returns true when enabled and username set", () => {
      const platform = createPlatform({ enabled: true, username: "testUser" });

      expect(platform.isConfigured()).toBe(true);
    });

    it("returns false when disabled", () => {
      const platform = createPlatform({ enabled: false, username: "testUser" });

      expect(platform.isConfigured()).toBe(false);
    });

    it("returns false when username missing", () => {
      const platform = createPlatform({ enabled: true, username: "" });

      expect(platform.isConfigured()).toBe(false);
    });
  });

  describe("validateConfig", () => {
    it("delegates to getStatus for standardized interface", () => {
      const platform = createPlatform({ enabled: true, username: "testUser" });
      platform.connection = createTestConnection({ isConnected: true });

      const result = platform.validateConfig();

      expect(result.isReady).toBe(true);
      expect(result.issues).toEqual([]);
    });

    it("returns issues for runtime state problems", () => {
      const platform = createPlatform({ enabled: true, username: "testUser" });
      platform.connection = null;

      const result = platform.validateConfig();

      expect(result.isReady).toBe(false);
      expect(result.issues).toContain("Not connected");
    });
  });
});
