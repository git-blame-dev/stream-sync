import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { safeSetTimeout } from "../../../src/utils/timeout-validator";
import { PlatformEvents } from "../../../src/interfaces/PlatformEvents";
import { PRIORITY_LEVELS } from "../../../src/core/constants";

import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import { EventEmitter } from "events";

type DisplayQueueDependencies = NonNullable<
  ConstructorParameters<typeof DisplayQueue>[4]
>;
type DisplayQueueObsManager = ConstructorParameters<typeof DisplayQueue>[0];
type VfxPayload = Record<string, unknown> & {
  correlationId: string;
  command?: string;
};
type TestEventBus = EventEmitter & {
  subscribe: (
    event: string,
    handler: (payload: Record<string, unknown>) => void,
  ) => () => void;
};

function createObsManager(): DisplayQueueObsManager {
  return {
    call: createMockFn<
      [requestType: string, payload: Record<string, unknown>],
      Promise<unknown>
    >(async () => ({})),
    isReady: createMockFn<[], Promise<boolean>>(async () => true),
  };
}

function createSourcesManager(
  recordedTexts: string[],
): NonNullable<DisplayQueueDependencies["sourcesManager"]> {
  return {
    updateTextSource: createMockFn<[string, string?], Promise<void>>(
      async (_source, text = "") => {
        recordedTexts.push(text);
      },
    ),
    clearTextSource: createMockFn<[string], Promise<void>>(async () => {}),
    updateChatMsgText: createMockFn<[string, string, string], Promise<void>>(
      async () => {},
    ),
    getSceneItemId: async () => ({ sceneItemId: 1 }),
    setSourceVisibility: createMockFn<
      [string, string, boolean],
      Promise<void>
    >(async () => {}),
    getGroupSceneItemId: async () => ({ sceneItemId: 1 }),
    setGroupSourceVisibility: async () => {},
    setPlatformLogoVisibility: async () => {},
    setNotificationPlatformLogoVisibility: async () => {},
    hideAllPlatformLogos: async () => {},
    hideAllNotificationPlatformLogos: async () => {},
    setChatDisplayVisibility: createMockFn<[boolean], Promise<void>>(
      async () => {},
    ),
    setNotificationDisplayVisibility: createMockFn<[boolean], Promise<void>>(
      async () => {},
    ),
    hideAllDisplays: createMockFn<[], Promise<void>>(async () => {}),
    setSourceFilterEnabled: createMockFn<
      [string, string, boolean],
      Promise<void>
    >(async () => {}),
    getSourceFilterSettings: createMockFn<
      [string, string],
      Promise<Record<string, unknown>>
    >(async () => ({})),
    setSourceFilterSettings: createMockFn<
      [string, string, Record<string, unknown>],
      Promise<void>
    >(async () => {}),
    clearSceneItemCache: createMockFn<[], void>(() => {}),
  };
}

function createGoalsManager(): NonNullable<
  DisplayQueueDependencies["goalsManager"]
> {
  return {
    processDonationGoal: createMockFn<
      [platform: unknown, amount: number],
      Promise<{ success: boolean }>
    >(async () => ({ success: true })),
    processPaypiggyGoal: createMockFn<
      [platform: string],
      Promise<{ success: boolean }>
    >(async () => ({ success: true })),
    initializeGoalDisplay: createMockFn<[], Promise<void>>(async () => {}),
    updateAllGoalDisplays: createMockFn<[], Promise<void>>(async () => {}),
    updateGoalDisplay: createMockFn<[string], Promise<void>>(async () => {}),
    getCurrentGoalStatus: () => null,
    getAllCurrentGoalStatuses: () => ({}),
  };
}

