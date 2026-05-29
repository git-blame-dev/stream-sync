import { afterEach, describe, expect, it } from "bun:test";
import { createMockFn, restoreAllMocks } from "../helpers/bun-mock-utils";
import { AppRuntime } from "../../src/main";
import { createConfigFixture } from "../helpers/config-fixture";

type RuntimeConfig = ConstructorParameters<typeof AppRuntime>[0];
type RuntimeDependencies = ConstructorParameters<typeof AppRuntime>[1];

describe("main.js event handler wiring", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  const createDeps = (): RuntimeDependencies => ({
    logging: {
      debug: createMockFn(),
      info: createMockFn(),
      warn: createMockFn(),
      error: createMockFn(),
      console: createMockFn(),
    },
    notificationManager: {
      handleNotification: createMockFn(),
    },
    displayQueue: { addItem: createMockFn() },
    eventBus: {
            subscribe: createMockFn(),
            emit: createMockFn(),
          },
    config: createConfigFixture(),
    vfxCommandService: {
      executeCommandForKey: createMockFn().mockResolvedValue({ success: true }),
    },
    userTrackingService: {
      isFirstMessage: createMockFn<[unknown, Record<string, unknown>?], boolean>().mockReturnValue(false),
    },
    commandParser: { getVFXConfig: createMockFn() },
    commandCooldownService: {
      checkUserCooldown: createMockFn<[unknown, number, number], boolean>().mockReturnValue(true),
      updateUserCooldown: createMockFn<[unknown], void>(),
    },
    platformLifecycleService: {
      getAllPlatforms: createMockFn(() => ({})),
      initializeAllPlatforms: createMockFn<[Record<string, unknown>], Promise<unknown>>().mockResolvedValue(undefined),
      disconnectAll: createMockFn<[], Promise<unknown>>().mockResolvedValue(undefined),
      getPlatformConnectionTime: createMockFn<[string], number | undefined | null>().mockReturnValue(null),
    },
    dependencyFactory: {
      createYoutubeDependencies: createMockFn(() => ({})),
    },
    twitchAuth: null,
    obsEventService: {},
    sceneManagementService: {},
  });

  const baseConfig: RuntimeConfig = createConfigFixture();

  it("rejects construction when EventBus is unavailable", () => {
    expect(
      () => new AppRuntime(baseConfig, Object.assign(createDeps(), { eventBus: null })),
    ).toThrow("AppRuntime missing required dependencies");
  });
});
