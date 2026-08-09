import { describe, expect, it } from "bun:test";
import { createMockFn } from "../../helpers/bun-mock-utils";
import { noOpLogger } from "../../helpers/mock-factories";
import { createOBSSourcesManager } from "../../../src/obs/sources.ts";

describe("OBS source characterization", () => {
  it("caches scene item IDs and invalidates the cache", async () => {
    const call = createMockFn<[string, Record<string, unknown>?], Promise<unknown>>()
      .mockResolvedValueOnce({ sceneItemId: 7 }).mockResolvedValueOnce({ sceneItemId: 8 });
    const holder: { invalidate: (() => void) | null } = { invalidate: null };
    const manager = { ensureConnected: async () => {}, call, isConnected: () => true, isReady: async () => true, setSourcesCacheInvalidator: (fn: (() => void) | null) => { holder.invalidate = fn; } };
    const sources = createOBSSourcesManager(manager, { logger: noOpLogger });
    await sources.getSceneItemId("scene", "source");
    await sources.getSceneItemId("scene", "source");
    expect(call).toHaveBeenCalledTimes(1);
    if (holder.invalidate) holder.invalidate();
    await sources.getSceneItemId("scene", "source");
    expect(call).toHaveBeenCalledTimes(2);
  });

  it("rejects missing scene item IDs", async () => {
    const manager = { ensureConnected: async () => {}, call: async () => ({ sceneItemId: null }), isConnected: () => true, isReady: async () => true };
    const sources = createOBSSourcesManager(manager, { logger: noOpLogger });
    await expect(sources.getSceneItemId("scene", "missing")).rejects.toThrow("missing");
  });
});
