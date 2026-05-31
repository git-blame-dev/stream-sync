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
import type { TestMockFn } from "../../helpers/bun-mock-utils";

type ObsManagerLike = ConstructorParameters<typeof OBSEffectsManager>[0];
type ObsCall = TestMockFn<
  [requestType: string, payload?: Record<string, unknown>],
  Promise<unknown>
>;
type ObsEventHandler = (event?: Record<string, unknown>) => void;
type TestObsManager = ObsManagerLike & {
  ensureConnected: TestMockFn<[], Promise<void>>;
  call: ObsCall;
  addEventListener: TestMockFn<
    [eventName: string, handler: ObsEventHandler],
    void
  >;
  removeEventListener: TestMockFn<
    [eventName: string, handler: ObsEventHandler],
    void
  >;
};

function hasUpdateTextSource(
  value: unknown,
): value is { updateTextSource: unknown } {
  return (
    value !== null &&
    typeof value === "object" &&
    "updateTextSource" in value
  );
}

describe("obs effects behavior", () => {
  let mockObsManager: TestObsManager;

  const createObsManager = (): TestObsManager => ({
    ensureConnected: createMockFn<[], Promise<void>>(async () => {}),
    call: createMockFn<
      [requestType: string, payload?: Record<string, unknown>],
      Promise<unknown>
    >(async () => ({})),
    addEventListener: createMockFn<
      [eventName: string, handler: ObsEventHandler],
      void
    >(),
    removeEventListener: createMockFn<
      [eventName: string, handler: ObsEventHandler],
      void
    >(),
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
    const requestTypes = mockObsManager.call.mock.calls.map(
      ([requestType]) => requestType,
    );
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
    Object.assign(manager, { obsManager: null });

    await expect(
      manager.waitForMediaCompletion("testSrc"),
    ).resolves.toBeUndefined();
  });

  it("resolves when media playback ended event is emitted for the source", async () => {
    const manager = new OBSEffectsManager(mockObsManager, {
      logger: noOpLogger,
    });

    const pending = manager.waitForMediaCompletion("testSrc");
    const listenerCall = mockObsManager.addEventListener.mock.calls[0];
    expect(listenerCall).toBeDefined();
    const mediaEndHandler = listenerCall?.[1];
    expect(mediaEndHandler).toBeDefined();
    if (!mediaEndHandler) {
      throw new Error("Expected media end handler to be registered");
    }
    mediaEndHandler({ inputName: "testSrc" });

    await expect(pending).resolves.toBeUndefined();
    expect(mockObsManager.removeEventListener).toHaveBeenCalledTimes(1);
  });

  it("rejects waiting for media completion when obs manager lacks event listener support", async () => {
    const manager = new OBSEffectsManager(
      {
        ensureConnected: createMockFn<[], Promise<void>>(async () => {}),
        call: createMockFn<
          [requestType: string, payload?: Record<string, unknown>],
          Promise<unknown>
        >(async () => ({})),
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
    const obsCall = mockObsManager.call.mock.calls[0];
    expect(obsCall).toBeDefined();
    const [requestType, payload] = obsCall ?? [];
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
    expect(hasUpdateTextSource(manager.sourcesManager)).toBe(true);
    if (!hasUpdateTextSource(manager.sourcesManager)) {
      throw new Error("Expected default sources manager to expose updateTextSource");
    }
    expect(typeof manager.sourcesManager.updateTextSource).toBe("function");
  });

  it("supports resetting default effects manager singleton", () => {
    const first = getDefaultEffectsManager();

    resetDefaultEffectsManager();

    const second = getDefaultEffectsManager();
    expect(second).not.toBe(first);
  });

  it("preserves named exports through the module namespace", () => {
    expect(effectsCompatModule.OBSEffectsManager).toBe(OBSEffectsManager);
    expect(effectsCompatModule.getDefaultEffectsManager).toBe(
      getDefaultEffectsManager,
    );
  });
});
