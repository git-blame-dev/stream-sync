import { describe, it, expect } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ini from "ini";

import { DEFAULTS } from "../../../src/core/config-schema";
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
    expect(normalized.gui).toEqual(DEFAULTS.gui);
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
  });

  it("defines exactly the approved monetization values in the example", () => {
    const parsed = readConfigExample();
    expect(Object.keys(parsed.monetizationValues).sort()).toEqual([
      "tiktokGiftUnitUsd", "tiktokMembershipUsd", "twitchBitUsd",
      "twitchMembershipUsd", "youtubeJewelUsd", "youtubeMembershipUsd",
    ].sort());
  });
});
