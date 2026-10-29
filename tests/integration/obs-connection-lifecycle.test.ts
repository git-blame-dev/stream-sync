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

    viewerCountSystem = new ViewerCountSystem({
      platforms: {},
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

    obsManager?.dispose();
    await obsManager?.disconnect();

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
    type Handler = (data?: { reason?: unknown; code?: unknown }) => void;
    const handlers = new Map<string, Handler>();

    const mockOBS = {
      connect: createMockFn().mockResolvedValue({
        obsWebSocketVersion: "5",
        negotiatedRpcVersion: 1,
      }),
      disconnect: createMockFn().mockResolvedValue(undefined),
      call: createMockFn().mockResolvedValue({}),
      on: createMockFn((eventName: string, handler: Handler) => {
        handlers.set(eventName, handler);
      }),
      off: createMockFn((eventName: string, handler: Handler) => {
        if (handlers.get(eventName) === handler) handlers.delete(eventName);
      }),
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

    const firstConnect = manager.connect();
    let ensured: Promise<unknown> | undefined;
    const ownedHandlers = [...handlers.entries()];
    try {
      const closed = handlers.get("ConnectionClosed");
      const identified = handlers.get("Identified");
      expect(closed).toEqual(expect.any(Function));
      expect(identified).toEqual(expect.any(Function));
      if (!closed || !identified) throw new Error("Expected owned OBS lifecycle handlers");
      closed({ code: 1006, reason: "socket-closed" });
      ensured = manager.ensureConnected(50);
      expect(mockOBS.connect).toHaveBeenCalledTimes(1);
      identified();
      await Promise.all([firstConnect, ensured]);
      expect(manager.getConnectionState().isConnected).toBe(true);
      expect(mockOBS.connect).toHaveBeenCalledTimes(1);
    } finally {
      manager.dispose();
      await manager.disconnect();
      await Promise.allSettled([firstConnect, ensured]);
    }
    expect(mockOBS.off.mock.calls).toEqual(ownedHandlers);
    expect(handlers.size).toBe(0);
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
    disconnect: createMockFn().mockResolvedValue(undefined),
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
