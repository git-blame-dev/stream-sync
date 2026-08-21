import React from "react";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import TestRenderer, { act } from "react-test-renderer";

import { MemberParticleCanvas } from "../../../gui/src/shared/components/MemberParticleCanvas";
import { memberParticleSeedId } from "../../../gui/src/shared/member-particles";

type Callback = (timestamp: number) => void;

const originalGlobals = new Map<string, unknown>();
let rafCallbacks: Callback[];
let cancelledFrames: number[];
let contexts: Array<Record<string, unknown>>;
let drawCalls: unknown[][];
let contextOperations: Array<{ type: string; args: number[] }>;
let canvas: Record<string, unknown>;
let motion: { matches: boolean; listener: ((event: unknown) => void) | undefined };
let intersectionCallback: (entries: Array<{ isIntersecting: boolean }>) => void;
let resizeCallback: () => void;
let intersectionDisconnect: () => void;
let resizeDisconnect: () => void;

function contextMock(): Record<string, unknown> {
  return {
    clearRect: () => undefined,
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
  return renderer!;
}

beforeEach(() => {
  rafCallbacks = [];
  cancelledFrames = [];
  contexts = [];
  drawCalls = [];
  contextOperations = [];
  motion = { matches: false, listener: undefined };
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
    rafCallbacks.push(callback);
    return rafCallbacks.length;
  };
  globals.cancelAnimationFrame = (id: number) => cancelledFrames.push(id);
  globals.IntersectionObserver = class {
    constructor(callback: (entries: Array<{ isIntersecting: boolean }>) => void) { intersectionCallback = callback; }
    observe() { /* boundary mock */ }
    disconnect() { intersectionDisconnect(); }
  };
  globals.ResizeObserver = class {
    constructor(callback: () => void) { resizeCallback = callback; }
    observe() { /* boundary mock */ }
    disconnect() { resizeDisconnect(); }
  };
  globals.window = { devicePixelRatio: 1.5, matchMedia: () => ({
    get matches() { return motion.matches; },
    addEventListener: (_: string, listener: (event: unknown) => void) => { motion.listener = listener; },
    removeEventListener: () => { motion.listener = undefined; },
  }) };
  globals.document = { createElement: () => ({ width: 1, height: 1, getContext: () => contextMock() }) };
});

afterEach(() => {
  const globals = globalThis as unknown as Record<string, unknown>;
  for (const [key, value] of originalGlobals) globals[key] = value;
  originalGlobals.clear();
});

describe("MemberParticleCanvas behavior", () => {
  it("exposes decorative markup with the stable seed id", () => {
    const renderer = renderCanvas("fixture-member-42");
    const node = renderer.root.findByType("canvas");
    expect(node.props.className).toBe("gui-row__member-particles");
    expect(node.props["aria-hidden"]).toBe("true");
    expect(node.props["data-member-particles-seed"]).toBe(memberParticleSeedId("fixture-member-42"));
    renderer.unmount();
  });

  it("sizes and draws the visible canvas when a frame advances", () => {
    const renderer = renderCanvas();
    expect(rafCallbacks).toHaveLength(1);
    act(() => rafCallbacks.shift()!(1_000_000_000));
    expect(canvas.width).toBe(180);
    expect(canvas.height).toBe(60);
    expect(contexts.at(0)?.clearRect).toBeDefined();
    expect(contexts.some((context) => context.drawImage !== undefined)).toBe(true);
    renderer.unmount();
  });

  it("keeps every longtail at the selected one-pixel thickness", () => {
    const renderer = renderCanvas();
    act(() => rafCallbacks.shift()!(1_000_000_000));
    const tailCalls = drawCalls.filter((args) => Number(args[3]) > Number(args[4]));

    expect(tailCalls.length).toBeGreaterThan(0);
    expect(tailCalls.every((args) => args[4] === 1)).toBe(true);
    renderer.unmount();
  });

  it("keeps right-to-left particles unmirrored by default", () => {
    const renderer = renderCanvas();
    act(() => rafCallbacks.shift()!(1_000_000_000));

    expect(contextOperations).not.toContainEqual({ type: "scale", args: [-1, 1] });
    renderer.unmount();
  });

  it("mirrors particle sprites and tails for left-to-right flow", () => {
    const renderer = renderCanvas("fixture-goal-controller", "left-to-right");
    act(() => rafCallbacks.shift()!(1_000_000_000));

    expect(contextOperations).toContainEqual({ type: "scale", args: [-1, 1] });
    expect(contextOperations.some(({ type }) => type === "save")).toBe(true);
    expect(contextOperations.some(({ type }) => type === "translate")).toBe(true);
    expect(contextOperations.some(({ type }) => type === "restore")).toBe(true);
    renderer.unmount();
  });

  it("stops and releases the backing store offscreen, then restarts on re-entry", () => {
    const renderer = renderCanvas();
    act(() => intersectionCallback([{ isIntersecting: false }]));
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(cancelledFrames.length).toBeGreaterThanOrEqual(1);
    act(() => intersectionCallback([{ isIntersecting: true }]));
    expect(rafCallbacks.length).toBeGreaterThanOrEqual(1);
    renderer.unmount();
  });

  it("resizes its backing store when device pixel ratio changes", () => {
    const renderer = renderCanvas();
    act(() => rafCallbacks.shift()!(1_000_000_000));
    expect(canvas.width).toBe(180);
    const testWindow = (globalThis as unknown as { window: { devicePixelRatio: number } }).window;
    testWindow.devicePixelRatio = 2;
    act(() => resizeCallback());
    expect(canvas.width).toBe(240);
    renderer.unmount();
  });

  it("responds to reduced-motion changes by stopping and resuming", () => {
    const renderer = renderCanvas();
    motion.matches = true;
    act(() => motion.listener?.({}));
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(cancelledFrames.length).toBeGreaterThanOrEqual(1);
    motion.matches = false;
    act(() => motion.listener?.({}));
    expect(rafCallbacks.length).toBeGreaterThanOrEqual(1);
    renderer.unmount();
  });

  it("releases its backing store when reduced motion is active at mount", () => {
    motion.matches = true;
    const renderer = renderCanvas();

    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    expect(rafCallbacks).toHaveLength(0);
    renderer.unmount();
  });

  it("cleans up its frame, observers, media listener, and canvas on unmount", () => {
    let disconnected = 0;
    intersectionDisconnect = () => { disconnected += 1; };
    resizeDisconnect = () => { disconnected += 1; };
    const renderer = renderCanvas();
    act(() => renderer.unmount());
    expect(cancelledFrames.length).toBeGreaterThanOrEqual(1);
    expect(disconnected).toBeGreaterThanOrEqual(2);
    expect(contexts.at(0)?.clearRect).toBeDefined();
    expect(motion.listener).toBeUndefined();
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
  });

  it("exits safely when the canvas context is unavailable", () => {
    canvas.getContext = () => null;
    const renderer = renderCanvas();
    expect(rafCallbacks).toHaveLength(0);
    expect(() => renderer.unmount()).not.toThrow();
  });
});
