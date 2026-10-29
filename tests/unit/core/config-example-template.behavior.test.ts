import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import ini from "ini";

import { DEFAULTS } from "../../../src/core/config-schema";
import { loadConfig, _resetConfigForTesting } from "../../../src/core/config";
import { buildLoggingConfig } from "../../../src/core/config-builders";
import { ConfigValidator } from "../../../src/utils/config-validator";

const CURRENT_DIR = path.dirname(fileURLToPath(import.meta.url));

function readConfigExample() {
  const filePath = path.resolve(CURRENT_DIR, "../../../config.example.ini");
  const raw = fs.readFileSync(filePath, "utf8");
  return ini.parse(raw);
}

describe("config example template behavior", () => {
  it("defines the gui section with schema-aligned keys and defaults", () => {
    const parsed = readConfigExample();
    expect(parsed.gui).toBeDefined();
    const guiConfig = parsed.gui;
    if (!guiConfig) {
      throw new Error("Expected config.example.ini to define [gui]");
    }

    expect(Object.keys(guiConfig).sort()).toEqual(
      Object.keys(DEFAULTS.gui).sort(),
    );

    const normalized = ConfigValidator.normalize({ gui: guiConfig });
    expect<unknown>(normalized.gui).toEqual(DEFAULTS.gui);
  });

  it("defines display queue section with schema-aligned defaults", () => {
    const parsed = readConfigExample();
    const displayQueueConfig = parsed.displayQueue;
    if (!displayQueueConfig) {
      throw new Error("Expected config.example.ini to define [displayQueue]");
    }

    expect(Object.keys(displayQueueConfig).sort()).toEqual(
      Object.keys(DEFAULTS.displayQueue).sort(),
    );

    const normalized = ConfigValidator.normalize({
      displayQueue: displayQueueConfig,
    });
    expect(normalized.displayQueue).toEqual(DEFAULTS.displayQueue);
  });

  it("loads the complete example through production normalization and validation", () => {
    const normalized = ConfigValidator.normalize(readConfigExample());

    expect(normalized.fundingGoal).toMatchObject({
      enabled: false,
      id: "support",
      label: "Support Goal",
      targetUsd: 100,
    });
    expect(normalized.monetizationValues).toEqual({
      tiktokGiftUnitUsd: 0.005,
      twitchBitUsd: 0.01,
      youtubeJewelUsd: 0.005,
      tiktokMembershipUsd: 2.10,
      twitchMembershipUsd: 3.50,
      youtubeMembershipUsd: 3.89,
    });
    expect(normalized.monetizationValues).not.toHaveProperty("paypiggyUsd");
    expect(normalized.monetizationValues).not.toHaveProperty("fundingValuationUsd");
    expect(normalized.http.enhancedTimeoutMs).toBe(6000);
    expect(normalized.http.enhancedTimeoutMs).toBe(DEFAULTS.http.enhancedTimeoutMs);
    expect(ConfigValidator.validate(normalized)).toEqual({ isValid: true, errors: [] });
    expect(normalized.logging.consoleLevel).toBe("warn");
    expect(buildLoggingConfig(normalized).console.level).toBe("warn");
    expect(buildLoggingConfig(normalized, { debugMode: true }).console.level).toBe("debug");
    expect(buildLoggingConfig(ConfigValidator.normalize({ ...readConfigExample(), logging: { consoleLevel: "invalid" } })).console.level).toBe("warn");
  });

  it("defines exactly the approved monetization values in the example", () => {
    const parsed = readConfigExample();
    expect(Object.keys(parsed.monetizationValues).sort()).toEqual([
      "tiktokGiftUnitUsd", "tiktokMembershipUsd", "twitchBitUsd",
      "twitchMembershipUsd", "youtubeJewelUsd", "youtubeMembershipUsd",
    ].sort());
  });
});


describe("YouTube supported configuration", () => {
  for (const setting of ["enableAPI = true", "streamDetectionMethod = api", "viewerCountMethod = api"]) {
    it(`rejects unsupported ${setting} from parsed INI`, () => {
      const raw = readConfigExample();
      raw.youtube = { ...raw.youtube, ...ini.parse(`[youtube]\n${setting}`).youtube };
      expect(() => ConfigValidator.normalize(raw)).toThrow(/YouTube Data API.*not supported.*youtubei/);
      const validation = ConfigValidator.validate(raw);
      expect(validation.isValid).toBe(false);
      expect(validation.errors.join(" ")).toMatch(/YouTube Data API.*not supported.*youtubei/);

      const previousPath = process.env.CHAT_BOT_CONFIG_PATH;
      const directory = fs.mkdtempSync(path.join(os.tmpdir(), "stream-sync-youtube-capability-"));
      try {
        raw.general.envFileReadEnabled = false;
        raw.general.envFileWriteEnabled = false;
        raw.logging.fileLoggingEnabled = false;
        const configPath = path.join(directory, "synthetic.ini");
        fs.writeFileSync(configPath, ini.stringify(raw));
        process.env.CHAT_BOT_CONFIG_PATH = configPath;
        _resetConfigForTesting();
        expect(() => loadConfig()).toThrow(/YouTube Data API.*not supported.*youtubei/);
      } finally {
        if (previousPath === undefined) delete process.env.CHAT_BOT_CONFIG_PATH;
        else process.env.CHAT_BOT_CONFIG_PATH = previousPath;
        _resetConfigForTesting();
        fs.rmSync(directory, { recursive: true, force: true });
      }
    });
  }
});
