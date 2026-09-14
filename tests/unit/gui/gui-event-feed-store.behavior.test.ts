import { describe, expect, it } from "bun:test";

import { createGuiFeedStore } from "../../../gui/src/shared/feed-store";

function expectFirstRow<T>(rows: T[]): T {
  const [row] = rows;
  if (!row) {
    throw new Error("expected at least one GUI feed row");
  }
  return row;
}

function createRow(index: number) {
  return {
    type: "chat",
    kind: "chat",
    platform: "twitch",
    username: `test-user-${index}`,
    text: `message-${index}`,
    avatarUrl: `https://example.invalid/avatar-${index}.png`,
    timestamp: `2024-01-01T00:00:0${index}.000Z`,
    presentationRole: "ordinary" as const,
  };
}

describe("GUI feed store behavior", () => {
  it("filters normalized rows before deduplication and retention", () => {
    const store = createGuiFeedStore({ inclusionPredicate: (row) => row.kind !== "chat", maxRows: 1 });
    store.pushEvent({ ...createRow(1), eventId: "chat-1" });
    store.pushEvent({ ...createRow(1), kind: "notification", eventId: "notification-1" });
    expect(store.getRows()).toHaveLength(1);
    expect(store.getRows()[0]?.kind).toBe("notification");
  });

  it("consumes mapper DTO fields and appends display rows", () => {
    const store = createGuiFeedStore();

    store.pushEvent({
      type: "chat",
      kind: "chat",
      platform: "twitch",
      username: "test-user",
      text: "hello world",
      avatarUrl: "https://example.invalid/test-avatar.png",
      timestamp: "2024-01-01T00:00:00.000Z",
      ignoredField: "ignore-me",
    });

    const rows = store.getRows();
    expect(rows.length).toBe(1);
    const row = expectFirstRow(rows);
    expect(row.type).toBe("chat");
    expect(row.kind).toBe("chat");
    expect(row.platform).toBe("twitch");
    expect(row.username).toBe("test-user");
    expect(row.text).toBe("hello world");
    expect(row.avatarUrl).toBe("https://example.invalid/test-avatar.png");
    expect(row.timestamp).toBe("2024-01-01T00:00:00.000Z");
    expect(Object.prototype.hasOwnProperty.call(row, "ignoredField")).toBe(
      false,
    );
  });

  it("preserves isPaypiggy on chat rows", () => {
    const store = createGuiFeedStore();

    store.pushEvent({
      type: "chat",
      kind: "chat",
      platform: "twitch",
      username: "test-user",
      text: "hello world",
      avatarUrl: "https://example.invalid/test-avatar.png",
      timestamp: "2024-01-01T00:00:00.000Z",
      isPaypiggy: true,
    });

    const rows = store.getRows();
    expect(rows.length).toBe(1);
    expect(expectFirstRow(rows).isPaypiggy).toBe(true);
  });

  it("retains strict stream supporter state only for chat rows", () => {
    const store = createGuiFeedStore();

    store.pushEvent({ ...createRow(1), isPaypiggy: false, isStreamSupporter: true });
    store.pushEvent({ ...createRow(2), isStreamSupporter: "true" });
    store.pushEvent({ ...createRow(3), kind: "notification", isStreamSupporter: true });

    expect(store.getRows()[0]?.isStreamSupporter).toBe(true);
    expect(store.getRows()[0]?.isPaypiggy).toBe(false);
    expect(store.getRows()[1]?.isStreamSupporter).toBeUndefined();
    expect(store.getRows()[2]?.isStreamSupporter).toBeUndefined();
  });

  it("normalizes presentation roles and overrides without dropping rows", () => {
    const store = createGuiFeedStore();

    store.pushEvent({
      ...createRow(1),
      presentationRole: "member",
      presentationOverride: { theme: "red", effects: ["particles", "sheen", "particles"], spriteUrl: "https://cdn.example/member.gif" },
    });
    store.pushEvent({
      ...createRow(2),
      presentationRole: "member",
      presentationOverride: { theme: "invalid", effects: ["bad"], spriteUrl: "javascript:bad" },
    });
    store.pushEvent({
      ...createRow(3),
      presentationRole: "member",
      presentationOverride: { spriteUrl: "https://user:pass@example.invalid/member.gif#fragment" },
    });
    store.pushEvent({
      ...createRow(4),
      presentationRole: "supporter",
      presentationOverride: { effects: ["sheen", "sheen"] },
    });
    store.pushEvent({
      ...createRow(5),
      presentationRole: "member",
      presentationOverride: { effects: [] },
    });

    expect(store.getRows()[0]?.presentationOverride).toEqual({ theme: "red", effects: ["particles", "sheen"], spriteUrl: "https://cdn.example/member.gif" });
    expect(store.getRows()[1]?.presentationOverride).toBeUndefined();
    expect(store.getRows()[2]?.presentationOverride?.spriteUrl).toBeUndefined();
    expect(store.getRows()[3]?.presentationOverride).toBeUndefined();
    expect(store.getRows()[4]?.presentationOverride).toEqual({ effects: [] });
  });

  it("enforces the presentation role matrix for every row kind", () => {
    const cases = [
      ["chat member", "chat", "member", "member"],
      ["chat supporter", "chat", "supporter", "supporter"],
      ["chat ordinary", "chat", "ordinary", "ordinary"],
      ["chat missing", "chat", undefined, "ordinary"],
      ["chat malformed", "chat", 42, "ordinary"],
      ["notification ordinary", "notification", "ordinary", "ordinary"],
      ["notification monetization", "notification", "monetization", "monetization"],
      ["notification member", "notification", "member", "ordinary"],
      ["notification missing", "notification", undefined, "ordinary"],
      ["command supporter", "command", "supporter", "ordinary"],
      ["greeting member", "greeting", "member", "ordinary"],
      ["farewell monetization", "farewell", "monetization", "ordinary"],
    ] as const;

    for (const [label, kind, presentationRole, expectedRole] of cases) {
      const store = createGuiFeedStore();
      store.pushEvent({ ...createRow(1), kind, presentationRole });

      expect(expectFirstRow(store.getRows()).presentationRole, label).toBe(expectedRole);
    }
  });

  it("strips chat-only status and member overrides from non-chat rows", () => {
    const store = createGuiFeedStore();
    store.pushEvent({
      ...createRow(1),
      kind: "notification",
      presentationRole: "member",
      presentationOverride: { theme: "red" },
      isPaypiggy: true,
      isStreamSupporter: true,
    });
    const row = expectFirstRow(store.getRows());

    expect(row.presentationRole).toBe("ordinary");
    expect(row.presentationOverride).toBeUndefined();
    expect(row.isPaypiggy).toBeUndefined();
    expect(row.isStreamSupporter).toBeUndefined();
  });

  it("preserves parts arrays emitted by GUI mapper", () => {
    const store = createGuiFeedStore();

    store.pushEvent({
      type: "chat",
      kind: "chat",
      platform: "tiktok",
      username: "test-user",
      text: "",
      parts: [
        {
          type: "emote",
          platform: "tiktok",
          emoteId: "1234512345",
          imageUrl: "https://example.invalid/tiktok-emote.webp",
        },
      ],
      avatarUrl: "https://example.invalid/test-avatar.png",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    const rows = store.getRows();
    expect(rows).toHaveLength(1);
    expect(expectFirstRow(rows).parts).toEqual([
      {
        type: "emote",
        platform: "tiktok",
        emoteId: "1234512345",
        imageUrl: "https://example.invalid/tiktok-emote.webp",
      },
    ]);
  });

  it("preserves canonical badgeImages and drops duplicate urls", () => {
    const store = createGuiFeedStore();

    store.pushEvent({
      type: "chat",
      kind: "chat",
      platform: "twitch",
      username: "test-user",
      text: "hello world",
      badgeImages: [
        {
          imageUrl: "https://example.invalid/badge-1.png",
          source: "twitch",
          label: "mod",
        },
        {
          imageUrl: "https://example.invalid/badge-1.png",
          source: "twitch",
          label: "dupe",
        },
        {
          imageUrl: "https://example.invalid/badge-2.png",
          source: "twitch",
          label: "founder",
        },
      ],
      avatarUrl: "https://example.invalid/test-avatar.png",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    const rows = store.getRows();
    expect(rows).toHaveLength(1);
    expect(expectFirstRow(rows).badgeImages).toEqual([
      {
        imageUrl: "https://example.invalid/badge-1.png",
        source: "twitch",
        label: "mod",
      },
      {
        imageUrl: "https://example.invalid/badge-2.png",
        source: "twitch",
        label: "founder",
      },
    ]);
  });

  it("appends multiple rows in arrival order", () => {
    const store = createGuiFeedStore();

    store.pushEvent({
      type: "chat",
      kind: "chat",
      platform: "twitch",
      username: "test-user-1",
      text: "one",
      avatarUrl: "https://example.invalid/avatar-1.png",
      timestamp: "2024-01-01T00:00:00.000Z",
    });
    store.pushEvent({
      type: "chat",
      kind: "chat",
      platform: "twitch",
      username: "test-user-2",
      text: "two",
      avatarUrl: "https://example.invalid/avatar-2.png",
      timestamp: "2024-01-01T00:00:01.000Z",
    });
    store.pushEvent({
      type: "chat",
      kind: "chat",
      platform: "twitch",
      username: "test-user-3",
      text: "three",
      avatarUrl: "https://example.invalid/avatar-3.png",
      timestamp: "2024-01-01T00:00:02.000Z",
    });

    const rows = store.getRows();
    expect(rows.length).toBe(3);
    const [firstRow, secondRow, thirdRow] = rows;
    if (!firstRow || !secondRow || !thirdRow) {
      throw new Error("expected three GUI feed rows");
    }
    expect(firstRow.username).toBe("test-user-1");
    expect(secondRow.username).toBe("test-user-2");
    expect(thirdRow.username).toBe("test-user-3");
  });

  it("suppresses duplicate event IDs without collapsing distinct rows", () => {
    const store = createGuiFeedStore();
    const row = createRow(1);

    store.pushEvent({ ...row, eventId: "event-1" });
    store.pushEvent({ ...row, eventId: "event-1" });
    store.pushEvent({ ...row, eventId: "event-2" });

    expect(store.getRows().map((entry) => entry.eventId)).toEqual([
      "event-1",
      "event-2",
    ]);
  });

  it("filters normalized rows before reserving event IDs", () => {
    let shouldInclude = false;
    const store = createGuiFeedStore({
      inclusionPredicate: () => shouldInclude,
    });
    const event = { ...createRow(1), eventId: "event-filtered-first" };

    store.pushEvent(event);
    shouldInclude = true;
    store.pushEvent(event);

    expect(store.getRows().map((entry) => entry.eventId)).toEqual([
      "event-filtered-first",
    ]);
  });

  it("does not let filtered rows consume the visible row limit", () => {
    const store = createGuiFeedStore({
      maxRows: 1,
      inclusionPredicate: (row) => row.kind === "chat",
    });

    store.pushEvent({ ...createRow(1), eventId: "event-visible" });
    store.pushEvent({
      ...createRow(2),
      eventId: "event-hidden",
      kind: "notification",
    });

    expect(store.getRows().map((entry) => entry.eventId)).toEqual([
      "event-visible",
    ]);
  });

  it("bounds event ID history and admits an evicted ID again", () => {
    const store = createGuiFeedStore();

    for (let index = 0; index <= 1000; index += 1) {
      store.pushEvent({ ...createRow(index), eventId: `event-${index}` });
    }
    store.pushEvent({ ...createRow(0), eventId: "event-0" });

    expect(store.getRows()).toHaveLength(1002);
  });

  it("enforces overlay queue max rows by keeping latest rows", () => {
    const store = createGuiFeedStore({ maxRows: 3 });

    store.pushEvent(createRow(1));
    store.pushEvent(createRow(2));
    store.pushEvent(createRow(3));
    store.pushEvent(createRow(4));

    const rows = store.getRows();
    expect(rows.length).toBe(3);
    expect(rows.map((row: { username: string }) => row.username)).toEqual([
      "test-user-2",
      "test-user-3",
      "test-user-4",
    ]);
  });

  it("keeps bottom insertion ordering when queue evicts oldest rows", () => {
    const store = createGuiFeedStore({ maxRows: 3 });

    store.pushEvent(createRow(1));
    store.pushEvent(createRow(2));
    store.pushEvent(createRow(3));
    store.pushEvent(createRow(4));
    store.pushEvent(createRow(5));

    const rows = store.getRows();
    expect(rows.map((row: { text: string }) => row.text)).toEqual([
      "message-3",
      "message-4",
      "message-5",
    ]);
  });

  it("rejects malformed rows before they reach the display queue", () => {
    const store = createGuiFeedStore();

    store.pushEvent({
      type: "chat",
      kind: "chat",
      platform: "twitch",
      username: "missing-avatar-user",
      text: "missing avatar",
      timestamp: "2024-01-01T00:00:00.000Z",
    });
    store.pushEvent({
      type: "chat",
      kind: "unsupported-kind",
      platform: "twitch",
      username: "unsupported-kind-user",
      text: "unsupported kind",
      avatarUrl: "https://example.invalid/avatar.png",
      timestamp: "2024-01-01T00:00:01.000Z",
    });

    expect(store.getRows()).toEqual([]);
  });
});
