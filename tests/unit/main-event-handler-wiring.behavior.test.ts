import { vi, afterEach, describe, expect, it } from 'bun:test';

import { AppRuntime } from "../../src/main";
import { createConfigFixture } from "../helpers/config-fixture";

type RuntimeConfig = ConstructorParameters<typeof AppRuntime>[0];
type RuntimeDependencies = ConstructorParameters<typeof AppRuntime>[1];

describe("main.js event handler wiring", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const createDeps = (): RuntimeDependencies => ({
    logging: {
      debug: vi.fn<(message: unknown, source?: string, data?: unknown) => void>(),
      info: vi.fn<(message: unknown, source?: string, data?: unknown) => void>(),
      warn: vi.fn<(message: unknown, source?: string, data?: unknown) => void>(),
      error: vi.fn<(message: unknown, source?: string, data?: unknown) => void>(),
      console: vi.fn<(message: unknown, source?: string, data?: unknown) => void>(),
    },
    notificationManager: {
      handleNotification: vi.fn<(type: string, platform: string, payload: { [x: string]: unknown; }) => Promise<unknown>>(),
    },
    displayQueue: { addItem: vi.fn<NonNullable<RuntimeDependencies["displayQueue"]>["addItem"]>(), addSequence: vi.fn<NonNullable<RuntimeDependencies["displayQueue"]>["addSequence"]>() },
    eventBus: {
            subscribe: vi.fn<(eventName: string, handler: (event: { [x: string]: unknown; }) => Promise<void> | void) => (() => void) | void>(),
            emit: vi.fn<(eventName: string, payload: unknown) => void>(),
          },
    config: createConfigFixture(),
    vfxCommandService: {
      executeCommandForKey: vi.fn<(...args: unknown[]) => Promise<{ success: true; }>>().mockResolvedValue({ success: true }),
    },
    userTrackingService: {
      isFirstMessage: vi.fn<(...args: [unknown, Record<string, unknown>?]) => boolean>().mockReturnValue(false),
    },
    commandParser: { getVFXConfig: vi.fn<(...args: unknown[]) => unknown>() },
    commandCooldownService: {
      dispose: vi.fn<(...args: []) => void>(),
      checkUserCooldown: vi.fn<(...args: [unknown, number, number]) => boolean>().mockReturnValue(true),
      updateUserCooldown: vi.fn<(...args: [unknown]) => void>(),
    },
    platformLifecycleService: {
      getAllPlatforms: vi.fn(() => ({})),
      initializeAllPlatforms: vi.fn<(...args: [Record<string, unknown>]) => Promise<unknown>>().mockResolvedValue(undefined),
      disconnectAll: vi.fn<(...args: []) => Promise<unknown>>().mockResolvedValue(undefined),
      getPlatformConnectionTime: vi.fn<(...args: [string]) => number | undefined | null>().mockReturnValue(null),
    },
    dependencyFactory: {
      createYoutubeDependencies: vi.fn(() => ({})),
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
