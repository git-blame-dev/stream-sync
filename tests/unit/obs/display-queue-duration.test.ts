import { describe, expect, afterEach, it, beforeEach } from "bun:test";
import { restoreAllMocks } from "../../helpers/bun-mock-utils";
import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import { EventEmitter } from "events";
import { PRIORITY_LEVELS } from "../../../src/core/constants";

describe("DisplayQueue TTS-driven durations", () => {
  let originalNodeEnv: string | undefined;

  type QueueItem = Parameters<DisplayQueue["getDuration"]>[0];
  type DisplayQueueObsManager = ConstructorParameters<typeof DisplayQueue>[0];

  const createObsManager = (): DisplayQueueObsManager => ({
    isReady: () => Promise.resolve(true),
    call: () => Promise.resolve({}),
  });

  const createQueueItem = (item: {
    type: string;
    data: Record<string, unknown>;
    platform?: string;
    holdDurationMs?: number;
  }): QueueItem => ({
    type: item.type,
    data: item.data,
    platform: item.platform ?? "twitch",
    ...(item.holdDurationMs === undefined ? {} : { holdDurationMs: item.holdDurationMs }),
  });

  const getDurationAtRuntimeBoundary = (queue: DisplayQueue, item: unknown): number =>
    Reflect.apply(queue.getDuration, queue, [item]) as number;

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = "test";
  });

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = originalNodeEnv;
    }
    restoreAllMocks();
  });

  function createQueue() {
    return new DisplayQueue(
      createObsManager(),
      { ttsEnabled: true },
      {
        CHAT_MESSAGE_DURATION: 4500,
        CHAT_TRANSITION_DELAY: 0,
        PRIORITY_LEVELS,
      },
      new EventEmitter(),
      {},
    );
  }

  it("returns minimum window for short TTS content", () => {
    const queue = createQueue();
    const item = createQueueItem({
      type: "platform:gift",
      data: { ttsMessage: "Hi" },
    });

    const duration = queue.getDuration(item);

    expect(duration).toBe(2000);
  });

  it("sizes window based on TTS word count and stage delays", () => {
    const queue = createQueue();
    const item = createQueueItem({
      type: "platform:paypiggy",
      data: {
        ttsMessage: "Thank you for the membership",
        message: "This is a custom message from the user",
        username: "testUser",
      },
    });

    const duration = queue.getDuration(item);

    expect(duration).toBeGreaterThan(2000);
    expect(duration).toBeLessThanOrEqual(20000);
  });

  it("caps extremely long TTS at maximum window", () => {
    const queue = createQueue();
    const longText = Array(120).fill("word").join(" ");
    const item = createQueueItem({
      type: "platform:gift",
      data: { ttsMessage: longText },
    });

    const duration = queue.getDuration(item);

    expect(duration).toBe(20000);
  });

  it("returns zero when no TTS content exists", () => {
    const queue = createQueue();
    const item = createQueueItem({
      type: "platform:follow",
      data: {},
    });

    const duration = queue.getDuration(item);

    expect(duration).toBe(0);
  });

  it("returns zero for null or missing data", () => {
    const queue = createQueue();

    const malformedItems = [
      createQueueItem({ type: "platform:gift", data: {} }),
      { type: "platform:gift" },
      { type: "platform:gift", data: null },
    ];

    for (const item of malformedItems) {
      expect(getDurationAtRuntimeBoundary(queue, item)).toBe(0);
    }
  });

  it("uses hold duration only when tts is disabled", () => {
    const queue = new DisplayQueue(
      createObsManager(),
      { ttsEnabled: false },
      {
        CHAT_MESSAGE_DURATION: 4500,
        CHAT_TRANSITION_DELAY: 0,
        PRIORITY_LEVELS,
      },
      new EventEmitter(),
      {},
    );

    const duration = queue.getDuration(createQueueItem({
      type: "platform:gift",
      data: { ttsMessage: "hello" },
    }));
    expect(duration).toBe(0);
  });

  it("keeps explicit hold duration when tts is disabled", () => {
    const queue = new DisplayQueue(
      createObsManager(),
      { ttsEnabled: false },
      {
        CHAT_MESSAGE_DURATION: 4500,
        CHAT_TRANSITION_DELAY: 0,
        PRIORITY_LEVELS,
      },
      new EventEmitter(),
      {},
    );

    const duration = queue.getDuration(createQueueItem({
      type: "platform:gift",
      holdDurationMs: 4200,
      data: { ttsMessage: "hello" },
    }));
    expect(duration).toBe(4200);
  });

  it("uses max of tts window and hold duration", () => {
    const queue = createQueue();
    const duration = queue.getDuration(createQueueItem({
      type: "platform:gift",
      holdDurationMs: 9000,
      data: { ttsMessage: "hello world" },
    }));

    expect(duration).toBe(9000);
  });
});
