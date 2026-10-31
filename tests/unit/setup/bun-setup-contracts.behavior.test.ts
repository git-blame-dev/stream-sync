import { describe, expect, it } from "bun:test";
import { dirname } from "node:path";
import { withNativeChildEnvironment } from "../../helpers/native-child-environment";


type TestGlobal = typeof globalThis & {
  originalConsole: Console;
  restoreConsole: () => void;
};

describe("bun setup contracts behavior", () => {
  it("leaves external packages available without test-wide substitutes", async () => {
    const [websocket, axios, youtube] = await Promise.all([
      import("ws"), import("axios"), import("youtubei.js"),
    ]);
    expect(typeof websocket.WebSocket).toBe("function");
    expect(('mock' in websocket.WebSocket)).toBe(false);
    expect(typeof axios.default).toBe("function");
    expect(('mock' in axios.default.get)).toBe(false);
    expect(('mock' in youtube.Innertube.create)).toBe(false);
  });

  it("prerun preserves native process exit", async () => {
    expect(('mock' in process.exit)).toBe(false);
    await withNativeChildEnvironment(async (env) => {
      const child = Bun.spawnSync([process.execPath, "--no-env-file", "--eval", `
        await import(${JSON.stringify(import.meta.resolve("../../setup/bun.prerun.ts"))});
        process.exit(23);
      `], { cwd: dirname(env.CHAT_BOT_CONFIG_PATH!), env, stdout: "pipe", stderr: "pipe", timeout: 5000 });
      expect(child.exitCode).toBe(23);
    });
  });

  it("restores console through global helper", () => {
    const testGlobal = globalThis as TestGlobal;
    const originalConsole = testGlobal.originalConsole;
    const previousConsole = global.console;
    try {
      global.console = {
      ...originalConsole,
      log: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
      debug: () => {},
    };

      testGlobal.restoreConsole();
      expect(global.console).toBe(originalConsole);
    } finally {
      global.console = previousConsole;
    }
  });

});
