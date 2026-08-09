import { describe, expect, it } from "bun:test";

import { DisplayQueueState } from "../../../src/obs/display-queue-state.ts";

describe("DisplayQueueState", () => {
  type DisplayItem = DisplayQueueState["queue"][number];
  type DisplayData = Record<string, unknown>;
  type PriorityType = "high" | "medium" | "low" | "chat";

  const priorities: Record<PriorityType, number> = {
      high: 10,
      medium: 5,
      low: 1,
      chat: 2,
    };

  const getPriority = (type: string) =>
    isPriorityType(type) ? priorities[type] : 0;

  const isPriorityType = (type: string): type is PriorityType =>
    type === "high" || type === "medium" || type === "low" || type === "chat";

  const expectRecordData = (item: DisplayItem | null | undefined): DisplayData => {
    expect(item).toBeDefined();
    const data = item && "data" in item ? item.data : undefined;
    expect(data).toBeObject();
    if (data === null || typeof data !== "object") {
      throw new Error("Expected display item data object");
    }
    return data as DisplayData;
  };

  it("orders items by priority with higher values first", () => {
    const state = new DisplayQueueState({ maxQueueSize: 10, getPriority });

    state.addItem({
      type: "low",
      platform: "test",
      data: { username: "test-user" },
    });
    state.addItem({
      type: "high",
      platform: "test",
      data: { username: "test-user" },
    });

    expect(state.queue.map((item) => item.type)).toEqual(["high", "low"]);
  });

  it("preserves FIFO ordering for same-priority items", () => {
    const state = new DisplayQueueState({ maxQueueSize: 10, getPriority });

    state.addItem({
      type: "medium",
      platform: "test",
      data: { username: "test-user-1" },
    });
    state.addItem({
      type: "medium",
      platform: "test",
      data: { username: "test-user-2" },
    });

    expect(state.queue.map((item) => expectRecordData(item).username)).toEqual([
      "test-user-1",
      "test-user-2",
    ]);
  });

  it("preserves queued chat items and records the latest chat item", () => {
    const state = new DisplayQueueState({ maxQueueSize: 10, getPriority });

    state.addItem({
      type: "chat",
      platform: "test",
      data: { username: "test-user-1", message: "first" },
    });
    state.addItem({
      type: "chat",
      platform: "test",
      data: { username: "test-user-2", message: "second" },
    });

    expect(state.queue.map((item) => expectRecordData(item).message)).toEqual([
      "first",
      "second",
    ]);
    expect(expectRecordData(state.lastChatItem).message).toBe("second");
  });

  it("enforces maxQueueSize limits", () => {
    const state = new DisplayQueueState({ maxQueueSize: 1, getPriority });

    state.addItem({
      type: "low",
      platform: "test",
      data: { username: "test-user" },
    });

    expect(() => {
      state.addItem({
        type: "high",
        platform: "test",
        data: { username: "test-user" },
      });
    }).toThrow("Queue at capacity (1)");
  });

  it("rejects additional chat at capacity instead of dropping queued chat", () => {
    const state = new DisplayQueueState({ maxQueueSize: 1, getPriority });

    state.addItem({
      type: "chat",
      platform: "test",
      data: { username: "test-user-1", message: "first" },
    });
    expect(() => {
      state.addItem({
        type: "chat",
        platform: "test",
        data: { username: "test-user-2", message: "second" },
      });
    }).toThrow("Queue at capacity (1)");

    expect(state.queue).toHaveLength(1);
    expect(expectRecordData(state.queue[0]).message).toBe("first");
    expect(expectRecordData(state.lastChatItem).message).toBe("first");
  });

  it("stores accelerated mode on a sequence and defaults unmarked sequences to normal", () => {
    const state = new DisplayQueueState({ maxQueueSize: 10, getPriority });
    const child = { type: "chat", platform: "test", data: { username: "test-user" } };

    Reflect.apply(state.addSequence, state, [[child], { chatPacing: "accelerated" }]);
    Reflect.apply(state.addSequence, state, [[child]]);

    expect((state.queue[0] as Record<string, unknown>).chatPacing).toBe("accelerated");
    expect((state.queue[1] as Record<string, unknown>).chatPacing).toBe("normal");
  });

  it("normalizes malformed sequence options to normal pacing", () => {
    const state = new DisplayQueueState({ maxQueueSize: 10, getPriority });
    const child = { type: "chat", platform: "test", data: { username: "test-user" } };

    Reflect.apply(state.addSequence, state, [[child], null]);
    Reflect.apply(state.addSequence, state, [[child], { chatPacing: "turbo" }]);

    expect((state.queue[0] as Record<string, unknown>).chatPacing).toBe("normal");
    expect((state.queue[1] as Record<string, unknown>).chatPacing).toBe("normal");
  });
});
