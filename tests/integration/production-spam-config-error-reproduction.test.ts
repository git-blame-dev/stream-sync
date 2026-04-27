import { describe, it, expect } from "bun:test";
import { createRequire } from "node:module";

const load = createRequire(import.meta.url);
const { config } = load("../../src/core/config");

describe("Production Spam Config Error Reproduction - Modernized", () => {
  describe("when reproducing the exact production error scenario", () => {
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
        delete load.cache[load.resolve("../../src/core/config")];

        const { config: freshConfig } = load("../../src/core/config");

        expect(freshConfig.spam).toBeDefined();
        expect(freshConfig.spam.enabled).toBeDefined();
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

        expect(() => {
          if (!spamConfig) {
            throw new Error("Spam config missing");
          }
          if (typeof spamConfig.enabled !== "boolean") {
            throw new Error("Invalid enabled");
          }
          if (typeof spamConfig.detectionWindow !== "number") {
            throw new Error("Invalid detectionWindow");
          }
          if (typeof spamConfig.maxIndividualNotifications !== "number") {
            throw new Error("Invalid maxIndividualNotifications");
          }
          if (typeof spamConfig.lowValueThreshold !== "number") {
            throw new Error("Invalid lowValueThreshold");
          }
        }).not.toThrow();
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
