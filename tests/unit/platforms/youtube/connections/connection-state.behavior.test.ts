import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  createMockFn,
  restoreAllMocks,
} from "../../../../helpers/bun-mock-utils";

import {
  initializeTestLogging,
  createMockPlatformDependencies,
} from "../../../../helpers/test-setup";
import { createYouTubeConfigFixture } from "../../../../helpers/config-fixture";

initializeTestLogging();

import { YouTubePlatform } from "../../../../../src/platforms/youtube";

describe("YouTubePlatform connection state reporting", () => {
  let config;
  let dependencies;

  beforeEach(() => {
    config = createYouTubeConfigFixture({
      enabled: true,
      username: "test-channel",
    });
    dependencies = createMockPlatformDependencies("youtube");
  });

  afterEach(() => {
    restoreAllMocks();
  });

  it("returns connection state based on connection manager data", () => {
    const platform = new YouTubePlatform(config, dependencies);
    platform.connectionManager = {
      getConnectionCount: createMockFn(() => 2),
    };
    platform.getActiveYouTubeVideoIds = createMockFn(() => [
      "video-1",
      "video-2",
    ]);
    platform.monitoringInterval = { id: "interval" };
    platform.isAnyYouTubeStreamReady = createMockFn(() => false);

    const state = platform.getConnectionState();

    expect(state).toEqual({
      isConnected: true,
      isMonitoring: true,
      activeConnections: ["video-1", "video-2"],
      totalConnections: 2,
    });
  });

  it("summarizes stats using connection and monitoring status", () => {
    const platform = new YouTubePlatform(config, dependencies);
    platform.connectionManager = {
      getConnectionCount: createMockFn(() => 1),
    };
    platform.getActiveYouTubeVideoIds = createMockFn(() => ["video-1"]);
    platform.monitoringInterval = { id: "interval" };
    platform.isAnyYouTubeStreamReady = createMockFn(() => false);

    const stats = platform.getStats();

    expect(stats).toEqual({
      platform: "youtube",
      enabled: config.enabled,
      connected: true,
      monitoring: true,
      activeConnections: 1,
      totalConnections: 1,
    });
  });
});
