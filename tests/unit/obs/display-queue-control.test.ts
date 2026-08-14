import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";

import { PRIORITY_LEVELS } from "../../../src/core/constants";
import type { DisplayQueueItem } from "../../../src/interfaces/DisplayQueue";
import { DisplayQueue } from "../../../src/obs/display-queue";
import { restoreAllMocks } from "../../helpers/bun-mock-utils";
import { initializeTestLogging } from "../../helpers/test-setup";

initializeTestLogging();

const chatItem = (message: string): DisplayQueueItem => ({
  type: "chat",
  platform: "twitch",
  data: { username: "test-user", message },
});

const notificationItem = (username: string): DisplayQueueItem => ({
  type: "platform:follow",
  platform: "twitch",
  data: { username },
});

function createQueue(options: { rowIntervalMs?: number; readyError?: Error; notificationsEnabled?: boolean } = {}) {
  const rows: Array<Record<string, unknown>> = [];
  const lifecycle: Array<Record<string, unknown>> = [];
  const delays: number[] = [];
  const eventBus = new EventEmitter();
  eventBus.on("display:row", (row) => rows.push(row as Record<string, unknown>));
  eventBus.on("display:notification-lifecycle", (event) => lifecycle.push(event as Record<string, unknown>));

  const queue = new DisplayQueue(
    {
      isReady: async () => {
        if (options.readyError) {
          throw options.readyError;
        }
        return false;
      },
      call: async () => ({}),
    },
    {
      autoProcess: false,
      gui: { enableNotifications: options.notificationsEnabled === true },
      ...(options.rowIntervalMs === undefined ? {} : { rowIntervalMs: options.rowIntervalMs }),
    },
    { PRIORITY_LEVELS },
    eventBus,
    {
      delay: async (ms) => {
        delays.push(ms);
      },
      ...(options.notificationsEnabled
        ? { notificationDelay: async (ms: number) => { delays.push(ms); } }
        : {}),
      sourcesManager: {
        updateTextSource: async () => {},
        clearTextSource: async () => {},
      },
    },
  );

  queue.effects.handleChatTTSEffects = async () => {};
  queue.effects.handleNotificationEffects = async () => {};

  return { delays, lifecycle, queue, rows };
}

describe("DisplayQueue GUI-primary control", () => {
  afterEach(() => {
    restoreAllMocks();
  });

  it("rejects items without a platform", () => {
    const { queue } = createQueue();

    expect(() => queue.addItem({
      type: "chat",
      data: { username: "test-user", message: "hello" },
    } as DisplayQueueItem)).toThrow("platform");
  });

  it("emits rows without checking OBS readiness", async () => {
    const { queue, rows } = createQueue({ readyError: new Error("OBS unavailable") });
    queue.addItem(chatItem("still visible"));

    await queue.processQueue();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      type: "chat",
      platform: "twitch",
      data: { message: "still visible" },
    });
  });

  it("assigns an event ID once and emits it with the row", async () => {
    const { queue, rows } = createQueue();
    const item = chatItem("identified");
    queue.addItem(item);

    await queue.processQueue();

    expect(item.eventId).toBeString();
    expect(rows[0]?.eventId).toBe(item.eventId);
  });

  it("emits coordinated notification rows and lifecycle with the same event ID", async () => {
    const { lifecycle, queue, rows } = createQueue({ notificationsEnabled: true });
    const item = notificationItem("coordinated-user");
    queue.addItem(item);

    await queue.processQueue();
    await queue.effectChain;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.eventId).toBe(item.eventId);
    expect(lifecycle.map((event) => ({ eventId: event.eventId, phase: event.phase }))).toEqual([
      { eventId: item.eventId, phase: "started" },
      { eventId: item.eventId, phase: "exit-started" },
    ]);
  });

  it("uses the configured interval for every presented row", async () => {
    const { delays, queue } = createQueue({ rowIntervalMs: 750 });
    queue.addItem(chatItem("one"));
    queue.addItem(chatItem("two"));

    await queue.processQueue();

    expect(delays).toEqual([750, 750]);
  });

  it("defaults row pacing to one second", async () => {
    const { delays, queue } = createQueue();
    queue.addItem(chatItem("default pace"));

    await queue.processQueue();

    expect(delays).toEqual([1000]);
  });

  it("preserves child order within an atomic sequence", async () => {
    const { queue, rows } = createQueue({ rowIntervalMs: 0 });
    queue.addSequence([chatItem("source chat"), notificationItem("linked-user")]);

    await queue.processQueue();

    expect(rows.map((row) => row.type)).toEqual(["chat", "platform:follow"]);
  });

  it("does not let pending OBS effects delay later GUI rows", async () => {
    const { queue, rows } = createQueue({ rowIntervalMs: 0 });
    let releaseFirstEffect: (() => void) | undefined;
    const firstEffect = new Promise<void>((resolve) => {
      releaseFirstEffect = resolve;
    });
    queue.effects.handleChatTTSEffects = async (item) => {
      if (item.data.message === "one") {
        await firstEffect;
      }
    };
    queue.addItem(chatItem("one"));
    queue.addItem(chatItem("two"));

    await queue.processQueue();

    expect(rows.map((row) => (row.data as { message: string }).message)).toEqual(["one", "two"]);
    releaseFirstEffect?.();
    await queue.effectChain;
  });

  it("isolates effect failures and runs later effects", async () => {
    const { queue } = createQueue({ rowIntervalMs: 0 });
    const processed: string[] = [];
    queue.effects.handleChatTTSEffects = async (item) => {
      const message = String(item.data.message);
      if (message === "one") {
        throw new Error("test effect failure");
      }
      processed.push(message);
    };
    queue.addItem(chatItem("one"));
    queue.addItem(chatItem("two"));

    await queue.processQueue();
    await queue.effectChain;

    expect(processed).toEqual(["two"]);
  });

  it("counts active sequence children and clears pending rows", () => {
    const { queue } = createQueue();
    queue.addSequence([chatItem("one"), notificationItem("linked-user")]);

    expect(queue.getQueueLength()).toBe(2);
    queue.clearQueue();
    expect(queue.getQueueLength()).toBe(0);
  });
});
