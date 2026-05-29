import { describe, it, expect, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";
import { TikTokPlatform } from "../../src/platforms/tiktok.ts";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";

type TikTokTestConfig = {
  enabled: boolean;
  username: string;
} & Record<string, unknown>;

type TikTokTestConnection = {
  on: (eventName: string, handler: (payload: unknown) => void | Promise<void>) => void;
  emit: (eventName: string, payload?: unknown) => boolean;
  removeAllListeners: (eventName?: string) => void;
  connect: () => Promise<unknown>;
  disconnect: () => Promise<unknown>;
};

type TikTokTestDependencies = {
  logger: typeof noOpLogger;
  notificationManager: {
    emit: (eventName: string, payload?: unknown) => boolean;
    on: (eventName: string, handler: (payload: unknown) => void) => void;
    removeListener: (eventName: string, handler: (payload: unknown) => void) => void;
    handleNotification: () => Promise<unknown>;
  };
  connectionFactory: {
    createConnection: (
      platform: string,
      config: unknown,
      dependencies: unknown,
    ) => TikTokTestConnection;
  };
  TikTokWebSocketClient: unknown;
  WebcastEvent: {
    CHAT: string;
    GIFT: string;
    FOLLOW: string;
    SOCIAL: string;
    ROOM_USER: string;
    ERROR: string;
    DISCONNECT: string;
  };
  ControlEvent: Record<string, string>;
  retrySystem?: {
    isConnected?: (platform: string) => boolean | undefined;
    resetRetryCount: (platform: string) => void;
    handleConnectionError: (
      platform: string,
      error: unknown,
      reconnect: () => Promise<void>,
      cleanup: () => Promise<void>,
    ) => void;
  };
};

type PlatformEvent = {
  type: string;
  data: {
    willReconnect?: boolean;
  };
};

const createPlatform = (
  configOverrides: Partial<TikTokTestConfig> = {},
  dependencyOverrides: Partial<TikTokTestDependencies> = {},
) => {
  const logger = dependencyOverrides.logger || noOpLogger;
  const notificationManager = dependencyOverrides.notificationManager || {
    emit: createMockFn<[string, unknown?], boolean>().mockReturnValue(true),
    on: createMockFn<[string, (payload: unknown) => void], void>(),
    removeListener: createMockFn<[string, (payload: unknown) => void], void>(),
    handleNotification: createMockFn<[], Promise<unknown>>().mockResolvedValue(undefined),
  };
  const connectionFactory = dependencyOverrides.connectionFactory || {
    createConnection: createMockFn<
      [string, unknown, unknown],
      TikTokTestConnection
    >().mockReturnValue({
      on: createMockFn<[
        string,
        (payload: unknown) => void | Promise<void>,
      ], void>(),
      emit: createMockFn<[string, unknown?], boolean>().mockReturnValue(true),
      removeAllListeners: createMockFn<[string?], void>(),
      connect: createMockFn<[], Promise<unknown>>().mockResolvedValue(undefined),
      disconnect: createMockFn<[], Promise<unknown>>().mockResolvedValue(undefined),
    }),
  };

  const TikTokWebSocketClient =
    dependencyOverrides.TikTokWebSocketClient ||
    createMockFn().mockImplementation(() => ({
      on: createMockFn(),
      off: createMockFn(),
      connect: createMockFn(),
      disconnect: createMockFn(),
      getState: createMockFn().mockReturnValue("DISCONNECTED"),
      isConnecting: false,
      isConnected: false,
    }));

  const WebcastEvent = dependencyOverrides.WebcastEvent || {
    CHAT: "chat",
    GIFT: "gift",
    FOLLOW: "follow",
    SOCIAL: "social",
    ROOM_USER: "roomUser",
    ERROR: "error",
    DISCONNECT: "disconnect",
  };
  const ControlEvent = dependencyOverrides.ControlEvent || {};

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
    ...dependencyOverrides,
  });
};

describe("TikTok reconnect lifecycle integration", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it("does not reconnect for terminal disconnect reasons", async () => {
    const retrySystem: TikTokTestDependencies["retrySystem"] = {
      resetRetryCount: createMockFn<[string], void>(),
      handleConnectionError: createMockFn<
        [string, unknown, () => Promise<void>, () => Promise<void>],
        void
      >(),
      isConnected: createMockFn<[string], boolean | undefined>(),
    };
    const platform = createPlatform({}, { retrySystem });
    platform.queueRetry = createMockFn().mockReturnValue({ queued: true });

    const result = await platform.handleConnectionIssue("private account");

    expect(result.issueType).toBe("disconnection");
    expect(result.retryResult).toEqual({
      queued: false,
      reason: "terminal-error",
    });
    expect(platform.queueRetry).not.toHaveBeenCalled();
  });

  it("keeps reconnect lifecycle observable for not-live stream-end", async () => {
    const platform = createPlatform();
    platform.intervalManager.hasInterval =
      createMockFn().mockReturnValue(false);
    platform.intervalManager.createInterval = createMockFn();
    const emittedEvents: PlatformEvent[] = [];
    platform.on("platform:event", (event) => emittedEvents.push(event));

    await platform._handleStreamEnd({
      message: "User is not live",
      code: 4404,
    });

    const disconnectEvent = emittedEvents.find(
      (event) => event.type === PlatformEvents.CHAT_DISCONNECTED,
    );
    expect(disconnectEvent).toBeDefined();
    if (!disconnectEvent) {
      throw new Error("Expected chat disconnect event");
    }
    expect(disconnectEvent.data.willReconnect).toBe(true);
    expect(platform.intervalManager.createInterval).toHaveBeenCalledTimes(1);
  });
});
