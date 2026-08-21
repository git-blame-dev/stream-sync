import { describe, expect, test } from "bun:test";
import React from "react";
import TestRenderer, { act, type ReactTestInstance, type ReactTestRenderer } from "react-test-renderer";

import { FundingLabelEditor } from "../../../gui/src/operator/FundingLabelEditor";

function button(renderer: ReactTestRenderer, label: string): ReactTestInstance {
  return renderer.root.findAllByType("button").find((item) => item.children.join("") === label)
    ?? (() => { throw new Error(`Missing ${label} button`); })();
}

describe("FundingLabelEditor", () => {
  test("requires an explicit edit and saves a validated label", async () => {
    let focused = 0;
    let selected = 0;
    const saved: string[] = [];
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(React.createElement(FundingLabelEditor, {
        goal: { label: "🎮 New Controller", labelOverridden: false },
        pending: false,
        onSave: async (label: string) => { saved.push(label); return true; },
        onReset: () => undefined,
      }), {
        createNodeMock: (element) => element.type === "input"
          ? { focus: () => { focused += 1; }, select: () => { selected += 1; } }
          : null,
      });
    });
    if (!renderer) throw new Error("Expected label editor renderer");
    const view = renderer;

    expect(view.root.findByType("input").props.readOnly).toBe(true);
    act(() => button(view, "Edit").props.onClick());
    expect(view.root.findByType("input").props.readOnly).toBe(false);
    expect(focused).toBe(1);
    expect(selected).toBe(1);

    act(() => view.root.findByType("input").props.onChange({ target: { value: "  🎙️ New Microphone  " } }));
    await act(async () => button(view, "Save").props.onClick());
    expect(saved).toEqual(["🎙️ New Microphone"]);
    expect(view.root.findByType("input").props.readOnly).toBe(true);
  });

  test("cancels drafts, rejects invalid labels, and exposes config reset only for overrides", () => {
    let reset = 0;
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(React.createElement(FundingLabelEditor, {
        goal: { label: "🎙️ New Microphone", labelOverridden: true },
        pending: false,
        onSave: async () => true,
        onReset: () => { reset += 1; },
      }));
    });
    if (!renderer) throw new Error("Expected label editor renderer");
    const view = renderer;

    act(() => button(view, "Use config default").props.onClick());
    expect(reset).toBe(1);
    act(() => button(view, "Edit").props.onClick());
    act(() => view.root.findByType("input").props.onChange({ target: { value: "bad\nlabel" } }));
    expect(view.root.findByType("input").props["aria-invalid"]).toBe(true);
    expect(button(view, "Save").props.disabled).toBe(true);
    act(() => view.root.findByType("input").props.onKeyDown({ key: "Escape" }));
    expect(view.root.findByType("input").props.value).toBe("🎙️ New Microphone");
    expect(view.root.findByType("input").props.readOnly).toBe(true);
  });
});
