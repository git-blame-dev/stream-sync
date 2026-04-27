import { describe, expect, it } from "bun:test";

import {
  DEFAULT_DURATION_MS,
  buildGiftAnimationPreviewEvent,
  runGuiGiftAnimationPreview,
} from "../../../scripts/local/gui-gift-animation-preview.ts";

type UnknownRecord = Record<string, unknown>;
type PreviewPipelineArgs = {
  giftAnimationResolver: {
    resolveFromNotificationData: (...args: unknown[]) => unknown;
  };
  delay: (...args: unknown[]) => unknown;
};

describe("GUI gift animation preview command behavior", () => {
  it("builds the isolated Corgi gift preview event", () => {
    const event = buildGiftAnimationPreviewEvent();

    expect(event).toBeDefined();
    expect(event.adapter).toBe("tiktok");
    expect(event.rawEvent.eventType).toBe("GIFT");
    expect(event.rawEvent.data.giftName).toBe("Corgi");
  });

  it("runs isolated gift animation preview and disposes resources", async () => {
    let started = false;
    let stopped = false;
    let disposed = false;
    const writes: string[] = [];
    const scheduledDurations: number[] = [];
    const clearedHandles: number[] = [];
    const createdPipelineArgs: PreviewPipelineArgs[] = [];
    const emittedEvents: Array<{ eventName: string; payload: UnknownRecord }> =
      [];

    const fakeEventBus = {
      subscribe() {
        return () => {};
      },
      emit(eventName: string, payload: UnknownRecord) {
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
      createPreviewPipelineImpl: (args: PreviewPipelineArgs) => {
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
        if (duration === 4) {
          resolve();
        }
        return duration;
      },
      clearTimeoutImpl: (handle: number) => {
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
    expect(
      typeof createdPipelineArgs[0].giftAnimationResolver
        .resolveFromNotificationData,
    ).toBe("function");
    expect(typeof createdPipelineArgs[0].delay).toBe("function");
    expect(scheduledDurations).toContain(750);
    expect(scheduledDurations).toContain(2250);
    expect(scheduledDurations).toContain(4);
    expect(clearedHandles).toContain(750);
    expect(clearedHandles).toContain(2250);
    expect(emittedEvents.length).toBeGreaterThan(0);
    expect(emittedEvents[0].eventName).toBe("display:gift-animation");
    expect(emittedEvents[0].payload.platform).toBe("tiktok");
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
    let capturedDuration: number | null = null;

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
        capturedDuration = duration;
        resolve();
      },
      stdout: {
        write() {},
      },
    });

    expect(capturedDuration).toBe(DEFAULT_DURATION_MS);
  });
});