describe("DisplayQueue notification TTS staging", () => {
  let originalNodeEnv: string | undefined;

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
    const recordedTexts: string[] = [];
    const mockSourcesManager = createSourcesManager(recordedTexts);
    const obsManager = createObsManager();

    const eventBus: TestEventBus = Object.assign(new EventEmitter(), {
      subscribe(
        event: string,
        handler: (payload: Record<string, unknown>) => void,
      ) {
      eventBus.on(event, handler);
      return () => eventBus.off(event, handler);
      },
    });

    const mockGoalsManager = createGoalsManager();

    const queue = new DisplayQueue(
      obsManager,
      {
        ttsEnabled: true,
        chat: {},
        notification: {},
        obs: { ttsTxt: "testTts" },
        handcam: { enabled: false },
      },
      {
        PRIORITY_LEVELS,
        CHAT_MESSAGE_DURATION: 4500,
        CHAT_TRANSITION_DELAY: 200,
      },
      eventBus,
      {
        sourcesManager: mockSourcesManager,
        goalsManager: mockGoalsManager,
        delay: async () => {},
      },
    );

    queue.effects.playGiftVideoAndAudio = createMockFn().mockResolvedValue();

    return { queue, eventBus, mockSourcesManager, recordedTexts };
  }

  it("emits VFX and updates TTS for gift notifications", async () => {
    const { queue, eventBus } = createQueue();
    const capturedVfx: VfxPayload[] = [];

    eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload: VfxPayload) => {
      capturedVfx.push(payload);
      safeSetTimeout(
        () => {
          eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
            correlationId: payload.correlationId,
          });
        },
        1,
      );
    });

    await queue.effects.handleGiftEffects(
      {
        type: "platform:gift",
        platform: "tiktok",
        vfxConfig: {
          commandKey: "gifts",
          command: "!money",
          filename: "money.mp4",
          mediaSource: "VFX Top",
          vfxFilePath: "/tmp/vfx",
          duration: 5000,
        },
        data: {
          username: "test-gifter",
          userId: "test-gifter-id",
          displayMessage: "sent a rose",
          ttsMessage: "test-gifter sent a rose",
          giftType: "rose",
          giftCount: 2,
          amount: 20,
          currency: "coins",
        },
      },
      [],
    );

    expect(capturedVfx).toHaveLength(1);
    expect(capturedVfx[0]).toEqual(
      expect.objectContaining({
        commandKey: "gifts",
        username: "test-gifter",
        platform: "tiktok",
      }),
    );
  });

  it("waits for VFX completion before playing TTS for sequential notifications", async () => {
    const { queue, eventBus, recordedTexts } = createQueue();
    const capturedVfx: VfxPayload[] = [];

    eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload: VfxPayload) => {
      capturedVfx.push(payload);
      safeSetTimeout(
        () => {
          eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
            correlationId: payload.correlationId,
          });
        },
        1,
      );
    });

    await queue.effects.handleSequentialEffects(
      {
        type: "platform:follow",
        platform: "twitch",
        vfxConfig: {
          commandKey: "follows",
          command: "!follow",
          filename: "follow.mp4",
          mediaSource: "VFX Top",
          vfxFilePath: "/tmp/vfx",
          duration: 5000,
        },
        data: {
          username: "test-follower",
          userId: "test-follower-id",
          displayMessage: "just followed!",
          ttsMessage: "test-follower just followed",
        },
      },
      [{ type: "primary", text: "test-follower just followed", delay: 0 }],
    );

    expect(capturedVfx).toHaveLength(1);
    expect(recordedTexts).toContain("test-follower just followed");
  });

  it("skips VFX when no vfxConfig provided", async () => {
    const { queue, eventBus, recordedTexts } = createQueue();
    const capturedVfx: VfxPayload[] = [];

    eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload: VfxPayload) =>
      capturedVfx.push(payload),
    );

    await queue.effects.handleSequentialEffects(
      {
        type: "greeting",
        platform: "twitch",
        data: {
          username: "test-viewer",
          displayMessage: "Hello",
          ttsMessage: "Hello from test-viewer",
        },
      },
      [{ type: "primary", text: "Hello from test-viewer", delay: 0 }],
    );

    expect(capturedVfx).toHaveLength(0);
    expect(recordedTexts).toContain("Hello from test-viewer");
  });

  it("processes multiple TTS stages sequentially", async () => {
    const { queue, eventBus, recordedTexts } = createQueue();

    eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload: VfxPayload) => {
      safeSetTimeout(
        () => {
          eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
            correlationId: payload.correlationId,
          });
        },
        1,
      );
    });

    const ttsStages = [
      { type: "primary", text: "Stage one", delay: 0 },
      { type: "message", text: "Stage two", delay: 0 },
    ];

    await queue.effects.handleSequentialEffects(
      {
        type: "platform:paypiggy",
        platform: "youtube",
        vfxConfig: {
          commandKey: "paypiggies",
          command: "!member",
          filename: "member.mp4",
          mediaSource: "VFX Top",
          vfxFilePath: "/tmp/vfx",
          duration: 5000,
        },
        data: {
          username: "test-member",
          userId: "test-member-id",
          displayMessage: "joined membership",
        },
      },
      ttsStages,
    );

    expect(recordedTexts).toEqual(["Stage one", "Stage two"]);
  });

  it("continues TTS when VFX config is partial and buildVfxMatch throws", async () => {
    const { queue, recordedTexts } = createQueue();

    await queue.effects.handleSequentialEffects(
      {
        type: "platform:gift",
        platform: "tiktok",
        vfxConfig: { commandKey: "gifts" },
        data: {
          username: "test-gifter",
          userId: "test-gifter-id",
          displayMessage: "sent a gift",
          ttsMessage: "test-gifter sent a gift",
        },
      },
      [{ type: "primary", text: "test-gifter sent a gift", delay: 0 }],
    );

    expect(recordedTexts).toContain("test-gifter sent a gift");
  });

  it("runs greeting secondary VFX after greeting primary VFX and before TTS", async () => {
    const { queue, eventBus, recordedTexts } = createQueue();
    const emittedCommands: unknown[] = [];

    eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload: VfxPayload) => {
      emittedCommands.push(payload.command);
      safeSetTimeout(
        () => {
          eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
            correlationId: payload.correlationId,
          });
        },
        1,
      );
    });

    await queue.effects.handleSequentialEffects(
      {
        type: "greeting",
        platform: "twitch",
        vfxConfig: {
          commandKey: "greetings",
          command: "!hello",
          filename: "hello.mp4",
          mediaSource: "VFX Top",
          vfxFilePath: "/tmp/vfx",
          duration: 5000,
        },
        secondaryVfxConfig: {
          commandKey: "under-the-water",
          command: "!water",
          filename: "under-the-water.mp4",
          mediaSource: "VFX Bottom Green",
          vfxFilePath: "/tmp/vfx",
          duration: 5000,
        },
        data: {
          username: "test-viewer",
          userId: "test-viewer-id",
          displayMessage: "Hello",
          ttsMessage: "Hello from test-viewer",
        },
      },
      [{ type: "primary", text: "Hello from test-viewer", delay: 0 }],
    );

    expect(emittedCommands).toEqual(["!hello", "!water"]);
    expect(recordedTexts).toEqual(["Hello from test-viewer"]);
  });
});
