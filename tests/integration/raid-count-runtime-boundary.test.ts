import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { AppRuntime } from "../../src/runtime/AppRuntime";
import { EventBus } from "../../src/core/EventBus";
import * as constants from "../../src/core/constants";
import { CommandCooldownService } from "../../src/services/CommandCooldownService";
import { PlatformLifecycleService } from "../../src/services/PlatformLifecycleService";
import { UserTrackingService } from "../../src/services/UserTrackingService";
import NotificationManager from "../../src/notifications/NotificationManager";
import type { DisplayQueueItem } from "../../src/interfaces/DisplayQueue";
import { createConfigFixture } from "../helpers/config-fixture";
import { noOpLogger } from "../helpers/mock-factories";
import { useFakeTimers, useRealTimers } from "../helpers/bun-timers";

describe("raid count real runtime boundary", () => {
  const runtimes: AppRuntime[] = [];
  beforeEach(() => useFakeTimers());
  afterEach(async () => {
    await Promise.all(runtimes.splice(0).map((runtime) => runtime.shutdown()));
    useRealTimers();
  });

  function createRuntime(options: { waitForVfx?: Promise<void>; rejectQueue?: boolean } = {}) {
    const config = createConfigFixture({ general: { raidsEnabled: true } });
    const eventBus = new EventBus();
    const items: DisplayQueueItem[] = [];
    let admissions = 0;
    const displayQueue = {
      addItem(item: DisplayQueueItem) {
        admissions++;
        if (options.rejectQueue) throw new Error("synthetic queue admission failure");
        items.push(item);
      },
      addSequence() { throw new Error("Raid must use one notification admission"); },
      getQueueLength: () => items.length,
    };
    const vfxCommandService = {
      async getVFXConfig() {
        await options.waitForVfx;
        return { commandKey: "raids", filename: "raids.mp4" };
      },
    };
    const userTrackingService = new UserTrackingService();
    const notificationManager = new NotificationManager({
      config, logger: noOpLogger, eventBus, displayQueue, constants,
      vfxCommandService, userTrackingService,
    } as unknown as ConstructorParameters<typeof NotificationManager>[0]);
    // Existing service interfaces use narrower callback inputs than runtime's
    // unknown-valued ports; retain the actual service instances at this boundary.
    const runtime = new AppRuntime(config, {
      logging: noOpLogger, eventBus, displayQueue, notificationManager,
      vfxCommandService, userTrackingService,
      commandCooldownService: new CommandCooldownService({ config, eventBus, logger: noOpLogger } as unknown as ConstructorParameters<typeof CommandCooldownService>[0]),
      platformLifecycleService: new PlatformLifecycleService({ config, eventBus, logger: noOpLogger }),
      lazyInnertube: {}, guiTransportService: {}, obsEventService: {},
    } as unknown as ConstructorParameters<typeof AppRuntime>[1]);
    runtimes.push(runtime);
    return { runtime, items, getAdmissions: () => admissions };
  }

  const identity = { username: "SyntheticRaider", userId: "synthetic-raider", timestamp: "2026-01-01T00:00:00.000Z" };

  for (const viewerCount of [undefined, 0, "0", 1, "1", -1, 1.5]) {
    it(`routes raid count ${String(viewerCount)} through the real router runtime manager and builder`, async () => {
      const { runtime, items, getAdmissions } = createRuntime();
      await runtime.platformEventRouter.routeEvent({ platform: "twitch", type: "platform:raid", data: { ...identity, ...(viewerCount === undefined ? {} : { viewerCount }) } });
      const count = viewerCount === undefined || Number(viewerCount) < 0 || !Number.isInteger(Number(viewerCount)) ? null : Number(viewerCount);
      const fragment = count === null ? "" : ` with ${count} ${count === 1 ? "viewer" : "viewers"}`;
      expect(getAdmissions()).toBe(1);
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        type: "platform:raid", priority: constants.PRIORITY_LEVELS.RAID,
        data: { displayMessage: `Incoming raid from SyntheticRaider${fragment}!`, ttsMessage: `Incoming raid from SyntheticRaider${fragment}`, logMessage: `Incoming raid from SyntheticRaider${fragment}!` },
        vfxConfig: { commandKey: "raids", filename: "raids.mp4" },
      });
    });
  }

  it("awaits the unified path through VFX preparation and queue admission", async () => {
    const gate = Promise.withResolvers<void>();
    const { runtime, items } = createRuntime({ waitForVfx: gate.promise });
    let completed = false;
    const routing = runtime.platformEventRouter.routeEvent({ platform: "twitch", type: "platform:raid", data: identity }).then(() => { completed = true; });
    try {
      await Promise.resolve();
      expect(completed).toBe(false);
      expect(items).toHaveLength(0);
    } finally {
      gate.resolve();
      await routing;
    }
    expect(completed).toBe(true);
    expect(items).toHaveLength(1);
  });

  it("preserves the unified failure result when external queue admission fails", async () => {
    const { runtime, items, getAdmissions } = createRuntime({ rejectQueue: true });
    const result = await runtime.handleRaidNotification("twitch", identity.username, identity);
    expect(result).toMatchObject({ success: false, error: "Display queue error", details: "synthetic queue admission failure" });
    expect(getAdmissions()).toBe(1);
    expect(items).toHaveLength(0);
  });

  it("retains identity and timestamp validation before notification admission", async () => {
    const { runtime, items, getAdmissions } = createRuntime();
    for (const data of [{ userId: identity.userId, timestamp: identity.timestamp }, { username: identity.username, timestamp: identity.timestamp }, { username: identity.username, userId: identity.userId }]) {
      await expect(runtime.platformEventRouter.routeEvent({ platform: "twitch", type: "platform:raid", data })).rejects.toThrow();
    }
    expect(getAdmissions()).toBe(0);
    expect(items).toHaveLength(0);
  });

  it("retains runtime identity validation when called without the router", async () => {
    const { runtime, items, getAdmissions } = createRuntime();
    for (const [username, options, error] of [
      ["", identity, "Missing username for platform:raid notification"],
      [identity.username, { timestamp: identity.timestamp }, "Missing userId for platform:raid notification"],
      [identity.username, { userId: identity.userId }, "Missing timestamp for platform:raid notification"],
    ] as const) {
      await expect(runtime.handleRaidNotification("twitch", username, options)).resolves.toMatchObject({ success: false, error });
    }
    expect(getAdmissions()).toBe(0);
    expect(items).toHaveLength(0);
  });
});
