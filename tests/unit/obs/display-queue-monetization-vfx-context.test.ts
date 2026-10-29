import { describe, expect, beforeEach, it, afterEach } from "bun:test";
import { createMockFn, restoreAllMocks } from "../../helpers/bun-mock-utils";
import { safeSetTimeout } from "../../../src/utils/timeout-validator";
import { EventEmitter } from "events";
import { DisplayQueue } from "../../../src/obs/display-queue.ts";
import * as constants from "../../../src/core/constants";
import { PlatformEvents } from "../../../src/interfaces/PlatformEvents";

type DisplayQueueDependencies = NonNullable<
  ConstructorParameters<typeof DisplayQueue>[4]
>;
type DisplayQueueObsManager = ConstructorParameters<typeof DisplayQueue>[0];
type DisplayQueueEventBus = ConstructorParameters<typeof DisplayQueue>[3];
type VfxPayload = Record<string, unknown> & {
  correlationId: string;
  context?: Record<string, unknown>;
};

function createObsManager(): DisplayQueueObsManager {
  return {
    isReady: createMockFn<[], Promise<boolean>>(async () => true),
    call: createMockFn<
      [requestType: string, payload: Record<string, unknown>],
      Promise<unknown>
    >(async () => ({ success: true })),
  };
}

function createSourcesManager(): NonNullable<
  DisplayQueueDependencies["sourcesManager"]
