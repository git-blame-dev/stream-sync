import { describe, it, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { ensureSecrets } from "../../src/utils/secret-manager.ts";
import { createConfigFixture } from "../helpers/config-fixture";

describe("secret-manager interactive gating integration", () => {
  it.each([
    { name: "non-TTY", isTTY: false, ci: undefined },
    { name: "CI", isTTY: true, ci: "true" },
  ])("rejects missing required secrets with zero prompt calls in implicit $name mode", ({ isTTY, ci }) => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "synthetic-secret-gating-"));
    const envFilePath = path.join(tempDir, "secrets", ".env");
    try {
      fs.mkdirSync(path.dirname(envFilePath));
      fs.writeFileSync(envFilePath, "SYNTHETIC_EXISTING=keep\n", { mode: 0o600 });
      // A child with a synthetic-only environment avoids reading or changing host secrets.
      const child = Bun.spawnSync([process.execPath, '--no-env-file', "-e", `
import assert from 'node:assert/strict';
import { ensureSecrets } from ${JSON.stringify(import.meta.resolve("../../src/utils/secret-manager.ts"))};
const originalTTY = Object.getOwnPropertyDescriptor(process.stdin, 'isTTY');
const originalCI = process.env.CI;
let promptCalls = 0;
try {
  Object.defineProperty(process.stdin, 'isTTY', { configurable: true, value: ${isTTY} });
  ${ci === undefined ? "delete process.env.CI;" : 'process.env.CI = "true";'}
  await assert.rejects(ensureSecrets({
    config: { tiktok: { enabled: true } },
    logger: { debug() {}, info() {}, warn() {}, error() {} },
    envFilePath: ${JSON.stringify(envFilePath)},
    envFileReadEnabled: true,
    envFileWriteEnabled: true,
    promptFor: async () => { promptCalls++; throw new Error('synthetic prompt must not run'); },
  }), /Missing required secrets: TIKTOK_API_KEY/);
  assert.equal(promptCalls, 0);
} finally {
  if (originalTTY) Object.defineProperty(process.stdin, 'isTTY', originalTTY);
  else Reflect.deleteProperty(process.stdin, 'isTTY');
  if (originalCI === undefined) delete process.env.CI;
  else process.env.CI = originalCI;
}
`], { cwd: tempDir, env: { NODE_ENV: "test" }, stdout: "pipe", stderr: "pipe" });
      expect({ code: child.exitCode, stderr: child.stderr.toString() }).toEqual({ code: 0, stderr: "" });
      expect(child.stdout.toString()).toBe("");
      expect(fs.readFileSync(envFilePath, "utf8")).toBe("SYNTHETIC_EXISTING=keep\n");
      expect(fs.readdirSync(path.dirname(envFilePath))).toEqual([".env"]);
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("prompts and persists required secrets when interactive and TTY is available", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-secrets-"));
    const envFilePath = path.join(tempDir, ".env");

    fs.writeFileSync(envFilePath, "SYNTHETIC_EXISTING=keep\n", { mode: 0o644 });
    const originalInode = fs.statSync(envFilePath).ino;

    const originalIsTTY = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    const originalCI = process.env.CI;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEnv = {
      TIKTOK_API_KEY: process.env.TIKTOK_API_KEY,
    };

    Object.defineProperty(process.stdin, "isTTY", { configurable: true, value: true });
    delete process.env.CI;
    process.env.NODE_ENV = "test";
    delete process.env.TIKTOK_API_KEY;

    const promptCalls: string[] = [];
    const promptFor = async (secretId: string) => {
      promptCalls.push(secretId);
      return "test-tiktok-api-key";
    };

    const logger = {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    try {
      const config = createConfigFixture({
        tiktok: { enabled: true },
        twitch: { enabled: false },
        obs: { enabled: false },
        streamelements: { enabled: false },
        youtube: { enabled: false },
      });

      const result = await ensureSecrets({
        config,
        logger,
        interactive: true,
        envFilePath,
        envFileReadEnabled: false,
        envFileWriteEnabled: true,
        promptFor,
      });

      const envContent = fs.readFileSync(envFilePath, "utf8");
      expect(envContent).toContain("TIKTOK_API_KEY=test-tiktok-api-key");
      expect(envContent).toContain("SYNTHETIC_EXISTING=keep");
      expect(fs.statSync(envFilePath).ino).not.toBe(originalInode);
      if (process.platform !== "win32") expect(fs.statSync(envFilePath).mode & 0o777).toBe(0o600);
      expect(fs.readdirSync(tempDir)).toEqual([".env"]);
      expect(promptCalls).toEqual(["TIKTOK_API_KEY"]);
      expect(result.missingRequired).toEqual([]);
      expect(result.persisted).toContain("TIKTOK_API_KEY");
    } finally {
      if (originalIsTTY) Object.defineProperty(process.stdin, "isTTY", originalIsTTY);
      else Reflect.deleteProperty(process.stdin, "isTTY");
      if (originalCI === undefined) {
        delete process.env.CI;
      } else {
        process.env.CI = originalCI;
      }
      if (originalNodeEnv === undefined) {
        delete process.env.NODE_ENV;
      } else {
        process.env.NODE_ENV = originalNodeEnv;
      }
      if (originalEnv.TIKTOK_API_KEY === undefined) {
        delete process.env.TIKTOK_API_KEY;
      } else {
        process.env.TIKTOK_API_KEY = originalEnv.TIKTOK_API_KEY;
      }
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });
});
