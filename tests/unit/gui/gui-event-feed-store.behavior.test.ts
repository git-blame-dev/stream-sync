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
  };
}

describe("GUI feed store behavior", () => {
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

  it("retains safe member sprites only on chat rows", () => {
    const store = createGuiFeedStore();

    store.pushEvent({
      ...createRow(1),
      isPaypiggy: true,
      memberSpriteUrl: "https://cdn.example/member.gif",
    });
    store.pushEvent({
      ...createRow(2),
      kind: "notification",
      memberSpriteUrl: "https://cdn.example/ignored.gif",
    });
    store.pushEvent({
      ...createRow(3),
      isPaypiggy: true,
      memberSpriteUrl:
        "https://user:pass@example.invalid/member.gif#fragment",
    });
    store.pushEvent({
      ...createRow(4),
      isPaypiggy: false,
      memberSpriteUrl: "https://cdn.example/ignored-non-member.gif",
    });

    expect(store.getRows()[0]?.memberSpriteUrl).toBe("https://cdn.example/member.gif");
    expect(store.getRows()[1]?.memberSpriteUrl).toBeUndefined();
    expect(store.getRows()[2]?.memberSpriteUrl).toBeUndefined();
    expect(store.getRows()[3]?.memberSpriteUrl).toBeUndefined();
  });

  it("retains allowlisted member themes only on member chat rows", () => {
    const store = createGuiFeedStore();

    store.pushEvent({ ...createRow(1), isPaypiggy: true, memberTheme: "red" });
    store.pushEvent({ ...createRow(2), isPaypiggy: true, memberTheme: "blue" });
    store.pushEvent({ ...createRow(3), isPaypiggy: false, memberTheme: "red" });
    store.pushEvent({ ...createRow(4), kind: "notification", memberTheme: "red" });

    expect(store.getRows()[0]?.memberTheme).toBe("red");
    expect(store.getRows()[1]?.memberTheme).toBeUndefined();
    expect(store.getRows()[2]?.memberTheme).toBeUndefined();
    expect(store.getRows()[3]?.memberTheme).toBeUndefined();
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
