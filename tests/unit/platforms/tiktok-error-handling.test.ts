import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { TikTokPlatform } from "../../../src/platforms/tiktok";

type TikTokConnection = NonNullable<InstanceType<typeof TikTokPlatform>["connection"]>;
type TikTokDependencies = NonNullable<ConstructorParameters<typeof TikTokPlatform>[1]>;
type TikTokWebcastEvent = NonNullable<TikTokDependencies["WebcastEvent"]>;
type MockConnection = TikTokConnection & {
  fetchIsLive: ReturnType<typeof createMockFn<[], Promise<boolean>>>;
  waitUntilLive: ReturnType<typeof createMockFn<[], Promise<void>>>;
  getState: ReturnType<typeof createMockFn<[], { isConnected: boolean }>>;
};

const WEBCAST_EVENT = {
  CHAT: "chat",
  GIFT: "gift",
  FOLLOW: "follow",
  SOCIAL: "social",
  ROOM_USER: "roomUser",
  ERROR: "error",
  DISCONNECT: "disconnect",
} satisfies TikTokWebcastEvent;

describe("TikTokPlatform Error Handling", () => {
  let mockConnection: MockConnection;
  let mockRetrySystem: {
    handleConnectionError: (err: unknown) => void;
    handleConnectionSuccess: ReturnType<typeof createMockFn>;
    resetRetryCount: ReturnType<typeof createMockFn>;
    incrementRetryCount: ReturnType<typeof createMockFn>;
    executeWithRetry: ReturnType<typeof createMockFn>;
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
      connect: createMockFn<[], Promise<unknown>>().mockResolvedValue(undefined),
      disconnect: createMockFn<[], Promise<unknown>>().mockResolvedValue(undefined),
      fetchIsLive: createMockFn<[], Promise<boolean>>().mockResolvedValue(false),
      waitUntilLive: createMockFn<[], Promise<void>>().mockResolvedValue(undefined),
      on: createMockFn<[string, (payload: unknown) => void | Promise<void>], void>(),
      getState: createMockFn<[], { isConnected: boolean }>().mockReturnValue({
        isConnected: false,
      }),
    };

    const retrySystemCalls: { handleConnectionError: unknown[] } = { handleConnectionError: [] };
    mockRetrySystem = {
      handleConnectionError: (err: unknown) =>
        retrySystemCalls.handleConnectionError.push(err),
      handleConnectionSuccess: createMockFn(),
      resetRetryCount: createMockFn(),
      incrementRetryCount: createMockFn(),
      executeWithRetry: createMockFn(),
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
      WebcastEvent: WEBCAST_EVENT,
      ControlEvent: {},
      TikTokWebSocketClient: createMockFn(() => mockConnection),
    };
  });

  afterEach(() => {
    restoreAllMocks();
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
