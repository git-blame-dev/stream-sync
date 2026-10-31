import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import { withNativeChildEnvironment } from "../helpers/native-child-environment";

import { runMainEntrypoint } from "../../src/main.ts";

describe("main entrypoint behavior", () => {
  it("returns success when delegated main resolves", async () => {
    const result = await runMainEntrypoint(async () => ({ ok: true }));

    expect(result).toEqual({ success: true });
  });

  it("handles delegated main rejection and exits nonzero in a native process", async () => {
    await withNativeChildEnvironment(async env => {
      const script = `
        import { runMainEntrypoint } from ${JSON.stringify(import.meta.resolve('../../src/main.ts'))};
        const result = await runMainEntrypoint(async () => { throw 'synthetic-entrypoint-failure'; });
        process.stdout.write(JSON.stringify({ result, exitCode: process.exitCode }));
      `;
      const child = Bun.spawnSync([process.execPath, '--no-env-file', '--eval', script], {
        cwd: dirname(env.CHAT_BOT_CONFIG_PATH!), env, stdout: 'pipe', stderr: 'pipe', timeout: 5000,
      });
      expect(child.exitCode).toBe(1);
      expect(JSON.parse(child.stdout.toString())).toEqual({
        result: { success: false, error: 'synthetic-entrypoint-failure' }, exitCode: 1,
      });
      expect(child.stderr.toString()).toContain('Fatal startup failure: synthetic-entrypoint-failure');
    });
  });
});
