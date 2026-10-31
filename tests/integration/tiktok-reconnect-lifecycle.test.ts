import { vi, describe, it, expect, afterEach } from 'bun:test';

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
    emit: vi.fn<(...args: [string, unknown?]) => boolean>().mockReturnValue(true),
    on: vi.fn<(...args: [string, (payload: unknown) => void]) => void>(),
    removeListener: vi.fn<(...args: [string, (payload: unknown) => void]) => void>(),
    handleNotification: vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined),
  };
  const connectionFactory = dependencyOverrides.connectionFactory || {
    createConnection: vi.fn<(...args: [string, unknown, unknown]) => TikTokTestConnection
    >().mockReturnValue({
      on: vi.fn<(...args: [
        string,
        (payload: unknown) => void | Promise<void>,
      ]) => void>(),
      emit: vi.fn<(...args: [string, unknown?]) => boolean>().mockReturnValue(true),
      removeAllListeners: vi.fn<(...args: [string?]) => void>(),
      connect: vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined),
      disconnect: vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined),
    }),
  };

  const TikTokWebSocketClient =
    dependencyOverrides.TikTokWebSocketClient ||
    vi.fn(() => ({
      on: vi.fn<(...args: unknown[]) => unknown>(),
      off: vi.fn<(...args: unknown[]) => unknown>(),
      connect: vi.fn<(...args: unknown[]) => unknown>(),
      disconnect: vi.fn<(...args: unknown[]) => unknown>(),
      getState: vi.fn<(...args: unknown[]) => string>().mockReturnValue("DISCONNECTED"),
      isConnecting: false,
      isConnected: false,
    }));

  const config = {
    enabled: true,
    username: "testUser",
    ...configOverrides,
  };

  return new TikTokPlatform(config, {
    logger,
    notificationManager,
    TikTokWebSocketClient,
    connectionFactory,
    ...dependencyOverrides,
  });
};

describe("TikTok reconnect lifecycle integration", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not reconnect for terminal disconnect reasons", async () => {
    const retrySystem: TikTokTestDependencies["retrySystem"] = {
      resetRetryCount: vi.fn<(...args: [string]) => void>(),
      handleConnectionError: vi.fn<(...args: [string, unknown, () => Promise<void>, () => Promise<void>]) => void
      >(),
      isConnected: vi.fn<(...args: [string]) => boolean | undefined>(),
    };
    const platform = createPlatform({}, { retrySystem });
    platform.queueRetry = vi.fn<(...args: unknown[]) => { queued: true; }>().mockReturnValue({ queued: true });

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
      vi.fn<(...args: unknown[]) => boolean>().mockReturnValue(false);
    platform.intervalManager.createInterval = vi.fn<(name: string, callback: () => void, intervalMs: number, type?: string, options?: Record<string, unknown>) => ReturnType<typeof globalThis.setInterval>>();
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
