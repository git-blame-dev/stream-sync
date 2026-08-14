import { describe, expect, it } from "bun:test";
import type { ReactNode } from "react";

import {
  bootstrapDockApp,
  readDockRuntimeConfig,
} from "../../../gui/src/dock/main";
import { DEFAULT_GUI_APPEARANCE } from "../../../gui/src/shared/appearance";

const defaultRuntimeConfig = {
  feedMode: "all" as const,
  appearance: DEFAULT_GUI_APPEARANCE,
};

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

function isElementWithProps(
  value: unknown,
): value is { props: Record<string, unknown> } {
  return typeof value === "object" && value !== null && "props" in value;
}

describe("Dock main bootstrap behavior", () => {
  it("reads the dock runtime kind", () => {
    expect(
      readDockRuntimeConfig({
        __STREAM_SYNC_GUI_CONFIG__: {
        },
      }),
    ).toMatchObject({ mode: "dock", feedMode: "all", notificationTransitionMs: 1000 });

    expect(
      readDockRuntimeConfig({
        __STREAM_SYNC_GUI_KIND__: "tiktok-animations",
      }),
    ).toMatchObject({ mode: "tiktok-animations", feedMode: "all", notificationTransitionMs: 1000 });

    expect(readDockRuntimeConfig({})).toMatchObject({
      mode: "dock",
      feedMode: "all",
      notificationTransitionMs: 1000,
    });
  });

  it("reads configured dock feeds and fixes notifications to non-chat", () => {
    expect(readDockRuntimeConfig({
      __STREAM_SYNC_GUI_CONFIG__: { dockFeedMode: "chat" },
    })).toMatchObject({ mode: "dock", feedMode: "chat", notificationTransitionMs: 1000 });
    expect(readDockRuntimeConfig({
      __STREAM_SYNC_GUI_KIND__: "notifications",
      __STREAM_SYNC_GUI_CONFIG__: { dockFeedMode: "all" },
    })).toMatchObject({ mode: "notifications", feedMode: "non-chat", notificationTransitionMs: 1000 });
    expect(readDockRuntimeConfig({
      __STREAM_SYNC_GUI_CONFIG__: { dockFeedMode: "invalid" },
    })).toMatchObject({ mode: "dock", feedMode: "all", notificationTransitionMs: 1000 });
  });

  it("renders dock app with dock mode", () => {
    const target = createTarget();
    let renderedElement: { props: Record<string, unknown> } | null = null;

    const result = bootstrapDockApp({
      target,
      readDockRuntimeConfigImpl: () => ({
        mode: "dock",
        notificationTransitionMs: 1000,
        ...defaultRuntimeConfig,
      }),
      createRootImpl: () => ({
        render: (element: ReactNode) => {
          if (isElementWithProps(element)) {
            renderedElement = element;
          }
        },
      }),
    });

    expect(result).toBe(true);
    expect(renderedElement!.props.mode).toBe("dock");
    expect(renderedElement!.props.feedMode).toBe("all");
  });

  it("renders tiktok animations mode when runtime kind requests it", () => {
    const target = createTarget();
    let renderedElement: { props: Record<string, unknown> } | null = null;

    const result = bootstrapDockApp({
      target,
      readDockRuntimeConfigImpl: () => ({
        mode: "tiktok-animations",
        notificationTransitionMs: 1000,
        ...defaultRuntimeConfig,
      }),
      createRootImpl: () => ({
        render: (element: ReactNode) => {
          if (isElementWithProps(element)) {
            renderedElement = element;
          }
        },
      }),
    });

    expect(result).toBe(true);
    expect(renderedElement!.props.mode).toBe("tiktok-animations");
  });

  it("returns false when no target is available", () => {
    const result = bootstrapDockApp({ target: null });
    expect(result).toBe(false);
  });

  it("writes bootstrap error into target when runtime parsing fails", () => {
    const target = createTarget();

    const result = bootstrapDockApp({
      target,
      readDockRuntimeConfigImpl: () => {
        throw new Error("bad dock runtime config");
      },
      createRootImpl: () => ({
        render: () => {},
      }),
    });

    expect(result).toBe(false);
    expect(target.getAttribute("data-gui-bootstrap-error")).toBe("true");
    expect(target.textContent).toContain(
      "Dock failed to load: bad dock runtime config",
    );
  });
});
