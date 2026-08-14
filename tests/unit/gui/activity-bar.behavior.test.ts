import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { describe, expect, it } from "bun:test";
import React from "react";

import { ActivityBar, type ActivityBarScheduler } from "../../../gui/src/shared/components/ActivityBar";

class ManualScheduler implements ActivityBarScheduler {
  now = 0;
  next = 1;
  tasks = new Map<number, { at: number; callback: () => void }>();

  setTimeout = (callback: () => void, delay: number) => {
    const id = this.next++;
    this.tasks.set(id, { at: this.now + delay, callback });
    return id;
  };

  clearTimeout = (handle: unknown) => {
    this.tasks.delete(handle as number);
  };

  advance(ms: number) {
    const end = this.now + ms;
    while (true) {
      const due = [...this.tasks.entries()]
        .filter(([, task]) => task.at <= end)
        .sort((left, right) => left[1].at - right[1].at)[0];
      if (!due) break;
      this.now = due[1].at;
      this.tasks.delete(due[0]);
      act(due[1].callback);
    }
    this.now = end;
  }
}

const row = (eventId: string, text: string) => ({
  eventId,
  type: "platform:follow",
  kind: "notification" as const,
  platform: "twitch",
  username: "user",
  text,
  avatarUrl: "avatar",
  timestamp: "2024-01-01T00:00:00.000Z",
});

const articles = (renderer: ReactTestRenderer) => renderer.root.findAllByProps({ role: "article" });

describe("ActivityBar behavior", () => {
  it("keeps one overlay row visible until its lifecycle requests exit", () => {
    const scheduler = new ManualScheduler();
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(ActivityBar, {
        row: row("event-1", "one"),
        exitRequested: false,
        scheduler,
      }));
    });

    expect(articles(renderer)).toHaveLength(1);
    expect(articles(renderer)[0]?.props.className).toContain("notification-enter");
    act(() => scheduler.advance(1000));
    expect(articles(renderer)[0]?.props.className).not.toContain("notification-enter");
    act(() => scheduler.advance(30_000));
    expect(articles(renderer)).toHaveLength(1);
    act(() => renderer.unmount());
  });

  it("serializes exit and reports completion without mounting a replacement", () => {
    const scheduler = new ManualScheduler();
    const completed: string[] = [];
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(ActivityBar, {
        row: row("event-1", "one"),
        exitRequested: false,
        scheduler,
        onExitComplete: (eventId: string) => completed.push(eventId),
      }));
      scheduler.advance(1000);
    });
    act(() => {
      renderer.update(React.createElement(ActivityBar, {
        row: row("event-2", "two"),
        exitRequested: true,
        scheduler,
        onExitComplete: (eventId: string) => completed.push(eventId),
      }));
    });

    expect(articles(renderer)).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).toContain("one");
    expect(articles(renderer)[0]?.props.className).toContain("notification-exit");
    act(() => scheduler.advance(1000));
    expect(articles(renderer)).toHaveLength(1);
    expect(JSON.stringify(renderer.toJSON())).toContain("two");
    expect(completed).toEqual(["event-1"]);
    act(() => renderer.unmount());
  });

  it("preserves order under reduced motion while completing exit immediately", () => {
    const completed: string[] = [];
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(ActivityBar, {
        row: row("event-1", "one"),
        exitRequested: false,
        reducedMotion: true,
        onExitComplete: (eventId: string) => completed.push(eventId),
      }));
    });
    expect(articles(renderer)).toHaveLength(1);
    act(() => {
      renderer.update(React.createElement(ActivityBar, {
        row: row("event-1", "one"),
        exitRequested: true,
        reducedMotion: true,
        onExitComplete: (eventId: string) => completed.push(eventId),
      }));
    });
    expect(articles(renderer)).toHaveLength(0);
    expect(completed).toEqual(["event-1"]);
    act(() => renderer.unmount());
  });

  it("ignores unrelated animation completions", () => {
    const scheduler = new ManualScheduler();
    const completed: string[] = [];
    let renderer!: ReactTestRenderer;
    act(() => {
      renderer = create(React.createElement(ActivityBar, {
        row: row("event-1", "one"),
        exitRequested: true,
        scheduler,
        onExitComplete: (eventId: string) => completed.push(eventId),
      }));
    });
    const article = articles(renderer)[0];
    const target = {};
    act(() => article?.props.onAnimationEnd({
      target,
      currentTarget: target,
      animationName: "unrelated-animation",
    }));
    expect(articles(renderer)).toHaveLength(1);
    expect(completed).toEqual([]);
    act(() => renderer.unmount());
  });
});
