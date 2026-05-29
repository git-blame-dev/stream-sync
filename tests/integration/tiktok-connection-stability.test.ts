import { describe, it, beforeEach, afterEach, expect } from "bun:test";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";
import { TikTokPlatform } from "../../src/platforms/tiktok.ts";

type TikTokTestDependencies = {
  logger: typeof noOpLogger;
  TikTokWebSocketClient: unknown;
  WebcastEvent: {
    CHAT: string;
    GIFT: string;
    FOLLOW: string;
    SOCIAL: string;
    ROOM_USER: string;
    ERROR: string;
    DISCONNECT: string;
  };
  ControlEvent: Record<string, string>;
  WebcastPushConnection: unknown;
  constants: { GRACE_PERIODS: { TIKTOK: number } };
};

describe("TikTok Platform Validation", () => {
  let mockDependencies: TikTokTestDependencies;

  beforeEach(() => {
    mockDependencies = {
      logger: noOpLogger,
      TikTokWebSocketClient: createMockFn(),
      WebcastEvent: {
        CHAT: "chat",
        GIFT: "gift",
        FOLLOW: "follow",
        SOCIAL: "social",
        ROOM_USER: "roomUser",
        ERROR: "error",
        DISCONNECT: "disconnect",
      },
      ControlEvent: { CONNECTED: "connected" },
      WebcastPushConnection: createMockFn(),
      constants: { GRACE_PERIODS: { TIKTOK: 5000 } },
    };
  });

  afterEach(() => {
    restoreAllMocks();
  });

  describe("Platform Construction and Basic Validation", () => {
    it("should be importable and constructible", () => {
      expect(TikTokPlatform).toBeDefined();
      expect(typeof TikTokPlatform).toBe("function");

      const config = { enabled: true, username: "test_user" };
      let platform: TikTokPlatform | null = null;
      expect(() => {
        platform = new TikTokPlatform(config, mockDependencies);
      }).not.toThrow();

      expect(platform).toBeDefined();
      expect(platform).toBeInstanceOf(TikTokPlatform);
    });

    it("should validate platform instance structure", () => {
      const config = { enabled: true, username: "test_user" };
      const platform = new TikTokPlatform(config, mockDependencies);

      expect(platform).toBeDefined();
      expect(typeof platform).toBe("object");
      expect(platform.constructor.name).toBe("TikTokPlatform");
    });

    it("should have expected methods available", () => {
      const config = { enabled: true, username: "test_user" };
      const platform = new TikTokPlatform(config, mockDependencies);

      const methods = Object.entries(
        Object.getOwnPropertyDescriptors(Object.getPrototypeOf(platform)),
      )
        .filter(
          ([name, descriptor]) =>
            name !== "constructor" && typeof descriptor.value === "function",
        )
        .map(([name]) => name);

      expect(methods).toBeDefined();
      expect(Array.isArray(methods)).toBe(true);
      expect(methods.length).toBeGreaterThan(0);
    });

    it("should accept injected logger dependency", () => {
      const config = { enabled: true, username: "test_user" };
      const platform = new TikTokPlatform(config, mockDependencies);

      expect(platform.logger).toBe(noOpLogger);
    });

    it("should validate TikTok Platform prototype structure", () => {
      const prototype = TikTokPlatform.prototype;
      const prototypeMethodNames = Object.getOwnPropertyNames(prototype);

      expect(prototype).toBeDefined();
      expect(prototypeMethodNames).toBeDefined();
      expect(Array.isArray(prototypeMethodNames)).toBe(true);
    });

    it("should store provided config", () => {
      const config = { enabled: true, username: "test_user" };
      const platform = new TikTokPlatform(config, mockDependencies);

      expect(platform.config).toBeDefined();
      expect(platform.config.enabled).toBe(true);
      expect(platform.config.username).toBe("test_user");
    });
  });
});
