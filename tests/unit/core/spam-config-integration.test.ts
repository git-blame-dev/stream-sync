import { describe, expect, it } from "bun:test";
import { config } from "../../../src/core/config";

type SpamConfig = {
  enabled: boolean;
  lowValueThreshold: number;
  detectionWindow: number;
  maxIndividualNotifications: number;
  [key: string]: unknown;
};

type GiftConfig = {
  giftVideoSource?: string;
  giftAudioSource?: string;
  enabled?: unknown;
  lowValueThreshold?: unknown;
  detectionWindow?: unknown;
};

const appConfig = config as {
  spam: SpamConfig;
  gifts: GiftConfig;
};

describe("Spam Configuration Integration", () => {
  describe("when accessing spam configuration", () => {
    it("should expose spam configuration via config.spam", () => {
      expect(appConfig.spam).toBeDefined();
      expect(typeof appConfig.spam).toBe("object");
    });

    it("should have all required spam detection properties", () => {
      const spamConfig = appConfig.spam;

      expect(spamConfig.enabled).toBeDefined();
      expect(spamConfig.lowValueThreshold).toBeDefined();
      expect(spamConfig.detectionWindow).toBeDefined();
      expect(spamConfig.maxIndividualNotifications).toBeDefined();
    });

    it("should provide proper default values", () => {
      const spamConfig = appConfig.spam;

      expect(typeof spamConfig.enabled).toBe("boolean");
      expect(typeof spamConfig.lowValueThreshold).toBe("number");
      expect(typeof spamConfig.detectionWindow).toBe("number");
      expect(typeof spamConfig.maxIndividualNotifications).toBe("number");

      expect(spamConfig.lowValueThreshold).toBeGreaterThan(0);
      expect(spamConfig.detectionWindow).toBeGreaterThan(0);
      expect(spamConfig.maxIndividualNotifications).toBeGreaterThan(0);
    });
  });

  describe("when using with NotificationManager", () => {
    it("should be compatible with NotificationManager spam detection initialization", () => {
      const spamConfig = appConfig.spam;

      const expectedProperties = [
        "enabled",
        "lowValueThreshold",
        "detectionWindow",
        "maxIndividualNotifications",
      ];

      expectedProperties.forEach((property) => {
        expect(spamConfig).toHaveProperty(property);
        expect(spamConfig[property]).not.toBeUndefined();
      });
    });

    it("should be accessible via this.app.config.spam pattern", () => {
      const mockApp = { config: appConfig };

      expect(mockApp.config).toBeDefined();
      expect(mockApp.config.spam).toBeDefined();
      expect(mockApp.config && mockApp.config.spam).toBeTruthy();
    });
  });

  describe("gift configuration properties", () => {
    it("should expose the canonical gift configuration properties", () => {
      const giftConfig = appConfig.gifts;

      expect(giftConfig.giftVideoSource).toBeDefined();
      expect(giftConfig.giftAudioSource).toBeDefined();
    });

    it("should not include spam fields in gift config", () => {
      const giftConfig = appConfig.gifts;

      expect(giftConfig.enabled).toBeUndefined();
      expect(giftConfig.lowValueThreshold).toBeUndefined();
      expect(giftConfig.detectionWindow).toBeUndefined();
    });
  });
});
