import { describe, test, expect, beforeEach } from "bun:test";
import { createMockFn } from "../../../helpers/bun-mock-utils";

import { PlatformEvents } from "../../../../src/interfaces/PlatformEvents";
import { OBSEffectsManager } from "../../../../src/obs/effects";
import {
  VFXCommandService,
  createVFXCommandService,
} from "../../../../src/services/VFXCommandService.ts";

type EventRecord = { name: string; payload: Record<string, unknown> };
type EventBus = ConstructorParameters<typeof VFXCommandService>[1];
type VFXServiceConfig = ConstructorParameters<typeof VFXCommandService>[0];
type PlayMediaInOBS = OBSEffectsManager["playMediaInOBS"];

function createConfig(): VFXServiceConfig {
  return {
    commands: { greetings: "!hello" },
    farewell: {},
    vfx: { filePath: "/tmp" },
    cooldowns: { cmdCooldown: 60, globalCmdCooldownMs: 60000 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function createMockEffectsManager(): OBSEffectsManager {
  const obsLogger = {
    debug: () => {},
    warn: () => {},
    error: () => {},
  };
  const effectsManager = new OBSEffectsManager(
    {
      ensureConnected: createMockFn<[], Promise<void>>().mockResolvedValue(undefined),
      call: createMockFn<[string, Record<string, unknown>?], Promise<unknown>>().mockResolvedValue({}),
    },
    {
      logger: obsLogger,
      retrySystem: { delay: () => Promise.resolve() },
    },
  );
  effectsManager.playMediaInOBS = createMockFn<Parameters<PlayMediaInOBS>, ReturnType<PlayMediaInOBS>>()
    .mockResolvedValue(undefined);
  return effectsManager;
}

function expectRecordedEvent(
  events: EventRecord[],
  name: string,
): EventRecord {
  const event = events.find((recordedEvent) => recordedEvent.name === name);
  expect(event).toBeDefined();
  if (!event) {
    throw new Error(`Expected ${name} event`);
  }
  return event;
}

describe("VFXCommandService completion events", () => {
  let eventBus: EventBus;
  let recordedEvents: EventRecord[];
  let mockEffectsManager: OBSEffectsManager;

  beforeEach(() => {
    recordedEvents = [];
    eventBus = {
      emit: (name: string, payload: unknown) => {
        if (!isRecord(payload)) {
          throw new Error("Expected VFX event payload object");
        }
        recordedEvents.push({ name, payload });
      },
    };
    mockEffectsManager = createMockEffectsManager();
  });

  test("emits both executed and effect-completed with enriched payload", async () => {
    const config = createConfig();
    const service = new VFXCommandService(config, eventBus, {
      effectsManager: mockEffectsManager,
    });

    const vfxConfig = {
      commandKey: "greetings",
      filename: "hello",
      mediaSource: "VFX Top",
      vfxFilePath: "/tmp",
      command: "!hello",
      duration: 5000,
    };

    service.selectVFXCommand = createMockFn().mockResolvedValue(vfxConfig);

    await service.executeCommand("!hello", {
      username: "testViewer",
      platform: "twitch",
      userId: "test-user-123",
      skipCooldown: true,
      notificationType: "greeting",
      correlationId: "test-corr-1",
    });

    const executedEvent = expectRecordedEvent(recordedEvents, PlatformEvents.VFX_COMMAND_EXECUTED);
    const completedEvent = expectRecordedEvent(recordedEvents, PlatformEvents.VFX_EFFECT_COMPLETED);

    const payload = completedEvent.payload;
    expect(executedEvent.payload.type).toBe(
      PlatformEvents.VFX_COMMAND_EXECUTED,
    );
    expect(payload.type).toBe(PlatformEvents.VFX_EFFECT_COMPLETED);
    expect(payload.commandKey).toBe("greetings");
    expect(payload.filename).toBe("hello");
    expect(payload.mediaSource).toBe("VFX Top");
    expect(payload.username).toBe("testViewer");
    expect(payload.platform).toBe("twitch");
    expect(payload.userId).toBe("test-user-123");
    expect(payload.context).toEqual(
      expect.objectContaining({ notificationType: "greeting" }),
    );
  });

  test("omits userId for automatic executions while preserving event correlation and context", async () => {
    const service = new VFXCommandService(createConfig(), eventBus, {
      effectsManager: mockEffectsManager,
    });
    service.selectVFXCommand = createMockFn().mockResolvedValue({
      commandKey: "greetings",
      filename: "synthetic-automatic",
      mediaSource: "Synthetic VFX Source",
      vfxFilePath: "/tmp/synthetic-automatic.vfx",
      command: "!hello",
      duration: 5000,
    });

    await service.executeCommand("!hello", {
      username: "  Synthetic Automation  ",
      platform: "twitch",
      skipCooldown: true,
      correlationId: "synthetic-correlation-1",
      notificationType: "synthetic-automatic",
    });

    for (const eventName of [
      PlatformEvents.VFX_COMMAND_EXECUTED,
      PlatformEvents.VFX_EFFECT_COMPLETED,
    ]) {
      const event = expectRecordedEvent(recordedEvents, eventName);
      expect(PlatformEvents.validateEvent(event.payload)).toBe(true);
      expect(event.payload).not.toHaveProperty("userId");
      expect(event.payload.username).toBe("Synthetic Automation");
      expect(event.payload.correlationId).toBe("synthetic-correlation-1");
      expect(event.payload.context).not.toHaveProperty("userId");
      expect(event.payload.context).toEqual(
        expect.objectContaining({
          correlationId: "synthetic-correlation-1",
          notificationType: "synthetic-automatic",
          platform: "twitch",
          username: "Synthetic Automation",
        }),
      );
    }
  });

  test("factory passes injected effects manager through to service construction", () => {
    const config = createConfig();
    const customEffectsManager = createMockEffectsManager();

    const service = createVFXCommandService(config, null, {
      effectsManager: customEffectsManager,
    });

    expect(service._effectsManager).toBe(customEffectsManager);
  });

  test("does not update cooldown state when completion event emission fails", async () => {
    const config = createConfig();
    const failingEventBus = {
      emit: (name: string) => {
        if (name === PlatformEvents.VFX_EFFECT_COMPLETED) {
          throw new Error("emit failed");
        }
      },
    };
    const service = new VFXCommandService(config, failingEventBus, {
      effectsManager: mockEffectsManager,
    });

    service.selectVFXCommand = createMockFn().mockResolvedValue({
      commandKey: "greetings",
      filename: "hello",
      mediaSource: "VFX Top",
      vfxFilePath: "/tmp",
      command: "!hello",
      duration: 5000,
    });

    const result = await service.executeCommand("!hello", {
      username: "testViewer",
      platform: "twitch",
      userId: "test-user-123",
      skipCooldown: false,
      correlationId: "test-corr-2",
    });

    expect(result.success).toBe(false);
    expect(service.stats.successfulCommands).toBe(0);
    expect(service.stats.failedCommands).toBe(1);
    expect(service.userLastCommand.size).toBe(0);
    expect(service.globalCommandCooldowns.size).toBe(0);
  });

  test("returns safe error text when non-Error values are thrown during execution", async () => {
    const config = createConfig();
    const service = new VFXCommandService(config, eventBus, {
      effectsManager: mockEffectsManager,
    });

    service.selectVFXCommand = createMockFn().mockRejectedValue(
      "plain-string-failure",
    );

    const result = await service.executeCommand("!hello", {
      username: "testViewer",
      platform: "twitch",
      userId: "test-user-123",
      skipCooldown: true,
      correlationId: "test-corr-3",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("plain-string-failure");
  });
});
