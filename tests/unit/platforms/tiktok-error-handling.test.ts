import { vi, describe, test, expect, beforeEach, afterEach } from 'bun:test';

import { noOpLogger } from "../../helpers/mock-factories";
import { createRecordingLogger } from "../../helpers/recording-logger";
import { TikTokPlatform } from "../../../src/platforms/tiktok";

type TikTokConnection = NonNullable<InstanceType<typeof TikTokPlatform>["connection"]>;
type MockConnection = TikTokConnection & {
  fetchIsLive: ReturnType<typeof vi.fn<(...args: []) => Promise<boolean>>>;
  waitUntilLive: ReturnType<typeof vi.fn<(...args: []) => Promise<void>>>;
  getState: ReturnType<typeof vi.fn<(...args: []) => { isConnected: boolean }>>;
};

describe("TikTokPlatform Error Handling", () => {
  let mockConnection: MockConnection;
  let mockRetrySystem: {
    handleConnectionError: (err: unknown) => void;
    handleConnectionSuccess: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
    resetRetryCount: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
    incrementRetryCount: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
    executeWithRetry: ReturnType<typeof vi.fn<(...args: unknown[]) => unknown>>;
    _calls: { handleConnectionError: unknown[] };
  };
  let baseConfig: {
    enabled: boolean;
    username: string;
    dataLoggingEnabled: boolean;
  };
  let baseDependencies: Record<string, unknown>;

  beforeEach(() => {

    mockConnection = {
      connect: vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined),
      disconnect: vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined),
      fetchIsLive: vi.fn<(...args: []) => Promise<boolean>>().mockResolvedValue(false),
      waitUntilLive: vi.fn<(...args: []) => Promise<void>>().mockResolvedValue(undefined),
      on: vi.fn<(...args: [string, (payload: unknown) => void | Promise<void>]) => void>(),
      getState: vi.fn<(...args: []) => { isConnected: boolean }>().mockReturnValue({
        isConnected: false,
      }),
    };

    const retrySystemCalls: { handleConnectionError: unknown[] } = { handleConnectionError: [] };
    mockRetrySystem = {
      handleConnectionError: (err: unknown) =>
        retrySystemCalls.handleConnectionError.push(err),
      handleConnectionSuccess: vi.fn<(...args: unknown[]) => unknown>(),
      resetRetryCount: vi.fn<(...args: unknown[]) => unknown>(),
      incrementRetryCount: vi.fn<(...args: unknown[]) => unknown>(),
      executeWithRetry: vi.fn<(...args: unknown[]) => unknown>(),
      _calls: retrySystemCalls,
    };

    baseConfig = {
      enabled: true,
      username: "testUser",
      dataLoggingEnabled: false,
    };

    baseDependencies = {
      logger: noOpLogger,
      retrySystem: mockRetrySystem,
      TikTokWebSocketClient: vi.fn(() => mockConnection),
    };
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("rejects invalid events without exposing provider identities or content", async () => {
    const logger = createRecordingLogger();
    const platform = new TikTokPlatform(baseConfig, { ...baseDependencies, logger });
    const emitted: unknown[] = [];
    platform.on("platform:event", (event) => emitted.push(event));
    try {
      await platform.handleTikTokGift("synthetic-private-gift");
      await platform.handleTikTokSocial("synthetic-private-social");
      await platform.handleTikTokShare("synthetic-private-share");
      const invalidIdentity = { user: { nickname: "synthetic-private-viewer" }, comment: "synthetic-private-content" };
      await platform.handleTikTokFollow(invalidIdentity);
      await platform.handleTikTokSocial(invalidIdentity);
      await platform.handleTikTokShare(invalidIdentity);
      expect(emitted).toEqual([]);
      expect(logger.entries.filter(entry => entry.level === "warn")).toHaveLength(3);
      expect(logger.entries.filter(entry => entry.level === "error")).toHaveLength(3);
      expect(JSON.stringify(logger.entries)).not.toContain("synthetic-private");
      expect(logger.entries.every(entry => entry.data && typeof entry.data === "object")).toBe(true);
    } finally {
      await platform.cleanup();
    }
  });

  describe("logger contract", () => {
    test("constructs with default app logger without losing warn method", () => {
      const dependenciesWithoutLogger = { ...baseDependencies };
      delete dependenciesWithoutLogger.logger;

      expect(() => {
        new TikTokPlatform(baseConfig, dependenciesWithoutLogger);
      }).not.toThrow();
    });

    test("rejects injected logger missing error method", () => {
      const incompleteLogger = {
        debug: () => {},
        info: () => {},
        warn: () => {},
      };

      expect(() => {
        new TikTokPlatform(baseConfig, {
          ...baseDependencies,
          logger: incompleteLogger,
        });
      }).toThrow(/TikTok logger is missing required methods: error\(\)/);
    });
  });

  describe("handleConnectionError", () => {
    test("handles error object without message property without crashing", () => {
      const platform = new TikTokPlatform(baseConfig, baseDependencies);
      const errorWithoutMessage = {};

      expect(() => {
        platform.handleConnectionError(errorWithoutMessage);
      }).not.toThrow();
    });

    test("handles null error gracefully", () => {
      const platform = new TikTokPlatform(baseConfig, baseDependencies);

      expect(() => {
        platform.handleConnectionError(null);
      }).not.toThrow();
    });

    test("handles string error properly", () => {
      const platform = new TikTokPlatform(baseConfig, baseDependencies);
      const stringError = "Connection timeout";

      expect(() => {
        platform.handleConnectionError(stringError);
      }).not.toThrow();
    });

    test("handles TLS errors without crashing", () => {
      const platform = new TikTokPlatform(baseConfig, baseDependencies);
      const tlsError = new Error(
        "Client network socket disconnected before secure TLS connection was established",
      );

      expect(() => {
        platform.handleConnectionError(tlsError);
      }).not.toThrow();
    });

    test("handles room info retrieval failures without crashing", () => {
      const platform = new TikTokPlatform(baseConfig, baseDependencies);
      const roomError = new Error("Failed to retrieve room info");

      expect(() => {
        platform.handleConnectionError(roomError);
      }).not.toThrow();
    });

    test("handles timeout errors without crashing", () => {
      const platform = new TikTokPlatform(baseConfig, baseDependencies);
      const timeoutError = new Error("Connection timeout exceeded");

      expect(() => {
        platform.handleConnectionError(timeoutError);
      }).not.toThrow();
    });

    test("cleans up connection state after error", () => {
      const platform = new TikTokPlatform(baseConfig, baseDependencies);
      platform.connection = mockConnection;
      platform.connectionActive = true;
      platform.listenersConfigured = true;

      platform.handleConnectionError(new Error("Test error"));

      expect(platform.connection).toBeNull();
      expect(platform.connectionActive).toBe(false);
      expect(platform.listenersConfigured).toBe(false);
    });

    test("triggers retry system on error", () => {
      const platform = new TikTokPlatform(baseConfig, baseDependencies);

      platform.handleConnectionError(new Error("Test error"));

      expect(
        mockRetrySystem._calls.handleConnectionError.length,
      ).toBeGreaterThan(0);
    });
  });

  describe("stream not live detection", () => {
    test("handles stream not live error without crashing", () => {
      const platform = new TikTokPlatform(baseConfig, baseDependencies);
      const notLiveError = new Error("Stream is not live");

      expect(() => {
        platform.handleConnectionError(notLiveError);
      }).not.toThrow();
    });
  });
});
