import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer from "react-test-renderer";

import { GuiShell } from "../../../gui/src/shared/components/GuiShell";
import type { GuiRowDto } from "../../../gui/src/shared/types";
import { ChatDemo } from "../../../gui/src/demo/ChatDemo";
import {
  advanceDemoFeed,
  createDemoRows,
  createInitialDemoFeedState,
} from "../../../gui/src/demo/demo-feed";
import { bootstrapChatDemo } from "../../../gui/src/demo/main";

function getDemoRow(rows: GuiRowDto[], username: string): GuiRowDto {
  const row = rows.find((candidate) => candidate.username === username);
  if (!row) {
    throw new Error(`Missing ${username} demo row`);
  }

  return row;
}

function getDemoRowByType(rows: GuiRowDto[], type: string): GuiRowDto {
  const row = rows.find((candidate) => candidate.type === type);
  if (!row) {
    throw new Error(`Missing ${type} demo row`);
  }

  return row;
}

function createTarget() {
  const attributes: Record<string, string> = {};
  return {
    textContent: "",
    setAttribute(name: string, value: string) {
      attributes[name] = value;
    },
    getAttribute(name: string) {
      return attributes[name] || null;
    },
  };
}

describe("Chat demo main behavior", () => {
  it("returns deterministic selected character rows", () => {
    const rows = createDemoRows();

    expect(rows).toHaveLength(8);
    expect(rows).toEqual([
      {
        type: "chat",
        kind: "chat",
        platform: "tiktok",
        username: "Goku",
        text: "Naruto, I heard your wallet has a power level over 9000.",
        avatarUrl: "https://myanimelist.net/images/characters/2/344142.jpg",
        timestamp: null,
      },
      {
        type: "chat",
        kind: "chat",
        platform: "youtube",
        username: "Ichigo",
        text: "Before Naruto answers, remember: substitute soul reaper energy is not tax deductible.",
        avatarUrl: "https://myanimelist.net/images/characters/13/473588.jpg",
        timestamp: null,
      },
      {
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "Naruto",
        text: "Believe it! I’m the Hokage of paypiggies today!",
        isPaypiggy: true,
        avatarUrl: "https://myanimelist.net/images/characters/15/570333.jpg",
        timestamp: null,
      },
      {
        type: "platform:gift",
        kind: "notification",
        platform: "youtube",
        username: "Ichigo",
        text: "Ichigo sent a $10 Super Chat: Save some spiritual pressure for the rest of us.",
        avatarUrl: "https://myanimelist.net/images/characters/13/473588.jpg",
        timestamp: null,
      },
      {
        type: "chat",
        kind: "chat",
        platform: "tiktok",
        username: "Goku",
        text: "That donation hit harder than a Kamehameha!",
        avatarUrl: "https://myanimelist.net/images/characters/2/344142.jpg",
        timestamp: null,
      },
      {
        type: "chat",
        kind: "chat",
        platform: "twitch",
        username: "Naruto",
        text: "My ninja way is supporting the stream!",
        isPaypiggy: true,
        avatarUrl: "https://myanimelist.net/images/characters/15/570333.jpg",
        timestamp: null,
      },
      {
        type: "chat",
        kind: "chat",
        platform: "tiktok",
        username: "Goku",
        text: "One more warm-up before Ichigo closes the loop.",
        avatarUrl: "https://myanimelist.net/images/characters/2/344142.jpg",
        timestamp: null,
      },
      {
        type: "chat",
        kind: "chat",
        platform: "youtube",
        username: "Ichigo",
        text: "Demo complete. Bankai: clean replay.",
        avatarUrl: "https://myanimelist.net/images/characters/13/473588.jpg",
        timestamp: null,
      },
    ]);
  });

  it("marks Naruto with paypiggy chat styling data", () => {
    const narutoRow = getDemoRow(createDemoRows(), "Naruto");

    expect(narutoRow).toMatchObject({
      type: "chat",
      kind: "chat",
      platform: "twitch",
      isPaypiggy: true,
      text: "Believe it! I’m the Hokage of paypiggies today!",
    });

    const html = renderToStaticMarkup(
      React.createElement(GuiShell, {
        mode: "dock",
        overlayMaxLinesPerMessage: 3,
        rows: [narutoRow],
      }),
    );

    expect(html).toContain("gui-row--paypiggy");
    expect(html).toContain("gui-row__member-tag");
    expect(html).toContain("Naruto");
  });

  it("returns Ichigo as donation row data", () => {
    const ichigoRow = getDemoRowByType(createDemoRows(), "platform:gift");

    expect(ichigoRow).toMatchObject({
      type: "platform:gift",
      kind: "notification",
      platform: "youtube",
      username: "Ichigo",
      text: "Ichigo sent a $10 Super Chat: Save some spiritual pressure for the rest of us.",
      avatarUrl: "https://myanimelist.net/images/characters/13/473588.jpg",
      timestamp: null,
    });

    expect(ichigoRow.text).not.toContain("donated $10");
  });

  it("clears and restarts the feed after the eight-message loop", () => {
    const emptyFeed = createInitialDemoFeedState();
    const completeFeed = createDemoRows().reduce(
      (feedState) => advanceDemoFeed(feedState),
      emptyFeed,
    );
    const clearedFeed = advanceDemoFeed(completeFeed);
    const restartedFeed = advanceDemoFeed(clearedFeed);

    expect(emptyFeed.rows.map((row) => row.username)).toEqual([]);
    expect(completeFeed.rows.map((row) => row.username)).toEqual([
      "Goku",
      "Ichigo",
      "Naruto",
      "Ichigo",
      "Goku",
      "Naruto",
      "Goku",
      "Ichigo",
    ]);
    expect(clearedFeed.rows.map((row) => row.username)).toEqual([]);
    expect(restartedFeed.rows.map((row) => row.username)).toEqual(["Goku"]);
  });

  it("renders the demo shell with the first selected character row", () => {
    const html = renderToStaticMarkup(React.createElement(ChatDemo));

    expect(html).toContain("gui-shell--overlay");
    expect(html).toContain("gui-row--overlay-enter");
    expect(html).toContain("Goku");
    expect(html).toContain(
      "https://myanimelist.net/images/characters/2/344142.jpg",
    );
  });

  it("mounts and unmounts the looping demo without leaking render state", async () => {
    const rendererRef: { current: TestRenderer.ReactTestRenderer | null } = {
      current: null,
    };
    let nextIntervalId = 0;
    const activeIntervalIds = new Set<number>();
    const scheduler = {
      setInterval: () => {
        nextIntervalId += 1;
        activeIntervalIds.add(nextIntervalId);
        return nextIntervalId;
      },
      clearInterval: (intervalId: unknown) => {
        if (typeof intervalId === "number") {
          activeIntervalIds.delete(intervalId);
        }
      },
    };

    await TestRenderer.act(async () => {
      rendererRef.current = TestRenderer.create(
        React.createElement(ChatDemo, { scheduler }),
      );
    });

    const renderer = rendererRef.current;
    if (!renderer) {
      throw new Error("Expected ChatDemo renderer to be created");
    }

    expect(JSON.stringify(renderer?.toJSON())).toContain("Goku");
    expect(activeIntervalIds.size).toBe(1);

    await TestRenderer.act(async () => {
      renderer?.unmount();
    });

    expect(renderer?.toJSON()).toBe(null);
    expect(activeIntervalIds.size).toBe(0);
  });

  it("bootstraps the demo entrypoint into the provided target", () => {
    const target = createTarget();
    const renderedElements: React.ReactElement[] = [];

    const result = bootstrapChatDemo({
      target,
      createRootImpl: () => ({
        render: (element: React.ReactNode) => {
          if (React.isValidElement(element)) {
            renderedElements.push(element);
          }
        },
      }),
    });

    expect(result).toBe(true);
    const renderedElement = renderedElements[0];
    if (!renderedElement) {
      throw new Error("Expected ChatDemo element to render");
    }
    expect(renderedElement.type).toBe(ChatDemo);
  });
});
