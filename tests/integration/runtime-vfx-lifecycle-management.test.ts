import { describe, test, beforeEach, afterEach, expect } from "bun:test";
import path from "node:path";
import {
  createMockFn,
  clearAllMocks,
  restoreAllMocks,
} from "../helpers/bun-mock-utils";
import { setupAutomatedCleanup } from "../helpers/mock-lifecycle";
import { createAppRuntimeTestDependencies } from "../helpers/runtime-test-harness";
import { TEST_TIMEOUTS } from "../helpers/test-setup";
import { PlatformEvents } from "../../src/interfaces/PlatformEvents";
import { AppRuntime } from "../../src/main";

type RuntimeUnderTest = InstanceType<typeof AppRuntime>;
type AppRuntimeConfig = ConstructorParameters<typeof AppRuntime>[0];
type RuntimeConfig = AppRuntimeConfig;
type VfxCommandService = NonNullable<RuntimeUnderTest["vfxCommandService"]>;
type VfxExecuteCommand = (
  command: unknown,
  context: Record<string, unknown>,
) => unknown;

const integrationTimeout = TEST_TIMEOUTS.SLOW;
const flushAsyncEvents = () => new Promise<void>((resolve) => setImmediate(resolve));

const createRuntimeConfig = (overrides: Partial<RuntimeConfig> = {}): RuntimeConfig =>
  ({
    general: {
      maxMessageLength: 500,
      greetingsEnabled: true,
      ...overrides.general,
    },
    obs: {
      enabled: false,
      chatMsgScene: "test-chat-scene",
      notificationScene: "test-notification-scene",
      chatPlatformLogos: { twitch: "test-chat-logo" },
      notificationPlatformLogos: { twitch: "test-notification-logo" },
      ttsTxt: "test-tts-source",
      notificationTxt: "test-notification-source",
    },
    handcam: {
      enabled: false,
      maxSize: 50,
      rampUpDuration: 0.5,
      holdDuration: 8,
      rampDownDuration: 0.5,
      totalSteps: 30,
      easingEnabled: true,
      sourceName: "test-handcam",
      glowFilterName: "test-glow",
    },
    cooldowns: {
      cmdCooldownMs: 60_000,
      heavyCommandCooldownMs: 300_000,
      globalCmdCooldownMs: 60_000,
    },
    farewell: { timeout: 1_000 },
    vfx: {
      filePath: path.join(__dirname, "../../test-assets/vfx"),
      ...overrides.vfx,
    },
    commands: {
      hello: "!hello, vfx bottom green",
      ...overrides.commands,
    },
  }) satisfies RuntimeConfig;

const requireExecuteCommand = (
  service: VfxCommandService,
): { executeCommand: VfxExecuteCommand } => {
  expect(typeof service.executeCommand).toBe("function");
  if (typeof service.executeCommand !== "function") {
    throw new Error("VFX service executeCommand was not available");
  }
  return { executeCommand: service.executeCommand };
};

const emitVfxCommand = (
  runtime: RuntimeUnderTest,
  payload: Record<string, unknown>,
) => {
  const emit = runtime.eventBus.emit;
  expect(typeof emit).toBe("function");
  if (typeof emit !== "function") {
    throw new Error("runtime event bus emit was not available");
  }
  emit(PlatformEvents.VFX_COMMAND_RECEIVED, payload);
};

setupAutomatedCleanup({
  clearCallsBeforeEach: true,
  validateAfterCleanup: true,
  logPerformanceMetrics: true,
});

