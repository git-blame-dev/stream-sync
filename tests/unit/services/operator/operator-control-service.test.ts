import { describe, expect, test } from "bun:test";
import { createOperatorControlService, OPERATOR_CONTROL_KEYS } from "../../../../src/services/operator/operator-control-service";

const defaults = OPERATOR_CONTROL_KEYS.reduce((result, key) => ({ ...result, [key]: true }), {} as Record<(typeof OPERATOR_CONTROL_KEYS)[number], boolean>);

function memoryFs(initial?: string, options: { failWrites?: number } = {}) {
  let value = initial;
  let remainingWriteFailures = options.failWrites ?? 0;
  const files = new Map<string, string>();
  return {
    readFile: async () => {
      if (value === undefined) throw Object.assign(new Error("missing"), { code: "ENOENT" });
      return value;
    },
    mkdir: async () => {},
    rename: async (from: string, to: string) => { value = files.get(from) ?? ""; files.delete(from); files.set(to, value); },
    writeFile: async (path: string, content: string) => {
      if (remainingWriteFailures > 0) {
        remainingWriteFailures -= 1;
        throw new Error("write failed");
      }
      files.set(path, content);
    },
    unlink: async (path: string) => { files.delete(path); },
    get value() { return value; },
  };
}

describe("operator controls", () => {
  test("loads overrides and exposes revisioned subscriptions", async () => {
    const fs = memoryFs(JSON.stringify({ giftsEnabled: false }));
    const service = await createOperatorControlService({ defaults, filePath: "/tmp/operator.json", fs });
    expect(service.controls.giftsEnabled).toBe(false);
    expect(service.overriddenKeys).toEqual(["giftsEnabled"]);
    expect(service.revision).toBe(0);
    const revisions: number[] = [];
    const unsubscribe = service.subscribe((snapshot) => revisions.push(snapshot.revision));
    await service.setEnabled("giftsEnabled", true);
    expect(service.isEnabled("giftsEnabled")).toBe(true);
    expect(service.revision).toBe(1);
    expect(revisions).toEqual([1]);
    unsubscribe();
  });

  test("reset persists an empty override set", async () => {
    const fs = memoryFs(JSON.stringify({ giftsEnabled: false }));
    const service = await createOperatorControlService({ defaults, filePath: "/tmp/operator.json", fs });
    await service.reset();
    expect(service.overriddenKeys).toEqual([]);
    expect(service.controls).toEqual(defaults);
    expect(JSON.parse(fs.value!)).toEqual({});
  });

  test("malformed state falls back and warns", async () => {
    const warnings: string[] = [];
    const service = await createOperatorControlService({ defaults, filePath: "/tmp/operator.json", fs: memoryFs("[]"), warn: (message) => warnings.push(message) });
    expect(service.controls).toEqual(defaults);
    expect(warnings).toHaveLength(1);
  });

  test("normalizes loaded defaults and serializes concurrent updates", async () => {
    const fs = memoryFs(JSON.stringify({ giftsEnabled: true }));
    const service = await createOperatorControlService({ defaults, filePath: "/tmp/operator.json", fs });
    expect(service.overriddenKeys).toEqual([]);
    const first = service.setEnabled("giftsEnabled", false);
    const second = service.setEnabled("sharesEnabled", false);
    await Promise.all([first, second]);
    expect(service.overriddenKeys).toEqual(["giftsEnabled", "sharesEnabled"]);
  });

  test("preserves runtime state after a write failure and accepts the next update", async () => {
    const fs = memoryFs(undefined, { failWrites: 1 });
    const service = await createOperatorControlService({ defaults, filePath: "/tmp/operator.json", fs });

    await expect(service.setEnabled("giftsEnabled", false)).rejects.toThrow("write failed");
    expect(service.isEnabled("giftsEnabled")).toBe(true);
    await service.setEnabled("sharesEnabled", false);

    expect(service.isEnabled("giftsEnabled")).toBe(true);
    expect(service.isEnabled("sharesEnabled")).toBe(false);
  });

  test("rejects invalid public inputs and isolates subscriber failures", async () => {
    const service = await createOperatorControlService({ defaults, filePath: "/tmp/operator.json", fs: memoryFs() });
    expect(() => service.isEnabled("unknown" as never)).toThrow();
    expect(() => service.setEnabled("messagesEnabled", true as never)).not.toThrow();
    await expect(service.setEnabled("messagesEnabled", "yes" as never)).rejects.toThrow();
    service.subscribe(() => { throw new Error("subscriber"); });
    await service.setEnabled("messagesEnabled", false);
    expect(service.isEnabled("messagesEnabled")).toBe(false);
  });
});
