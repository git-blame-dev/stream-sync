import { describe, expect, beforeEach, afterEach, it } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import {
  useFakeTimers,
  useRealTimers,
  runOnlyPendingTimers,
} from "../../helpers/bun-timers";

import { OBSConnectionManager } from "../../../src/obs/connection.ts";

describe("OBSConnectionManager", () => {
  let originalNodeEnv: string | undefined;

  type ObsEventHandler = (data?: { reason?: unknown; code?: unknown }) => void;
  type ObsEventHandlers = Partial<Record<string, ObsEventHandler>>;
  type MockOBS = {
    connect: (address?: string, password?: string) => Promise<{ obsWebSocketVersion?: unknown; negotiatedRpcVersion?: unknown }>;
    disconnect: () => Promise<void>;
    call: (requestType: string, requestData?: Record<string, unknown>) => Promise<unknown>;
    on: (eventName: string, handler: ObsEventHandler) => void;
    off: (eventName: string, handler: ObsEventHandler) => void;
  };
  type ManagerDependencies = NonNullable<ConstructorParameters<typeof OBSConnectionManager>[0]>;
  type ManagerConfig = ManagerDependencies["config"];
  type ManagerOverrides = {
    obs?: MockOBS;
    mockOBS?: MockOBS;
    OBSWebSocket?: NonNullable<ConstructorParameters<typeof OBSConnectionManager>[0]>["OBSWebSocket"];
    config?: ManagerConfig;
  };

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
    useFakeTimers();
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    restoreAllMocks();
    useRealTimers();
  });

  const createDefaultMockOBS = (): MockOBS => ({
    connect: createMockFn<
      [address?: string, password?: string],
      Promise<{ obsWebSocketVersion?: unknown; negotiatedRpcVersion?: unknown }>
    >().mockResolvedValue({
      obsWebSocketVersion: "5",
      negotiatedRpcVersion: 1,
    }),
    disconnect: createMockFn<[], Promise<void>>().mockResolvedValue(),
    call: createMockFn<
      [requestType: string, requestData?: Record<string, unknown>],
      Promise<unknown>
    >().mockResolvedValue({}),
    on: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
    off: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
  });

  const createManager = (overrides: ManagerOverrides = {}) => {
    const dependencies: ManagerDependencies = {
      obs: overrides.obs || overrides.mockOBS || createDefaultMockOBS(),
      config: overrides.config || {
        address: "ws://localhost:4455",
        password: "testPassword",
        enabled: true,
        connectionTimeoutMs: 50,
      },
    };
    if (overrides.OBSWebSocket !== undefined) {
      dependencies.OBSWebSocket = overrides.OBSWebSocket;
    }
    return new OBSConnectionManager(dependencies);
  };

  it("skips connect when already connected", async () => {
    const connectSpy = createMockFn<
      [address?: string, password?: string],
      Promise<{ obsWebSocketVersion?: unknown; negotiatedRpcVersion?: unknown }>
    >().mockResolvedValue({
      obsWebSocketVersion: "5",
      negotiatedRpcVersion: 1,
    });
    const mockOBS: MockOBS = {
      connect: connectSpy,
      disconnect: createMockFn<[], Promise<void>>().mockResolvedValue(),
      call: createMockFn<[requestType: string, requestData?: Record<string, unknown>], Promise<unknown>>().mockResolvedValue({}),
      on: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
      off: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
    };

    const manager = createManager({ mockOBS });
    manager._isConnected = true;

    await expect(manager.connect()).resolves.toBe(true);
    expect(connectSpy).not.toHaveBeenCalled();
  });

  it("returns existing promise when already connecting", async () => {
    const mockOBS = createDefaultMockOBS();

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
    const mockOBS = createDefaultMockOBS();

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
    const handlers: ObsEventHandlers = {};
    const mockOBS: MockOBS = {
      connect: createMockFn<[address?: string, password?: string], Promise<{}>>().mockResolvedValue({}),
      disconnect: createMockFn<[], Promise<void>>().mockResolvedValue(),
      call: createMockFn<[requestType: string, requestData?: Record<string, unknown>], Promise<unknown>>().mockResolvedValue({}),
      on: createMockFn<[eventName: string, handler: ObsEventHandler], void>((event, cb) => {
        handlers[event] = cb;
      }),
      off: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
    };

    const manager = createManager({ mockOBS });
    const connectPromise = manager.connect();

    handlers.Identified?.();
    const result = await connectPromise;

    expect(result).toBe(true);
    expect(manager._isConnected).toBe(true);
  });

  it("dedupes concurrent connect callers into one underlying connect attempt", async () => {
    const handlers: ObsEventHandlers = {};
    const connectPromise = Promise.resolve({
      obsWebSocketVersion: "5",
      negotiatedRpcVersion: 1,
    });
    const mockOBS: MockOBS = {
      connect: createMockFn(() => connectPromise),
      disconnect: createMockFn().mockResolvedValue(undefined),
      call: createMockFn().mockResolvedValue({}),
      on: createMockFn<[eventName: string, handler: ObsEventHandler], void>((event, cb) => {
        handlers[event] = cb;
      }),
      off: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
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
    const handlers: ObsEventHandlers = {};
    const mockOBS: MockOBS = {
      connect: createMockFn().mockResolvedValue({
        obsWebSocketVersion: "5",
        negotiatedRpcVersion: 1,
      }),
      disconnect: createMockFn().mockResolvedValue(undefined),
      call: createMockFn().mockResolvedValue({}),
      on: createMockFn<[eventName: string, handler: ObsEventHandler], void>((event, cb) => {
        handlers[event] = cb;
      }),
      off: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
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
    const handlers: ObsEventHandlers = {};
    const mockOBS: MockOBS = {
      connect: createMockFn().mockResolvedValue({
        obsWebSocketVersion: "5",
        negotiatedRpcVersion: 1,
      }),
      disconnect: createMockFn().mockResolvedValue(undefined),
      call: createMockFn().mockResolvedValue({}),
      on: createMockFn<[eventName: string, handler: ObsEventHandler], void>((event, cb) => {
        handlers[event] = cb;
      }),
      off: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
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
    const handlers: ObsEventHandlers = {};
    const mockOBS: MockOBS = {
      connect: createMockFn().mockResolvedValue({
        obsWebSocketVersion: "5",
        negotiatedRpcVersion: 1,
      }),
      disconnect: createMockFn().mockResolvedValue(undefined),
      call: createMockFn().mockResolvedValue({}),
      on: createMockFn<[eventName: string, handler: ObsEventHandler], void>((event, cb) => {
        handlers[event] = cb;
      }),
      off: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
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
