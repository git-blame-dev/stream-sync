import { describe, expect, test } from "bun:test";
import { createOperatorAppearanceService } from "../../../../src/services/operator/operator-appearance-service";

const defaults = { compactRows: false, rowBackgroundsEnabled: true, maxDisplayableBadges: 0, streamSupporterChatEffectsEnabled: true, memberRowTheme: "green" as const, memberRowEffects: ["sheen"] as const };

function memoryFs(initial?: string) {
  let value = initial;
  const files = new Map<string, string>();
  return {
    readFile: async () => { if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" }); return value; },
    mkdir: async () => {},
    rename: async (from: string, to: string) => { value = files.get(from) ?? ""; files.delete(from); files.set(to, value); },
    writeFile: async (path: string, content: string) => { files.set(path, content); },
    unlink: async (path: string) => { files.delete(path); },
    get value() { return value; }
  };
}

describe("operator appearance", () => {
  test("loads overrides and emits immutable revisioned snapshots", async () => {
    const service = await createOperatorAppearanceService({ defaults, filePath: "/tmp/operator-appearance.json", fs: memoryFs(JSON.stringify({ maxDisplayableBadges: 2 })) });
    expect(service.snapshot).toEqual({ sessionId: service.sessionId, revision: 0, settings: { ...defaults, maxDisplayableBadges: 2 }, overriddenKeys: ["maxDisplayableBadges"] });
    const snapshots: unknown[] = [];
    service.subscribe((snapshot) => snapshots.push(snapshot));
    await service.set("compactRows", true);
    expect(service.snapshot.revision).toBe(1);
    expect(Object.isFrozen(service.snapshot)).toBe(true);
    expect(Object.isFrozen(service.snapshot.settings)).toBe(true);
    expect(snapshots[0]).toEqual(service.snapshot);
  });

  test("supports zero, validates badge limits, and removes default-valued overrides", async () => {
    const service = await createOperatorAppearanceService({ defaults: { ...defaults, maxDisplayableBadges: 2 }, filePath: "/tmp/operator-appearance.json", fs: memoryFs() });
    await service.set("maxDisplayableBadges", 0);
    expect(service.snapshot.settings.maxDisplayableBadges).toBe(0);
    await service.set("maxDisplayableBadges", 2);
    expect(service.snapshot.overriddenKeys).toEqual([]);
    await expect(service.set("maxDisplayableBadges", -1)).rejects.toThrow();
    await expect(service.set("maxDisplayableBadges", 1.5)).rejects.toThrow();
  });

  test("persists stream supporter chat effects", async () => {
    const service = await createOperatorAppearanceService({ defaults, filePath: "/tmp/operator-appearance.json", fs: memoryFs() });
    await service.set("streamSupporterChatEffectsEnabled", false);
    expect(service.snapshot.settings.streamSupporterChatEffectsEnabled).toBe(false);
    expect(service.snapshot.overriddenKeys).toContain("streamSupporterChatEffectsEnabled");
  });

  test("normalizes and persists ordered member appearance", async () => {
    const service = await createOperatorAppearanceService({ defaults, filePath: "/tmp/operator-appearance.json", fs: memoryFs() });
    await service.set("memberRowTheme", "red");
    await service.set("memberRowEffects", ["particles"]);
    expect(service.snapshot.settings.memberRowTheme).toBe("red");
    expect(service.snapshot.settings.memberRowEffects).toEqual(["particles"]);
    expect(service.snapshot.overriddenKeys).toEqual(["memberRowTheme", "memberRowEffects"]);
    await expect(service.set("memberRowTheme", "blue" as never)).rejects.toThrow();
    await expect(service.set("memberRowEffects", ["sheen", "sheen"] as never)).rejects.toThrow();
  });

  test("compares effect defaults by value and owns persisted arrays", async () => {
    const service = await createOperatorAppearanceService({ defaults, filePath: "/tmp/operator-appearance.json", fs: memoryFs(JSON.stringify({ memberRowEffects: ["sheen"] })) });
    expect(service.snapshot.overriddenKeys).toEqual([]);

    const effects: ("sheen" | "particles")[] = ["particles"];
    await service.set("memberRowEffects", effects);
    effects[0] = "sheen";
    expect(service.snapshot.settings.memberRowEffects).toEqual(["particles"]);

    await service.set("memberRowEffects", ["sheen"]);
    expect(service.snapshot.overriddenKeys).toEqual([]);
  });

  test("reloads persisted member appearance in configured order", async () => {
    const fs = memoryFs();
    const first = await createOperatorAppearanceService({ defaults, filePath: "/tmp/operator-appearance.json", fs });
    await first.set("memberRowTheme", "gold");
    await first.set("memberRowEffects", ["particles", "sheen"]);

    const reloaded = await createOperatorAppearanceService({ defaults, filePath: "/tmp/operator-appearance.json", fs });
    expect(reloaded.snapshot.settings.memberRowTheme).toBe("gold");
    expect(reloaded.snapshot.settings.memberRowEffects).toEqual(["particles", "sheen"]);
    expect(reloaded.snapshot.overriddenKeys).toEqual(["memberRowTheme", "memberRowEffects"]);
  });

  test("merges missing member fields from current config defaults", async () => {
    const service = await createOperatorAppearanceService({ defaults, filePath: "/tmp/operator-appearance.json", fs: memoryFs(JSON.stringify({ compactRows: true })) });
    expect(service.snapshot.settings.memberRowTheme).toBe("green");
    expect(service.snapshot.settings.memberRowEffects).toEqual(["sheen"]);
  });

  test("malformed state falls back and reset persists defaults", async () => {
    const warnings: string[] = [];
    const fs = memoryFs("[]");
    const service = await createOperatorAppearanceService({ defaults, filePath: "/tmp/operator-appearance.json", fs, warn: (message) => warnings.push(message) });
    expect(service.snapshot.settings).toEqual(defaults);
    expect(warnings).toHaveLength(1);
    await service.reset();
    expect(JSON.parse(fs.value!)).toEqual({});
  });

  test("keeps authoritative state unchanged when persistence fails", async () => {
    const base = memoryFs();
    let shouldFail = true;
    const fs = {
      ...base,
      writeFile: async (path: string, content: string) => {
        if (shouldFail) throw new Error("write failed");
        return base.writeFile(path, content);
      },
    };
    const service = await createOperatorAppearanceService({ defaults, filePath: "/tmp/operator-appearance.json", fs });

    await expect(service.set("compactRows", true)).rejects.toThrow("write failed");
    expect(service.snapshot).toEqual({ sessionId: service.sessionId, revision: 0, settings: defaults, overriddenKeys: [] });

    shouldFail = false;
    await service.set("compactRows", true);
    expect(service.snapshot).toEqual({
      sessionId: service.sessionId,
      revision: 1,
      settings: { ...defaults, compactRows: true },
      overriddenKeys: ["compactRows"],
    });
  });
});
