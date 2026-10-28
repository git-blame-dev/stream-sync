import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTikTokGiftAnimationResolver } from "../../../src/services/tiktok-gift-animation/resolver";
import { zipFixture } from "../../helpers/bounded-zip-fixture";

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
  for (const stage of ["pipeline", "start", "resolve", "scheduled", "normal", "cleanup"] as const) {
    it(`retires its real default resolver after ${stage} while the pipeline borrows it`, async () => {
      const directory = await mkdtemp(join(tmpdir(), "gift-preview-owner-"));
      const failure = new Error(`synthetic ${stage} owner failure`);
      const attempts: string[] = [];
      const media = Buffer.from("000000186674797069736f6d0000000069736f6d", "hex");
      const bytes = zipFixture([
        { name: "config.json", body: Buffer.from(JSON.stringify({ portrait: {
          path: "output.mp4", videoW: 960, videoH: 864, w: 480, h: 854,
          rgbFrame: [0, 0, 480, 854], aFrame: [480, 0, 480, 854], f: 75,
        } })) },
        { name: "output.mp4", body: media, method: 8 },
      ]);
      const resolver = createTikTokGiftAnimationResolver({
        cacheDirectory: directory, logger: { debug() {}, warn() {}, error() {} },
        downloadArchive: async (_url, output) => {
          if (stage === "resolve") throw failure;
          await writeFile(output, bytes, { flag: "wx" });
          return { bytes: bytes.length };
        },
      });
      const nativeDispose = resolver.dispose.bind(resolver);
      resolver.dispose = () => {
        attempts.push("resolver");
        return nativeDispose().then(() => {
          if (stage === "start" || stage === "cleanup") throw new Error("synthetic resolver cleanup failure");
        });
      };
      let mediaPath = "";
      let emits = 0;
      try {
        const run = runGuiGiftAnimationPreview({
          logger: { warn() {}, error() { throw new Error("synthetic reporting failure"); } },
          createGiftAnimationResolverImpl: () => resolver,
          createPreviewPipelineImpl: (args) => {
            expect(args.giftAnimationResolver).toBe(resolver);
            if (stage === "pipeline") throw failure;
            return {
              eventBus: { emit(_event, payload) {
                mediaPath = (payload as { mediaFilePath: string }).mediaFilePath;
                if (++emits === 2 && stage === "scheduled") throw failure;
              } },
              emitIngestEvent() {},
              dispose() { attempts.push("pipeline"); throw new Error("synthetic pipeline cleanup failure"); },
            };
          },
          createGuiTransportServiceImpl: () => ({
            async start() { if (stage === "start") throw failure; },
            async stop() { attempts.push("transport"); throw new Error("synthetic transport cleanup failure"); },
          }),
          giftEvent: { adapter: "tiktok", rawEvent: { data: { asset: { videoResourceList: [
            { videoTypeName: "h264", videoUrl: { urlList: ["https://cdn.synthetic.invalid/preview.zip"] } },
          ] } } } },
          safeSetTimeoutImpl(callback) { callback(); return {}; },
          clearTimeoutImpl() {}, stdout: { write() {} },
        });
        if (stage === "normal" || stage === "cleanup") await run;
        else if (stage === "resolve") await expect(run).rejects.toThrow("failed to resolve animation payload");
        else await expect(run).rejects.toBe(failure);
        expect(attempts).toEqual(stage === "pipeline" ? ["resolver"] : ["transport", "pipeline", "resolver"]);
        expect(await resolver.resolveFromNotificationData({ enhancedGiftData: { originalData: { asset: {
          videoResourceList: [{ videoTypeName: "h264", videoUrl: { urlList: ["https://cdn.synthetic.invalid/preview.zip"] } }],
        } } } })).toBeNull();
        if (mediaPath) expect(await readFile(mediaPath)).toEqual(media);
        else expect(await readdir(directory)).toEqual([]);
      } finally {
        await nativeDispose();
        await rm(directory, { recursive: true, force: true });
      }
    });
  }

  it("never disposes a borrowed resolver, including when other cleanup owners fail", async () => {
    let disposed = false;
    const attempts: string[] = [];
    const failure = new Error("synthetic borrowed preview start failure");
    await expect(runGuiGiftAnimationPreview({
      logger: { warn() {}, error() {} },
      giftAnimationResolver: {
        async resolveFromNotificationData() { return null; },
        dispose() { disposed = true; throw new Error("Borrowed resolver must not be disposed"); },
      },
      createPreviewPipelineImpl: () => ({
        eventBus: { emit() {} }, emitIngestEvent() {},
        dispose() { attempts.push("pipeline"); throw new Error("synthetic cleanup failure"); },
      }),
      createGuiTransportServiceImpl: () => ({
        async start() { throw failure; },
        async stop() { attempts.push("transport"); throw new Error("synthetic cleanup failure"); },
      }),
    })).rejects.toBe(failure);
    expect(attempts).toEqual(["transport", "pipeline"]);
    expect(disposed).toBe(false);
  });

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
