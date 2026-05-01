import { describe, it, expect, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";
import { TikTokPlatform } from "../../src/platforms/tiktok.ts";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";

const createPlatform = (configOverrides = {}, dependencyOverrides = {}) => {
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
      connect: createMockFn().mockResolvedValue(),
      disconnect: createMockFn(),
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
    const retrySystem = {
      resetRetryCount: createMockFn(),
      handleConnectionError: createMockFn(),
      isConnected: createMockFn(),
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
    const emittedEvents = [];
    platform.on("platform:event", (event) => emittedEvents.push(event));

    await platform._handleStreamEnd({
      message: "User is not live",
      code: 4404,
    });

    const disconnectEvent = emittedEvents.find(
      (event) => event.type === PlatformEvents.CHAT_DISCONNECTED,
    );
    expect(disconnectEvent).toBeDefined();
    expect(disconnectEvent.data.willReconnect).toBe(true);
    expect(platform.intervalManager.createInterval).toHaveBeenCalledTimes(1);
  });
});
