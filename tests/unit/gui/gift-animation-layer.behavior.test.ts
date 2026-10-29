import { beforeEach, describe, expect, it } from "bun:test";
import React from "react";
import { advanceTimersByTime, getTimerCount, useFakeTimers, useRealTimers } from "../../helpers/bun-timers";
import TestRenderer from "react-test-renderer";

import { GiftAnimationLayer } from "../../../gui/src/shared/components/GiftAnimationLayer";
import type {
  GuiGiftAnimationConfig,
  GuiGiftAnimationEffectEnvelope,
} from "../../../gui/src/shared/types";
import { createMockFn, type TestMockFn } from "../../helpers/bun-mock-utils";

type EffectOverrides = Partial<Omit<GuiGiftAnimationEffectEnvelope, "config">> & {
  config?: Partial<GuiGiftAnimationConfig>;
};

function createEffect(
  overrides: EffectOverrides = {},
): GuiGiftAnimationEffectEnvelope {
  const baseConfig = {
    profileName: "portrait",
    sourceWidth: 960,
    sourceHeight: 864,
    renderWidth: 480,
    renderHeight: 854,
    rgbFrame: [0, 0, 480, 854],
    aFrame: [480, 0, 480, 854],
  } satisfies GuiGiftAnimationConfig;
  const { config: configOverrides, ...effectOverrides } = overrides;

  return {
    __guiEvent: "effect",
    effectType: "tiktok-gift-animation",
    playbackId: "test-playback-id",
    durationMs: 2400,
    assetUrl: "/gui/runtime/0123456789abcdef01234567.mp4",
    ...effectOverrides,
    config: {
      ...baseConfig,
      ...(configOverrides || {}),
    },
  };
}

function createCanvasContext(overrides: Record<string, any> = {}) {
  return {
    clearRect: createMockFn(),
    drawImage: createMockFn(),
    getImageData: createMockFn(() => ({
      data: new Uint8ClampedArray([10, 20, 30, 255, 40, 50, 60, 255]),
    })),
    createImageData: createMockFn((width: number, height: number) => ({
      data: new Uint8ClampedArray(width * height * 4),
    })),
    putImageData: createMockFn(),
    ...overrides,
  };
}

type VideoNode = {
  readyState: number;
  paused: boolean;
  ended: boolean;
  currentTime: number;
  muted: boolean;
  playsInline: boolean;
  src: string;
  onended: (() => void) | null;
  onerror: (() => void) | null;
  onloadeddata: (() => void) | null;
  play: TestMockFn<[], Promise<undefined>>;
  pause: TestMockFn;
  removeAttribute: TestMockFn;
  load: TestMockFn;
};

function createVideoNode(): VideoNode {
  return {
    readyState: 2,
    paused: false,
    ended: false,
    currentTime: 0,
    muted: false,
    playsInline: false,
    src: "",
    onended: null,
    onerror: null,
    onloadeddata: null,
    play: createMockFn<[], Promise<undefined>>().mockResolvedValue(undefined),
    pause: createMockFn(),
    removeAttribute: createMockFn(),
    load: createMockFn(),
  };
}

function createCanvasNode(context: any) {
  return {
    width: 0,
    height: 0,
    getContext: () => context,
  };
}

function installDomRuntime(
  options: { createElement?: (tagName: string) => any } = {},
) {
  const previousWindow = global.window;
  const previousDocument = global.document;
  const previousHtmlMediaElement = global.HTMLMediaElement;
  const previousTimeStamp = console.timeStamp;
  useFakeTimers();
  const timerBaseline = getTimerCount();
  const rafCallbacks = new Map<number, FrameRequestCallback>();
  let nextRaf = 0;

  const windowMock = {
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      const handle = ++nextRaf;
      rafCallbacks.set(handle, callback);
      return handle;
    },
    cancelAnimationFrame: createMockFn((handle: number) => rafCallbacks.delete(handle)),
    setTimeout: global.setTimeout,
    clearTimeout: createMockFn((handle: ReturnType<typeof setTimeout>) => global.clearTimeout(handle)),
  };

  global.window = windowMock as unknown as Window & typeof globalThis;
  global.document = {
    createElement:
      options.createElement ||
      ((tagName: string) => {
        if (tagName === "canvas") {
          return createCanvasNode(createCanvasContext());
        }

        return {};
      }),
  } as unknown as Document;
  global.HTMLMediaElement = {
    HAVE_CURRENT_DATA: 2,
  } as unknown as typeof HTMLMediaElement;
  console.timeStamp = previousTimeStamp || (() => {});

  return {
    windowMock,
    timerBaseline,
    get pendingRafCount() { return rafCallbacks.size; },
    runNextAnimationFrame() {
      const first = rafCallbacks.entries().next().value;
      if (first) {
        rafCallbacks.delete(first[0]);
        first[1](0);
      }
    },
    advanceTime(milliseconds = 3000) {
      advanceTimersByTime(milliseconds);
    },
    restore() {
      useRealTimers();
      if (previousWindow !== undefined) {
        global.window = previousWindow;
      } else {
        Reflect.deleteProperty(global, "window");
      }

      if (previousDocument !== undefined) {
        global.document = previousDocument;
      } else {
        Reflect.deleteProperty(global, "document");
      }

      if (previousHtmlMediaElement !== undefined) {
        global.HTMLMediaElement = previousHtmlMediaElement;
      } else {
        Reflect.deleteProperty(global, "HTMLMediaElement");
      }

      if (previousTimeStamp) {
        console.timeStamp = previousTimeStamp;
      } else {
        Reflect.deleteProperty(console, "timeStamp");
      }
    },
  };
}

