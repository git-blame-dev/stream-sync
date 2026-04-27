import { describe, expect, it } from "bun:test";

import { runMainEntrypoint } from "../../src/main.ts";

describe("main entrypoint behavior", () => {
  it("returns success when delegated main resolves", async () => {
    const result = await runMainEntrypoint(async () => ({ ok: true }));

    expect(result).toEqual({ success: true });
  });

  it("handles delegated main rejection and sets process exit code", async () => {
    const originalExitCode = process.exitCode;
    process.exitCode = undefined;

    const result = await runMainEntrypoint(async () => {
      throw "test-entrypoint-failure";
    });

    expect(result).toEqual({
      success: false,
      error: "test-entrypoint-failure",
    });
    expect(process.exitCode).toBe(1);

    process.exitCode = originalExitCode;
  });
});
