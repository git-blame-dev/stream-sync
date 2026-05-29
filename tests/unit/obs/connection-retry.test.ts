import { describe, expect, beforeEach, afterEach, it } from "bun:test";
import {
  type TestMockFn,
  createMockFn,
  clearAllMocks,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";
import {
  useFakeTimers,
  useRealTimers,
  runOnlyPendingTimers,
} from "../../helpers/bun-timers";

import {
  OBSConnectionManager,
  getOBSConnectionManager,
  resetOBSConnectionManager,
} from "../../../src/obs/connection.ts";

type ConnectResult = {
  obsWebSocketVersion: string;
  negotiatedRpcVersion: number;
};

type ConnectionClosedData = { code: number; reason: string };
type ObsEventHandler = (data?: { reason?: unknown; code?: unknown }) => void;

type ObsSocketFake = {
  connect: TestMockFn<[address?: string, password?: string], Promise<ConnectResult>>;
  disconnect: TestMockFn<[], Promise<void>>;
  call: TestMockFn<[requestType: string, requestData?: Record<string, unknown>], Promise<unknown>>;
  on: TestMockFn<[eventName: string, handler: ObsEventHandler], void>;
  once: TestMockFn<[eventName: string, handler: ObsEventHandler], void>;
  off: TestMockFn<[eventName: string, handler: ObsEventHandler], void>;
};

describe("OBSConnectionManager reconnection behavior", () => {
  let mockOBS: ObsSocketFake;
  let manager: OBSConnectionManager;
  let identifiedCallback: (() => void) | null;
  let connectionClosedCallback: ((data: ConnectionClosedData) => void) | null;

  const advanceTimers = async () => {
    runOnlyPendingTimers();
    await Promise.resolve();
  };

  beforeEach(() => {
    resetOBSConnectionManager();
    useFakeTimers();
    identifiedCallback = null;
    connectionClosedCallback = null;

    mockOBS = {
      connect: createMockFn<[address?: string, password?: string], Promise<ConnectResult>>(),
      disconnect: createMockFn<[], Promise<void>>().mockResolvedValue(),
      call: createMockFn<[requestType: string, requestData?: Record<string, unknown>], Promise<unknown>>(),
      on: createMockFn<[eventName: string, handler: ObsEventHandler], void>((event, cb) => {
        if (event === "Identified") identifiedCallback = cb;
        if (event === "ConnectionClosed") connectionClosedCallback = cb;
      }),
      once: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
      off: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
    };

    manager = new OBSConnectionManager({
      obs: mockOBS,
      config: {
        address: "ws://localhost:4455",
        password: "test-password",
        enabled: true,
        connectionTimeoutMs: 5000,
      },
    });
  });

  afterEach(() => {
    resetOBSConnectionManager();
    restoreAllMocks();
    useRealTimers();
    clearAllMocks();
  });

  it("schedules a reconnect after a failed connect attempt", async () => {
    mockOBS.connect
      .mockRejectedValueOnce(new Error("fail-first"))
      .mockResolvedValue({ obsWebSocketVersion: "5", negotiatedRpcVersion: 1 });

    await manager.connect().catch(() => {});

    await advanceTimers();

    expect(mockOBS.connect).toHaveBeenCalledTimes(2);

    if (identifiedCallback) {
      identifiedCallback();
    }
  });

  it("schedules reconnect on ConnectionClosed events", async () => {
    mockOBS.connect.mockResolvedValue({
      obsWebSocketVersion: "5",
      negotiatedRpcVersion: 1,
    });

    const connectPromise = manager.connect();
    if (identifiedCallback) identifiedCallback();
    await connectPromise;

    if (connectionClosedCallback) {
      connectionClosedCallback({ code: 1006, reason: "test" });
    }

    await advanceTimers();

    expect(mockOBS.connect).toHaveBeenCalledTimes(2);
  });

  it("does not reconnect after intentional disconnect", async () => {
    mockOBS.disconnect.mockImplementation(async () => {
      if (connectionClosedCallback) {
        connectionClosedCallback({
          code: 1000,
          reason: "intentional-disconnect",
        });
      }
    });
    mockOBS.connect.mockResolvedValue({
      obsWebSocketVersion: "5",
      negotiatedRpcVersion: 1,
    });

    const connectPromise = manager.connect();
    if (identifiedCallback) {
      identifiedCallback();
    }
    await connectPromise;

    manager.reconnectIntervalMs = 10;
    await manager.disconnect();
    await advanceTimers();

    expect(mockOBS.connect).toHaveBeenCalledTimes(1);
  });

  it("clears pending reconnect work when singleton manager resets", async () => {
    const singletonOBS: ObsSocketFake = {
      connect: createMockFn<[address?: string, password?: string], Promise<ConnectResult>>().mockResolvedValue({
        obsWebSocketVersion: "5",
        negotiatedRpcVersion: 1,
      }),
      disconnect: createMockFn<[], Promise<void>>().mockResolvedValue(),
      call: createMockFn<[requestType: string, requestData?: Record<string, unknown>], Promise<unknown>>(),
      on: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
      off: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
      once: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
    };

    const singletonManager = getOBSConnectionManager({
      obs: singletonOBS,
      config: {
        address: "ws://localhost:4455",
        password: "singleton-password",
        enabled: true,
        connectionTimeoutMs: 5000,
      },
    });

    singletonManager.reconnectIntervalMs = 10;
    singletonManager.scheduleReconnect("test-singleton-reset");

    resetOBSConnectionManager();
    await advanceTimers();

    expect(singletonOBS.connect).not.toHaveBeenCalled();
  });
});
