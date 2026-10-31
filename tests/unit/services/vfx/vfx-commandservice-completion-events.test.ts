import { vi, describe, test, expect, beforeEach, spyOn } from 'bun:test';

import { noOpLogger } from "../../../helpers/mock-factories";

import { PlatformEvents } from "../../../../src/interfaces/PlatformEvents";
import { OBSEffectsManager } from "../../../../src/obs/effects";
import { getUnifiedLogger } from "../../../../src/core/logging";
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
    commands: { greetings: "!hello, Synthetic VFX Source" },
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
      ensureConnected: vi.fn<(...args: []) => Promise<void>>().mockResolvedValue(undefined),
      call: vi.fn<(...args: [string, Record<string, unknown>?]) => Promise<unknown>>().mockResolvedValue({}),
    },
    {
      logger: obsLogger,
      retrySystem: { delay: () => Promise.resolve() },
    },
  );
  effectsManager.playMediaInOBS = vi.fn<(...args: Parameters<PlayMediaInOBS>) => ReturnType<PlayMediaInOBS>>()
    .mockResolvedValue(undefined);
  return effectsManager;
}

function createExternalOBSFixture() {
  const call = vi.fn<(...args: [string, Record<string, unknown>?]) => Promise<unknown>>()
    .mockResolvedValue({});
  const effectsManager = new OBSEffectsManager({
    ensureConnected: async () => {},
    call,
    addEventListener: (_name: string, handler: (data?: Record<string, unknown>) => void) => {
      queueMicrotask(() => handler({ inputName: "Synthetic VFX Source" }));
    },
    removeEventListener: () => {},
  }, {
    logger: noOpLogger,
    delay: async () => {},
  });
  return { effectsManager, call };
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

    service.selectVFXCommand = vi.fn<(...args: unknown[]) => Promise<typeof vfxConfig>>().mockResolvedValue(vfxConfig);

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
    service.selectVFXCommand = vi.fn<(...args: unknown[]) => Promise<{ commandKey: string; filename: string; mediaSource: string; vfxFilePath: string; command: string; duration: number; }>>().mockResolvedValue({
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

  test("rejects missing correlation before OBS execution or cooldown updates", async () => {
    const obs = createExternalOBSFixture();
    const service = new VFXCommandService(createConfig(), eventBus, {
      effectsManager: obs.effectsManager,
    });
    const result = await service.executeCommand("!hello", {
      username: "Synthetic Viewer",
      platform: "twitch",
      userId: "synthetic-user",
      skipCooldown: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("correlationId");
    expect(obs.call).not.toHaveBeenCalled();
    expect(recordedEvents).toHaveLength(0);
    expect(service.userLastCommand.size).toBe(0);
    expect(service.globalCommandCooldowns.size).toBe(0);
    expect(service.userCommandTimestamps.size).toBe(0);
    expect(service.stats.timedCommands).toBe(0);
  });

  test.each([PlatformEvents.VFX_COMMAND_EXECUTED, PlatformEvents.VFX_EFFECT_COMPLETED])("preserves actual success and cooldowns when %s publication fails", async (failingEvent) => {
    const obs = createExternalOBSFixture();
    const config = createConfig();
    const cooldownCommittedAtPublication: boolean[] = [];
    const failingEventBus = {
      emit: (name: string) => {
        cooldownCommittedAtPublication.push(service.userLastCommand.has("test-user-123"));
        recordedEvents.push({ name, payload: {} });
        if (name === failingEvent) {
          throw new Error("emit failed");
        }
      },
    };
    const service = new VFXCommandService(config, failingEventBus, {
      effectsManager: obs.effectsManager,
    });

    const result = await service.executeCommand("!hello", {
      username: "testViewer",
      platform: "twitch",
      userId: "test-user-123",
      skipCooldown: false,
      correlationId: "test-corr-2",
    });

    expect(result.success).toBe(true);
    expect(service.stats.successfulCommands).toBe(1);
    expect(service.stats.failedCommands).toBe(0);
    expect(service.stats.timedCommands).toBe(1);
    expect(cooldownCommittedAtPublication).toEqual([true, true]);
    expect(service.userLastCommand.size).toBe(1);
    expect(service.globalCommandCooldowns.has("greetings")).toBe(true);
    expect(service.userCommandTimestamps.get("test-user-123")).toHaveLength(1);
    expect(recordedEvents.map(({ name }) => name)).toEqual([
      PlatformEvents.VFX_COMMAND_EXECUTED,
      PlatformEvents.VFX_EFFECT_COMPLETED,
    ]);
    const repeated = await service.executeCommand("!hello", {
      username: "Synthetic Viewer", platform: "twitch", userId: "test-user-123",
      skipCooldown: false, correlationId: "synthetic-repeat",
    });
    expect(repeated.error).toBe("Command on cooldown");
    expect(obs.call.mock.calls.map(([name]) => name)).toEqual([
      "SetInputSettings", "TriggerMediaInputAction",
    ]);
  });

  test("still publishes completion when executed publication and its diagnostic both throw", async () => {
    const obs = createExternalOBSFixture();
    const service = new VFXCommandService(createConfig(), {
      emit: (name, payload) => {
        if (name === PlatformEvents.VFX_COMMAND_EXECUTED) throw new Error("synthetic observer failure");
        if (isRecord(payload)) recordedEvents.push({ name, payload });
      },
    }, { effectsManager: obs.effectsManager });
    const diagnostic = spyOn(getUnifiedLogger(), "error").mockImplementation(() => {
      throw new Error("synthetic diagnostic failure");
    });
    try {
      const result = await service.executeCommand("!hello", {
        username: "Synthetic Viewer", platform: "twitch", userId: "  synthetic-user  ",
        skipCooldown: false, correlationId: "synthetic-diagnostic-correlation",
      });
      expect(result.success).toBe(true);
      expect(diagnostic).toHaveBeenCalledTimes(1);
      expectRecordedEvent(recordedEvents, PlatformEvents.VFX_EFFECT_COMPLETED);
      expect(service.userLastCommand.has("synthetic-user")).toBe(true);
      expect(service.stats.successfulCommands).toBe(1);
      expect(service.stats.failedCommands).toBe(0);
    } finally {
      diagnostic.mockRestore();
    }
  });

  test("returns safe error text when non-Error values are thrown during execution", async () => {
    const config = createConfig();
    const service = new VFXCommandService(config, eventBus, {
      effectsManager: mockEffectsManager,
    });

    service.selectVFXCommand = vi.fn<(...args: unknown[]) => Promise<never>>().mockRejectedValue("plain-string-failure");

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
