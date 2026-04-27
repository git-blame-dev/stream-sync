import { describe, expect, it } from "bun:test";

import { createGuiFeedStore } from "../../../gui/src/shared/feed-store";

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
    expect(rows[0].type).toBe("chat");
    expect(rows[0].kind).toBe("chat");
    expect(rows[0].platform).toBe("twitch");
    expect(rows[0].username).toBe("test-user");
    expect(rows[0].text).toBe("hello world");
    expect(rows[0].avatarUrl).toBe("https://example.invalid/test-avatar.png");
    expect(rows[0].timestamp).toBe("2024-01-01T00:00:00.000Z");
    expect(Object.prototype.hasOwnProperty.call(rows[0], "ignoredField")).toBe(
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
    expect(rows[0].isPaypiggy).toBe(true);
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
    expect(rows[0].parts).toEqual([
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
    expect(rows[0].badgeImages).toEqual([
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
    expect(rows[0].username).toBe("test-user-1");
    expect(rows[1].username).toBe("test-user-2");
    expect(rows[2].username).toBe("test-user-3");
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
});
