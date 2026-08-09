import { describe, expect, it } from "bun:test";
import { createOBSSourcesManager, OBSSourcesManager } from "../../../src/obs/sources.ts";

describe("OBS sources dependency injection", () => {
  it("requires an OBS manager", () => {
    expect(() => Reflect.construct(OBSSourcesManager, [])).toThrow(/OBSConnectionManager/);
  });

  it("requires connection operation dependencies", () => {
    const manager = { call: async () => ({}), isConnected: () => true, isReady: async () => true } as never;
    expect(() => createOBSSourcesManager(manager, {})).toThrow(/ensureOBSConnected/);
  });

  it("requires an OBS call dependency", () => {
    const manager = {
      ensureConnected: async () => {},
      isConnected: () => true,
      isReady: async () => true,
    } as never;

    expect(() => createOBSSourcesManager(manager, {})).toThrow(/obsCall/);
  });
});
