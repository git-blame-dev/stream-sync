import { vi, describe, test, beforeEach, afterEach, expect } from 'bun:test';

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
  const ownedObsManagers: ReturnType<typeof createOBSConnectionManager>[] = [];
  const ownedViewerSystems: ViewerCountSystem[] = [];
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

    ownedObsManagers.push(obsManager);
    viewerCountSystem = new ViewerCountSystem({
      platforms: {},
      config: testConfig,
      logger: noOpLogger,
    });
    ownedViewerSystems.push(viewerCountSystem);
    obsObserver = new OBSViewerCountObserver(obsManager, noOpLogger, {
      config: testConfig,
    });

    await viewerCountSystem.initialize();
  });

  afterEach(async () => {
    const errors: unknown[] = [];
    try {
      for (const system of ownedViewerSystems.splice(0)) {
        try { system.stopPolling(); } catch (error) { errors.push(error); }
        try { await system.cleanup(); } catch (error) { errors.push(error); }
      }
      for (const manager of ownedObsManagers.splice(0)) {
        try { manager.dispose(); } catch (error) { errors.push(error); }
        try { await manager.disconnect(); } catch (error) { errors.push(error); }
      }
    } finally {
      try { vi.clearAllMocks(); } finally { vi.restoreAllMocks(); }
    }
    if (errors.length) throw new AggregateError(errors, "OBS lifecycle test cleanup failed");
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
    try { resetOBSConnectionManager(); }
    finally {
      try { useRealTimers(); }
      finally { try { vi.clearAllMocks(); } finally { vi.restoreAllMocks(); } }
    }
  });

  test("ConnectionClosed during in-flight connect does not start overlapping reconnect attempt", async () => {
    type Handler = (data?: { reason?: unknown; code?: unknown }) => void;
    const handlers = new Map<string, Handler>();

    const mockOBS = {
      connect: vi.fn<(...args: unknown[]) => Promise<{ obsWebSocketVersion: string; negotiatedRpcVersion: number; }>>().mockResolvedValue({
        obsWebSocketVersion: "5",
        negotiatedRpcVersion: 1,
      }),
      disconnect: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
      call: vi.fn<(...args: unknown[]) => Promise<{}>>().mockResolvedValue({}),
      on: vi.fn((eventName: string, handler: Handler) => {
        handlers.set(eventName, handler);
      }),
      off: vi.fn((eventName: string, handler: Handler) => {
        if (handlers.get(eventName) === handler) handlers.delete(eventName);
      }),
      once: vi.fn<(...args: unknown[]) => unknown>(),
      addEventListener: vi.fn<(...args: unknown[]) => unknown>(),
      removeEventListener: vi.fn<(...args: unknown[]) => unknown>(),
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
      try {
        try { manager.dispose(); } finally { await manager.disconnect(); }
      } finally {
        await Promise.allSettled([firstConnect, ensured]);
      }
    }
    expect(mockOBS.off.mock.calls).toEqual(ownedHandlers);
    expect(handlers.size).toBe(0);
  });
});

function createMockOBSWebSocket() {
  return {
    connected: false,
    call: vi.fn<(...args: unknown[]) => Promise<{}>>().mockResolvedValue({}),
    connect: vi.fn<(...args: unknown[]) => Promise<{ obsWebSocketVersion: string; negotiatedRpcVersion: number; }>>().mockResolvedValue({
      obsWebSocketVersion: "5.0.0",
      negotiatedRpcVersion: 1,
    }),
    disconnect: vi.fn<(...args: unknown[]) => Promise<undefined>>().mockResolvedValue(undefined),
    on: vi.fn<(...args: unknown[]) => unknown>(),
    off: vi.fn<(...args: unknown[]) => unknown>(),
    once: vi.fn<(...args: unknown[]) => unknown>(),
    addEventListener: vi.fn<(...args: unknown[]) => unknown>(),
    removeEventListener: vi.fn<(...args: unknown[]) => unknown>(),
    setConnected(connected: boolean) {
      this.connected = connected;
    },
  };
}