> {
  return {
    updateTextSource: createMockFn<[string, string?], Promise<void>>(
      async () => {},
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

describe("DisplayQueue monetization VFX context", () => {
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

  function createQueue(
    eventBus: DisplayQueueEventBus,
    delay: NonNullable<DisplayQueueDependencies["delay"]> = async () => {},
  ): DisplayQueue {
    const obsManager = createObsManager();

    const baseConfig = {
      autoProcess: false,
      maxQueueSize: 100,
      chat: {
        sourceName: "chat",
        sceneName: "scene",
        groupName: "group",
        platformLogos: {},
      },
      notification: {
        sourceName: "notification",
        sceneName: "scene",
        groupName: "group",
        platformLogos: {},
      },
      timing: {
        transitionDelay: 200,
        notificationClearDelay: 500,
        chatMessageDuration: 4500,
      },
      handcam: { enabled: false },
      gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
      obs: {},
      youtube: {},
      twitch: {},
      tiktok: {},
      ttsChatEnabled: false,
      ttsNotificationsEnabled: false,
    };

    const mockDependencies: DisplayQueueDependencies = {
      sourcesManager: createSourcesManager(),
      goalsManager: createGoalsManager(),
      delay,
    };

    const queue = new DisplayQueue(
      obsManager,
      baseConfig,
      constants,
      eventBus,
      mockDependencies,
    );
    queue.effects.playGiftVideoAndAudio = createMockFn().mockResolvedValue();

    return queue;
  }

  it("emits VFX_COMMAND_RECEIVED for gift notifications", async () => {
    const eventBus = new EventEmitter();
    const capturedVfx: VfxPayload[] = [];
    const queue = createQueue(eventBus);

    const item = {
      type: "platform:gift",
      platform: "youtube",
      vfxConfig: {
        commandKey: "gifts",
        command: "!gift",
        filename: "gift.mp4",
        mediaSource: "vfx top",
        vfxFilePath: "/tmp/vfx",
        duration: 5000,
      },
      data: {
        username: "test-gift-user",
        userId: "test-user-id-123",
        displayMessage: "sent a gift",
      },
    };

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

    await queue.effects.handleGiftEffects(item, []);

    expect(capturedVfx).toHaveLength(1);
    expect(PlatformEvents.validateEvent(capturedVfx[0])).toBe(true);
    expect(capturedVfx[0]).toEqual(
      expect.objectContaining({
        commandKey: "gifts",
        username: "test-gift-user",
        userId: "test-user-id-123",
        platform: "youtube",
      }),
    );
  });

  it("starts gift media, waits two seconds, then emits VFX on every platform", async () => {
    for (const platform of ["youtube", "twitch", "tiktok"]) {
      const eventBus = new EventEmitter();
      const timeline: string[] = [];
      let releaseDelay: (() => void) | undefined;
      let markDelayStarted: (() => void) | undefined;
      const delayStarted = new Promise<void>((resolve) => {
        markDelayStarted = resolve;
      });
      const queue = createQueue(eventBus, async (milliseconds) => {
        timeline.push(`delay:${milliseconds}`);
        markDelayStarted?.();
        await new Promise<void>((resolve) => {
          releaseDelay = resolve;
        });
      });
      queue.effects.playGiftVideoAndAudio = createMockFn(async () => {
        timeline.push("media");
        return true;
      });
      eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload: VfxPayload) => {
        timeline.push("vfx");
        eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
          correlationId: payload.correlationId,
        });
      });

      const effectsPromise = queue.effects.handleGiftEffects(
        {
          type: "platform:gift",
          platform,
          vfxConfig: {
            commandKey: "gifts",
            command: "!gift",
            filename: "gift.mp4",
            mediaSource: "vfx top",
            vfxFilePath: "/tmp/vfx",
            duration: 5000,
          },
          data: {
            username: `test-${platform}-gift-user`,
            displayMessage: "sent a gift",
          },
        },
        [],
      );

      await delayStarted;
      expect(timeline).toEqual(["media", "delay:2000"]);
      if (!releaseDelay) {
        throw new Error("Expected the gift VFX delay to be pending");
      }
      releaseDelay();
      await effectsPromise;

      expect(timeline).toEqual(["media", "delay:2000", "vfx"]);
    }
  });

  it("emits one anonymous YouTube gift VFX request with the display-queue context", async () => {
    const eventBus = new EventEmitter();
    const capturedVfx: VfxPayload[] = [];
    const queue = createQueue(eventBus);
    const item = {
      type: "platform:gift",
      platform: "youtube",
      vfxConfig: {
        commandKey: "test-gifts",
        command: "!test-gift",
        filename: "test-gift.mp4",
        mediaSource: "test-vfx",
        vfxFilePath: "/tmp/test-vfx",
        duration: 2000,
      },
      data: { username: "test-youtube-gifter", displayMessage: "sent a gift" },
    };

    eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload: VfxPayload) => {
      capturedVfx.push(payload);
      safeSetTimeout(() => {
        eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
          correlationId: payload.correlationId,
        });
      }, 1);
    });

    await queue.effects.handleGiftEffects(item, []);

    expect(capturedVfx).toHaveLength(1);
    const payload = capturedVfx[0];
    expect(payload).toBeDefined();
    if (!payload) throw new Error("Expected one VFX payload to be emitted");
    expect(payload).not.toHaveProperty("userId");
    expect(payload.context).toEqual({
      source: "display-queue",
      notificationType: "platform:gift",
      delayApplied: 2000,
      skipCooldown: true,
      correlationId: payload.correlationId,
    });
    expect(payload.delayApplied).toBe(2000);
  });

  it("emits VFX_COMMAND_RECEIVED for sequential notifications", async () => {
    const eventBus = new EventEmitter();
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

    const queue = createQueue(eventBus);

    const item = {
      type: "platform:follow",
      platform: "twitch",
      vfxConfig: {
        commandKey: "follows",
        command: "!follow",
        filename: "follow.mp4",
        mediaSource: "vfx top",
        vfxFilePath: "/tmp/vfx",
        duration: 5000,
      },
      data: {
        username: "test-follow-user",
        userId: "test-follow-id",
        displayMessage: "followed",
      },
    };

    await queue.effects.handleSequentialEffects(item, []);

    expect(capturedVfx).toHaveLength(1);
    expect(capturedVfx[0]).toEqual(
      expect.objectContaining({
        commandKey: "follows",
        username: "test-follow-user",
        platform: "twitch",
        userId: "test-follow-id",
      }),
    );
  });

  it("includes context with source and notificationType in VFX payload", async () => {
    const eventBus = new EventEmitter();
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

    const queue = createQueue(eventBus);

    const item = {
      type: "platform:paypiggy",
      platform: "tiktok",
      vfxConfig: {
        commandKey: "paypiggies",
        command: "!member",
        filename: "member.mp4",
        mediaSource: "vfx top",
        vfxFilePath: "/tmp/vfx",
        duration: 5000,
      },
      data: {
        username: "test-member",
        userId: "test-member-id",
        displayMessage: "joined",
      },
    };

    await queue.effects.handleSequentialEffects(item, []);

    expect(capturedVfx).toHaveLength(1);
    const emittedVfx = capturedVfx[0];
    expect(emittedVfx).toBeDefined();
    if (!emittedVfx) {
      throw new Error("Expected one VFX payload to be emitted");
    }
    expect(emittedVfx.context).toEqual(
      expect.objectContaining({
        source: "display-queue",
        notificationType: "platform:paypiggy",
      }),
    );
  });

  it("skips VFX emit when no vfxConfig provided", async () => {
    const eventBus = new EventEmitter();
    const capturedVfx: VfxPayload[] = [];
    eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload: VfxPayload) =>
      capturedVfx.push(payload),
    );
    const queue = createQueue(eventBus);

    const item = {
      type: "platform:follow",
      platform: "youtube",
      data: {
        username: "test-user",
        userId: "test-id",
        displayMessage: "subscribed",
      },
    };

    await queue.effects.handleSequentialEffects(item, []);

    expect(capturedVfx).toHaveLength(0);
  });
});
