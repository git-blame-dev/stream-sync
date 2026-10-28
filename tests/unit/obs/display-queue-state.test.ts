import { describe, expect, it } from "bun:test";

import { DisplayQueueState } from "../../../src/obs/display-queue-state.ts";

describe("DisplayQueueState", () => {
  const child = (name: string, priority: number) => ({
    type: name, platform: 'twitch', priority, data: { username: name }
  });
  const names = (state: DisplayQueueState) => state.queue.map((entry) => state.isSequence(entry)
    ? entry.children.map((item) => item.type).join(',') : entry.type);

  it('recomputes a waiting sequence from surviving children and reorders pending entries', () => {
    const state = new DisplayQueueState();
    state.addSequence([child('synthetic-chat', 1), child('synthetic-greeting', 4)]);
    state.addItem(child('synthetic-command', 2));
    expect(state.removeMatching((item) => item.type === 'synthetic-greeting').map((item) => item.type)).toEqual(['synthetic-greeting']);
    expect(names(state)).toEqual(['synthetic-command', 'synthetic-chat']);
    expect(state.queue.map((entry) => entry.priority)).toEqual([2, 1]);
  });

  it('uses original admission FIFO when a demoted sequence ties older and newer pending entries', () => {
    const state = new DisplayQueueState();
    state.addItem(child('synthetic-older', 1));
    state.addSequence([child('synthetic-first-child', 1), child('synthetic-remove', 9), child('synthetic-last-child', 1)]);
    state.addItem(child('synthetic-newer', 1));
    state.removeMatching((item) => item.type === 'synthetic-remove');
    expect(names(state)).toEqual(['synthetic-older', 'synthetic-first-child,synthetic-last-child', 'synthetic-newer']);
    state.removeMatching((item) => item.type === 'synthetic-first-child');
    expect(names(state)).toEqual(['synthetic-older', 'synthetic-last-child', 'synthetic-newer']);
  });

  it('removes empty sequences without disturbing ordinary priority and equal-FIFO ordering', () => {
    const state = new DisplayQueueState();
    state.addItem(child('synthetic-low', 1));
    state.addItem(child('synthetic-high-first', 7));
    state.addSequence([child('synthetic-remove-one', 9), child('synthetic-remove-two', 8)]);
    state.addItem(child('synthetic-high-second', 7));
    state.removeMatching((item) => item.type.startsWith('synthetic-remove'));
    expect(names(state)).toEqual(['synthetic-high-first', 'synthetic-high-second', 'synthetic-low']);
    state.removeMatching(() => false);
    expect(names(state)).toEqual(['synthetic-high-first', 'synthetic-high-second', 'synthetic-low']);
  });
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
  });

});
