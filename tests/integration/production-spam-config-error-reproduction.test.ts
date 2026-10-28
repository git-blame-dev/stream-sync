import { afterEach, beforeEach, describe, it, expect } from "bun:test";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";
import ini from "ini";
import { getRawTestConfig } from "../helpers/config-fixture";
import { createDonationSpamDetection, createSpamDetectionConfig } from "../../src/utils/spam-detection";

const load = createRequire(import.meta.url);
const configModulePath = load.resolve("../../src/core/config");
let config: { spam: Required<Parameters<typeof createSpamDetectionConfig>[0]> };
let previousEntry: NodeJS.Module | undefined;
let previousConfigPath: string | undefined;
let temporaryDirectory: string | undefined;
const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} };

describe("Synthetic spam configuration integration", () => {
  beforeEach(() => {
    previousEntry = load.cache[configModulePath];
    previousConfigPath = process.env.CHAT_BOT_CONFIG_PATH;
    temporaryDirectory = fs.mkdtempSync(path.join(tmpdir(), 'spam-config-fixture-'));
    const raw = getRawTestConfig();
    raw.general.envFileReadEnabled = false;
    const syntheticPath = path.join(temporaryDirectory, 'synthetic.ini');
    fs.writeFileSync(syntheticPath, ini.stringify(raw));
    process.env.CHAT_BOT_CONFIG_PATH = syntheticPath;
    delete load.cache[configModulePath];
    ({ config } = load(configModulePath));
  });

  afterEach(() => {
    try {
      if (previousEntry) load.cache[configModulePath] = previousEntry;
      else delete load.cache[configModulePath];
    } finally {
      try {
        if (previousConfigPath === undefined) delete process.env.CHAT_BOT_CONFIG_PATH;
        else process.env.CHAT_BOT_CONFIG_PATH = previousConfigPath;
      } finally {
        if (temporaryDirectory) fs.rmSync(temporaryDirectory, { recursive: true, force: true });
        temporaryDirectory = undefined;
      }
    }
    expect(load.cache[configModulePath]).toBe(previousEntry);
    expect(process.env.CHAT_BOT_CONFIG_PATH).toBe(previousConfigPath);
  });
  describe("when parsing configuration for spam detection", () => {
    describe("and config.spam is unexpectedly undefined", () => {
it("provides spam configuration from the config module", () => {
        expect(config.spam).toBeDefined();
        expect(config.spam).not.toBeNull();
        expect(config.spam).not.toBeUndefined();
      });

it("exposes a complete spam config structure", () => {
        const spamConfig = config.spam;

        expect(spamConfig.enabled).toBeDefined();
        expect(spamConfig.detectionWindow).toBeDefined();
        expect(spamConfig.maxIndividualNotifications).toBeDefined();
        expect(spamConfig.lowValueThreshold).toBeDefined();
      });
    });

    describe("and checking for potential configuration loading race conditions", () => {
it("keeps spam config available after a fresh config module load", () => {
        const originalEntry = load.cache[configModulePath];
        try {
          delete load.cache[configModulePath];
          const { config: freshConfig } = load(configModulePath);
          expect(freshConfig.spam).toBeDefined();
          expect(freshConfig.spam.enabled).toBeDefined();
        } finally {
          if (originalEntry) load.cache[configModulePath] = originalEntry;
          else delete load.cache[configModulePath];
        }
      });

it("makes spam config immediately accessible", () => {
        expect(config).toBeDefined();
        expect(config.spam).toBeDefined();
        expect(config.spam.enabled).toBeDefined();
      });
    });

    describe("and testing config structure for service creation", () => {
it("matches the spam config structure expected by services", () => {
        const spamConfig = config.spam;

        expect(spamConfig).toHaveProperty("enabled");
        expect(spamConfig).toHaveProperty("detectionWindow");
        expect(spamConfig).toHaveProperty("maxIndividualNotifications");
        expect(spamConfig).toHaveProperty("lowValueThreshold");

        expect(typeof spamConfig.enabled).toBe("boolean");
        expect(typeof spamConfig.detectionWindow).toBe("number");
        expect(typeof spamConfig.maxIndividualNotifications).toBe("number");
        expect(typeof spamConfig.lowValueThreshold).toBe("number");
      });

it("uses spam config values valid for service initialization", () => {
        const spamConfig = config.spam;

        expect(spamConfig.detectionWindow).toBeGreaterThan(0);
        expect(spamConfig.maxIndividualNotifications).toBeGreaterThan(0);
        expect(spamConfig.lowValueThreshold).toBeGreaterThanOrEqual(0);
      });
    });
  });

  describe("when validating the complete fix", () => {
    describe("and verifying spam detection service can be created", () => {
      it("should successfully create spam detection service without errors", () => {
        const spamConfig = config.spam;

        const detectionConfig = createSpamDetectionConfig(spamConfig, { logger });
        const detector = createDonationSpamDetection(detectionConfig, { logger, autoCleanup: false });
        try {
          const threshold = detectionConfig.getPlatformConfig('twitch').lowValueThreshold;
          expect(detector.isLowValueDonation(threshold, 'twitch')).toBe(true);
          expect(detector.isLowValueDonation(threshold + 1, 'twitch')).toBe(false);
        } finally {
          detector.destroy();
        }
      });

      it("should provide config values that enable spam detection", () => {
        const spamConfig = config.spam;

        expect(typeof spamConfig.enabled).toBe("boolean");
        expect(spamConfig.enabled).toBe(true);
      });
    });

    describe("and ensuring production-ready configuration", () => {
      it("should provide reasonable production defaults", () => {
        const spamConfig = config.spam;

        expect(spamConfig.detectionWindow).toBeGreaterThan(0);
        expect(spamConfig.detectionWindow).toBeLessThan(3600);

        expect(spamConfig.maxIndividualNotifications).toBeGreaterThan(0);
        expect(spamConfig.maxIndividualNotifications).toBeLessThan(100);

        expect(spamConfig.lowValueThreshold).toBeGreaterThanOrEqual(0);
        expect(spamConfig.lowValueThreshold).toBeLessThan(100000);
      });

      it("should maintain configuration across multiple accesses", () => {
        const firstAccess = config.spam;
        const secondAccess = config.spam;

        expect(firstAccess.enabled).toBe(secondAccess.enabled);
        expect(firstAccess.detectionWindow).toBe(secondAccess.detectionWindow);
        expect(firstAccess.maxIndividualNotifications).toBe(
          secondAccess.maxIndividualNotifications,
        );
        expect(firstAccess.lowValueThreshold).toBe(
          secondAccess.lowValueThreshold,
        );
      });
    });
  });
});
