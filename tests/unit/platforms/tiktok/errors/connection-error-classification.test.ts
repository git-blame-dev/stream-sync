import { vi, describe, it, expect, afterEach } from 'bun:test';

import { noOpLogger } from "../../../../helpers/mock-factories";
import { TikTokPlatform } from "../../../../../src/platforms/tiktok.ts";

type TikTokPlatformConfig = ConstructorParameters<typeof TikTokPlatform>[0];
type TikTokPlatformDependencies = ConstructorParameters<typeof TikTokPlatform>[1];

const createPlatform = (
  configOverrides: Partial<TikTokPlatformConfig> = {},
  dependencyOverrides: TikTokPlatformDependencies = {},
) => {
  const logger = dependencyOverrides.logger || noOpLogger;
  const notificationManager = dependencyOverrides.notificationManager || {
    emit: vi.fn<(...args: unknown[]) => unknown>(),
    on: vi.fn<(...args: unknown[]) => unknown>(),
    removeListener: vi.fn<(...args: unknown[]) => unknown>(),
    handleNotification: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
  };
  const connectionFactory = dependencyOverrides.connectionFactory || {
    createConnection: vi.fn<(...args: unknown[]) => { on: import("bun:test").Mock<(...args: unknown[]) => unknown>; emit: import("bun:test").Mock<(...args: unknown[]) => unknown>; removeAllListeners: import("bun:test").Mock<(...args: unknown[]) => unknown>; connect: import("bun:test").Mock<(..._args: unknown[]) => Promise<undefined>>; disconnect: import("bun:test").Mock<(...args: unknown[]) => unknown>; }>().mockReturnValue({
      on: vi.fn<(...args: unknown[]) => unknown>(),
      emit: vi.fn<(...args: unknown[]) => unknown>(),
      removeAllListeners: vi.fn<(...args: unknown[]) => unknown>(),
      connect: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      disconnect: vi.fn<(...args: unknown[]) => unknown>(),
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

describe("TikTokPlatform _handleConnectionError classification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns errorCategory stream-status for fetchIsLive errors", () => {
    const platform = createPlatform();

    const result = platform._handleConnectionError(
      new Error("fetchIsLive failed"),
    );

    expect(result.errorCategory).toBe("stream-status");
    expect(result.username).toBe("testUser");
  });

  it("returns errorCategory stream-wait for waitUntilLive errors", () => {
    const platform = createPlatform();

    const result = platform._handleConnectionError(
      new Error("waitUntilLive timeout"),
    );

    expect(result.errorCategory).toBe("stream-wait");
  });

  it("returns errorCategory connection-establishment for connect errors", () => {
    const platform = createPlatform();

    const result = platform._handleConnectionError(
      new Error("Failed to connect to server"),
    );

    expect(result.errorCategory).toBe("connection-establishment");
  });

  it("returns errorCategory network for TLS errors", () => {
    const platform = createPlatform();

    const result = platform._handleConnectionError(
      new Error("TLS handshake failed"),
    );

    expect(result.errorCategory).toBe("network");
  });

  it("returns errorCategory network for socket disconnected errors", () => {
    const platform = createPlatform();

    const result = platform._handleConnectionError(
      new Error("socket disconnected unexpectedly"),
    );

    expect(result.errorCategory).toBe("network");
  });

  it("returns errorCategory room-info for room info errors", () => {
    const platform = createPlatform();

    const result = platform._handleConnectionError(
      new Error("Failed to retrieve room info"),
    );

    expect(result.errorCategory).toBe("room-info");
  });

  it("returns errorCategory unknown for unrecognized errors", () => {
    const platform = createPlatform();

    const result = platform._handleConnectionError(
      new Error("Something unexpected happened"),
    );

    expect(result.errorCategory).toBe("unknown");
  });

  it("handles null/undefined errors gracefully", () => {
    const platform = createPlatform();

    const result = platform._handleConnectionError(null);

    expect(result.errorCategory).toBe("unknown");
    expect(result.username).toBe("testUser");
  });
});
