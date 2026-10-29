import React from "react";
import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { useFakeTimers, useRealTimers, advanceTimersByTime, setSystemTime } from "../../helpers/bun-timers";
import { safeSetTimeout } from "../../../src/utils/timeout-validator";
import TestRenderer, { act } from "react-test-renderer";

import { MemberParticleCanvas } from "../../../gui/src/shared/components/MemberParticleCanvas";
import { memberParticleSeedId } from "../../../gui/src/shared/member-particles";

type Callback = (timestamp: number) => void;

const originalGlobals = new Map<string, unknown>();
let pendingFrames: Map<number, ReturnType<typeof setTimeout>>;
let nextFrame: number;
let frameTimestamp: number;
let renderers: TestRenderer.ReactTestRenderer[];
let clock: ReturnType<typeof spyOn>;
let cancelledFrames: number[];
let contexts: Array<Record<string, unknown>>;
let drawCalls: unknown[][];
let contextOperations: Array<{ type: string; args: number[] }>;
let canvas: Record<string, unknown>;
let motion: { matches: boolean; listener: ((event: unknown) => void) | undefined };
let intersectionEvents: EventTarget;
let resizeEvents: EventTarget;
let motionEvents: EventTarget;
let intersectionDisconnect: () => void;
let resizeDisconnect: () => void;

function contextMock(): Record<string, unknown> {
  return {
    clearRect: (...args: number[]) => { contextOperations.push({ type: "clear", args }); },
    drawImage: (...args: unknown[]) => { drawCalls.push(args); },
    restore: () => { contextOperations.push({ type: "restore", args: [] }); },
    save: () => { contextOperations.push({ type: "save", args: [] }); },
    setTransform: () => undefined,
    scale: (...args: number[]) => { contextOperations.push({ type: "scale", args }); },
    translate: (...args: number[]) => { contextOperations.push({ type: "translate", args }); },
    createRadialGradient: () => ({ addColorStop: () => undefined }),
    createLinearGradient: () => ({ addColorStop: () => undefined }),
    fillRect: () => undefined,
    globalAlpha: 1,
  };
}

function renderCanvas(seed = "fixture-member-42", direction?: "left-to-right" | "right-to-left") {
  let renderer: TestRenderer.ReactTestRenderer;
  act(() => {
    renderer = TestRenderer.create(React.createElement(MemberParticleCanvas, {
      seed,
      ...(direction === undefined ? {} : { direction }),
    }), {
      createNodeMock: () => canvas,
    });
  });
  renderers.push(renderer!);
  return renderer!;
}

beforeEach(() => {
  useFakeTimers();
  setSystemTime(new Date(0));
  clock = spyOn(performance, "now").mockReturnValue(0);
  pendingFrames = new Map();
  nextFrame = 0;
  frameTimestamp = 0;
  renderers = [];
  cancelledFrames = [];
  contexts = [];
  drawCalls = [];
  contextOperations = [];
  motion = { matches: false, listener: undefined };
  intersectionEvents = new EventTarget();
  resizeEvents = new EventTarget();
  motionEvents = new EventTarget();
  intersectionDisconnect = () => undefined;
  resizeDisconnect = () => undefined;
  canvas = {
    width: 0,
    height: 0,
    getContext: () => {
      const context = contextMock();
      contexts.push(context);
      return context;
    },
    getBoundingClientRect: () => ({ width: 120, height: 40 }),
  };

  const globals = globalThis as unknown as Record<string, unknown>;
  for (const key of ["requestAnimationFrame", "cancelAnimationFrame", "IntersectionObserver", "ResizeObserver", "window", "document"]) {
    originalGlobals.set(key, globals[key]);
  }
  globals.requestAnimationFrame = (callback: Callback) => {
    const id = ++nextFrame;
    const timer = safeSetTimeout(() => {
      pendingFrames.delete(id);
      frameTimestamp += 16;
      callback(frameTimestamp);
    }, 16);
    pendingFrames.set(id, timer);
    return id;
  };
  globals.cancelAnimationFrame = (id: number) => {
    cancelledFrames.push(id);
    const timer = pendingFrames.get(id);
    if (timer !== undefined) clearTimeout(timer);
    pendingFrames.delete(id);
  };
  globals.IntersectionObserver = class {
    listener: EventListener;
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) {
      this.listener = event => callback((event as CustomEvent<Array<{ isIntersecting: boolean }>>).detail);
      intersectionEvents.addEventListener("change", this.listener);
    }
    observe() { /* boundary mock */ }
    disconnect() { intersectionEvents.removeEventListener("change", this.listener); intersectionDisconnect(); }
  };
  globals.ResizeObserver = class {
    constructor(readonly callback: () => void) { resizeEvents.addEventListener("resize", callback); }
    observe() { /* boundary mock */ }
    disconnect() { resizeEvents.removeEventListener("resize", this.callback); resizeDisconnect(); }
  };
  globals.window = { devicePixelRatio: 1.5, matchMedia: () => ({
    get matches() { return motion.matches; },
    addEventListener: (_: string, listener: (event: unknown) => void) => { motion.listener = listener; motionEvents.addEventListener("change", listener); },
    removeEventListener: () => { if (motion.listener) motionEvents.removeEventListener("change", motion.listener); motion.listener = undefined; },
  }) };
  globals.document = { createElement: () => ({ width: 1, height: 1, getContext: () => contextMock() }) };
});

