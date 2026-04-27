import { describe, expect, beforeEach, it } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { waitForDelay } from "../../helpers/time-utils";
import {
  OBSEffectsManager,
  getDefaultEffectsManager,
  resetDefaultEffectsManager,
} from "../../../src/obs/effects.ts";
import * as effectsCompatModule from "../../../src/obs/effects.ts";

describe("obs effects behavior", () => {
  let mockObsManager;

  const createObsManager = () => ({
    ensureConnected: createMockFn(async () => {}),
    call: createMockFn(async () => {}),
    addEventListener: createMockFn(),
    removeEventListener: createMockFn(),
  });

  beforeEach(() => {
    mockObsManager = createObsManager();
    resetDefaultEffectsManager();
  });

  it("plays media and triggers OBS calls with fire-and-forget mode", async () => {
    const manager = new OBSEffectsManager(mockObsManager, {
      logger: noOpLogger,
    });

  await manager.playMediaInOBS(
      {
        mediaSource: "testSrc",
        filename: "testFile",
        vfxFilePath: "/test/path",
      },
      false,
  );

  expect(mockObsManager.ensureConnected).toHaveBeenCalled();
  const requestTypes = mockObsManager.call.mock.calls.map(([requestType]) => requestType);
  expect(requestTypes).toEqual([
    "SetInputSettings",
    "TriggerMediaInputAction",
  ]);
  });

  it("throws error when OBS calls fail", async () => {
    mockObsManager.call.mockRejectedValueOnce(
      new Error("OBS connection failed"),
    );
    const manager = new OBSEffectsManager(mockObsManager, {
      logger: noOpLogger,
    });

    await expect(
      manager.playMediaInOBS(
        {
          mediaSource: "testSrc",
          filename: "testFile",
          vfxFilePath: "/test/path",
        },
        false,
      ),
    ).rejects.toThrow("OBS connection failed");
  });

  it("resolves when no obs manager present during waitForMediaCompletion", async () => {
    const manager = new OBSEffectsManager(mockObsManager, {
      logger: noOpLogger,
    });
    manager.obsManager = null;

    await expect(
      manager.waitForMediaCompletion("testSrc"),
    ).resolves.toBeUndefined();
  });

  it("resolves when media playback ended event is emitted for the source", async () => {
    const manager = new OBSEffectsManager(mockObsManager, {
      logger: noOpLogger,
    });

    const pending = manager.waitForMediaCompletion("testSrc");
    const mediaEndHandler = mockObsManager.addEventListener.mock.calls[0][1];
    mediaEndHandler({ inputName: "testSrc" });

    await expect(pending).resolves.toBeUndefined();
    expect(mockObsManager.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("rejects waiting for media completion when obs manager lacks event listener support", async () => {
    const manager = new OBSEffectsManager(
      {
        ensureConnected: createMockFn(async () => {}),
        call: createMockFn(async () => {}),
      },
      { logger: noOpLogger },
    );

    await expect(manager.waitForMediaCompletion("testSrc")).rejects.toThrow(
      "event listener support",
    );
  });

  it("returns after timeout when media completion event never arrives", async () => {
    const manager = new OBSEffectsManager(mockObsManager, {
      logger: noOpLogger,
    });

    const pending = manager.waitForMediaCompletion("testSrc", 5);
    await waitForDelay(10);

    await expect(pending).resolves.toBeUndefined();
    expect(mockObsManager.removeEventListener).toHaveBeenCalledTimes(1);
  });

it("restarts media input on the requested source", async () => {
    const manager = new OBSEffectsManager(mockObsManager, {
      logger: noOpLogger,
    });

    await manager.triggerMediaAction(
      "testSrc",
      "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
    );

  expect(mockObsManager.ensureConnected).toHaveBeenCalledTimes(1);
  const [requestType, payload] = mockObsManager.call.mock.calls[0] || [];
  expect(requestType).toBe("TriggerMediaInputAction");
  expect(payload).toEqual({
    inputName: "testSrc",
    mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
  });
});

  it("propagates media input action failures", async () => {
    mockObsManager.call.mockRejectedValueOnce(new Error("action failed"));
    const manager = new OBSEffectsManager(mockObsManager, {
      logger: noOpLogger,
    });

    await expect(
      manager.triggerMediaAction(
        "testSrc",
        "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART",
      ),
    ).rejects.toThrow("action failed");
  });

  it("returns a stable default effects manager instance", () => {
    const first = getDefaultEffectsManager();
    const second = getDefaultEffectsManager();

    expect(first).toBeDefined();
    expect(first).toBe(second);
  });

  it("wires default effects manager to real default sources manager instance", () => {
    const manager = getDefaultEffectsManager();

    expect(manager.sourcesManager).toBeDefined();
    expect(typeof manager.sourcesManager.updateTextSource).toBe("function");
  });

  it("supports resetting default effects manager singleton", () => {
    const first = getDefaultEffectsManager();

    resetDefaultEffectsManager();

    const second = getDefaultEffectsManager();
    expect(second).not.toBe(first);
  });

  it("preserves named exports through the commonjs compatibility wrapper", () => {
    expect(effectsCompatModule.OBSEffectsManager).toBe(OBSEffectsManager);
    expect(effectsCompatModule.getDefaultEffectsManager).toBe(
      getDefaultEffectsManager,
    );
  });
});