describe("AppRuntime VFXCommandService Lifecycle Management", () => {
  let runtime!: RuntimeUnderTest;
  let config!: RuntimeConfig;

  beforeEach(() => {
    clearAllMocks();

    config = createRuntimeConfig();
  });

  afterEach(async () => {
    const stopRuntime = runtime ? Reflect.get(runtime, "stop") : undefined;
    if (typeof stopRuntime === "function") {
      await stopRuntime.call(runtime);
    }
    restoreAllMocks();
  });

  describe("VFXCommandService Initialization", () => {
    test(
      "should initialize VFXCommandService during AppRuntime startup",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        runtime = new AppRuntime(config, dependencies);

        await runtime.start();

        expect(runtime.vfxCommandService).toBeDefined();
        expect(runtime.vfxCommandService).not.toBeNull();
        expect(typeof runtime.vfxCommandService.executeCommand).toBe(
          "function",
        );
      },
      { timeout: integrationTimeout },
    );
  });

  describe("EventBus VFX Command Integration", () => {
    test(
      "should execute VFX commands via EventBus",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        runtime = new AppRuntime(config, dependencies);
        await runtime.start();

        let vfxExecuted = false;
        const service = requireExecuteCommand(runtime.vfxCommandService);
        const originalExecuteCommand = service.executeCommand;
        runtime.vfxCommandService.executeCommand = createMockFn(
          async (...args: Parameters<VfxExecuteCommand>) => {
            vfxExecuted = true;
            return originalExecuteCommand.apply(runtime.vfxCommandService, args);
          },
        );

        emitVfxCommand(runtime, {
          command: "!hello",
          username: "TestUser",
          platform: "twitch",
          userId: "test-123",
          context: { skipCooldown: true, correlationId: "corr-1" },
        });

        await flushAsyncEvents();

        expect(vfxExecuted).toBe(true);
      },
      { timeout: integrationTimeout },
    );

    test(
      "should handle VFX command errors gracefully",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        runtime = new AppRuntime(config, dependencies);
        await runtime.start();

        runtime.vfxCommandService.executeCommand =
          createMockFn().mockRejectedValue(new Error("VFX execution failed"));

        emitVfxCommand(runtime, {
          command: "!invalid",
          username: "TestUser",
          platform: "twitch",
          userId: "user-1",
          context: { skipCooldown: true, correlationId: "corr-2" },
        });

        await flushAsyncEvents();

        expect(runtime.vfxCommandService.executeCommand).toHaveBeenCalledTimes(
          1,
        );
      },
      { timeout: integrationTimeout },
    );

    test(
      "should ignore events emitted by VFXCommandService to prevent recursion",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        runtime = new AppRuntime(config, dependencies);
        await runtime.start();

        runtime.vfxCommandService.executeCommand = createMockFn();

        emitVfxCommand(runtime, {
          command: "!hello",
          username: "LoopTester",
          platform: "tiktok",
          userId: "user-2",
          source: "vfx-service",
          context: { skipCooldown: true, correlationId: "corr-3" },
        });

        await flushAsyncEvents();

        expect(runtime.vfxCommandService.executeCommand).not.toHaveBeenCalled();
      },
      { timeout: integrationTimeout },
    );

    test(
      "processes VFX commands even when commands are disabled",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        const disabledConfig = {
          ...config,
          general: {
            ...config.general,
            commandsEnabled: false,
          },
        };
        runtime = new AppRuntime(disabledConfig, dependencies);
        await runtime.start();

        runtime.vfxCommandService.executeCommand = createMockFn();

        emitVfxCommand(runtime, {
          command: "!hello",
          username: "NoCmd",
          platform: "twitch",
          userId: "user-3",
          context: { skipCooldown: true, correlationId: "corr-4" },
        });

        await flushAsyncEvents();

        expect(runtime.vfxCommandService.executeCommand).toHaveBeenCalledTimes(
          1,
        );
      },
      { timeout: integrationTimeout },
    );

    test(
      "should continue processing VFX when commands are enabled",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        runtime = new AppRuntime(config, dependencies);
        await runtime.start();

        runtime.vfxCommandService.executeCommand =
          createMockFn().mockResolvedValue({ success: true });

        emitVfxCommand(runtime, {
          command: "!hello",
          username: "CmdUser",
          platform: "twitch",
          userId: "user-4",
          context: { skipCooldown: true, correlationId: "corr-5" },
        });

        await flushAsyncEvents();

        expect(runtime.vfxCommandService.executeCommand).toHaveBeenCalledTimes(
          1,
        );
      },
      { timeout: integrationTimeout },
    );

    test(
      "ignores VFX events already sourced from eventbus to avoid recursion",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        runtime = new AppRuntime(config, dependencies);
        await runtime.start();

        runtime.vfxCommandService.executeCommand = createMockFn();

        emitVfxCommand(runtime, {
          command: "!hello",
          username: "LoopUser",
          platform: "twitch",
          source: "eventbus",
          userId: "user-5",
          context: { skipCooldown: true, correlationId: "corr-6" },
        });

        await flushAsyncEvents();

        expect(runtime.vfxCommandService.executeCommand).not.toHaveBeenCalled();
      },
      { timeout: integrationTimeout },
    );

    test(
      "ignores VFX events sourced from vfx-service to avoid recursion",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        runtime = new AppRuntime(config, dependencies);
        await runtime.start();

        runtime.vfxCommandService.executeCommand = createMockFn();

        emitVfxCommand(runtime, {
          command: "!hello",
          username: "LoopUser",
          platform: "twitch",
          source: "vfx-service",
          userId: "user-6",
          context: { skipCooldown: true, correlationId: "corr-7" },
        });

        await flushAsyncEvents();

        expect(runtime.vfxCommandService.executeCommand).not.toHaveBeenCalled();
      },
      { timeout: integrationTimeout },
    );

    test(
      "gracefully skips when VFXCommandService is unavailable",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        runtime = new AppRuntime(config, dependencies);
        await runtime.start();

        Reflect.set(runtime, "vfxCommandService", null);

        emitVfxCommand(runtime, {
          command: "!hello",
          username: "NoService",
          platform: "tiktok",
          userId: "user-7",
          context: { skipCooldown: true, correlationId: "corr-8" },
        });

        await flushAsyncEvents();

        expect(runtime.vfxCommandService).toBeNull();
      },
      { timeout: integrationTimeout },
    );

    test(
      "handles VFX events with no command payload without crashing",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        runtime = new AppRuntime(config, dependencies);
        await runtime.start();

        runtime.vfxCommandService.executeCommand = createMockFn();
        runtime.vfxCommandService.executeCommandForKey = createMockFn();

        emitVfxCommand(runtime, {
          username: "NoCommand",
          platform: "youtube",
          userId: "user-8",
          context: { skipCooldown: true, correlationId: "corr-9" },
        });

        await flushAsyncEvents();

        expect(runtime.vfxCommandService.executeCommand).not.toHaveBeenCalled();
        expect(
          runtime.vfxCommandService.executeCommandForKey,
        ).not.toHaveBeenCalled();
      },
      { timeout: integrationTimeout },
    );

    test(
      "routes commandKey events with normalized context when command text is absent",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        runtime = new AppRuntime(config, dependencies);
        await runtime.start();

        runtime.vfxCommandService.executeCommand = createMockFn();
        const commandKeyExecutions: Array<{
          commandKey: string;
          context: Record<string, unknown>;
        }> = [];
        runtime.vfxCommandService.executeCommandForKey = createMockFn(
          async (commandKey: unknown, context: Record<string, unknown>) => {
            if (typeof commandKey !== "string") {
              throw new Error("Expected string command key");
            }
            commandKeyExecutions.push({ commandKey, context });
            return { success: true };
          },
        );

        emitVfxCommand(runtime, {
          commandKey: "gifts",
          username: "KeyUser",
          platform: "youtube",
          userId: "user-42",
          context: { skipCooldown: true, correlationId: "corr-10" },
        });

        await flushAsyncEvents();

        expect(runtime.vfxCommandService.executeCommand).not.toHaveBeenCalled();
        expect(commandKeyExecutions).toHaveLength(1);
        expect(commandKeyExecutions[0]).toMatchObject({
          commandKey: "gifts",
          context: {
            username: "KeyUser",
            platform: "youtube",
            userId: "user-42",
            source: "eventbus",
            skipCooldown: true,
            correlationId: "corr-10",
          },
        });
      },
      { timeout: integrationTimeout },
    );

    test(
      "routes commandKey events even when commands are disabled",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        const disabledConfig = {
          ...config,
          general: { ...config.general, commandsEnabled: false },
        };
        runtime = new AppRuntime(disabledConfig, dependencies);
        await runtime.start();

        const commandKeyExecutions: Array<{
          commandKey: string;
          context: Record<string, unknown>;
        }> = [];
        runtime.vfxCommandService.executeCommandForKey = createMockFn(
          async (commandKey: unknown, context: Record<string, unknown>) => {
            if (typeof commandKey !== "string") {
              throw new Error("Expected string command key");
            }
            commandKeyExecutions.push({ commandKey, context });
            return { success: true };
          },
        );

        emitVfxCommand(runtime, {
          commandKey: "gifts",
          username: "DisabledKeyUser",
          platform: "tiktok",
          userId: "user-99",
          context: { skipCooldown: true, correlationId: "corr-11" },
        });

        await flushAsyncEvents();

        expect(commandKeyExecutions).toHaveLength(1);
        expect(commandKeyExecutions[0]).toMatchObject({
          commandKey: "gifts",
          context: {
            username: "DisabledKeyUser",
            platform: "tiktok",
            userId: "user-99",
            source: "eventbus",
            skipCooldown: true,
            correlationId: "corr-11",
          },
        });
      },
      { timeout: integrationTimeout },
    );
  });

  describe("AppRuntime Lifecycle Management", () => {
    test(
      "should maintain VFXCommandService throughout AppRuntime lifecycle",
      async () => {
        const { dependencies } = createAppRuntimeTestDependencies();
        runtime = new AppRuntime(config, dependencies);
        await runtime.start();

        const vfxServiceBeforeStop = runtime.vfxCommandService;

        await flushAsyncEvents();

        expect(runtime.vfxCommandService).toBe(vfxServiceBeforeStop);
        expect(runtime.vfxCommandService).toBeDefined();
      },
      { timeout: integrationTimeout },
    );
  });
});
