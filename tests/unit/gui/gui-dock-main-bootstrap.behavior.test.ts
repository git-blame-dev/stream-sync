import { describe, expect, it } from "bun:test";

import {
  bootstrapDockApp,
  readDockRuntimeConfig,
} from "../../../gui/src/dock/main";

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

describe("Dock main bootstrap behavior", () => {
  it("reads compare mode from runtime config using explicit true value only", () => {
    expect(
      readDockRuntimeConfig({
        __STREAM_SYNC_GUI_CONFIG__: {
          uiCompareMode: true,
        },
      }),
    ).toEqual({ uiCompareMode: true, mode: "dock" });

    expect(
      readDockRuntimeConfig({
        __STREAM_SYNC_GUI_CONFIG__: {
          uiCompareMode: "true",
        },
      }),
    ).toEqual({ uiCompareMode: false, mode: "dock" });

    expect(
      readDockRuntimeConfig({
        __STREAM_SYNC_GUI_KIND__: "tiktok-animations",
      }),
    ).toEqual({ uiCompareMode: false, mode: "tiktok-animations" });

    expect(readDockRuntimeConfig({})).toEqual({
      uiCompareMode: false,
      mode: "dock",
    });
  });

  it("renders dock app with runtime compare mode config", () => {
    const target = createTarget();
    let renderedElement: { props: Record<string, unknown> } | null = null;

    const result = bootstrapDockApp({
      target,
      readDockRuntimeConfigImpl: () => ({
        uiCompareMode: true,
        mode: "dock",
      }),
      createRootImpl: () => ({
        render: (element: { props: Record<string, unknown> }) => {
          renderedElement = element;
        },
      }),
    });

    expect(result).toBe(true);
    expect(renderedElement!.props.mode).toBe("dock");
    expect(renderedElement!.props.uiCompareMode).toBe(true);
  });

  it("renders tiktok animations mode when runtime kind requests it", () => {
    const target = createTarget();
    let renderedElement: { props: Record<string, unknown> } | null = null;

    const result = bootstrapDockApp({
      target,
      readDockRuntimeConfigImpl: () => ({
        uiCompareMode: false,
        mode: "tiktok-animations",
      }),
      createRootImpl: () => ({
        render: (element: { props: Record<string, unknown> }) => {
          renderedElement = element;
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
