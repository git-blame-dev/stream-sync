import { describe, it, afterEach, expect } from "bun:test";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { noOpLogger } from "../helpers/mock-factories";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService.ts";

type TestPlatformInstance = {
  initialize: () => Promise<boolean>;
  cleanup: () => Promise<void>;
  on: () => void;
};

type TestPlatformConstructor = new (
  config: unknown,
  dependencies?: unknown,
) => TestPlatformInstance;

const createTestPlatformConstructor = (
  initialize: () => Promise<boolean>,
): TestPlatformConstructor =>
  class {
    initialize = initialize;
    cleanup = createMockFn().mockResolvedValue(undefined);
    on = createMockFn(() => undefined);
  };

describe("PlatformLifecycleService connection routing (smoke)", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it("initializes enabled platforms directly without StreamDetector", async () => {
    const lifecycle = new PlatformLifecycleService({
      config: {
        youtube: { enabled: true, username: "channel" },
        twitch: { enabled: true },
        custom: { enabled: true },
      },
      logger: noOpLogger,
    });

    const youtubeInit = createMockFn().mockResolvedValue(true);
    const twitchInit = createMockFn().mockResolvedValue(true);
    const customInit = createMockFn().mockResolvedValue(true);

    const youtubePlatform = createTestPlatformConstructor(youtubeInit);
    const twitchPlatform = createTestPlatformConstructor(twitchInit);
    const customPlatform = createTestPlatformConstructor(customInit);

    await lifecycle.initializeAllPlatforms({
      youtube: youtubePlatform,
      twitch: twitchPlatform,
      custom: customPlatform,
    });

    const status = lifecycle.getStatus();
    expect(status.initializedPlatforms).toEqual(
      expect.arrayContaining(["youtube", "twitch", "custom"]),
    );
  });
});
