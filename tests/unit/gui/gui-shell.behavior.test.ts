import { describe, expect, it } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import TestRenderer, { type ReactTestRenderer } from "react-test-renderer";

import { GuiShell, resolveGuiRowRenderKey } from "../../../gui/src/shared/components/GuiShell";
import { useFakeTimers, useRealTimers, advanceTimersByTime } from "../../helpers/bun-timers";
import { safeSetTimeout } from "../../../src/utils/timeout-validator";
import type { GuiRowDto } from "../../../gui/src/shared/types";

type ScrollListener = () => void;
type OverlayNode = { type?: unknown; props?: Record<string, unknown> };
type ShellRenderer = ReactTestRenderer;

function isOverlayNode(value: unknown): value is OverlayNode {
  return typeof value === "object" && value !== null;
}

function createDockShellMock({
  scrollTop = 0,
  clientHeight = 120,
  scrollHeight = 320,
}: { scrollTop?: number; clientHeight?: number; scrollHeight?: number } = {}) {
  const listenersByEvent = new Map<string, ScrollListener>();

  return {
    scrollTop,
    clientHeight,
    scrollHeight,
    addEventListener: (eventName: string, handler: ScrollListener) => {
      listenersByEvent.set(eventName, handler);
    },
    removeEventListener: (eventName: string, handler: ScrollListener) => {
      if (listenersByEvent.get(eventName) === handler) {
        listenersByEvent.delete(eventName);
      }
    },
    emitScroll: () => {
      const handler = listenersByEvent.get("scroll");
      if (typeof handler === "function") {
        handler();
      }
    },
  };
}

function createGuiRow(index: number): GuiRowDto {
  return {
    type: "chat",
    kind: "chat",
    platform: "twitch",
    username: `test-user-${index}`,
    text: `message-${index}`,
    avatarUrl: `https://example.invalid/test-avatar-${index}.png`,
    timestamp: `2024-01-01T00:00:0${index}.000Z`,
  };
}

function createMotionNodeMock(element: unknown) {
  if (!isOverlayNode(element)) {
    return {};
  }

  return {
    style: {},
    offsetHeight: 50,
    offsetLeft: 0,
    offsetTop: 0,
    offsetWidth: 100,
    getBoundingClientRect: () => ({ height: 50, left: 0, top: 0, width: 100 }),
  };
}

function findOverlayExitNodes(renderer: ShellRenderer) {
  return renderer.root.findAll((node) => {
    if (node.type !== "div") {
      return false;
    }

    const className =
      typeof node.props.className === "string" ? node.props.className : "";
    return className.includes("gui-row--overlay-exit");
  });
}

