import { describe, afterEach, test, expect } from "bun:test";
import { InnertubeFactory } from "../../src/factories/innertube-factory";
import { clearAllMocks, restoreAllMocks } from "../helpers/bun-mock-utils";

describe("Factory Pattern Integration", () => {
  afterEach(async () => {
    clearAllMocks();
    restoreAllMocks();
  });

  describe("Factory Statistics and Metadata", () => {
    test("provides factory statistics", () => {
      const stats = InnertubeFactory.getStats();

      expect(stats).toMatchObject({
        factoryVersion: "1.0.0",
        supportedMethods: expect.arrayContaining([
          "createInstance",
          "createWithConfig",
          "createForTesting",
          "createWithTimeout",
        ]),
        youtubeJsVersion: "v16+",
        esm: true,
      });
    });

    test("tracks all supported creation methods", () => {
      const stats = InnertubeFactory.getStats();

      const expectedMethods = [
        "createInstance",
        "createWithConfig",
        "createForTesting",
        "createWithTimeout",
      ];

      expectedMethods.forEach((method) => {
        expect(stats.supportedMethods).toContain(method);
      });
    });

    test("indicates ESM compatibility", () => {
      const stats = InnertubeFactory.getStats();

      expect(stats.esm).toBe(true);
      expect(stats.youtubeJsVersion).toContain("v16");
    });
  });

  describe("Instance Creation", () => {
    test("creates standard instance successfully", async () => {
      const instance = await InnertubeFactory.createInstance();

      expect(instance).toBeDefined();
      expect(typeof instance).toBe("object");
    });

    test("creates configured instance successfully", async () => {
      const config = { debug: true, cache: false };
      const instance = await InnertubeFactory.createWithConfig(config);

      expect(instance).toBeDefined();
      expect(typeof instance).toBe("object");
    });

    test("creates test instance successfully", async () => {
      const instance = await InnertubeFactory.createForTesting();

      expect(instance).toBeDefined();
      expect(typeof instance).toBe("object");
    });

    test("creates instance with timeout successfully", async () => {
      const instance = await InnertubeFactory.createWithTimeout(5000);

      expect(instance).toBeDefined();
      expect(typeof instance).toBe("object");
    });

    test("creates multiple instances with different configs", async () => {
      const configs = [
        { client: "WEB" },
        { debug: true },
        { cache: true },
        { debug: false, cache: false },
      ];

      const instances = await Promise.all(
        configs.map((config) => InnertubeFactory.createWithConfig(config)),
      );

      expect(instances).toHaveLength(4);
      instances.forEach((instance) => {
        expect(instance).toBeDefined();
        expect(typeof instance).toBe("object");
      });
    });
  });

  describe("Configuration Handling", () => {
    test("handles empty configuration", async () => {
      const instance = await InnertubeFactory.createWithConfig({});

      expect(instance).toBeDefined();
    });

    test("handles undefined configuration", async () => {
      const instance = await InnertubeFactory.createWithConfig();

      expect(instance).toBeDefined();
    });
  });

  describe("API Structure Validation", () => {
    test("provides all required factory methods", () => {
      expect(typeof InnertubeFactory.createInstance).toBe("function");
      expect(typeof InnertubeFactory.createWithConfig).toBe("function");
      expect(typeof InnertubeFactory.createForTesting).toBe("function");
      expect(typeof InnertubeFactory.createWithTimeout).toBe("function");
      expect(typeof InnertubeFactory.getStats).toBe("function");
    });

    test("provides consistent method signatures", () => {
      expect(InnertubeFactory.createInstance.length).toBe(0);
      expect(InnertubeFactory.createWithConfig.length).toBe(0);
      expect(InnertubeFactory.createForTesting.length).toBe(0);
      expect(InnertubeFactory.createWithTimeout.length).toBe(0);
      expect(InnertubeFactory.getStats.length).toBe(0);
    });

  });

});