describe("GiftAnimationLayer behavior", () => {
  for (const assetUrl of ["https://example.invalid/a.mp4", "//example.invalid/a.mp4", "javascript:alert(1)", "/gui/runtime/../a.mp4", "/gui/runtime/0123456789abcdef01234567.mp4?x=1", "/gui/runtime/%2e%2e.mp4", "/gui/runtime/0123456789abcdef01234567.mp4\n"]) {
    it(`rejects non-local media before assigning src: ${assetUrl}`, async () => {
      const harness = installDomRuntime();
      const video = createVideoNode();
      const completions: string[] = [];
      let renderer!: TestRenderer.ReactTestRenderer;
      try {
        await TestRenderer.act(async () => {
          renderer = TestRenderer.create(React.createElement(GiftAnimationLayer, {
            effect: createEffect({ assetUrl }), onComplete: (_id, reason) => completions.push(reason),
          }), { createNodeMock: (element) => element.type === "video" ? video : createCanvasNode(createCanvasContext()) });
        });
        expect(video.src).toBe("");
        expect(video.play.mock.calls).toHaveLength(0);
        expect(completions).toEqual(["media-error"]);
      } finally {
        await TestRenderer.act(async () => renderer?.unmount());
        harness.restore();
      }
    });
  }

  for (const failure of ["rgb-missing", "alpha-missing", "context-throws", "drawImage", "getImageData", "putImageData"]) {
    it(`completes canvas failure once and retires callbacks: ${failure}`, async () => {
      let count = 0;
      const rgb = createCanvasContext(failure === "drawImage" || failure === "getImageData" || failure === "putImageData"
        ? { [failure]: () => { throw new Error("synthetic canvas failure"); } } : {});
      const harness = installDomRuntime({ createElement: () => {
        count += 1;
        if (failure === "context-throws") return { getContext: () => { throw new Error("synthetic unavailable context"); } };
        return createCanvasNode((count === 1 && failure === "rgb-missing") || (count === 2 && failure === "alpha-missing") ? null : rgb);
      } });
      const video = createVideoNode();
      const completions: string[] = [];
      let renderer!: TestRenderer.ReactTestRenderer;
      try {
        await TestRenderer.act(async () => {
          renderer = TestRenderer.create(React.createElement(GiftAnimationLayer, {
            effect: createEffect(), onComplete: (_id, reason) => completions.push(reason),
          }), { createNodeMock: (element) => element.type === "video" ? video : createCanvasNode(createCanvasContext()) });
        });
        const retainedLoad = video.onloadeddata;
        const retainedEnd = video.onended;
        await TestRenderer.act(async () => {
          retainedLoad?.();
          harness.runNextAnimationFrame();
          retainedLoad?.();
          retainedEnd?.();
          harness.runNextAnimationFrame();
          harness.advanceTime();
        });
        expect(completions).toEqual(["canvas-unavailable"]);
        expect(video.onloadeddata).toBeNull();
        expect(video.pause.mock.calls).toHaveLength(1);
        expect(video.removeAttribute.mock.calls).toEqual([["src"]]);
        const playCalls = video.play.mock.calls.length;
        await TestRenderer.act(async () => renderer.unmount());
        retainedLoad?.();
        harness.runNextAnimationFrame();
        expect(video.play.mock.calls).toHaveLength(playCalls);
        expect(video.pause.mock.calls).toHaveLength(1);
      } finally {
        await TestRenderer.act(async () => renderer?.unmount());
        harness.restore();
      }
    });
  }

  it("reports play rejection and prevents retained callbacks from restarting playback", async () => {
    const harness = installDomRuntime();
    const video = createVideoNode();
    video.paused = true;
    video.play.mockRejectedValue(new Error("synthetic playback rejection"));
    const completions: string[] = [];
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(GiftAnimationLayer, {
          effect: createEffect(), onComplete: (_id, reason) => completions.push(reason),
        }), { createNodeMock: (element) => element.type === "video" ? video : createCanvasNode(createCanvasContext()) });
      });
      const load = video.onloadeddata!;
      const end = video.onended!;
      await TestRenderer.act(async () => load());
      expect(completions).toEqual(["play-rejected"]);
      await TestRenderer.act(async () => { load(); end(); harness.runNextAnimationFrame(); harness.advanceTime(); });
      expect(completions).toEqual(["play-rejected"]);
      expect(video.play.mock.calls).toHaveLength(1);
    } finally {
      await TestRenderer.act(async () => renderer?.unmount());
      harness.restore();
    }
  });
  for (const [durationMs, deadline] of [[2400, 2900], [100, 1000]] as const) {
    it(`honors the actual ${deadline}ms deadline for duration ${durationMs}`, async () => {
      const harness = installDomRuntime();
      const video = createVideoNode();
      const completions: string[] = [];
      let renderer!: TestRenderer.ReactTestRenderer;
      try {
        await TestRenderer.act(async () => {
          renderer = TestRenderer.create(React.createElement(GiftAnimationLayer, {
            effect: createEffect({ durationMs }), onComplete: (_id, reason) => completions.push(reason),
          }), { createNodeMock: element => element.type === "video" ? video : createCanvasNode(createCanvasContext()) });
        });
        await TestRenderer.act(async () => video.onloadeddata?.());
        expect(getTimerCount()).toBe(harness.timerBaseline + 1);
        expect(harness.pendingRafCount).toBe(1);
        await TestRenderer.act(async () => harness.advanceTime(deadline - 1));
        expect(completions).toEqual([]);
        await TestRenderer.act(async () => harness.advanceTime(1));
        expect(completions).toEqual(["timeout"]);
        expect(getTimerCount()).toBe(harness.timerBaseline);
        expect(harness.pendingRafCount).toBe(0);
      } finally {
        await TestRenderer.act(async () => renderer?.unmount());
        harness.restore();
      }
    });
  }

  for (const retirement of ["ended", "error", "replacement", "unmount"] as const) {
    it(`cancels scheduled work on ${retirement} before the old deadline`, async () => {
      const harness = installDomRuntime();
      const video = createVideoNode();
      const completions: string[] = [];
      const onComplete = (id: string, reason: string) => completions.push(`${id}:${reason}`);
      let renderer!: TestRenderer.ReactTestRenderer;
      try {
        await TestRenderer.act(async () => {
          renderer = TestRenderer.create(React.createElement(GiftAnimationLayer, {
            effect: createEffect(), onComplete,
          }), { createNodeMock: element => element.type === "video" ? video : createCanvasNode(createCanvasContext()) });
        });
        const load = video.onloadeddata!;
        const end = video.onended!;
        const error = video.onerror!;
        await TestRenderer.act(async () => load());
        expect(harness.pendingRafCount).toBe(1);
        expect(getTimerCount()).toBe(harness.timerBaseline + 1);
        await TestRenderer.act(async () => {
          if (retirement === "ended") end();
          if (retirement === "error") error();
          if (retirement === "unmount") renderer.unmount();
          if (retirement === "replacement") renderer.update(React.createElement(GiftAnimationLayer, {
            effect: createEffect({ playbackId: "synthetic-replacement", durationMs: 6000 }), onComplete,
          }));
        });
        expect(harness.pendingRafCount).toBe(0);
        expect(getTimerCount()).toBe(harness.timerBaseline + (retirement === "replacement" ? 1 : 0));
        expect(video.pause.mock.calls).toHaveLength(1);
        expect(video.removeAttribute.mock.calls).toEqual([["src"]]);
        const expected = retirement === "ended" ? ["test-playback-id:ended"] : retirement === "error" ? ["test-playback-id:media-error"] : [];
        expect(completions).toEqual(expected);
        const playCalls = video.play.mock.calls.length;
        await TestRenderer.act(async () => { load(); end(); error(); harness.advanceTime(3000); harness.runNextAnimationFrame(); });
        expect(completions).toEqual(expected);
        expect(video.play.mock.calls).toHaveLength(playCalls);
        await TestRenderer.act(async () => renderer.unmount());
        expect(getTimerCount()).toBe(harness.timerBaseline);
        expect(harness.pendingRafCount).toBe(0);
      } finally {
        await TestRenderer.act(async () => renderer?.unmount());
        harness.restore();
      }
    });
  }
  beforeEach(() => {
    global.console.timeStamp = global.console.timeStamp || (() => {});
  });

  it("renders nothing when no effect is active", async () => {
    let renderer: any = null;

    await TestRenderer.act(async () => {
      renderer = TestRenderer.create(
        React.createElement(GiftAnimationLayer, {
          effect: null,
          onComplete: () => {},
        }),
      );
    });

    expect(renderer.toJSON()).toBeNull();

    await TestRenderer.act(async () => {
      renderer.unmount();
    });
  });

  it("retires active callbacks on disposal without acknowledging a completed playback", async () => {
    const harness = installDomRuntime();
    const video = createVideoNode();
    const completions: string[] = [];
    let renderer!: TestRenderer.ReactTestRenderer;
    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(React.createElement(GiftAnimationLayer, {
          effect: createEffect(), onComplete: (_id, reason) => completions.push(reason),
        }), { createNodeMock: (element) => element.type === "video" ? video : createCanvasNode(createCanvasContext()) });
      });
      const load = video.onloadeddata!;
      const end = video.onended!;
      await TestRenderer.act(async () => load());
      await TestRenderer.act(async () => renderer.unmount());
      video.paused = true;
      await TestRenderer.act(async () => { load(); end(); harness.runNextAnimationFrame(); harness.advanceTime(); });
      expect(completions).toEqual([]);
      expect(video.play.mock.calls).toHaveLength(0);
      expect(video.pause.mock.calls).toHaveLength(1);
      expect(harness.windowMock.cancelAnimationFrame.mock.calls.length).toBeGreaterThan(0);
      expect(harness.windowMock.clearTimeout.mock.calls.length).toBeGreaterThan(0);
    } finally {
      await TestRenderer.act(async () => renderer?.unmount());
      harness.restore();
    }
  });

  it("completes immediately when canvas context is unavailable", async () => {
    const harness = installDomRuntime({
      createElement: (tagName: string) => {
        if (tagName === "canvas") {
          return createCanvasNode(createCanvasContext());
        }

        return {};
      },
    });
    const onCompleteCalls: string[] = [];
    const videoNode = createVideoNode();
    let renderer: any = null;

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GiftAnimationLayer, {
            effect: createEffect(),
            onComplete: (playbackId: string) =>
              onCompleteCalls.push(playbackId),
          }),
          {
            createNodeMock: (element: any) => {
              if (element.type === "video") {
                return videoNode;
              }

              if (element.type === "canvas") {
                return createCanvasNode(null);
              }

              return {};
            },
          },
        );
      });

      expect(onCompleteCalls).toEqual(["test-playback-id"]);
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => {
          renderer.unmount();
        });
      }
      harness.restore();
    }
  });

  it("renders RGB-only frames and completes on video end when alpha metadata is absent", async () => {
    const harness = installDomRuntime({
      createElement: (tagName: string) => {
        if (tagName === "canvas") {
          return createCanvasNode(createCanvasContext());
        }

        return {};
      },
    });
    const onCompleteCalls: string[] = [];
    const canvasContext = createCanvasContext();
    const videoNode = createVideoNode();
    let renderer: any = null;

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GiftAnimationLayer, {
            effect: createEffect({
              config: {
                aFrame: null,
              },
            }),
            onComplete: (playbackId: string) =>
              onCompleteCalls.push(playbackId),
          }),
          {
            createNodeMock: (element: any) => {
              if (element.type === "video") {
                return videoNode;
              }

              if (element.type === "canvas") {
                return createCanvasNode(canvasContext);
              }

              return {};
            },
          },
        );
      });

      await TestRenderer.act(async () => {
        videoNode.onloadeddata!();
      });

      await TestRenderer.act(async () => {
        harness.runNextAnimationFrame();
      });

      expect(onCompleteCalls).toHaveLength(0);
      expect(canvasContext.drawImage.mock.calls.length).toBeGreaterThan(0);

      await TestRenderer.act(async () => {
        videoNode.onended!();
      });

      expect(onCompleteCalls).toEqual(["test-playback-id"]);

      await TestRenderer.act(async () => {
        videoNode.onended?.();
        videoNode.onerror?.();
        harness.advanceTime();
      });

      expect(onCompleteCalls).toEqual(["test-playback-id"]);
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => {
          renderer.unmount();
        });
      }
      harness.restore();
    }
  });

  it("composites alpha frames, ignores stale completions, and completes active playback from timeout", async () => {
    const rgbBufferContext = createCanvasContext({
      getImageData: createMockFn(() => ({
        data: new Uint8ClampedArray([1, 2, 3, 255, 4, 5, 6, 255]),
      })),
    });
    const alphaBufferContext = createCanvasContext({
      getImageData: createMockFn(() => ({
        data: new Uint8ClampedArray([2, 97, 98, 99, 3, 101, 102, 103]),
      })),
    });
    let createdCanvasCount = 0;
    const harness = installDomRuntime({
      createElement: (tagName: string) => {
        if (tagName !== "canvas") {
          return {};
        }

        createdCanvasCount += 1;
        return createdCanvasCount === 1
          ? createCanvasNode(rgbBufferContext)
          : createCanvasNode(alphaBufferContext);
      },
    });
    const onCompleteCalls: string[] = [];
    const videoNode = createVideoNode();
    const canvasContext = createCanvasContext({
      drawImage: createMockFn(),
      clearRect: createMockFn(),
    });
    let renderer: any = null;
    let staleOnEnded: (() => void) | null = null;

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GiftAnimationLayer, {
            effect: createEffect({
              config: {
                sourceWidth: 4,
                sourceHeight: 1,
                renderWidth: 2,
                renderHeight: 1,
                rgbFrame: [0, 0, 2, 1],
                aFrame: [2, 0, 2, 1],
              },
            }),
            onComplete: (playbackId: string) =>
              onCompleteCalls.push(playbackId),
          }),
          {
            createNodeMock: (element: any) => {
              if (element.type === "video") {
                return videoNode;
              }

              if (element.type === "canvas") {
                return createCanvasNode(canvasContext);
              }

              return {};
            },
          },
        );
      });

      await TestRenderer.act(async () => {
        videoNode.onloadeddata!();
      });

      await TestRenderer.act(async () => {
        harness.runNextAnimationFrame();
      });

      expect(rgbBufferContext.drawImage.mock.calls[0]).toEqual([videoNode, 0, 0, 2, 1, 0, 0, 2, 1]);
      expect(alphaBufferContext.drawImage.mock.calls[0]).toEqual([videoNode, 2, 0, 2, 1, 0, 0, 2, 1]);
      expect(Array.from((rgbBufferContext.putImageData.mock.calls[0]![0] as ImageData).data)).toEqual([
        0, 0, 0, 0, 4, 5, 6, 3,
      ]);
      expect(rgbBufferContext.putImageData.mock.calls[0]!.slice(1)).toEqual([0, 0]);
      expect(canvasContext.drawImage.mock.calls[0]!.slice(1)).toEqual([0, 0, 2, 1]);
      staleOnEnded = videoNode.onended;

      await TestRenderer.act(async () => {
        renderer.update(
          React.createElement(GiftAnimationLayer, {
            effect: createEffect({
              playbackId: "test-playback-id-2",
            }),
            onComplete: (playbackId: string) =>
              onCompleteCalls.push(playbackId),
          }),
        );
      });

      await TestRenderer.act(async () => {
        staleOnEnded!();
      });

      expect(onCompleteCalls).toHaveLength(0);
      expect(rgbBufferContext.putImageData.mock.calls.length).toBeGreaterThan(
        0,
      );

      await TestRenderer.act(async () => {
        harness.advanceTime();
      });

      expect(onCompleteCalls).toEqual(["test-playback-id-2"]);
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => {
          renderer.unmount();
        });
      }
      harness.restore();
    }
  });

  it("composites large alpha frames with full-size buffers", async () => {
    const rgbBufferContext = createCanvasContext();
    const alphaBufferContext = createCanvasContext();
    let createdCanvasCount = 0;
    const harness = installDomRuntime({
      createElement: (tagName: string) => {
        if (tagName !== "canvas") {
          return {};
        }

        createdCanvasCount += 1;
        return createdCanvasCount === 1
          ? createCanvasNode(rgbBufferContext)
          : createCanvasNode(alphaBufferContext);
      },
    });
    const videoNode = createVideoNode();
    const canvasContext = createCanvasContext();
    let renderer: any = null;

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GiftAnimationLayer, {
            effect: createEffect({
              config: {
                sourceWidth: 1440,
                sourceHeight: 1280,
                renderWidth: 720,
                renderHeight: 1280,
                rgbFrame: [0, 0, 720, 1280],
                aFrame: [720, 0, 720, 1280],
              },
            }),
            onComplete: () => {},
          }),
          {
            createNodeMock: (element: any) => {
              if (element.type === "video") {
                return videoNode;
              }

              if (element.type === "canvas") {
                return createCanvasNode(canvasContext);
              }

              return {};
            },
          },
        );
      });

      await TestRenderer.act(async () => {
        videoNode.onloadeddata!();
      });

      await TestRenderer.act(async () => {
        harness.runNextAnimationFrame();
      });

      expect(alphaBufferContext.drawImage.mock.calls.length).toBeGreaterThan(0);
      expect(rgbBufferContext.putImageData.mock.calls.length).toBeGreaterThan(
        0,
      );
      const createImageDataCall = rgbBufferContext.createImageData.mock.calls[0];
      if (!createImageDataCall) {
        throw new Error("expected createImageData to be called");
      }
      expect(createImageDataCall[0]).toBe(720);
      expect(createImageDataCall[1]).toBe(1280);
      expect(canvasContext.drawImage.mock.calls.length).toBeGreaterThan(0);
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => {
          renderer.unmount();
        });
      }
      harness.restore();
    }
  });

  it("does not restart active playback when only onComplete identity changes", async () => {
    const harness = installDomRuntime({
      createElement: (tagName: string) => {
        if (tagName === "canvas") {
          return createCanvasNode(createCanvasContext());
        }

        return {};
      },
    });
    const activeEffect = createEffect();
    const videoNode = createVideoNode();
    const canvasContext = createCanvasContext();
    let renderer: any = null;

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GiftAnimationLayer, {
            effect: activeEffect,
            onComplete: () => {},
          }),
          {
            createNodeMock: (element: any) => {
              if (element.type === "video") {
                return videoNode;
              }

              if (element.type === "canvas") {
                return createCanvasNode(canvasContext);
              }

              return {};
            },
          },
        );
      });

      await TestRenderer.act(async () => {
        videoNode.onloadeddata!();
      });

      const pauseCallsBeforeRerender = videoNode.pause.mock.calls.length;
      const loadCallsBeforeRerender = videoNode.load.mock.calls.length;

      await TestRenderer.act(async () => {
        renderer.update(
          React.createElement(GiftAnimationLayer, {
            effect: activeEffect,
            onComplete: () => {},
          }),
        );
      });

      expect(videoNode.pause.mock.calls.length).toBe(pauseCallsBeforeRerender);
      expect(videoNode.load.mock.calls.length).toBe(loadCallsBeforeRerender);
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => {
          renderer.unmount();
        });
      }
      harness.restore();
    }
  });

  it("retries video playback when paused mid-animation", async () => {
    const harness = installDomRuntime({
      createElement: (tagName: string) => {
        if (tagName === "canvas") {
          return createCanvasNode(createCanvasContext());
        }

        return {};
      },
    });
    const videoNode = createVideoNode();
    const canvasContext = createCanvasContext();
    let renderer: any = null;

    try {
      await TestRenderer.act(async () => {
        renderer = TestRenderer.create(
          React.createElement(GiftAnimationLayer, {
            effect: createEffect(),
            onComplete: () => {},
          }),
          {
            createNodeMock: (element: any) => {
              if (element.type === "video") {
                return videoNode;
              }

              if (element.type === "canvas") {
                return createCanvasNode(canvasContext);
              }

              return {};
            },
          },
        );
      });

      await TestRenderer.act(async () => {
        videoNode.onloadeddata!();
      });

      const playCallsAfterLoad = videoNode.play.mock.calls.length;
      videoNode.paused = true;

      await TestRenderer.act(async () => {
        harness.runNextAnimationFrame();
      });

      expect(videoNode.play.mock.calls.length).toBeGreaterThan(
        playCallsAfterLoad,
      );
    } finally {
      if (renderer) {
        await TestRenderer.act(async () => {
          renderer.unmount();
        });
      }
      harness.restore();
    }
  });
});
