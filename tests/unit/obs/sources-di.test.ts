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

describe("OBSSourcesManager DI requirements", () => {
  afterEach(() => {
    restoreAllMocks();
    resetDefaultSourcesManager();
    resetOBSConnectionManager();
  });

  it("exposes only DI-focused exports (no wrapper functions)", () => {
    const sources = require("../../../src/obs/sources.ts");
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
    expect(() => new OBSSourcesManager()).toThrow(
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
      createOBSSourcesManager(incompleteObsManager, {
        logger: noOpLogger,
        ...createSourcesConfigFixture(),
      }),
    ).toThrow(/ensureOBSConnected function/);
  });

  it("requires obsCall contract when dependencies do not provide it", () => {
    const incompleteObsManager = {
      ensureConnected: createMockFn().mockResolvedValue(),
      isConnected: createMockFn().mockReturnValue(true),
      isReady: createMockFn().mockResolvedValue(true),
    };

    expect(() =>
      createOBSSourcesManager(incompleteObsManager, {
        logger: noOpLogger,
        ...createSourcesConfigFixture(),
      }),
    ).toThrow(/obsCall function/);
  });

  it("uses injected obsManager for operations", async () => {
    const mockObsManager = {
      ensureConnected: createMockFn().mockResolvedValue(),
      call: createMockFn().mockImplementation(async (requestType, payload) => {
        if (
          requestType === "GetSceneItemId" &&
          payload?.sceneName === "test-scene" &&
          payload?.sourceName === "test-source"
        ) {
          return { sceneItemId: 42 };
        }

        return { sceneItemId: 0 };
      }),
      addEventListener: createMockFn(),
      removeEventListener: createMockFn(),
      isConnected: createMockFn().mockReturnValue(true),
      isReady: createMockFn().mockResolvedValue(true),
    };

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
    const registeredInvalidators = [];
    const mockObsManager = {
      ensureConnected: createMockFn().mockResolvedValue(),
      call: createMockFn()
        .mockResolvedValueOnce({ sceneItemId: 42 })
        .mockResolvedValueOnce({ sceneItemId: 99 }),
      addEventListener: createMockFn(),
      removeEventListener: createMockFn(),
      isConnected: createMockFn().mockReturnValue(true),
      isReady: createMockFn().mockResolvedValue(true),
      setSourcesCacheInvalidator: createMockFn((invalidator) => {
        registeredInvalidators.push(invalidator);
      }),
    };

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

    registeredInvalidators[0]();

    await sourcesManager.getSceneItemId("test-scene", "test-source");
    expect(mockObsManager.call).toHaveBeenCalledTimes(2);
  });

  it("skips empty platform logo names during hide-all cleanup", async () => {
    const obsCalls = [];
    const mockObsManager = {
      ensureConnected: createMockFn().mockResolvedValue(),
      call: createMockFn().mockImplementation(async (requestType, payload) => {
        obsCalls.push({ requestType, payload });
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
      }),
      addEventListener: createMockFn(),
      removeEventListener: createMockFn(),
      isConnected: createMockFn().mockReturnValue(true),
      isReady: createMockFn().mockResolvedValue(true),
    };

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
