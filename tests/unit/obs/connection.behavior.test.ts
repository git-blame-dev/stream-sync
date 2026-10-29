import { describe, expect, afterEach, it, beforeEach } from "bun:test";
import { EventEmitter } from "node:events";
import { createHandcamConfigFixture } from "../../helpers/config-fixture";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import {
  secrets,
  _resetForTesting,
  initializeStaticSecrets,
} from "../../../src/core/secrets";

const {
  OBSConnectionManager,
  getOBSConnectionManager,
  resetOBSConnectionManager,
  obsCall,
  ensureOBSConnected,
} = require("../../../src/obs/connection.ts");
const { initializeOBSConnection } = require("../../../src/obs/connection.ts");

class SyntheticOBS extends EventEmitter {
  requests: Array<{ method: string; data: Record<string, unknown> }> = [];
  async connect() { this.emit('Identified'); return { obsWebSocketVersion: 'synthetic' }; }
  async disconnect() { this.emit('ConnectionClosed'); }
  async call(method: string, data: Record<string, unknown> = {}) {
    this.requests.push({ method, data });
    if (method === 'GetSourceFilter') return { filterSettings: { size: 4 } };
    return { ok: true };
  }
}

describe("OBSConnectionManager behavior", () => {
  let originalNodeEnv: string | undefined;
  const localManagers: Array<InstanceType<typeof OBSConnectionManager>> = [];
  const createLocalManager = (deps: ReturnType<typeof createDeps>) => {
    const manager = new OBSConnectionManager(deps);
    localManagers.push(manager);
    return manager;
  };

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(async () => {
    for (const manager of localManagers.splice(0)) {
      manager.dispose();
      await manager.disconnect();
    }
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    resetOBSConnectionManager();
    restoreAllMocks();
    _resetForTesting();
    initializeStaticSecrets();
  });

  const createMockOBS = () => ({
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
    on: createMockFn<
      [eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void],
      void
    >(),
    off: createMockFn<
      [eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void],
      void
    >(),
    once: createMockFn(),
  });

  const createDeps = (
    overrides: {
      obs?: ReturnType<typeof createMockOBS>;
      config?: Record<string, unknown>;
      constants?: Record<string, unknown>;
    } = {},
  ) => ({
    config: {
      address: "ws://localhost:4455",
      password: "testPass",
      enabled: true,
      connectionTimeoutMs: 50,
    },
    obs: overrides.obs || createMockOBS(),
    constants: {
      ERROR_MESSAGES: { OBS_CONNECTION_TIMEOUT: "Timed out" },
    },
    ...overrides,
  });

  it("returns true immediately when already connected", async () => {
    const mockOBS = createMockOBS();
    const deps = createDeps({ obs: mockOBS });
    const manager = createLocalManager(deps);
    manager._isConnected = true;

    const result = await manager.connect();

    expect(result).toBe(true);
    expect(mockOBS.connect).not.toHaveBeenCalled();
  });

  it("returns existing promise when connection already in progress", async () => {
    const deps = createDeps();
    const manager = createLocalManager(deps);
    manager._isConnected = false;
    manager.isConnecting = true;
    const existingPromise = Promise.resolve("existing");
    manager.connectionPromise = existingPromise;

    const result = await manager.connect();

    expect(result).toBe("existing");
  });

  it("skips reconnect scheduling when OBS is disabled", () => {
    const deps = createDeps({ config: { enabled: false } });
    const manager = createLocalManager(deps);

    manager.scheduleReconnect("test");

    expect(manager.reconnectTimer).toBeNull();
  });

  it("does not double-schedule reconnect when already pending", () => {
    const deps = createDeps();
    const manager = createLocalManager(deps);
    manager.reconnectTimer = { id: "existing" };
    try {
      manager.scheduleReconnect("test");
      expect(manager.reconnectTimer).toEqual({ id: "existing" });
    } finally {
      manager.reconnectTimer = null;
    }
  });

  it("closes timed-out transport and schedules one reconnect", async () => {
    const mockOBS = createMockOBS();
    const manager = createLocalManager(createDeps({ obs: mockOBS, config: { enabled: true, connectionTimeoutMs: 10 } }));
    try {
      manager.reconnectIntervalMs = 1000;
      await expect(manager.connect()).rejects.toThrow("timed out");
      expect(mockOBS.disconnect).toHaveBeenCalledTimes(1);
      expect(manager.reconnectTimer).not.toBeNull();
      manager.scheduleReconnect("duplicate");
      expect(manager.reconnectTimer).not.toBeNull();
    } finally {
      manager.dispose();
      await manager.disconnect();
      expect(manager.reconnectTimer).toBeNull();
    }
  });

  it("resets startup glow after the SDK identifies the owning connection", async () => {
    const obs = new SyntheticOBS();
    const result = await initializeOBSConnection({ enabled: true }, {
      obs, handcam: createHandcamConfigFixture({ enabled: true }),
    });
    try {
      expect(result.outcome).toBe("connected");
      expect(result.manager.isConnected()).toBe(true);
      expect(obs.requests.map(request => request.method)).toEqual(["GetSourceFilter", "SetSourceFilterSettings"]);
    } finally { await result.manager.disconnect(); resetOBSConnectionManager(); }
  });

  it("returns an explicit startup outcome for disabled and degraded initialization", async () => {
    const disabled = await initializeOBSConnection({ enabled: false }, { config: {} });
    expect(disabled.outcome).toBe("disabled");
    resetOBSConnectionManager();
    const mockOBS = createMockOBS();
    mockOBS.connect.mockRejectedValueOnce(new Error("offline"));
    const degraded = await initializeOBSConnection({ enabled: true, connectionTimeoutMs: 10 }, { obs: mockOBS });
    expect(degraded.outcome).toBe("degraded");
    expect(degraded.manager).toBeDefined();
  });

  it("exposes connection state via getConnectionState", () => {
    const deps = createDeps();
    const manager = createLocalManager(deps);
    manager._isConnected = true;

    const state = manager.getConnectionState();

    expect(state.isConnected).toBe(true);
    expect(state.config.address).toBe("ws://localhost:4455");
  });

  it("exposes config via getConfig", () => {
    const deps = createDeps();
    const manager = createLocalManager(deps);

    const config = manager.getConfig();

    expect(config.address).toBe("ws://localhost:4455");
    expect(config.password).toBe("testPass");
    expect(config.enabled).toBe(true);
  });

  it("uses secrets password when config password is undefined", () => {
    _resetForTesting();
    secrets.obs.password = "secret-from-env";

    const deps = createDeps({
      config: {
        address: "ws://localhost:4455",
        enabled: true,
        connectionTimeoutMs: 50,
      },
    });
    const manager = createLocalManager(deps);

    expect(manager.getConfig().password).toBe("secret-from-env");
  });

  it("isConnected returns internal connection state", () => {
    const deps = createDeps();
    const manager = createLocalManager(deps);

    expect(manager.isConnected()).toBe(false);

    manager._isConnected = true;
    expect(manager.isConnected()).toBe(true);
  });

  it("reuses singleton manager and applies config updates for subsequent dependency config", () => {
    const mockOBS = createMockOBS();

    const first = getOBSConnectionManager({
      obs: mockOBS,
      config: {
        address: "ws://first:4455",
        password: "first-pass",
        enabled: true,
        connectionTimeoutMs: 50,
      },
      constants: { ERROR_MESSAGES: { OBS_CONNECTION_TIMEOUT: "Timed out" } },
    });
    const second = getOBSConnectionManager({
      config: { address: "ws://second:4455" },
    });

    expect(second).toBe(first);
    expect(second.getConfig().address).toBe("ws://second:4455");
  });

  it("rejects incompatible non-config overrides after singleton creation", () => {
    const firstObs = createMockOBS();
    getOBSConnectionManager({
      obs: firstObs,
      config: {
        address: "ws://first:4455",
        password: "first-pass",
        enabled: true,
        connectionTimeoutMs: 50,
      },
      constants: { ERROR_MESSAGES: { OBS_CONNECTION_TIMEOUT: "Timed out" } },
    });

    const secondObs = createMockOBS();

    expect(() => getOBSConnectionManager({ obs: secondObs })).toThrow(
      /incompatible non-config dependency overrides/i,
    );
  });

  it("routes obsCall and readiness through the identified singleton", async () => {
    const obs = new SyntheticOBS();
    const manager = getOBSConnectionManager({ obs, config: {
      address: "ws://synthetic.invalid", password: "synthetic", enabled: true, connectionTimeoutMs: 50,
    } });
    try {
      await ensureOBSConnected(1234);
      expect(manager.isConnected()).toBe(true);
      expect(await obsCall("GetSceneList", {})).toEqual({ ok: true });
      expect(obs.requests).toEqual([{ method: "GetSceneList", data: {} }]);
    } finally { await manager.disconnect(); resetOBSConnectionManager(); }
  });

  it("forwards event listener registration helpers to obs client methods", () => {
    const mockOBS = createMockOBS();
    type ObsEventHandler = (data?: { reason?: unknown; code?: unknown }) => void;
    const registeredHandlers = new Map<string, ObsEventHandler>();
    mockOBS.on.mockImplementation(
      (eventName: string, handler: ObsEventHandler) => {
        registeredHandlers.set(eventName, handler);
      },
    );
    mockOBS.off.mockImplementation(
      (eventName: string, handler: ObsEventHandler) => {
        if (registeredHandlers.get(eventName) === handler) {
          registeredHandlers.delete(eventName);
        }
      },
    );

    const manager = createLocalManager(createDeps({ obs: mockOBS }));
    const handler = () => {};

    manager.addEventListener("ConnectionClosed", handler);
    expect(registeredHandlers.get("ConnectionClosed")).toBe(handler);

    manager.removeEventListener("ConnectionClosed", handler);
    expect(registeredHandlers.has("ConnectionClosed")).toBe(false);
  });

  it("caches and clears scene item ids via helper methods", () => {
    const manager = createLocalManager(createDeps());

    manager.cacheSceneItemId("scene:source", 42);
    expect(manager.getCachedSceneItemId("scene:source")).toBe(42);

    manager.clearSceneItemCache();
    expect(manager.getCachedSceneItemId("scene:source")).toBeUndefined();
  });
});
