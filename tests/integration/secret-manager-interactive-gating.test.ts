import { describe, it, expect } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { ensureSecrets } from "../../src/utils/secret-manager.ts";
import { createConfigFixture } from "../helpers/config-fixture";

describe("secret-manager interactive gating integration", () => {
  it("prompts and persists required secrets when interactive and TTY is available", async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-secrets-"));
    const envFilePath = path.join(tempDir, ".env");

    const originalIsTTY = process.stdin.isTTY;
    const originalCI = process.env.CI;
    const originalNodeEnv = process.env.NODE_ENV;
    const originalEnv = {
      TIKTOK_API_KEY: process.env.TIKTOK_API_KEY,
    };

    process.stdin.isTTY = true;
    delete process.env.CI;
    process.env.NODE_ENV = "test";
    delete process.env.TIKTOK_API_KEY;

    const promptCalls = [];
    const promptFor = async (secretId) => {
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
      expect(promptCalls).toEqual(["TIKTOK_API_KEY"]);
      expect(result.missingRequired).toEqual([]);
      expect(result.persisted).toContain("TIKTOK_API_KEY");
    } finally {
      process.stdin.isTTY = originalIsTTY;
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
