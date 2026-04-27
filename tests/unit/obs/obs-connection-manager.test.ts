import { describe, expect, beforeEach, afterEach, it } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import {
  useFakeTimers,
  useRealTimers,
  runOnlyPendingTimers,
} from "../../helpers/bun-timers";

import { OBSConnectionManager } from "../../../src/obs/connection.ts";

describe("OBSConnectionManager", () => {
  let originalNodeEnv;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    useFakeTimers();
  });

  afterEach(() => {
    process.env.NODE_ENV = originalNodeEnv;
    restoreAllMocks();
    useRealTimers();
  });

  const createDefaultMockOBS = () => ({
    connect: createMockFn().mockResolvedValue({
      obsWebSocketVersion: "5",
      negotiatedRpcVersion: 1,
    }),
    disconnect: createMockFn().mockResolvedValue(),
    call: createMockFn().mockResolvedValue({}),
    on: createMockFn(),
    off: createMockFn(),
    once: createMockFn(),
  });

  const createManager = (overrides = {}) => {
    return new OBSConnectionManager({
      obs: overrides.obs || overrides.mockOBS || createDefaultMockOBS(),
      OBSWebSocket: overrides.OBSWebSocket,
      config: overrides.config || {
        address: "ws://localhost:4455",
        password: "testPassword",
        enabled: true,
        connectionTimeoutMs: 50,
      },
    });
  };

  it("skips connect when already connected", async () => {
    const connectSpy = createMockFn().mockResolvedValue({
      obsWebSocketVersion: "5",
      negotiatedRpcVersion: 1,
    });
    const mockOBS = {
      connect: connectSpy,
      disconnect: createMockFn(),
      call: createMockFn(),
      on: createMockFn(),
      off: createMockFn(),
      once: createMockFn(),
    };

    const manager = createManager({ mockOBS });
    manager._isConnected = true;

    await expect(manager.connect()).resolves.toBe(true);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("returns existing promise when already connecting", async () => {
    const mockOBS = {
      connect: createMockFn(),
      disconnect: createMockFn(),
      call: createMockFn(),
      on: createMockFn(),
      off: createMockFn(),
      once: createMockFn(),
    };

    const manager = createManager({ mockOBS });
    manager._isConnected = false;
    manager.isConnecting = true;
    const existingPromise = Promise.resolve(true);
    manager.connectionPromise = existingPromise;

    const promise = manager.connect();
    expect(promise).toBe(existingPromise);
    await expect(promise).resolves.toBe(true);
  });

  it("skips reconnect scheduling when disabled", () => {
    const manager = createManager({
      config: { enabled: false },
    });

    manager.scheduleReconnect("test");
    expect(manager.reconnectTimer).toBeNull();
  });

  it("does not double-schedule reconnect when already pending", () => {
    const mockOBS = {
      connect: createMockFn(),
      disconnect: createMockFn(),
      call: createMockFn(),
      on: createMockFn(),
      off: createMockFn(),
      once: createMockFn(),
    };

    const manager = createManager({ mockOBS });
    manager.reconnectTimer = { id: "existingTimer" };

    manager.scheduleReconnect("duplicate");
    expect(manager.reconnectTimer).toEqual({ id: "existingTimer" });
  });

  it("caches and retrieves scene item IDs", () => {
    const manager = createManager();
    manager.cacheSceneItemId("testScene", "123");
    expect(manager.getCachedSceneItemId("testScene")).toBe("123");
  });

  it("clears scene item cache", () => {
    const manager = createManager();
    manager.cacheSceneItemId("testScene", "123");
    expect(manager.sceneItemIdCache.size).toBe(1);

    manager.clearSceneItemCache();
    expect(manager.sceneItemIdCache.size).toBe(0);
  });

  it("exposes connection state through getConnectionState", () => {
    const manager = createManager();
    manager._isConnected = true;

    const state = manager.getConnectionState();
    expect(state.isConnected).toBe(true);
    expect(state.config.address).toBe("ws://localhost:4455");
  });

  it("successfully completes connection when Identified event fires", async () => {
    const handlers = {};
    const mockOBS = {
      connect: createMockFn().mockResolvedValue({}),
      disconnect: createMockFn(),
      call: createMockFn(),
      on: createMockFn((event, cb) => {
        handlers[event] = cb;
      }),
      off: createMockFn(),
      once: createMockFn(),
    };

    const manager = createManager({ mockOBS });
    const connectPromise = manager.connect();

    handlers.Identified?.();
    const result = await connectPromise;

    expect(result).toBe(true);
    expect(manager._isConnected).toBe(true);
  });

  it("dedupes concurrent connect callers into one underlying connect attempt", async () => {
    const handlers = {};
    const connectPromise = Promise.resolve({
      obsWebSocketVersion: "5",
      negotiatedRpcVersion: 1,
    });
    const mockOBS = {
      connect: createMockFn(() => connectPromise),
      disconnect: createMockFn().mockResolvedValue(undefined),
      call: createMockFn().mockResolvedValue({}),
      on: createMockFn((event, cb) => {
        handlers[event] = cb;
      }),
      off: createMockFn(),
      once: createMockFn(),
    };

    const manager = createManager({ mockOBS });
    const first = manager.connect();
    const second = manager.connect();

    expect(first).toBe(second);
    expect(mockOBS.connect).toHaveBeenCalledTimes(1);

    handlers.Identified?.();
    await expect(first).resolves.toBe(true);
  });

  it("ensureConnected reuses active connect attempt", async () => {
    const handlers = {};
    const mockOBS = {
      connect: createMockFn().mockResolvedValue({
        obsWebSocketVersion: "5",
        negotiatedRpcVersion: 1,
      }),
      disconnect: createMockFn().mockResolvedValue(undefined),
      call: createMockFn().mockResolvedValue({}),
      on: createMockFn((event, cb) => {
        handlers[event] = cb;
      }),
      off: createMockFn(),
      once: createMockFn(),
    };

    const manager = createManager({ mockOBS });
    const connectPromise = manager.connect();
    const ensuredPromise = manager.ensureConnected();

    expect(mockOBS.connect).toHaveBeenCalledTimes(1);

    handlers.Identified?.();
    await expect(
      Promise.all([connectPromise, ensuredPromise]),
    ).resolves.toEqual([true, undefined]);
  });

  it("ignores late Identified event after connect timeout", async () => {
    const handlers = {};
    const mockOBS = {
      connect: createMockFn().mockResolvedValue({
        obsWebSocketVersion: "5",
        negotiatedRpcVersion: 1,
      }),
      disconnect: createMockFn().mockResolvedValue(undefined),
      call: createMockFn().mockResolvedValue({}),
      on: createMockFn((event, cb) => {
        handlers[event] = cb;
      }),
      off: createMockFn(),
      once: createMockFn(),
    };

    const manager = createManager({
      mockOBS,
      config: {
        address: "ws://localhost:4455",
        password: "testPassword",
        enabled: true,
        connectionTimeoutMs: 10,
      },
    });

    const pendingConnect = manager.connect();
    runOnlyPendingTimers();
    await expect(pendingConnect).rejects.toThrow(
      /timed out waiting for authentication/i,
    );

    handlers.Identified?.();

    expect(manager.isConnected()).toBe(false);
  });

  it("fails fast when disabled for direct connect and ensureConnected", async () => {
    const mockOBS = createDefaultMockOBS();
    const manager = createManager({
      mockOBS,
      config: {
        address: "ws://localhost:4455",
        password: "testPassword",
        enabled: false,
        connectionTimeoutMs: 50,
      },
    });

    await expect(manager.connect()).rejects.toThrow(/disabled/i);
    await expect(manager.ensureConnected()).rejects.toThrow(/disabled/i);
    expect(mockOBS.connect).not.toHaveBeenCalled();
  });

  it("does not accept late Identified when config is disabled during connect attempt", async () => {
    const handlers = {};
    const mockOBS = {
      connect: createMockFn().mockResolvedValue({
        obsWebSocketVersion: "5",
        negotiatedRpcVersion: 1,
      }),
      disconnect: createMockFn().mockResolvedValue(undefined),
      call: createMockFn().mockResolvedValue({}),
      on: createMockFn((event, cb) => {
        handlers[event] = cb;
      }),
      off: createMockFn(),
      once: createMockFn(),
    };

    const manager = createManager({
      mockOBS,
      config: {
        address: "ws://localhost:4455",
        password: "testPassword",
        enabled: true,
        connectionTimeoutMs: 10,
      },
    });

    const pendingConnect = manager.connect();
    manager.updateConfig({ enabled: false });
    handlers.Identified?.();
    runOnlyPendingTimers();

    await expect(pendingConnect).rejects.toThrow(
      /timed out waiting for authentication/i,
    );
    expect(manager.isConnected()).toBe(false);
  });
});
