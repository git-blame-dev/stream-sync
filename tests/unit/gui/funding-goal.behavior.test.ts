import { describe, expect, test } from "bun:test";
import React from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { FundingGoal } from "../../../gui/src/goal/FundingGoal";
import type { FundingGoalSnapshot } from "../../../gui/src/shared/funding-goal";
import { parseFundingGoalSnapshot, selectNewestFundingGoal } from "../../../gui/src/shared/funding-goal";

function goal(overrides: Partial<FundingGoalSnapshot> = {}): FundingGoalSnapshot {
  return {
    enabled: true,
    id: "controller",
    label: "🎮 New Controller",
    currentUsd: 108.25,
    targetUsd: 100,
    completed: true,
    revision: 3,
    sessionId: "session-1",
    ...overrides,
  };
}

describe("FundingGoal", () => {
  test("renders funded standard copy while preserving the over-goal raised amount", () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(FundingGoal, { goal: goal() }));
    });

    const progress = renderer?.root.findByProps({ role: "progressbar" });
    expect(progress?.props["aria-valuenow"]).toBe(100);
    expect(progress?.props["aria-valuetext"]).toBe("$108.25 of $100.00, goal reached");
    expect(renderer?.root.findByProps({ className: "funding-goal funding-goal--standard" })).toBeDefined();
    expect(renderer?.root.findByProps({ className: "funding-goal__emoji" }).children.join("")).toBe("🎮");
    expect(renderer?.root.findByProps({ className: "funding-goal__label" }).props["aria-label"]).toBe("🎮 New Controller");
    expect(renderer?.root.findByProps({ className: "funding-goal__raised-status" }).children.join("")).toBe("FUNDED");
    expect(renderer?.root.findByProps({ className: "funding-goal__raised-caption" }).children.join("")).toBe("$108.25 raised");
    expect(() => renderer?.root.findByProps({ className: "funding-goal__raised-value" })).toThrow();
    expect(renderer?.root.findByProps({ className: "funding-goal__fill" }).props.style.transform).toBe("scaleX(1)");
  });

  test("renders incomplete standard copy with the raised amount above the goal caption", () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(FundingGoal, {
        goal: goal({ currentUsd: 25, completed: false }),
      }));
    });

    expect(renderer?.root.findByProps({ className: "funding-goal__raised-value" }).children.join("")).toBe("$25.00 raised");
    expect(renderer?.root.findByProps({ className: "funding-goal__raised-caption" }).children.join("")).toBe("of $100.00 goal");
    expect(() => renderer?.root.findByProps({ className: "funding-goal__raised-status" })).toThrow();
  });

  test("marks standard copy funded when the amount reaches the target", () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(FundingGoal, {
        goal: goal({ currentUsd: 100, completed: false }),
      }));
    });

    expect(renderer?.root.findByProps({ className: "funding-goal__raised-status" }).children.join("")).toBe("FUNDED");
  });

  test("renders the minimal goal badge with compact amount copy", () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(FundingGoal, {
        goal: goal({ currentUsd: 25, completed: false }),
        profile: "minimal",
      }));
    });

    expect(renderer?.root.findByProps({ className: "funding-goal funding-goal--minimal" })).toBeDefined();
    expect(renderer?.root.findByProps({ className: "funding-goal__badge" }).children.join("")).toBe("GOAL");
    expect(renderer?.root.findByProps({ className: "funding-goal__amount" }).children.join("")).toBe("$25.00 / $100.00");
  });

  test("marks the minimal goal funded from target-reaching progress", () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(FundingGoal, {
        goal: goal({ currentUsd: 100, completed: false }),
        profile: "minimal",
      }));
    });

    expect(renderer?.root.findByProps({ className: "funding-goal__badge" }).children.join("")).toBe("FUNDED");
    expect(renderer?.root.findByProps({ className: "funding-goal__amount" }).children.join("")).toBe("$100.00 / $100.00");
  });

  test("keeps a joined Unicode emoji together in the visible label", () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(FundingGoal, {
        goal: goal({ label: "👨‍💻 Build setup", currentUsd: 25, completed: false }),
      }));
    });

    expect(renderer?.root.findByProps({ className: "funding-goal__emoji" }).children.join("")).toBe("👨‍💻");
    expect(renderer?.root.findByProps({ className: "funding-goal__label" }).children).toContain("Build setup");
  });

  test("renders nothing when the configured goal is disabled", () => {
    let renderer: ReactTestRenderer | undefined;
    act(() => {
      renderer = create(React.createElement(FundingGoal, { goal: goal({ enabled: false }) }));
    });

    expect(renderer?.toJSON()).toBeNull();
  });

  test("accepts a lower revision after a server session or goal identity changes", () => {
    const current = goal({ revision: 10 });
    const restarted = goal({ revision: 0, sessionId: "session-2", currentUsd: 0, completed: false });
    const replacement = goal({ id: "microphone", revision: 0, currentUsd: 0, completed: false });

    expect(selectNewestFundingGoal(current, restarted)).toBe(restarted);
    expect(selectNewestFundingGoal(current, replacement)).toBe(replacement);
    expect(selectNewestFundingGoal(current, goal({ revision: 9 }))).toBe(current);
    expect(parseFundingGoalSnapshot(restarted)).toEqual(restarted);
    expect(parseFundingGoalSnapshot({ ...restarted, targetUsd: 0 })).toBeNull();
  });
});
