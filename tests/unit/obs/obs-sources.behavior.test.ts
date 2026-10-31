import { afterEach, describe, expect, it } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import {
  createOBSSourcesManager,
  getDefaultSourcesManager,
  resetDefaultSourcesManager,
  sanitizeForOBS,
} from "../../../src/obs/sources.ts";

describe("OBS source operations", () => {
  afterEach(() => {
    resetDefaultSourcesManager();
  });

  const manager = () => ({
    ensureConnected: createMockFn<[], Promise<void>>().mockResolvedValue(),
    call: createMockFn<[string, Record<string, unknown>?], Promise<unknown>>(),
    isConnected: () => true,
    isReady: async () => true,
  });

  it("updates text while preserving existing settings and sanitizing text", async () => {
    const obs = manager();
    obs.call.mockResolvedValueOnce({ inputSettings: { font: "Inter" } }).mockResolvedValueOnce({});
    const sources = createOBSSourcesManager(obs, { logger: noOpLogger });
    await sources.updateTextSource("chat", "hello 🌟");
    expect(obs.call.mock.calls).toEqual([
      ["GetInputSettings", { inputName: "chat" }],
      ["SetInputSettings", { inputName: "chat", inputSettings: { font: "Inter", text: "hello " }, overlay: false }],
    ]);
  });

  it("clears text while preserving other settings", async () => {
    const obs = manager();
    obs.call.mockResolvedValueOnce({ inputSettings: { text: "old", font: "Arial" } }).mockResolvedValueOnce({});
    const sources = createOBSSourcesManager(obs, { logger: noOpLogger });
    await sources.clearTextSource("tts");
    expect(obs.call.mock.calls[1]?.[1]).toEqual({ inputName: "tts", inputSettings: { text: "", font: "Arial" }, overlay: false });
  });

  it("looks up and toggles a scene source", async () => {
    const obs = manager();
    obs.call.mockResolvedValueOnce({ sceneItemId: 42 }).mockResolvedValueOnce({});
    const sources = createOBSSourcesManager(obs, { logger: noOpLogger });
    await sources.setSourceVisibility("scene", "source", false);
    expect(obs.call.mock.calls[1]).toEqual(["SetSceneItemEnabled", { sceneName: "scene", sceneItemId: 42, sceneItemEnabled: false }]);
  });

  it("forwards source filter operations", async () => {
    const obs = manager();
    obs.call.mockResolvedValueOnce({ filterSettings: { opacity: 50 } }).mockResolvedValueOnce({});
    const sources = createOBSSourcesManager(obs, { logger: noOpLogger });
    await expect(sources.getSourceFilterSettings("source", "filter")).resolves.toEqual({ opacity: 50 });
    await sources.setSourceFilterEnabled("source", "filter", true);
    expect(obs.call.mock.calls[1]).toEqual(["SetSourceFilterEnabled", { sourceName: "source", filterName: "filter", filterEnabled: true }]);
  });

  it("forwards source filter settings updates", async () => {
    const obs = manager();
    obs.call.mockResolvedValue({});
    const sources = createOBSSourcesManager(obs, { logger: noOpLogger });

    await sources.setSourceFilterSettings("source", "filter", { opacity: 75 });

    expect(obs.call).toHaveBeenCalledWith("SetSourceFilterSettings", {
      sourceName: "source",
      filterName: "filter",
      filterSettings: { opacity: 75 },
    });
  });

  it.each([
    ["set enabled", "SetSourceFilterEnabled"],
    ["get settings", "GetSourceFilter"],
    ["set settings", "SetSourceFilterSettings"],
  ])("propagates filter errors from %s operations", async (_name, operation) => {
    const obs = manager();
    obs.call.mockRejectedValue(new Error("test filter failure"));
    const sources = createOBSSourcesManager(obs, { logger: noOpLogger });

    let action: Promise<unknown>;
    if (operation === "SetSourceFilterEnabled") {
      action = sources.setSourceFilterEnabled("source", "filter", true);
    } else if (operation === "GetSourceFilter") {
      action = sources.getSourceFilterSettings("source", "filter");
    } else {
      action = sources.setSourceFilterSettings("source", "filter", {});
    }

    await expect(action).rejects.toThrow("test filter failure");
  });

  it("creates a degraded default manager when connection lookup throws", () => {
    const sources = getDefaultSourcesManager({
      logger: noOpLogger,
      ensureOBSConnected: async () => {},
      obsCall: async () => ({}),
      getOBSConnectionManager: () => {
        throw new Error("test connection lookup failure");
      },
    });

    expect(sources.isDegraded).toBe(true);
  });

  it("creates a degraded default manager when connection lookup is empty", () => {
    const sources = getDefaultSourcesManager({
      logger: noOpLogger,
      ensureOBSConnected: async () => {},
      obsCall: async () => ({}),
      getOBSConnectionManager: () => null as never,
    });

    expect(sources.isDegraded).toBe(true);
  });

  it("unregisters cache invalidation when resetting the default manager", () => {
    const invalidators: Array<(() => void) | null> = [];
    const obs = {
      ...manager(),
      setSourcesCacheInvalidator: (invalidator: (() => void) | null) => {
        invalidators.push(invalidator);
      },
    };
    getDefaultSourcesManager({
      logger: noOpLogger,
      ensureOBSConnected: obs.ensureConnected,
      obsCall: obs.call,
      getOBSConnectionManager: () => obs,
    });

    resetDefaultSourcesManager();

    expect(invalidators).toHaveLength(2);
    expect(invalidators[0]).toBeFunction();
    expect(invalidators[1]).toBeNull();
  });

  it("sanitizes non-string and non-ASCII values", () => {
    expect(sanitizeForOBS("Hi 🚀")).toBe("Hi ");
    expect(sanitizeForOBS(null)).toBe("");
  });
});

it('writes private text and filter settings without copying their contents into diagnostics', async () => {
  const diagnostics: unknown[] = [];
  const capture = (...args: unknown[]) => { diagnostics.push(args); };
  const calls: unknown[] = [];
  const manager = {
    ensureConnected: async () => {}, isConnected: () => true, isReady: async () => true,
    call: async (method: string, data?: Record<string, unknown>) => {
      calls.push({ method, data });
      return method === 'GetInputSettings' ? { inputSettings: { font: 'Synthetic font' } } : {};
    },
  };
  const sources = createOBSSourcesManager(manager, { logger: { ...noOpLogger, debug: capture, warn: capture } });
  await sources.updateTextSource('synthetic-chat', 'synthetic-private-message 🌟');
  await sources.setSourceFilterSettings('synthetic-chat', 'synthetic-filter', { text: 'synthetic-private-filter' });
  expect(calls).toContainEqual({ method: 'SetInputSettings', data: { inputName: 'synthetic-chat', inputSettings: { font: 'Synthetic font', text: 'synthetic-private-message ' }, overlay: false } });
  expect(calls).toContainEqual({ method: 'SetSourceFilterSettings', data: { sourceName: 'synthetic-chat', filterName: 'synthetic-filter', filterSettings: { text: 'synthetic-private-filter' } } });
  expect(JSON.stringify(diagnostics)).not.toContain('synthetic-private');
});
