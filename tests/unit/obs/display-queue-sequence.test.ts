import { afterEach, describe, expect, it } from "bun:test";
import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import { PRIORITY_LEVELS } from "../../../src/core/constants";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { initializeTestLogging } from "../../helpers/test-setup";

initializeTestLogging();

type Queue = InstanceType<typeof DisplayQueue>;
type Item = Parameters<Queue["displayItem"]>[0];

const item = (type: string, name: string, priority?: number): Item => ({
  type,
  platform: "twitch",
  ...(priority === undefined ? {} : { priority }),
  data: { username: name, message: name },
});

describe("DisplayQueue sequences", () => {
  afterEach(() => restoreAllMocks());

  const createQueue = (maxQueueSize?: number): Queue => {
    const queue = new DisplayQueue(
      { isReady: async () => true, call: async () => ({}) },
      {
        autoProcess: false,
        ...(maxQueueSize === undefined ? {} : { maxQueueSize }),
        chat: { sourceName: "chat", sceneName: "scene", groupName: "group", platformLogos: {} },
        notification: { sourceName: "notification", sceneName: "scene", groupName: "group", platformLogos: {} },
      },
      { PRIORITY_LEVELS },
      null,
      { delay: () => Promise.resolve() },
    );
    queue.getDuration = createMockFn().mockReturnValue(0);
    return queue;
  };

  it("schedules a sequence by its maximum child priority, preserving exact child order", async () => {
    const queue = createQueue();
    const seen: string[] = [];
    queue.displayItem = async (entry) => { seen.push(String(entry.data.username)); return true; };
    queue.addItem(item("platform:raid", "unrelated", 2));
    queue.addSequence([item("chat", "first", 1), item("platform:gift", "second", 5), item("chat", "third", 1)]);
    await queue.processQueue();
    expect(seen).toEqual(["first", "second", "third", "unrelated"]);
  });

  it("does not interrupt remaining children or an active unrelated row", async () => {
    const queue = createQueue();
    const seen: string[] = [];
    let release!: () => void;
    const displaying = new Promise<void>((resolve) => { release = resolve; });
    queue.displayItem = async (entry) => {
      seen.push(String(entry.data.username));
      if (entry.data.username === "first") await displaying;
      return true;
    };
    queue.addSequence([item("chat", "first", 1), item("chat", "second", 1)]);
    const processing = queue.processQueue();
    await Promise.resolve();
    queue.addItem(item("platform:raid", "urgent", 10));
    expect(seen).toEqual(["first"]);
    release();
    await processing;
    expect(seen).toEqual(["first", "second", "urgent"]);
  });

  it("waits for an unrelated active row before starting a new sequence", async () => {
    const queue = createQueue();
    const seen: string[] = [];
    let release!: () => void;
    const displaying = new Promise<void>((resolve) => { release = resolve; });
    queue.displayItem = async (entry) => {
      seen.push(String(entry.data.username));
      if (entry.data.username === "active-unrelated") await displaying;
      return true;
    };
    queue.addItem(item("platform:gift", "active-unrelated", 1));
    const processing = queue.processQueue();
    await Promise.resolve();
    queue.addSequence([item("chat", "source", 1), item("command", "result", 2)]);
    expect(seen).toEqual(["active-unrelated"]);
    release();
    await processing;
    expect(seen).toEqual(["active-unrelated", "source", "result"]);
  });

  it("rejects an over-capacity sequence atomically and preserves lastChat", () => {
    const queue = createQueue(2);
    queue.addItem(item("chat", "admitted"));
    const before = [...queue.queue];
    expect(() => queue.addSequence([item("chat", "one"), item("chat", "two")])).toThrow("Queue at capacity");
    expect(queue.queue).toEqual(before);
    expect(queue.lastChatItem?.data.username).toBe("admitted");
  });

  it("counts queued children and records the admitted sequence chat", () => {
    const queue = createQueue();
    queue.addSequence([item("chat", "one"), item("platform:gift", "gift"), item("chat", "two")]);
    expect(queue.getQueueLength()).toBe(3);
    expect(queue.lastChatItem?.data.username).toBe("two");
  });

  it("counts remaining active children for queue length and capacity", async () => {
    const queue = createQueue(2);
    let release!: () => void;
    const displaying = new Promise<void>((resolve) => { release = resolve; });
    queue.displayItem = async (entry) => {
      if (entry.data.username === "active") await displaying;
      return true;
    };
    queue.addSequence([item("chat", "active"), item("command", "remaining")]);
    const processing = queue.processQueue();
    await Promise.resolve();

    expect(queue.getQueueLength()).toBe(1);
    expect(() => queue.addSequence([item("chat", "one"), item("command", "two")])).toThrow("Queue at capacity");

    release();
    await processing;
  });

  it("continues after a child display failure", async () => {
    const queue = createQueue();
    const seen: string[] = [];
    queue.displayItem = async (entry) => { seen.push(String(entry.data.username)); if (seen.length === 1) throw new Error("display failed"); return true; };
    queue.addSequence([item("chat", "failed"), item("chat", "continued")]);
    await queue.processQueue();
    expect(seen).toEqual(["failed", "continued"]);
  });

  it("does not start a concurrent processor after clearing an active sequence", async () => {
    const queue = createQueue();
    const seen: string[] = [];
    let release!: () => void;
    const displaying = new Promise<void>((resolve) => { release = resolve; });
    queue.displayItem = async (entry) => {
      seen.push(String(entry.data.username));
      if (entry.data.username === "active") await displaying;
      return true;
    };
    queue.addSequence([item("chat", "active"), item("command", "cleared")]);
    const processing = queue.processQueue();
    await Promise.resolve();

    queue.clearQueue();
    queue.config.autoProcess = true;
    queue.addSequence([item("chat", "new-source"), item("command", "new-result")]);
    expect(seen).toEqual(["active"]);

    release();
    await processing;
    expect(seen).toEqual(["active", "new-source", "new-result"]);
  });

  it("counts chats in queued and active sequence backlog", async () => {
    const queue = createQueue();
    let release!: () => void;
    const displaying = new Promise<void>((resolve) => { release = resolve; });
    queue.displayItem = async (entry) => { if (entry.data.username === "active") await displaying; return true; };
    queue.addSequence([item("chat", "active"), item("chat", "remaining")]);
    const processing = queue.processQueue();
    await Promise.resolve();
    queue.addSequence([item("chat", "queued"), item("chat", "queued-again")]);
    expect(queue.hasMultipleQueuedChats()).toBe(true);
    release();
    await processing;
  });

  it("uses normal pacing for an unmarked sequence", () => {
    const queue = createQueue();
    queue.addSequence([item("chat", "default")]);

    expect((queue.queue[0] as Record<string, unknown>).chatPacing).toBe("normal");
  });

  it("records accelerated pacing on a sequence", () => {
    const queue = createQueue();

    Reflect.apply(queue.addSequence, queue, [[item("chat", "accelerated")], { chatPacing: "accelerated" }]);

    expect((queue.queue[0] as Record<string, unknown>).chatPacing).toBe("accelerated");
  });

  it("applies sequence pacing while processing its children", async () => {
    const queue = createQueue();
    queue.displayItem = async () => true;
    Reflect.apply(queue.addSequence, queue, [[item("chat", "accelerated")], { chatPacing: "accelerated" }]);

    await queue.processQueue();

    expect(queue.getDuration).toHaveBeenCalledWith(
      expect.objectContaining({ type: "chat" }),
      "accelerated",
    );
  });

  it.each([
    ["accelerated", { chatPacing: "accelerated" }, [0, 250, 3000, 250]],
    ["normal", undefined, [4500, 250, 3000, 250]],
  ] as const)("uses %s chat pacing across a chat-notification sequence", async (_name, options, expectedDelays) => {
    const delays: number[] = [];
    const events: string[] = [];
    const queue = new DisplayQueue(
      { isReady: async () => true, call: async () => ({}) },
      {
        autoProcess: false,
        ttsEnabled: false,
        timing: { chatMessageDuration: 4500, transitionDelay: 250 },
        chat: { sourceName: "chat", sceneName: "scene", groupName: "group", platformLogos: {} },
        notification: { sourceName: "notification", sceneName: "scene", groupName: "group", platformLogos: {} },
      },
      { PRIORITY_LEVELS },
      null,
      { delay: async (ms) => { delays.push(ms); } },
    );
    queue.displayItem = async (entry) => {
      events.push(`display:${entry.type}`);
      return true;
    };
    queue.hideCurrentDisplay = async (entry) => {
      events.push(`hide:${entry?.type}`);
    };
    queue.displayLingeringChat = async () => {};
    const items = [
      item("chat", "source"),
      { ...item("command", "result"), holdDurationMs: 3000 },
    ];

    queue.addSequence(items, options);
    await queue.processQueue();

    expect(delays).toEqual([...expectedDelays]);
    expect(events).toEqual([
      "display:chat",
      "hide:chat",
      "display:command",
      "hide:command",
    ]);
  });
});
