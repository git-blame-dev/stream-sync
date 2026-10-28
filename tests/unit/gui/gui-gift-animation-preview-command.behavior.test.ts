import { describe, expect, it } from "bun:test";

import {
  DEFAULT_DURATION_MS,
  buildGiftAnimationPreviewEvent,
  runGuiGiftAnimationPreview,
} from "../../../scripts/local/gui-gift-animation-preview.ts";

type UnknownRecord = Record<string, unknown>;

function requireRecordAt(
  records: UnknownRecord[],
  index: number,
): UnknownRecord {
  const record = records[index];
  if (!record) {
    throw new Error(`Missing record at index ${index}`);
  }

  return record;
}

function requireValue<T>(value: T | undefined, description: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${description}`);
  }

  return value;
}

describe("GUI gift animation preview command behavior", () => {
  for (const stage of ["start", "initial", "synchronous"] as const) {
    it(`retires resources after ${stage} failure`, async () => {
      const failure = new Error(`synthetic ${stage} failure`);
      const handles: object[] = [];
      const cleared: unknown[] = [];
      const callbacks: Array<() => void> = [];
      let emits = 0;
      let stopped = false;
      let disposed = false;
      const run = runGuiGiftAnimationPreview({
        logger: { warn() {}, error() {} },
        createPreviewPipelineImpl: () => ({
          eventBus: { emit() {
            emits += 1;
            if (stage === "initial" || emits === 2) throw failure;
          } },
          emitIngestEvent() {},
          dispose() { disposed = true; },
        }),
        createGuiTransportServiceImpl: () => ({
          async start() { if (stage === "start") throw failure; },
          async stop() { stopped = true; },
        }),
        giftAnimationResolver: { async resolveFromNotificationData() { return { durationMs: 1 }; } },
        safeSetTimeoutImpl(callback) {
          callbacks.push(callback);
          callback();
          const handle = {};
          handles.push(handle);
          return handle;
        },
        clearTimeoutImpl(handle) {
          cleared.push(handle);
          callbacks.forEach((callback) => callback());
        },
        stdout: { write() {} },
      });
      await expect(run).rejects.toBe(failure);
      expect(stopped).toBe(true);
      expect(disposed).toBe(true);
      expect(handles).toHaveLength(stage === "start" ? 0 : 3);
      expect(cleared).toEqual(handles);
      expect(emits).toBe(stage === "start" ? 0 : stage === "initial" ? 1 : 2);
    });
  }

  it("owns scheduled failures and fences retired callbacks even when reporting fails", async () => {
    const failure = new Error("synthetic scheduled emission failure");
    const callbacks: Array<() => void> = [];
    const handles: object[] = [];
    const cleared: unknown[] = [];
    let emits = 0;
    let stopped = false;
    let disposed = false;
    const run = runGuiGiftAnimationPreview({
      logger: { warn() {}, error() { throw new Error("synthetic reporting failure"); } },
      createPreviewPipelineImpl: () => ({
        eventBus: { emit() { if (++emits === 2) throw failure; } },
        emitIngestEvent() {},
        dispose() { disposed = true; },
      }),
      createGuiTransportServiceImpl: () => ({
        async start() {},
        async stop() { stopped = true; throw new Error("synthetic stop failure"); },
      }),
      giftAnimationResolver: { async resolveFromNotificationData() { return { durationMs: 1 }; } },
      safeSetTimeoutImpl(callback) {
        callbacks.push(callback);
        const handle = {};
        handles.push(handle);
        return handle;
      },
      clearTimeoutImpl(handle) { cleared.push(handle); },
      stdout: { write() {} },
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(callbacks).toHaveLength(3);
    expect(() => requireValue(callbacks[0], "scheduled emission")()).not.toThrow();
    await expect(run).rejects.toBe(failure);
    expect(stopped).toBe(true);
    expect(disposed).toBe(true);
    expect(cleared).toEqual(handles);
    callbacks.forEach((callback) => callback());
    expect(emits).toBe(2);
  });

  it("builds the isolated Corgi gift preview event", () => {
    const event = buildGiftAnimationPreviewEvent();

    expect(event).toBeDefined();
    expect(event.adapter).toBe("tiktok");
    expect(event.rawEvent).toMatchObject({
      eventType: "GIFT",
      data: { giftName: "Corgi" },
    });
  });

  it("runs isolated gift animation preview and disposes resources", async () => {
    let started = false;
    let stopped = false;
    let disposed = false;
    const writes: string[] = [];
    const scheduledDurations: number[] = [];
    const scheduledHandles: object[] = [];
    const clearedHandles: unknown[] = [];
    const createdPipelineArgs: UnknownRecord[] = [];
    const emittedEvents: Array<{ eventName: string; payload: unknown }> =
      [];

    const fakeEventBus = {
      subscribe() {
        return () => {};
      },
      emit(eventName: string, payload: unknown) {
        emittedEvents.push({ eventName, payload });
      },
    };

    const fakePipeline = {
      eventBus: fakeEventBus,
      emitIngestEvent() {},
      async dispose() {
        disposed = true;
      },
    };

    const fakeService = {
      async start() {
        started = true;
      },
      async stop() {
        stopped = true;
      },
    };

    await runGuiGiftAnimationPreview({
      durationMs: 4,
      createPreviewPipelineImpl: (args: UnknownRecord) => {
        createdPipelineArgs.push(args);
        return fakePipeline;
      },
      createGuiTransportServiceImpl: () => fakeService,
      giftAnimationResolver: {
        async resolveFromNotificationData() {
          return {
            mediaFilePath: "/tmp/test-corgi-animation.mp4",
            mediaContentType: "video/mp4",
            durationMs: 4200,
            animationConfig: {
              profileName: "portrait",
              sourceWidth: 1440,
              sourceHeight: 1280,
              renderWidth: 720,
              renderHeight: 1280,
              rgbFrame: [0, 0, 720, 1280],
              aFrame: [720, 0, 720, 1280],
            },
          };
        },
      },
      safeSetTimeoutImpl: (resolve: () => void, duration: number) => {
        scheduledDurations.push(duration);
        const handle = { duration };
        scheduledHandles.push(handle);
        if (duration === 4) {
          resolve();
        }
        return handle;
      },
      clearTimeoutImpl: (handle: unknown) => {
        clearedHandles.push(handle);
      },
      stdout: {
        write: (text: string) => writes.push(text),
      },
    });

    expect(started).toBe(true);
    expect(stopped).toBe(true);
    expect(disposed).toBe(true);
    expect(createdPipelineArgs.length).toBe(1);
    const createdPipelineArg = requireRecordAt(createdPipelineArgs, 0);
    expect(createdPipelineArg.giftAnimationResolver).toMatchObject({
      resolveFromNotificationData: expect.any(Function),
    });
    expect(typeof createdPipelineArg.delay).toBe("function");
    expect(scheduledDurations).toContain(750);
    expect(scheduledDurations).toContain(2250);
    expect(scheduledDurations).toContain(4);
    expect(clearedHandles).toContain(
      requireValue(scheduledHandles[0], "first scheduled timer handle"),
    );
    expect(clearedHandles).toContain(
      requireValue(scheduledHandles[1], "second scheduled timer handle"),
    );
    expect(clearedHandles).toEqual(scheduledHandles);
    expect(emittedEvents.length).toBeGreaterThan(0);
    const emittedEvent = emittedEvents[0];
    if (!emittedEvent) {
      throw new Error("Expected gift animation event to be emitted");
    }
    expect(emittedEvent.eventName).toBe("display:gift-animation");
    expect(emittedEvent.payload).toMatchObject({ platform: "tiktok" });
    expect(
      writes.some((line) =>
        line.includes("GUI gift animation preview running"),
      ),
    ).toBe(true);
    expect(writes.some((line) => line.includes("TikTok Animation URL"))).toBe(
      true,
    );
    expect(
      writes.some((line) =>
        line.includes("GUI gift animation preview finished"),
      ),
    ).toBe(true);
  });

  it("uses default preview duration when value is missing", async () => {
    const scheduledDurations: number[] = [];

    await runGuiGiftAnimationPreview({
      createPreviewPipelineImpl: () => ({
        eventBus: { subscribe: () => () => {}, emit() {} },
        emitIngestEvent() {},
        async dispose() {},
      }),
      createGuiTransportServiceImpl: () => ({
        async start() {},
        async stop() {},
      }),
      giftAnimationResolver: {
        async resolveFromNotificationData() {
          return {
            mediaFilePath: "/tmp/test-corgi-animation.mp4",
            mediaContentType: "video/mp4",
            durationMs: 4200,
            animationConfig: {
              profileName: "portrait",
              sourceWidth: 1440,
              sourceHeight: 1280,
              renderWidth: 720,
              renderHeight: 1280,
              rgbFrame: [0, 0, 720, 1280],
              aFrame: [720, 0, 720, 1280],
            },
          };
        },
      },
      safeSetTimeoutImpl: (resolve: () => void, duration: number) => {
        scheduledDurations.push(duration);
        resolve();
        return { duration };
      },
      clearTimeoutImpl() {},
      stdout: {
        write() {},
      },
    });

    expect(scheduledDurations).toContain(DEFAULT_DURATION_MS);
  });
});
