import { describe, test, beforeEach, afterEach, expect } from "bun:test";
import {
  clearAllMocks,
  createMockFn,
  restoreAllMocks,
} from "../helpers/bun-mock-utils";
import { useFakeTimers, useRealTimers } from "../helpers/bun-timers";
import { createConfigFixture } from "../helpers/config-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import { OBSViewerCountObserver } from "../../src/observers/obs-viewer-count-observer";
import {
  createOBSConnectionManager,
  getOBSConnectionManager,
  resetOBSConnectionManager,
} from "../../src/obs/connection.ts";
import { ViewerCountSystem } from "../../src/utils/viewer-count";

describe("OBS Connection Lifecycle Integration", () => {
  let viewerCountSystem: InstanceType<typeof ViewerCountSystem>;
  let obsManager: ReturnType<typeof createOBSConnectionManager>;
  let obsObserver: InstanceType<typeof OBSViewerCountObserver>;
  let mockPlatforms: {
    youtube: ReturnType<typeof createStreamingPlatformMock>;
    twitch: ReturnType<typeof createStreamingPlatformMock>;
    tiktok: ReturnType<typeof createStreamingPlatformMock>;
  };
  let mockOBSWebSocket: ReturnType<typeof createMockOBSWebSocket>;
  let testConfig: ReturnType<typeof createConfigFixture>;

  beforeEach(async () => {
    testConfig = createConfigFixture();
    mockOBSWebSocket = createMockOBSWebSocket();

    obsManager = createOBSConnectionManager({
      obs: mockOBSWebSocket,
      config: {
        address: "ws://localhost:4455",
        password: "testPassword123",
        enabled: true,
        connectionTimeoutMs: testConfig.obs?.connectionTimeoutMs || 10000,
      },
    });

    mockPlatforms = {
      youtube: createStreamingPlatformMock("youtube", 1500),
      twitch: createStreamingPlatformMock("twitch", 2500),
      tiktok: createStreamingPlatformMock("tiktok", 800),
    };

    viewerCountSystem = new ViewerCountSystem({
      platforms: mockPlatforms,
      config: testConfig,
      logger: noOpLogger,
    });
    obsObserver = new OBSViewerCountObserver(obsManager, noOpLogger, {
      config: testConfig,
    });

    await viewerCountSystem.initialize();
  });

  afterEach(async () => {
    if (viewerCountSystem?.isPolling) {
      viewerCountSystem.stopPolling();
    }

    if (viewerCountSystem) {
      await viewerCountSystem.cleanup();
    }

    clearAllMocks();
    restoreAllMocks();
  });

  describe("OBS Observer System", () => {
    test("initializes and registers observer correctly", async () => {
      expect(viewerCountSystem).toBeDefined();
      expect(obsObserver).toBeDefined();
      expect(obsManager).toBeDefined();

      viewerCountSystem.addObserver(obsObserver);

      expect(viewerCountSystem.observers.size).toBe(1);
      expect(viewerCountSystem.observers.has("obs-viewer-count-observer")).toBe(
        true,
      );
    });
  });
});

describe("OBS connection manager reconnect ownership integration", () => {
  beforeEach(() => {
    useFakeTimers();
    resetOBSConnectionManager();
  });

  afterEach(() => {
    resetOBSConnectionManager();
    useRealTimers();
    clearAllMocks();
    restoreAllMocks();
  });

  test("ConnectionClosed during in-flight connect does not start overlapping reconnect attempt", async () => {
    let connectionClosedHandler: unknown = null;
    let identifiedHandler: unknown = null;

    const mockOBS = {
      connect: createMockFn().mockResolvedValue({
        obsWebSocketVersion: "5",
        negotiatedRpcVersion: 1,
      }),
      disconnect: createMockFn().mockResolvedValue(undefined),
      call: createMockFn().mockResolvedValue({}),
      on: createMockFn((eventName: string, handler: unknown) => {
        if (eventName === "ConnectionClosed") {
          connectionClosedHandler = handler;
        }
        if (eventName === "Identified") {
          identifiedHandler = handler;
        }
      }),
      off: createMockFn(),
      once: createMockFn(),
      addEventListener: createMockFn(),
      removeEventListener: createMockFn(),
    };

    const manager = getOBSConnectionManager({
      obs: mockOBS,
      config: {
        address: "ws://localhost:4455",
        password: "test-password",
        enabled: true,
        connectionTimeoutMs: 5000,
      },
    });

    const firstConnect = manager.connect().catch(() => false);

    if (typeof connectionClosedHandler === "function") {
      (
        connectionClosedHandler as (data?: {
          reason?: unknown;
          code?: unknown;
        }) => void
      )({ code: 1006, reason: "socket-closed" });
    }
    const ensured = manager.ensureConnected(50).catch(() => undefined);
    await Promise.resolve();

    expect(mockOBS.connect).toHaveBeenCalledTimes(1);

    if (typeof identifiedHandler === "function") {
      (identifiedHandler as () => void)();
    }
    await Promise.all([firstConnect, ensured]);
  });
});

function createMockOBSWebSocket() {
  return {
    connected: false,
    call: createMockFn().mockResolvedValue({}),
    connect: createMockFn().mockResolvedValue({
      obsWebSocketVersion: "5.0.0",
      negotiatedRpcVersion: 1,
    }),
    disconnect: createMockFn().mockResolvedValue(),
    on: createMockFn(),
    off: createMockFn(),
    once: createMockFn(),
    addEventListener: createMockFn(),
    removeEventListener: createMockFn(),
    setConnected(connected: boolean) {
      this.connected = connected;
    },
  };
}

function createStreamingPlatformMock(
  platformName: string,
  initialViewerCount: number,
) {
  return {
    getViewerCount: createMockFn().mockResolvedValue(initialViewerCount),
    isEnabled: createMockFn(() => true),
    isConnected: createMockFn(() => true),
    platform: platformName,
  };
}