afterEach(() => {
  try {
    act(() => { for (const renderer of renderers) renderer.unmount(); });
    expect(pendingFrames.size).toBe(0);
  } finally {
    const globals = globalThis as unknown as Record<string, unknown>;
    for (const [key, value] of originalGlobals) {
      if (value === undefined) Reflect.deleteProperty(globals, key);
      else globals[key] = value;
    }
    originalGlobals.clear();
    clock.mockRestore();
    useRealTimers();
  }
});

describe("MemberParticleCanvas behavior", () => {
  it("exposes decorative markup with the stable seed id", () => {
    const renderer = renderCanvas("fixture-member-42");
    const node = renderer.root.findByType("canvas");
    expect(node.props.className).toBe("gui-row__member-particles");
    expect(node.props["aria-hidden"]).toBe("true");
    expect(node.props["data-member-particles-seed"]).toBe(memberParticleSeedId("fixture-member-42"));
    act(() => renderer.unmount());
  });

  it("sizes and draws the visible canvas when a frame advances", () => {
    const renderer = renderCanvas();
    expect(pendingFrames.size).toBe(1);
    act(() => { advanceTimersByTime(1_000); });
    expect(canvas.width).toBe(180);
    expect(canvas.height).toBe(60);
    expect(contextOperations).toContainEqual({ type: "clear", args: [0, 0, 120, 40] });
    // Fixed synthetic seed, 62 scheduled frames through 992 ms.
    expect(contextOperations.filter(({ type }) => type === "clear")).toHaveLength(62);
    expect(drawCalls).toHaveLength(759);
    expect(drawCalls.every(args => Number.isFinite(args[1]) && Number.isFinite(args[2]) && Number(args[3]) > 0 && Number(args[4]) > 0)).toBe(true);
    expect(pendingFrames.size).toBe(1);
    act(() => renderer.unmount());
  });

  it("keeps every longtail at the selected one-pixel thickness", () => {
    const renderer = renderCanvas();
    act(() => { advanceTimersByTime(1_000); });
    const tailCalls = drawCalls.filter((args) => Number(args[3]) > Number(args[4]));

    expect(tailCalls.length).toBeGreaterThan(0);
    expect(tailCalls.every((args) => args[4] === 1)).toBe(true);
    act(() => renderer.unmount());
  });

  it("keeps right-to-left particles unmirrored by default", () => {
    const renderer = renderCanvas();
    act(() => { advanceTimersByTime(1_000); });

    expect(contextOperations).not.toContainEqual({ type: "scale", args: [-1, 1] });
    act(() => renderer.unmount());
  });

  it("mirrors particle sprites and tails for left-to-right flow", () => {
    const renderer = renderCanvas("fixture-goal-controller", "left-to-right");
    act(() => { advanceTimersByTime(1_000); });

    expect(contextOperations).toContainEqual({ type: "scale", args: [-1, 1] });
    expect(contextOperations.some(({ type }) => type === "save")).toBe(true);
    expect(contextOperations.some(({ type }) => type === "translate")).toBe(true);
    expect(contextOperations.some(({ type }) => type === "restore")).toBe(true);
    act(() => renderer.unmount());
  });

  it("stops and releases the backing store offscreen, then restarts on re-entry", () => {
    const renderer = renderCanvas();
    act(() => { intersectionEvents.dispatchEvent(new CustomEvent("change", { detail: [{ isIntersecting: false }] })); });
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(cancelledFrames).toHaveLength(1);
    expect(pendingFrames.size).toBe(0);
    act(() => { advanceTimersByTime(160); });
    expect(drawCalls).toHaveLength(0);
    act(() => { intersectionEvents.dispatchEvent(new CustomEvent("change", { detail: [{ isIntersecting: true }] })); });
    expect(pendingFrames.size).toBe(1);
    act(() => renderer.unmount());
  });

  it("resizes its backing store when device pixel ratio changes", () => {
    const renderer = renderCanvas();
    act(() => { advanceTimersByTime(1_000); });
    expect(canvas.width).toBe(180);
    const testWindow = (globalThis as unknown as { window: { devicePixelRatio: number } }).window;
    testWindow.devicePixelRatio = 2;
    act(() => { resizeEvents.dispatchEvent(new Event("resize")); });
    expect(canvas.width).toBe(240);
    act(() => renderer.unmount());
  });

  it("responds to reduced-motion changes by stopping and resuming", () => {
    const renderer = renderCanvas();
    motion.matches = true;
    act(() => { motionEvents.dispatchEvent(new Event("change")); });
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(cancelledFrames).toHaveLength(1);
    expect(pendingFrames.size).toBe(0);
    motion.matches = false;
    act(() => { motionEvents.dispatchEvent(new Event("change")); });
    expect(pendingFrames.size).toBe(1);
    act(() => renderer.unmount());
  });

  it("releases its backing store when reduced motion is active at mount", () => {
    motion.matches = true;
    const renderer = renderCanvas();

    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(pendingFrames.size).toBe(0);
    act(() => renderer.unmount());
  });

  it("cleans up its frame, observers, media listener, and canvas on unmount", () => {
    let disconnected = 0;
    intersectionDisconnect = () => { disconnected += 1; };
    resizeDisconnect = () => { disconnected += 1; };
    const renderer = renderCanvas();
    act(() => renderer.unmount());
    expect(cancelledFrames).toHaveLength(1);
    expect(pendingFrames.size).toBe(0);
    expect(disconnected).toBe(2);
    expect(drawCalls).toHaveLength(0);
    expect(motion.listener).toBeUndefined();
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });

  it("exits safely when the canvas context is unavailable", () => {
    canvas.getContext = () => null;
    const renderer = renderCanvas();
    expect(pendingFrames.size).toBe(0);
    expect(() => act(() => renderer.unmount())).not.toThrow();
  });
});
