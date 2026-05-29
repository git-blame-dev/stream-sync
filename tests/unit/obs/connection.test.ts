import { describe, expect, beforeEach, afterEach, it } from "bun:test";
import {
  type TestMockFn,
  createMockFn,
  clearAllMocks,
  restoreAllMocks,
} from "../../helpers/bun-mock-utils";
import { waitForDelay } from "../../helpers/time-utils";

import { OBSConnectionManager } from "../../../src/obs/connection.ts";

type ConnectResult = {
  obsWebSocketVersion: string;
  negotiatedRpcVersion: number;
};

type ObsEventHandler = (data?: { reason?: unknown; code?: unknown }) => void;

type ObsSocketFake = {
  connect: TestMockFn<[address?: string, password?: string], Promise<ConnectResult>>;
  disconnect: TestMockFn<[], Promise<void>>;
  call: TestMockFn<[requestType: string, requestData?: Record<string, unknown>], Promise<unknown>>;
  on: TestMockFn<[eventName: string, handler: ObsEventHandler], void>;
  once: TestMockFn<[eventName: string, handler: ObsEventHandler], void>;
  off: TestMockFn<[eventName: string, handler: ObsEventHandler], void>;
};

describe("OBS Connection Race Condition - User Experience Validation", () => {
  let mockOBS: ObsSocketFake;
  let connectionManager: OBSConnectionManager;
  let identifiedCallback: (() => void) | null;

  beforeEach(() => {
    identifiedCallback = null;

    mockOBS = {
      connect: createMockFn<[address?: string, password?: string], Promise<ConnectResult>>(),
      disconnect: createMockFn<[], Promise<void>>().mockResolvedValue(),
      call: createMockFn<[requestType: string, requestData?: Record<string, unknown>], Promise<unknown>>(),
      on: createMockFn<[eventName: string, handler: ObsEventHandler], void>().mockImplementation((event, callback) => {
        if (event === "Identified") {
          identifiedCallback = callback;
        }
      }),
      once: createMockFn<[eventName: string, handler: ObsEventHandler], void>().mockImplementation((event, callback) => {
        if (event === "Identified") {
          identifiedCallback = callback;
        }
      }),
      off: createMockFn<[eventName: string, handler: ObsEventHandler], void>(),
    };

    connectionManager = new OBSConnectionManager({
      obs: mockOBS,
      config: {
        address: "ws://localhost:4455",
        password: "test123",
        enabled: true,
        connectionTimeoutMs: 5000,
      },
    });
  });

  afterEach(() => {
    restoreAllMocks();
    clearAllMocks();
  });

  describe("Connection Readiness Behavior", () => {
    it("should NOT allow API calls until Identified event fires", async () => {
      mockOBS.connect.mockResolvedValue({
        obsWebSocketVersion: "5.0.0",
        negotiatedRpcVersion: 1,
      });

      const connectPromise = connectionManager.connect();

      let connectResolved = false;
      connectPromise
        .then(() => {
          connectResolved = true;
        })
        .catch(() => {
          connectResolved = true;
        });

      await waitForDelay(50);

      expect(connectResolved).toBe(false);
      expect(connectionManager.isConnected()).toBe(false);

      if (identifiedCallback) {
        identifiedCallback();
        await connectPromise;
        expect(connectionManager.isConnected()).toBe(true);
      } else {
        throw new Error("identifiedCallback was not captured properly");
      }
    });

    it("should prevent API calls during the authentication window", async () => {
      mockOBS.connect.mockResolvedValue({
        obsWebSocketVersion: "5.0.0",
        negotiatedRpcVersion: 1,
      });

      const connectPromise = connectionManager.connect();

      await waitForDelay(50);

      expect(connectionManager.isConnected()).toBe(false);

      await expect(connectionManager.call("GetSceneList")).rejects.toThrow(
        /not connected/i,
      );

      if (identifiedCallback) {
        identifiedCallback();
        await connectPromise;
        expect(connectionManager.isConnected()).toBe(true);
      } else {
        throw new Error("identifiedCallback was not captured properly");
      }
    });

    it("rejects connection when identified event never arrives before timeout", async () => {
      const shortTimeoutManager = new OBSConnectionManager({
        obs: mockOBS,
        config: {
          address: "ws://localhost:4455",
          password: "test123",
          enabled: true,
          connectionTimeoutMs: 20,
        },
      });

      mockOBS.connect.mockResolvedValue({
        obsWebSocketVersion: "5.0.0",
        negotiatedRpcVersion: 1,
      });

      await expect(shortTimeoutManager.connect()).rejects.toThrow(
        /timed out waiting for authentication/i,
      );
    });
  });
});
