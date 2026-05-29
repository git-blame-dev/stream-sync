import { describe, expect, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { createSourcesConfigFixture } from "../../helpers/config-fixture";
import { noOpLogger } from "../../helpers/mock-factories";
import {
  OBSSourcesManager,
  createOBSSourcesManager,
  getDefaultSourcesManager,
  resetDefaultSourcesManager,
} from "../../../src/obs/sources.ts";
import { resetOBSConnectionManager } from "../../../src/obs/connection.ts";
import * as sourcesModule from "../../../src/obs/sources";

describe("OBSSourcesManager DI requirements", () => {
  type SourcesObsManager = Parameters<typeof createOBSSourcesManager>[0];
  type ObsCall = SourcesObsManager["call"];
  type ObsCallRecord = { requestType: string; payload?: Record<string, unknown> };

  const createReadyObsManager = (overrides: Partial<SourcesObsManager> = {}): SourcesObsManager => ({
    ensureConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
    call: createMockFn<Parameters<ObsCall>, ReturnType<ObsCall>>().mockResolvedValue({}),
    addEventListener: createMockFn<
      [eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void],
      void
    >(),
    removeEventListener: createMockFn<
      [eventName: string, handler: (data?: { reason?: unknown; code?: unknown }) => void],
      void
    >(),
    isConnected: createMockFn<[], boolean>().mockReturnValue(true),
    isReady: createMockFn<[], Promise<boolean>>().mockResolvedValue(true),
    ...overrides,
  });

  afterEach(() => {
    restoreAllMocks();
    resetDefaultSourcesManager();
    resetOBSConnectionManager();
  });

  it("exposes only DI-focused exports (no wrapper functions)", () => {
    const sources = sourcesModule;
    const exportedKeys = Object.keys(sources).sort();
    expect(exportedKeys).toEqual([
      "OBSSourcesManager",
      "createOBSSourcesManager",
      "getDefaultSourcesManager",
      "resetDefaultSourcesManager",
      "sanitizeForOBS",
    ]);
  });

  it("requires an OBS manager in the constructor", () => {
    expect(() => Reflect.construct(OBSSourcesManager, [])).toThrow(
      /OBSSourcesManager requires OBSConnectionManager/,
    );
  });

  it("requires ensureOBSConnected contract when dependencies do not provide it", () => {
    const incompleteObsManager = {
      call: createMockFn().mockResolvedValue({}),
      isConnected: createMockFn().mockReturnValue(true),
      isReady: createMockFn().mockResolvedValue(true),
    };

    expect(() =>
      Reflect.apply(createOBSSourcesManager, null, [incompleteObsManager, {
        logger: noOpLogger,
        ...createSourcesConfigFixture(),
      }]),
    ).toThrow(/ensureOBSConnected function/);
  });

  it("requires obsCall contract when dependencies do not provide it", () => {
    const incompleteObsManager = {
      ensureConnected: createMockFn().mockResolvedValue(),
      isConnected: createMockFn().mockReturnValue(true),
      isReady: createMockFn().mockResolvedValue(true),
    };

    expect(() =>
      Reflect.apply(createOBSSourcesManager, null, [incompleteObsManager, {
        logger: noOpLogger,
        ...createSourcesConfigFixture(),
      }]),
    ).toThrow(/obsCall function/);
  });

  it("uses injected obsManager for operations", async () => {
    const call = createMockFn<Parameters<ObsCall>, ReturnType<ObsCall>>().mockImplementation(async (requestType, payload) => {
        if (
          requestType === "GetSceneItemId" &&
          payload?.sceneName === "test-scene" &&
          payload?.sourceName === "test-source"
        ) {
          return { sceneItemId: 42 };
        }

        return { sceneItemId: 0 };
      });
    const mockObsManager = createReadyObsManager({ call });

    const sourcesManager = createOBSSourcesManager(mockObsManager, {
      logger: noOpLogger,
      ...createSourcesConfigFixture(),
      ensureOBSConnected: mockObsManager.ensureConnected,
      obsCall: mockObsManager.call,
    });

    const result = await sourcesManager.getSceneItemId(
      "test-scene",
      "test-source",
    );

    expect(result).toEqual({ sceneItemId: 42, sceneName: "test-scene" });
  });

  it("registers cache invalidation callback with active connection manager", async () => {
    const registeredInvalidators: (() => void)[] = [];
    const call = createMockFn<Parameters<ObsCall>, ReturnType<ObsCall>>()
        .mockResolvedValueOnce({ sceneItemId: 42 })
        .mockResolvedValueOnce({ sceneItemId: 99 });
    const mockObsManager = createReadyObsManager({
      call,
      setSourcesCacheInvalidator: createMockFn((invalidator) => {
        if (invalidator) {
          registeredInvalidators.push(invalidator);
        }
      }),
    });

    const sourcesManager = createOBSSourcesManager(mockObsManager, {
      logger: noOpLogger,
      ...createSourcesConfigFixture(),
      ensureOBSConnected: mockObsManager.ensureConnected,
      obsCall: mockObsManager.call,
      connection: {
        getOBSConnectionManager: () => mockObsManager,
      },
    });

    await sourcesManager.getSceneItemId("test-scene", "test-source");
    await sourcesManager.getSceneItemId("test-scene", "test-source");
    expect(mockObsManager.call).toHaveBeenCalledTimes(1);

    const [invalidateSourcesCache] = registeredInvalidators;
    expect(invalidateSourcesCache).toBeDefined();
    if (!invalidateSourcesCache) {
      throw new Error("Expected sources cache invalidator registration");
    }
    invalidateSourcesCache();

    await sourcesManager.getSceneItemId("test-scene", "test-source");
    expect(mockObsManager.call).toHaveBeenCalledTimes(2);
  });

  it("skips empty platform logo names during hide-all cleanup", async () => {
    const obsCalls: ObsCallRecord[] = [];
    const call = createMockFn<Parameters<ObsCall>, ReturnType<ObsCall>>().mockImplementation(async (requestType, payload) => {
        obsCalls.push(
          payload === undefined ? { requestType } : { requestType, payload },
        );
        if (
          requestType === "GetSceneItemId" ||
          requestType === "GetGroupSceneItemList"
        ) {
          return {
            sceneItemId: 1,
            sceneItems: [{ sourceName: "valid-logo", sceneItemId: 1 }],
          };
        }
        if (requestType === "GetInputSettings") {
          return { inputSettings: {} };
        }
        return {};
      });
    const mockObsManager = createReadyObsManager({ call });

    const sourcesManager = createOBSSourcesManager(mockObsManager, {
      logger: noOpLogger,
      ...createSourcesConfigFixture(),
      ensureOBSConnected: mockObsManager.ensureConnected,
      obsCall: mockObsManager.call,
    });

    await expect(
      sourcesManager.hideAllDisplays(
        "chat-scene",
        "notification-scene",
        { twitch: "valid-logo", youtube: "", tiktok: undefined },
        { twitch: "valid-logo", youtube: "", tiktok: undefined },
        "tts-source",
        "notification-source",
      ),
    ).resolves.toBeUndefined();

    const groupLookups = obsCalls.filter(
      (entry) => entry.requestType === "GetGroupSceneItemList",
    );
    expect(groupLookups.length).toBe(2);
  });

  it("supports resetting default sources manager singleton", () => {
    const first = getDefaultSourcesManager();

    resetDefaultSourcesManager();

    const second = getDefaultSourcesManager();
    expect(second).not.toBe(first);
  });
});
