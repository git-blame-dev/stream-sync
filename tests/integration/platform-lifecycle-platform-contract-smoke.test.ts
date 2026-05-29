import { describe, test, afterEach, expect } from "bun:test";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";

describe("PlatformLifecycleService platform contract validation (smoke)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  test("fails fast with actionable error when a platform instance is invalid", async () => {
    const eventBus = { emit: createMockFn() };

    const lifecycle = new PlatformLifecycleService({
      config: { twitch: { enabled: true } },
      eventBus,
      logger: noOpLogger,
    });

    try {
      class InvalidPlatform {
        initialize!: () => Promise<unknown> | unknown;
        cleanup!: () => Promise<void> | void;
        on!: (eventName: string, handler: (...args: unknown[]) => unknown) => unknown;
      }

      await lifecycle.initializeAllPlatforms({ twitch: InvalidPlatform });

      expect(lifecycle.isPlatformAvailable("twitch")).toBe(false);
      expect(lifecycle.getAllPlatforms()).toEqual({});

      const status = lifecycle.getStatus();
      expect(status.failedPlatforms).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "twitch",
            lastError: expect.stringContaining("missing required methods"),
          }),
        ]),
      );
      const failedPlatform = status.failedPlatforms[0];
      expect(failedPlatform).toBeDefined();
      expect(failedPlatform?.lastError).toContain("initialize");
      expect(failedPlatform?.lastError).toContain("cleanup");
      expect(failedPlatform?.lastError).toContain("on");
    } finally {
      lifecycle.dispose();
    }
  });
});