describe("GuiShell behavior", () => {
  it("uses eventId for stable row identity and object identity as fallback", () => {
    let fallbackSequence = 0;
    const fallbackKeys = new WeakMap<GuiRowDto, string>();
    const getFallbackKey = (row: GuiRowDto) => {
      const existing = fallbackKeys.get(row);
      if (existing) return existing;
      fallbackSequence += 1;
      const key = `row:${fallbackSequence}`;
      fallbackKeys.set(row, key);
      return key;
    };
    const original = { ...createGuiRow(1), eventId: "event-1" };
    const reconstructed = { ...original, text: "updated message" };
    const legacy = createGuiRow(2);

    expect(resolveGuiRowRenderKey(original, getFallbackKey)).toBe("event:event-1");
    expect(resolveGuiRowRenderKey(reconstructed, getFallbackKey)).toBe(
      "event:event-1",
    );
    expect(resolveGuiRowRenderKey(legacy, getFallbackKey)).toBe(
      resolveGuiRowRenderKey(legacy, getFallbackKey),
    );
    expect(resolveGuiRowRenderKey(createGuiRow(2), getFallbackKey)).not.toBe(
      resolveGuiRowRenderKey(legacy, getFallbackKey),
    );
  });

  it("renders rows and mode class", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiShell, {
        mode: "overlay",
        overlayMaxLinesPerMessage: 3,
        rows: [
          {
            type: "chat",
            kind: "chat",
            platform: "twitch",
            username: "test-user",
            text: "hello",
            avatarUrl: "https://example.invalid/test-avatar.png",
            timestamp: "2024-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(html).toContain("gui-shell--overlay");
    expect(html).toContain('aria-label="Livestream activity"');
    expect(html).toContain("test-user");
    expect(html).toContain("hello");
  });

  it("applies dock scroll container style contract", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiShell, {
        mode: "dock",
        overlayMaxLinesPerMessage: 3,
        rows: [],
      }),
    );

    expect(html).toContain("gui-shell--dock");
    expect(html).toContain("height:100vh");
    expect(html).toContain("overflow-y:auto");
  });

  it("applies overlay line-clamp contract when configured", () => {
    const html = renderToStaticMarkup(
      React.createElement(GuiShell, {
        mode: "overlay",
        overlayMaxLinesPerMessage: 3,
        rows: [
          {
            type: "chat",
            kind: "chat",
            platform: "twitch",
            username: "test-user",
            text: "line one line two line three line four",
            avatarUrl: "https://example.invalid/test-avatar.png",
            timestamp: "2024-01-01T00:00:00.000Z",
          },
        ],
      }),
    );

    expect(html).toContain('style="--overlay-line-clamp:3"');
    expect(html).toContain("gui-row__text--overlay-clamp");
  });

  it("renders capacity updates without overlay exit clones", async () => {
    const rows = [createGuiRow(1), createGuiRow(2), createGuiRow(3), createGuiRow(4)];
    let renderer: ShellRenderer | null = null;
    const previousGetComputedStyle = globalThis.getComputedStyle;
    globalThis.getComputedStyle = (() => ({
      height: "",
      width: "",
      direction: "ltr",
    })) as unknown as typeof globalThis.getComputedStyle;

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GuiShell, {
            mode: "overlay",
            overlayMaxLinesPerMessage: 3,
            rows: rows.slice(0, 3),
          }),
          { createNodeMock: createMotionNodeMock },
        );
      });

      await TestRenderer.act(async () => {
        renderer!.update(
          React.createElement(GuiShell, {
            mode: "overlay",
            overlayMaxLinesPerMessage: 3,
            rows: rows.slice(1),
          }),
        );
      });

      const rendered = JSON.stringify(renderer!.toJSON());
      expect(rendered).toContain("test-user-1");
      expect(rendered).toContain("test-user-2");
      expect(rendered).toContain("test-user-3");
      expect(rendered).toContain("test-user-4");
      expect(findOverlayExitNodes(renderer!)).toHaveLength(0);
    } finally {
      if (renderer) await TestRenderer.act(async () => renderer!.unmount());
      if (previousGetComputedStyle) {
        globalThis.getComputedStyle = previousGetComputedStyle;
      } else {
        Reflect.deleteProperty(globalThis, "getComputedStyle");
      }
    }
  });

  it("auto-scrolls dock shell to latest rows when messages update", async () => {
    const previousTimeStamp = console.timeStamp;
    console.timeStamp = previousTimeStamp || (() => {});
    let renderer: ShellRenderer | null = null;
    const dockShell = createDockShellMock();

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user",
                text: "first message",
                avatarUrl: "https://example.invalid/test-avatar.png",
                timestamp: "2024-01-01T00:00:00.000Z",
              },
            ],
          }),
          {
            createNodeMock: (element: unknown) => {
              if (!isOverlayNode(element)) {
                return {};
              }

              if (element.type === "main") {
                return dockShell;
              }

              return {
                style: {
                  transition: "",
                  transform: "",
                },
                offsetHeight: 24,
                getBoundingClientRect: () => ({ top: 100 }),
              };
            },
          },
        );
      });

      expect(dockShell.scrollTop).toBe(320);

      dockShell.scrollTop = 200;
      dockShell.scrollHeight = 320;
      dockShell.emitScroll();
      dockShell.scrollHeight = 640;

      await TestRenderer.act(async () => {
        renderer!.update(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user",
                text: "first message",
                avatarUrl: "https://example.invalid/test-avatar.png",
                timestamp: "2024-01-01T00:00:00.000Z",
              },
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user-2",
                text: "second message",
                avatarUrl: "https://example.invalid/test-avatar-2.png",
                timestamp: "2024-01-01T00:00:01.000Z",
              },
            ],
          }),
        );
      });

      expect(dockShell.scrollTop).toBe(640);
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => {
          renderer!.unmount();
        });
      }

      if (previousTimeStamp) {
        console.timeStamp = previousTimeStamp;
      } else {
        Reflect.deleteProperty(console, "timeStamp");
      }
    }
  });

  it("keeps dock scroll position when user is reading older rows", async () => {
    const previousTimeStamp = console.timeStamp;
    console.timeStamp = previousTimeStamp || (() => {});
    let renderer: ShellRenderer | null = null;
    const dockShell = createDockShellMock({ scrollTop: 40 });

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user",
                text: "first message",
                avatarUrl: "https://example.invalid/test-avatar.png",
                timestamp: "2024-01-01T00:00:00.000Z",
              },
            ],
          }),
          {
            createNodeMock: (element: unknown) => {
              if (!isOverlayNode(element)) {
                return {};
              }

              if (element.type === "main") {
                return dockShell;
              }

              return {
                style: {
                  transition: "",
                  transform: "",
                },
                offsetHeight: 24,
                getBoundingClientRect: () => ({ top: 100 }),
              };
            },
          },
        );
      });

      expect(dockShell.scrollTop).toBe(320);

      dockShell.scrollTop = 200;
      dockShell.scrollHeight = 320;
      dockShell.emitScroll();
      dockShell.scrollHeight = 640;

      await TestRenderer.act(async () => {
        renderer!.update(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user",
                text: "first message",
                avatarUrl: "https://example.invalid/test-avatar.png",
                timestamp: "2024-01-01T00:00:00.000Z",
              },
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user-2",
                text: "second message",
                avatarUrl: "https://example.invalid/test-avatar-2.png",
                timestamp: "2024-01-01T00:00:01.000Z",
              },
            ],
          }),
        );
      });

      expect(dockShell.scrollTop).toBe(640);

      dockShell.scrollTop = 511;
      dockShell.scrollHeight = 640;
      dockShell.emitScroll();
      dockShell.scrollHeight = 760;

      await TestRenderer.act(async () => {
        renderer!.update(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user",
                text: "first message",
                avatarUrl: "https://example.invalid/test-avatar.png",
                timestamp: "2024-01-01T00:00:00.000Z",
              },
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user-2",
                text: "second message",
                avatarUrl: "https://example.invalid/test-avatar-2.png",
                timestamp: "2024-01-01T00:00:01.000Z",
              },
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user-3",
                text: "third message",
                avatarUrl: "https://example.invalid/test-avatar-3.png",
                timestamp: "2024-01-01T00:00:02.000Z",
              },
            ],
          }),
        );
      });

      expect(dockShell.scrollTop).toBe(511);
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => {
          renderer!.unmount();
        });
      }

      if (previousTimeStamp) {
        console.timeStamp = previousTimeStamp;
      } else {
        Reflect.deleteProperty(console, "timeStamp");
      }
    }
  });

  it("pins dock when user is within 8px of the bottom", async () => {
    const previousTimeStamp = console.timeStamp;
    console.timeStamp = previousTimeStamp || (() => {});
    let renderer: ShellRenderer | null = null;
    const dockShell = createDockShellMock();

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user",
                text: "first message",
                avatarUrl: "https://example.invalid/test-avatar.png",
                timestamp: "2024-01-01T00:00:00.000Z",
              },
            ],
          }),
          {
            createNodeMock: (element: unknown) => {
              if (!isOverlayNode(element)) {
                return {};
              }

              if (element.type === "main") {
                return dockShell;
              }

              return {
                style: {
                  transition: "",
                  transform: "",
                },
                offsetHeight: 24,
                getBoundingClientRect: () => ({ top: 100 }),
              };
            },
          },
        );
      });

      expect(dockShell.scrollTop).toBe(320);

      dockShell.scrollTop = 200;
      dockShell.scrollHeight = 320;
      dockShell.emitScroll();
      dockShell.scrollHeight = 640;

      await TestRenderer.act(async () => {
        renderer!.update(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user",
                text: "first message",
                avatarUrl: "https://example.invalid/test-avatar.png",
                timestamp: "2024-01-01T00:00:00.000Z",
              },
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user-2",
                text: "second message",
                avatarUrl: "https://example.invalid/test-avatar-2.png",
                timestamp: "2024-01-01T00:00:01.000Z",
              },
            ],
          }),
        );
      });

      expect(dockShell.scrollTop).toBe(640);

      dockShell.scrollTop = 512;
      dockShell.scrollHeight = 640;
      dockShell.emitScroll();
      dockShell.scrollHeight = 760;

      await TestRenderer.act(async () => {
        renderer!.update(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user",
                text: "first message",
                avatarUrl: "https://example.invalid/test-avatar.png",
                timestamp: "2024-01-01T00:00:00.000Z",
              },
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user-2",
                text: "second message",
                avatarUrl: "https://example.invalid/test-avatar-2.png",
                timestamp: "2024-01-01T00:00:01.000Z",
              },
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user-3",
                text: "third message",
                avatarUrl: "https://example.invalid/test-avatar-3.png",
                timestamp: "2024-01-01T00:00:02.000Z",
              },
            ],
          }),
        );
      });

      expect(dockShell.scrollTop).toBe(760);
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => {
          renderer!.unmount();
        });
      }

      if (previousTimeStamp) {
        console.timeStamp = previousTimeStamp;
      } else {
        Reflect.deleteProperty(console, "timeStamp");
      }
    }
  });

  it("pins dock shell to bottom again on animation frame when dock is pinned", async () => {
    const previousTimeStamp = console.timeStamp;
    const previousRequestAnimationFrame = global.requestAnimationFrame;
    const previousCancelAnimationFrame = global.cancelAnimationFrame;
    useFakeTimers();
    const frameTimers = new Map<number, ReturnType<typeof setTimeout>>();
    let nextFrame = 0;
    global.cancelAnimationFrame = id => {
      const timer = frameTimers.get(id);
      if (timer !== undefined) clearTimeout(timer);
      frameTimers.delete(id);
    };
    console.timeStamp = previousTimeStamp || (() => {});

    const dockShell = createDockShellMock({
      clientHeight: 200,
      scrollHeight: 200,
    });
    let rafCalls = 0;
    let renderer: ShellRenderer | null = null;

    global.requestAnimationFrame = (callback) => {
      rafCalls += 1;
      dockShell.scrollHeight = 420;
      const id = ++nextFrame;
      frameTimers.set(id, safeSetTimeout(() => { frameTimers.delete(id); callback(0); }, 16));
      return id;
    };

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [],
          }),
          {
            createNodeMock: (element: unknown) => {
              if (!isOverlayNode(element)) {
                return {};
              }

              if (element.type === "main") {
                return dockShell;
              }

              return {
                style: {
                  transition: "",
                  transform: "",
                },
                offsetHeight: 24,
                getBoundingClientRect: () => ({ top: 100 }),
              };
            },
          },
        );
      });

      TestRenderer.act(() => { advanceTimersByTime(16); });
      expect(rafCalls).toBe(1);
      expect(dockShell.scrollTop).toBe(420);
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => {
          renderer!.unmount();
        });
      }

      const pendingFrameCount = frameTimers.size;
      useRealTimers();
      if (previousCancelAnimationFrame === undefined) Reflect.deleteProperty(global, "cancelAnimationFrame");
      else global.cancelAnimationFrame = previousCancelAnimationFrame;
      if (typeof previousRequestAnimationFrame === "function") {
        global.requestAnimationFrame = previousRequestAnimationFrame;
      } else {
        Reflect.deleteProperty(global, "requestAnimationFrame");
      }

      if (previousTimeStamp) {
        console.timeStamp = previousTimeStamp;
      } else {
        Reflect.deleteProperty(console, "timeStamp");
      }
      expect(pendingFrameCount).toBe(0);
    }
  });

  it("keeps dock position when unpinned as new rows arrive", async () => {
    const previousTimeStamp = console.timeStamp;
    const previousRequestAnimationFrame = global.requestAnimationFrame;
    const previousCancelAnimationFrame = global.cancelAnimationFrame;
    useFakeTimers();
    const frameTimers = new Map<number, ReturnType<typeof setTimeout>>();
    let nextFrame = 0;
    global.cancelAnimationFrame = id => {
      const timer = frameTimers.get(id);
      if (timer !== undefined) clearTimeout(timer);
      frameTimers.delete(id);
    };
    console.timeStamp = previousTimeStamp || (() => {});

    const dockShell = createDockShellMock();
    let renderer: ShellRenderer | null = null;

    global.requestAnimationFrame = (callback) => {
      dockShell.scrollHeight += 100;
      const id = ++nextFrame;
      frameTimers.set(id, safeSetTimeout(() => { frameTimers.delete(id); callback(0); }, 16));
      return id;
    };

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user",
                text: "first message",
                avatarUrl: "https://example.invalid/test-avatar.png",
                timestamp: "2024-01-01T00:00:00.000Z",
              },
            ],
          }),
          {
            createNodeMock: (element: unknown) => {
              if (!isOverlayNode(element)) {
                return {};
              }

              if (element.type === "main") {
                return dockShell;
              }

              return {
                style: {
                  transition: "",
                  transform: "",
                },
                offsetHeight: 24,
                getBoundingClientRect: () => ({ top: 100 }),
              };
            },
          },
        );
      });

      TestRenderer.act(() => { advanceTimersByTime(16); });
      dockShell.scrollTop = 80;
      dockShell.scrollHeight = 320;
      dockShell.emitScroll();
      dockShell.scrollHeight = 480;

      await TestRenderer.act(async () => {
        renderer!.update(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user",
                text: "first message",
                avatarUrl: "https://example.invalid/test-avatar.png",
                timestamp: "2024-01-01T00:00:00.000Z",
              },
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user-2",
                text: "second message",
                avatarUrl: "https://example.invalid/test-avatar-2.png",
                timestamp: "2024-01-01T00:00:01.000Z",
              },
            ],
          }),
        );
      });

      expect(dockShell.scrollTop).toBe(80);
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => {
          renderer!.unmount();
        });
      }

      const pendingFrameCount = frameTimers.size;
      useRealTimers();
      if (previousCancelAnimationFrame === undefined) Reflect.deleteProperty(global, "cancelAnimationFrame");
      else global.cancelAnimationFrame = previousCancelAnimationFrame;
      if (typeof previousRequestAnimationFrame === "function") {
        global.requestAnimationFrame = previousRequestAnimationFrame;
      } else {
        Reflect.deleteProperty(global, "requestAnimationFrame");
      }

      if (previousTimeStamp) {
        console.timeStamp = previousTimeStamp;
      } else {
        Reflect.deleteProperty(console, "timeStamp");
      }
      expect(pendingFrameCount).toBe(0);
    }
  });

  it("keeps dock pinned when geometry drifts after a pinned scroll event", async () => {
    const previousTimeStamp = console.timeStamp;
    console.timeStamp = previousTimeStamp || (() => {});
    let renderer: ShellRenderer | null = null;
    const dockShell = createDockShellMock();

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user",
                text: "first message",
                avatarUrl: "https://example.invalid/test-avatar.png",
                timestamp: "2024-01-01T00:00:00.000Z",
              },
            ],
          }),
          {
            createNodeMock: (element: unknown) => {
              if (!isOverlayNode(element)) {
                return {};
              }

              if (element.type === "main") {
                return dockShell;
              }

              return {
                style: {
                  transition: "",
                  transform: "",
                },
                offsetHeight: 24,
                getBoundingClientRect: () => ({ top: 100 }),
              };
            },
          },
        );
      });

      expect(dockShell.scrollTop).toBe(320);

      dockShell.scrollTop = 200;
      dockShell.scrollHeight = 320;
      dockShell.emitScroll();

      dockShell.scrollTop = 50;
      dockShell.scrollHeight = 640;

      await TestRenderer.act(async () => {
        renderer!.update(
          React.createElement(GuiShell, {
            mode: "dock",
            overlayMaxLinesPerMessage: 3,
            rows: [
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user",
                text: "first message",
                avatarUrl: "https://example.invalid/test-avatar.png",
                timestamp: "2024-01-01T00:00:00.000Z",
              },
              {
                type: "chat",
                kind: "chat",
                platform: "twitch",
                username: "test-user-2",
                text: "second message",
                avatarUrl: "https://example.invalid/test-avatar-2.png",
                timestamp: "2024-01-01T00:00:01.000Z",
              },
            ],
          }),
        );
      });

      expect(dockShell.scrollTop).toBe(640);
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => {
          renderer!.unmount();
        });
      }

      if (previousTimeStamp) {
        console.timeStamp = previousTimeStamp;
      } else {
        Reflect.deleteProperty(console, "timeStamp");
      }
    }
  });
});
