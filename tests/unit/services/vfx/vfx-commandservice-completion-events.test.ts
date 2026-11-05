import { vi, describe, test, expect, beforeEach, afterEach, spyOn } from 'bun:test';
import { EventEmitter } from 'node:events';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { EventBus } from '../../../../src/core/EventBus';

import { noOpLogger } from "../../../helpers/mock-factories";

import { PlatformEvents } from "../../../../src/interfaces/PlatformEvents";
import { OBSEffectsManager } from "../../../../src/obs/effects";
import { getUnifiedLogger } from "../../../../src/core/logging";
import {
  VFXCommandService,
  createVFXCommandService,
} from "../../../../src/services/VFXCommandService.ts";

type EventRecord = { name: string; payload: Record<string, unknown> };
type VFXServiceConfig = ConstructorParameters<typeof VFXCommandService>[0];

function createConfig(dir: string): VFXServiceConfig {
  return {
    commands: { greetings: "!hello, Synthetic VFX Source" },
    farewell: {},
    vfx: { filePath: dir },
    cooldowns: { cmdCooldown: 60, globalCmdCooldownMs: 60000 },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
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
  let effectsManager: OBSEffectsManager;
  let dir: string;
  let remoteEvents: EventEmitter;
  let remoteFailure: unknown;
  let call: ReturnType<typeof vi.fn<(...args: [string, Record<string, unknown>?]) => Promise<unknown>>>;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "synthetic-vfx-completion-"));
    try {
      await writeFile(join(dir, "greetings.mp4"), "synthetic bytes; remote OBS playback is simulated");
      recordedEvents = [];
      eventBus = new EventBus();
      for (const name of [PlatformEvents.VFX_COMMAND_EXECUTED, PlatformEvents.VFX_EFFECT_COMPLETED]) {
        eventBus.on(name, (payload: unknown) => {
          if (!isRecord(payload)) throw new Error("Expected VFX event payload object");
          recordedEvents.push({ name, payload });
        });
      }
      remoteEvents = new EventEmitter();
      remoteFailure = undefined;
      call = vi.fn(async (method: string, payload?: Record<string, unknown>): Promise<unknown> => {
        if (remoteFailure !== undefined) throw remoteFailure;
        if (method === "TriggerMediaInputAction") {
          // Duplicate external end notifications must not duplicate service completion.
          remoteEvents.emit("MediaInputPlaybackEnded", { inputName: payload?.inputName });
          remoteEvents.emit("MediaInputPlaybackEnded", { inputName: payload?.inputName });
        }
        return {};
      });
      effectsManager = new OBSEffectsManager({
        ensureConnected: async () => {}, call,
        addEventListener: (name, handler) => { remoteEvents.on(name, handler); },
        removeEventListener: (name, handler) => { remoteEvents.off(name, handler); },
      }, { logger: noOpLogger });
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      throw error;
    }
  });

  afterEach(async () => {
    try {
      expect(remoteEvents?.listenerCount("MediaInputPlaybackEnded") ?? 0).toBe(0);
    } finally {
      effectsManager?.dispose();
      eventBus?.reset();
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("emits both executed and effect-completed with enriched payload", async () => {
    const config = createConfig(dir);
    const service = new VFXCommandService(config, eventBus, {
      effectsManager,
    });

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
    expect(recordedEvents.map(({ name }) => name)).toEqual([
      PlatformEvents.VFX_COMMAND_EXECUTED, PlatformEvents.VFX_EFFECT_COMPLETED,
    ]);
    expect(call.mock.calls).toEqual([
      ["SetInputSettings", { inputName: "Synthetic VFX Source", inputSettings: {
        local_file: join(dir, "greetings.mp4"), looping: false,
      }, overlay: false }],
      ["TriggerMediaInputAction", { inputName: "Synthetic VFX Source",
        mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART" }],
    ]);
    expect(completedEvent.payload.correlationId).toBe("test-corr-1");

    const payload = completedEvent.payload;
    expect(executedEvent.payload.type).toBe(
      PlatformEvents.VFX_COMMAND_EXECUTED,
    );
    expect(payload.type).toBe(PlatformEvents.VFX_EFFECT_COMPLETED);
    expect(payload.commandKey).toBe("greetings");
    expect(payload.filename).toBe("greetings");
    expect(payload.mediaSource).toBe("Synthetic VFX Source");
    expect(payload.username).toBe("testViewer");
    expect(payload.platform).toBe("twitch");
    expect(payload.userId).toBe("test-user-123");
    expect(payload.context).toEqual(
      expect.objectContaining({ notificationType: "greeting" }),
    );
  });

  test("omits userId for automatic executions while preserving event correlation and context", async () => {
    const service = new VFXCommandService(createConfig(dir), eventBus, {
      effectsManager,
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
    const config = createConfig(dir);
    const customEffectsManager = effectsManager;

    const service = createVFXCommandService(config, null, {
      effectsManager: customEffectsManager,
    });

    expect(service._effectsManager).toBe(customEffectsManager);
  });

  test("rejects missing correlation before OBS execution or cooldown updates", async () => {
    const service = new VFXCommandService(createConfig(dir), eventBus, {
      effectsManager,
    });
    const result = await service.executeCommand("!hello", {
      username: "Synthetic Viewer",
      platform: "twitch",
      userId: "synthetic-user",
      skipCooldown: false,
    });
    expect(result.success).toBe(false);
    expect(result.error).toContain("correlationId");
    expect(call).not.toHaveBeenCalled();
    expect(recordedEvents).toHaveLength(0);
    expect(service.userLastCommand.size).toBe(0);
    expect(service.globalCommandCooldowns.size).toBe(0);
    expect(service.userCommandTimestamps.size).toBe(0);
    expect(service.stats.timedCommands).toBe(0);
  });

  test.each([PlatformEvents.VFX_COMMAND_EXECUTED, PlatformEvents.VFX_EFFECT_COMPLETED])("preserves actual success and cooldowns when %s publication fails", async (failingEvent) => {
    const config = createConfig(dir);
    const cooldownCommittedAtPublication: boolean[] = [];
    for (const name of [PlatformEvents.VFX_COMMAND_EXECUTED, PlatformEvents.VFX_EFFECT_COMPLETED]) {
      eventBus.on(name, () => {
        cooldownCommittedAtPublication.push(service.userLastCommand.has("test-user-123"));
        if (name === failingEvent) throw new Error("synthetic consumer failure");
      });
    }
    const service = new VFXCommandService(config, eventBus, {
      effectsManager,
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
    expect(call.mock.calls.map(([name]) => name)).toEqual([
      "SetInputSettings", "TriggerMediaInputAction",
    ]);
  });

  test("still publishes completion when executed publication and its diagnostic both throw", async () => {
    eventBus.on(PlatformEvents.VFX_COMMAND_EXECUTED, () => {
      throw new Error("synthetic observer failure");
    });
    const service = new VFXCommandService(createConfig(dir), eventBus, { effectsManager });
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
      expect(recordedEvents.map(({ name }) => name)).toEqual([
        PlatformEvents.VFX_COMMAND_EXECUTED, PlatformEvents.VFX_EFFECT_COMPLETED,
      ]);
      expectRecordedEvent(recordedEvents, PlatformEvents.VFX_EFFECT_COMPLETED);
      expect(service.userLastCommand.has("synthetic-user")).toBe(true);
      expect(service.stats.successfulCommands).toBe(1);
      expect(service.stats.failedCommands).toBe(0);
    } finally {
      diagnostic.mockRestore();
    }
  });

  test("returns safe error text when non-Error values are thrown during execution", async () => {
    const config = createConfig(dir);
    const service = new VFXCommandService(config, eventBus, {
      effectsManager,
    });

    remoteFailure = "plain-string-failure";

    const result = await service.executeCommand("!hello", {
      username: "testViewer",
      platform: "twitch",
      userId: "test-user-123",
      skipCooldown: false,
      correlationId: "test-corr-3",
    });

    expect(result.success).toBe(false);
    expect(result.error).toBe("plain-string-failure");
    expect(recordedEvents).toEqual([]);
    expect(service.stats.failedCommands).toBe(1);
    expect(service.stats.successfulCommands).toBe(0);
    expect(service.stats.timedCommands).toBe(1);
    expect(service.userLastCommand.size).toBe(0);
    expect(service.globalCommandCooldowns.size).toBe(0);
    remoteFailure = undefined;
    const recovered = await service.executeCommand("!hello", {
      username: "Synthetic Viewer", platform: "twitch", userId: "test-user-123",
      skipCooldown: false, correlationId: "synthetic-recovery",
    });
    expect(recovered.success).toBe(true);
    expect(service.stats.successfulCommands).toBe(1);
    expect(recordedEvents.map(({ name }) => name)).toEqual([
      PlatformEvents.VFX_COMMAND_EXECUTED, PlatformEvents.VFX_EFFECT_COMPLETED,
    ]);
  });
});
