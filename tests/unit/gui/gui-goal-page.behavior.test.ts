import { describe, expect, test } from "bun:test";
import React from "react";
import TestRenderer, { act, type ReactTestRenderer } from "react-test-renderer";

import { GoalApp, parseGoalEvent } from "../../../gui/src/goal/App";
import { FundingGoal } from "../../../gui/src/goal/FundingGoal";
import { bootstrapGoalApp } from "../../../gui/src/goal/main";
import { readGoalRuntimeConfig } from "../../../gui/src/goal/runtime-config";
import type { FundingGoalSnapshot } from "../../../gui/src/shared/funding-goal";

type EventHandler = (payload: unknown) => void;

function goal(overrides: Partial<FundingGoalSnapshot> = {}): FundingGoalSnapshot {
  return {
    enabled: true,
    id: "controller",
    label: "🎮 New Controller",
    labelOverridden: false,
    currentUsd: 25,
    targetUsd: 100,
    completed: false,
    revision: 1,
    sessionId: "session-1",
    ...overrides,
  };
}

describe("goal page behavior", () => {
  test("accepts only valid funding goal transport events", () => {
    const event = { __guiEvent: "funding-goal", ...goal() };

    expect(parseGoalEvent(event)).toEqual(goal());
    expect(parseGoalEvent({ ...event, __guiEvent: "appearance" })).toBeNull();
    expect(parseGoalEvent({ ...event, targetUsd: 0 })).toBeNull();
    expect(parseGoalEvent(null)).toBeNull();
  });

  test("renders the newest minimal goal and disposes its event feed", () => {
    let onEvent: EventHandler | null = null;
    let disposed = false;
    const createEventFeedImpl = ({ onEvent: handler }: { onEvent: EventHandler }) => {
      onEvent = handler;
      return () => { disposed = true; };
    };
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(React.createElement(GoalApp, {
        initialProfile: "minimal",
        createEventFeedImpl,
      }));
    });

    expect(renderer?.root.findByProps({ className: "goal-page" })).toBeDefined();
    expect(renderer?.root.findAllByType(FundingGoal)).toHaveLength(0);

    act(() => onEvent?.({ __guiEvent: "funding-goal", ...goal() }));
    expect(renderer?.root.findByType(FundingGoal).props).toMatchObject({
      profile: "minimal",
      goal: { currentUsd: 25, revision: 1, sessionId: "session-1" },
    });

    act(() => onEvent?.({ __guiEvent: "funding-goal", ...goal({ currentUsd: 99, revision: 0 }) }));
    expect(renderer?.root.findByType(FundingGoal).props.goal.currentUsd).toBe(25);

    act(() => onEvent?.({
      __guiEvent: "funding-goal",
      ...goal({ currentUsd: 0, revision: 0, sessionId: "session-2" }),
    }));
    expect(renderer?.root.findByType(FundingGoal).props.goal).toMatchObject({
      currentUsd: 0,
      revision: 0,
      sessionId: "session-2",
    });

    act(() => renderer?.unmount());
    expect(disposed).toBe(true);
  });

  test("keeps the page shell but hides a disabled goal snapshot", () => {
    let onEvent: EventHandler | null = null;
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = TestRenderer.create(React.createElement(GoalApp, {
        createEventFeedImpl: ({ onEvent: handler }: { onEvent: EventHandler }) => {
          onEvent = handler;
          return () => undefined;
        },
      }));
    });

    act(() => onEvent?.({ __guiEvent: "funding-goal", ...goal({ enabled: false }) }));
    expect(renderer?.root.findByProps({ className: "goal-page" })).toBeDefined();
    expect(renderer?.root.findAllByType(FundingGoal)).toHaveLength(1);
    expect(renderer?.toJSON()).toMatchObject({ type: "main", children: null });
    act(() => renderer?.unmount());
  });

  test("reads only standard or minimal runtime appearances", () => {
    expect(readGoalRuntimeConfig({})).toEqual({ appearance: "standard" });
    expect(readGoalRuntimeConfig({ __STREAM_SYNC_GUI_CONFIG__: { appearance: { profile: "minimal" } } }))
      .toEqual({ appearance: "minimal" });
    expect(readGoalRuntimeConfig({ __STREAM_SYNC_GUI_CONFIG__: { appearance: { profile: "unknown" } } }))
      .toEqual({ appearance: "standard" });
  });

  test("bootstraps with injected dependencies and reports failures", () => {
    const target = {
      textContent: "",
      attributes: new Map<string, string>(),
      setAttribute(name: string, value: string) { this.attributes.set(name, value); },
    };
    const rendered: React.ReactNode[] = [];

    expect(bootstrapGoalApp({
      target,
      createRootImpl: () => ({ render: (node) => { rendered.push(node); } }),
      readGoalRuntimeConfigImpl: () => ({ appearance: "minimal" }),
    })).toBe(true);
    const renderedApp = rendered[0];
    expect(React.isValidElement(renderedApp)).toBe(true);
    if (!React.isValidElement<{ initialProfile: string }>(renderedApp)) {
      throw new Error("Expected goal bootstrap to render a React element");
    }
    expect(renderedApp.props.initialProfile).toBe("minimal");
    expect(bootstrapGoalApp({ target: null })).toBe(false);

    expect(bootstrapGoalApp({
      target,
      readGoalRuntimeConfigImpl: () => { throw new Error("test config failure"); },
    })).toBe(false);
    expect(target.attributes.get("data-gui-bootstrap-error")).toBe("true");
    expect(target.textContent).toBe("Goal failed to load: test config failure");
  });
});
