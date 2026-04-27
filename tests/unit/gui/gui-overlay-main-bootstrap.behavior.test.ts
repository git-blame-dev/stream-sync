import { describe, expect, it } from "bun:test";

import { bootstrapOverlayApp } from "../../../gui/src/overlay/main";

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

describe("Overlay main bootstrap behavior", () => {
  it("renders overlay app when runtime config is valid", () => {
    const target = createTarget();
    let renderedElement: { props: Record<string, unknown> } | null = null;

    const result = bootstrapOverlayApp({
      target,
      readOverlayRuntimeConfigImpl: () => ({
        overlayMaxMessages: 5,
        overlayMaxLinesPerMessage: 4,
      }),
      createRootImpl: () => ({
        render: (element: { props: Record<string, unknown> }) => {
          renderedElement = element;
        },
      }),
    });

    expect(result).toBe(true);
    expect(renderedElement!.props.mode).toBe("overlay");
    expect(renderedElement!.props.overlayMaxMessages).toBe(5);
    expect(renderedElement!.props.overlayMaxLinesPerMessage).toBe(4);
  });

  it("returns false when no target is available", () => {
    const result = bootstrapOverlayApp({ target: null });
    expect(result).toBe(false);
  });

  it("writes explicit bootstrap error into target when config parsing fails", () => {
    const target = createTarget();

    const result = bootstrapOverlayApp({
      target,
      readOverlayRuntimeConfigImpl: () => {
        throw new Error("bad runtime config");
      },
      createRootImpl: () => ({
        render: () => {},
      }),
    });

    expect(result).toBe(false);
    expect(target.getAttribute("data-gui-bootstrap-error")).toBe("true");
    expect(target.textContent).toContain(
      "Overlay failed to load: bad runtime config",
    );
  });
});
