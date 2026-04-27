import { describe, it, expect } from "bun:test";
import { createMockFn } from "../helpers/bun-mock-utils";
import { createConfigFixture } from "../helpers/config-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";
import { DependencyFactory } from "../../src/utils/dependency-factory";

describe("Platform lifecycle startup smoke E2E", () => {
  it("initializes and disconnects an enabled platform without stream detection", async () => {
    const service = new PlatformLifecycleService({
      config: { twitch: { enabled: true } },
      logger: noOpLogger,
    });

    const initialize = createMockFn().mockResolvedValue(true);
    const cleanup = createMockFn().mockResolvedValue();
    const MockPlatform = createMockFn().mockImplementation(() => ({
      initialize,
      cleanup,
      on: createMockFn(),
    }));

    await service.initializeAllPlatforms({ twitch: MockPlatform });

    expect(service.isPlatformAvailable("twitch")).toBe(true);

    await service.disconnectAll();

    expect(service.isPlatformAvailable("twitch")).toBe(false);
  });

  it("initializes an enabled platform through the real dependency factory path", async () => {
    const config = createConfigFixture({
      twitch: {
        enabled: true,
        channel: "test-channel",
        clientId: "test-client-id",
      },
      youtube: { enabled: false },
      tiktok: { enabled: false },
    });
    const testTwitchAuth = { isReady: () => true };
    const service = new PlatformLifecycleService({
      config,
      dependencyFactory: new DependencyFactory(),
      logger: noOpLogger,
      sharedDependencies: {
        config,
        twitchAuth: testTwitchAuth,
      },
    });

    const initialize = createMockFn().mockResolvedValue(true);
    const cleanup = createMockFn().mockResolvedValue();
    const MockPlatform = createMockFn().mockImplementation(
      (platformConfig, dependencies) => ({
        platformConfig,
        dependencies,
        initialize,
        cleanup,
        on: createMockFn(),
      }),
    );

    await service.initializeAllPlatforms({ twitch: MockPlatform });

    expect(service.isPlatformAvailable("twitch")).toBe(true);
    expect(service.getStatus().initializedPlatforms).toContain("twitch");

    await service.disconnectAll();

    expect(service.isPlatformAvailable("twitch")).toBe(false);
  });
});
