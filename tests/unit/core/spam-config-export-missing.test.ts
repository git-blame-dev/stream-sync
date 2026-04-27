import { describe, expect, it } from "bun:test";
import { setupAutomatedCleanup } from "../../helpers/mock-lifecycle";
import { initializeTestLogging } from "../../helpers/test-setup";
import { config } from "../../../src/core/config";

type SpamConfig = {
  enabled: boolean;
  detectionWindow: number;
  maxIndividualNotifications: number;
  lowValueThreshold: number;
};

type MainConfig = {
  spam: SpamConfig;
  [key: string]: unknown;
};

const getConfig = () => {
  return config as MainConfig;
};

initializeTestLogging();

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  logPerformanceMetrics: true,
});

describe("Spam Config Export Missing", () => {
  describe("when config module is imported", () => {
    describe("and checking for spam configuration export", () => {
      it("should expose spam configuration on the main config object", () => {
        const config = getConfig();

        expect(config.spam).toBeDefined();
        expect(config.spam).not.toBeUndefined();
        expect(config.spam).not.toBeNull();
      });

      it("should include spam as an enumerable config property", () => {
        const config = getConfig();

        const enumerableProps = Object.keys(config);
        expect(enumerableProps).toContain("spam");

        const ownProps = Object.getOwnPropertyNames(config);
        expect(ownProps).toContain("spam");
      });

      it("should provide spam config as accessible property", () => {
        const config = getConfig();

        expect(config.spam).toBeDefined();
        expect(typeof config.spam).toBe("object");
        expect(config.spam.enabled).toBeDefined();
      });
    });

    describe("and verifying spam configuration content", () => {
      it("should provide all required spam configuration properties", () => {
        const config = getConfig();
        const spam = config.spam;

        expect(spam).toBeDefined();

        expect(spam.enabled).toBeDefined();
        expect(spam.enabled).not.toBeUndefined();

        expect(spam.detectionWindow).toBeDefined();
        expect(spam.detectionWindow).not.toBeUndefined();

        expect(spam.maxIndividualNotifications).toBeDefined();
        expect(spam.maxIndividualNotifications).not.toBeUndefined();

        expect(spam.lowValueThreshold).toBeDefined();
        expect(spam.lowValueThreshold).not.toBeUndefined();
      });

      it("should provide spam properties with expected types and ranges", () => {
        const config = getConfig();
        const spam = config.spam;

        expect(typeof spam.enabled).toBe("boolean");
        expect(typeof spam.detectionWindow).toBe("number");
        expect(typeof spam.maxIndividualNotifications).toBe("number");
        expect(typeof spam.lowValueThreshold).toBe("number");

        expect(Number.isInteger(spam.detectionWindow)).toBe(true);
        expect(Number.isInteger(spam.maxIndividualNotifications)).toBe(true);
        expect(Number.isFinite(spam.lowValueThreshold)).toBe(true);

        expect(spam.detectionWindow).toBeGreaterThan(0);
        expect(spam.maxIndividualNotifications).toBeGreaterThan(0);
        expect(spam.lowValueThreshold).toBeGreaterThan(0);
      });
    });
  });

  describe("when simulating NotificationManager usage", () => {
    describe("and accessing spam config through app.config pattern", () => {
      it("should allow spam config access through app.config", () => {
        const config = getConfig();

        const mockApp = {
          config: config,
          obs: { connection: null },
        };

        const hasConfig = mockApp.config;
        const hasSpamConfig = mockApp.config && mockApp.config.spam;

        expect(hasConfig).toBeTruthy();
        expect(hasSpamConfig).toBeTruthy();

        const spamConfig = mockApp.config.spam;
        expect(spamConfig.enabled).toBeDefined();
        expect(spamConfig.detectionWindow).toBeDefined();
        expect(spamConfig.maxIndividualNotifications).toBeDefined();
        expect(spamConfig.lowValueThreshold).toBeDefined();
      });

      it("should provide a spam config shape usable by spam detection setup", () => {
        const config = getConfig();
        const spamConfig = config.spam;

        expect(spamConfig).toBeTruthy();
        expect(typeof spamConfig).toBe("object");

        expect(spamConfig.enabled).toBeDefined();
        expect(spamConfig.detectionWindow).toBeDefined();
        expect(spamConfig.maxIndividualNotifications).toBeDefined();
        expect(spamConfig.lowValueThreshold).toBeDefined();

        expect(typeof spamConfig.enabled).toBe("boolean");
        expect(typeof spamConfig.detectionWindow).toBe("number");
        expect(typeof spamConfig.maxIndividualNotifications).toBe("number");
        expect(typeof spamConfig.lowValueThreshold).toBe("number");
      });
    });
  });

  describe("when ensuring no regression in NotificationManager", () => {
    describe("and verifying NotificationManager can initialize spam detection", () => {
      it("should provide spam config values compatible with spam detector initialization", () => {
        const config = getConfig();

        expect(config.spam).toBeDefined();
        expect(config.spam.enabled).toBeDefined();
        expect(config.spam.detectionWindow).toBeDefined();
        expect(config.spam.maxIndividualNotifications).toBeDefined();
        expect(config.spam.lowValueThreshold).toBeDefined();

        expect(typeof config.spam.enabled).toBe("boolean");
        expect(typeof config.spam.detectionWindow).toBe("number");
        expect(typeof config.spam.maxIndividualNotifications).toBe("number");
        expect(typeof config.spam.lowValueThreshold).toBe("number");

        expect(config.spam.detectionWindow).toBeGreaterThan(0);
        expect(config.spam.maxIndividualNotifications).toBeGreaterThan(0);
        expect(config.spam.lowValueThreshold).toBeGreaterThanOrEqual(0);
      });
    });
  });
});
