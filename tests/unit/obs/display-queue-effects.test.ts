import { describe, expect, it } from "bun:test";
import { EventEmitter } from "events";

import { DisplayQueueEffects } from "../../../src/obs/display-queue-effects.ts";
import { waitForDelay } from "../../helpers/time-utils";
import { PlatformEvents } from "../../../src/interfaces/PlatformEvents";

type EffectsDependencies = ConstructorParameters<typeof DisplayQueueEffects>[0];
type EffectQueueItem = Parameters<DisplayQueueEffects["handleGiftEffects"]>[0];
type GiftAnimationResult = Awaited<
  ReturnType<
    NonNullable<EffectsDependencies["giftAnimationResolver"]>["resolveFromNotificationData"]
  >
>;

type ObsCall = { method: string; payload: Record<string, unknown> };
type GoalCall = { platform: string; amount: number };
type EmittedEvent = { eventName: string; payload: Record<string, unknown> };
type NamedEmission = { event: string; payload: Record<string, unknown> };

class TestEventBus extends EventEmitter {
  subscribe(eventName: string, handler: (payload: Record<string, unknown>) => void) {
    this.on(eventName, handler);
    return () => this.off(eventName, handler);
  }

  override emit(eventName: string, payload: Record<string, unknown>) {
    return super.emit(eventName, payload);
  }
}

const handcamConfig = (enabled: boolean): NonNullable<EffectsDependencies["config"]["handcam"]> => ({
  enabled,
  maxSize: 0,
  rampUpDuration: 0,
  holdDuration: 0,
  rampDownDuration: 0,
  totalSteps: 1,
  easingEnabled: false,
  sourceName: "handcam",
  glowFilterName: "glow",
});

const extractUsername: EffectsDependencies["extractUsername"] = (data) =>
  typeof data?.username === "string" ? data.username : null;

const requireResolver = (
  resolve: ((value: GiftAnimationResult) => void) | undefined,
): ((value: GiftAnimationResult) => void) => {
  if (!resolve) {
    throw new Error("Expected animation resolver to be captured");
  }
  return resolve;
};

describe("DisplayQueueEffects", () => {
  it("runs TTS stages for non-gift notifications", async () => {
    const ttsUpdates: string[] = [];
    const sourcesManager = {
      clearTextSource: async () => {},
      updateTextSource: async (_source: string, text: string) => {
        ttsUpdates.push(text);
      },
    };
    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: true,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(false),
      },
      sourcesManager,
      obsManager: { call: async () => ({}) },
      goalsManager: { processDonationGoal: async () => {} },
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername,
    });

    await effects.handleNotificationEffects({
      type: "platform:follow",
      platform: "tiktok",
      data: {
        username: "test-user",
        ttsMessage: "hello",
        isComment: true,
        message: "hi",
      },
    });

    expect(ttsUpdates[0]).toBe("hello");
    expect(ttsUpdates[1]).toContain("says");
  });

  it("plays gift media, triggers handcam glow, and tracks goals", async () => {
    const obsCalls: ObsCall[] = [];
    const goalCalls: GoalCall[] = [];
    let handcamTriggered = false;
    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: false,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(true),
        gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
      },
      sourcesManager: {
        clearTextSource: async () => {},
        updateTextSource: async () => {},
      },
      obsManager: {
        call: async (method: string, payload: Record<string, unknown>) => {
          obsCalls.push({ method, payload });
          return {};
        },
      },
      goalsManager: {
        processDonationGoal: async (platform: string, amount: number) => {
          goalCalls.push({ platform, amount });
        },
      },
      triggerHandcamGlow: () => {
        handcamTriggered = true;
      },
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername,
    });

    await effects.handleNotificationEffects({
      type: "platform:gift",
      platform: "tiktok",
      data: {
        username: "test-user",
        userId: "test-user-id",
        giftType: "rose",
        giftCount: 1,
        amount: 100,
        currency: "coins",
      },
    });

    expect(handcamTriggered).toBe(true);
    expect(goalCalls).toEqual([{ platform: "tiktok", amount: 100 }]);
    expect(obsCalls.length).toBe(2);
  });

  it("skips VFX and continues TTS when sequential VFX match build fails", async () => {
    const ttsUpdates: string[] = [];
    const emittedVfx: Record<string, unknown>[] = [];
    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: true,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(false),
      },
      sourcesManager: {
        clearTextSource: async () => {},
        updateTextSource: async (_source: string, text: string) => {
          ttsUpdates.push(text);
        },
      },
      obsManager: { call: async () => ({}) },
      goalsManager: { processDonationGoal: async () => {} },
      eventBus: { emit: (_event: string, payload: Record<string, unknown>) => emittedVfx.push(payload) },
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername,
    });

    const result = await effects.handleSequentialEffects(
      {
        type: "platform:follow",
        platform: "tiktok",
        vfxConfig: { commandKey: "test-cmd" },
        data: { username: "test-user", userId: "test-user-id" },
      },
      [{ type: "primary", text: "test-tts-text", delay: 0 }],
    );

    expect(result).toBeNull();
    expect(emittedVfx).toHaveLength(0);
    expect(ttsUpdates).toContain("test-tts-text");
  });

  it("continues gift effects when VFX config is partial", async () => {
    const ttsUpdates: string[] = [];
    const emittedVfx: NamedEmission[] = [];
    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: true,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(false),
        gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
      },
      sourcesManager: {
        clearTextSource: async () => {},
        updateTextSource: async (_source: string, text: string) => {
          ttsUpdates.push(text);
        },
      },
      obsManager: { call: async () => ({}) },
      goalsManager: { processDonationGoal: async () => {} },
      eventBus: {
        emit: (event: string, payload: Record<string, unknown>) => emittedVfx.push({ event, payload }),
      },
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername,
    });

    await effects.handleGiftEffects(
      {
        type: "platform:gift",
        platform: "tiktok",
        vfxConfig: { commandKey: "gifts" },
        data: { username: "test-user", userId: "test-user-id" },
      },
      [{ type: "primary", text: "test-gift-tts", delay: 0 }],
    );

    expect(ttsUpdates).toContain("test-gift-tts");
    expect(emittedVfx).toHaveLength(0);
  });

  it("emits tiktok gift animation effect and sets hold duration", async () => {
    const emittedEvents: EmittedEvent[] = [];
    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: false,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(false),
        gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
        gui: { enableOverlay: true, enableDock: false, showGifts: true },
      },
      sourcesManager: {
        clearTextSource: async () => {},
        updateTextSource: async () => {},
      },
      obsManager: { call: async () => ({}) },
      goalsManager: { processDonationGoal: async () => {} },
      eventBus: {
        emit: (eventName: string, payload: Record<string, unknown>) =>
          emittedEvents.push({ eventName, payload }),
      },
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername,
      giftAnimationResolver: {
        resolveFromNotificationData: async () => ({
          mediaFilePath: "/tmp/test-animation.mp4",
          mediaContentType: "video/mp4",
          durationMs: 4500,
          animationConfig: {
            profileName: "portrait",
            sourceWidth: 960,
            sourceHeight: 864,
            renderWidth: 480,
            renderHeight: 854,
            rgbFrame: [0, 0, 480, 854],
            aFrame: [480, 0, 480, 854],
          },
        }),
      },
    });

    const item: EffectQueueItem = {
      type: "platform:gift",
      platform: "tiktok",
      data: {
        username: "test-user",
        userId: "test-user-id",
        giftType: "Corgi",
        giftCount: 1,
        amount: 299,
        currency: "coins",
      },
    };

    await effects.handleGiftEffects(item, []);

    const animationEvent = emittedEvents.find(
      (entry) => entry.eventName === "display:gift-animation",
    );
    expect(animationEvent).toBeDefined();
    expect(animationEvent?.payload.durationMs).toBe(4500);
    expect(item.holdDurationMs).toBe(4500);
  });

  it("does not resolve animation for non-tiktok gifts", async () => {
    let resolveCallCount = 0;
    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: false,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(false),
        gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
        gui: { enableOverlay: true, enableDock: false, showGifts: true },
      },
      sourcesManager: {
        clearTextSource: async () => {},
        updateTextSource: async () => {},
      },
      obsManager: { call: async () => ({}) },
      goalsManager: { processDonationGoal: async () => {} },
      eventBus: { emit: () => {} },
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername,
      giftAnimationResolver: {
        resolveFromNotificationData: async () => {
          resolveCallCount += 1;
          return null;
        },
      },
    });

    await effects.handleGiftEffects(
      {
        type: "platform:gift",
        platform: "twitch",
        data: {
          username: "test-user",
          userId: "test-user-id",
          giftType: "Rose",
          giftCount: 1,
          amount: 1,
          currency: "coins",
        },
      },
      [],
    );

    expect(resolveCallCount).toBe(0);
  });

  it("does not resolve animation when gui gift animations are disabled", async () => {
    let resolveCallCount = 0;
    const emittedEvents: EmittedEvent[] = [];
    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: false,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(false),
        gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
        gui: { enableOverlay: false, enableDock: false, showGifts: true },
      },
      sourcesManager: {
        clearTextSource: async () => {},
        updateTextSource: async () => {},
      },
      obsManager: { call: async () => ({}) },
      goalsManager: { processDonationGoal: async () => {} },
      eventBus: {
        emit: (eventName: string, payload: Record<string, unknown>) =>
          emittedEvents.push({ eventName, payload }),
      },
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername,
      giftAnimationResolver: {
        resolveFromNotificationData: async () => {
          resolveCallCount += 1;
          return null;
        },
      },
    });

    await effects.handleGiftEffects(
      {
        type: "platform:gift",
        platform: "tiktok",
        data: {
          username: "test-user",
          userId: "test-user-id",
          giftType: "Rose",
          giftCount: 1,
          amount: 1,
          currency: "coins",
        },
      },
      [],
    );

    expect(resolveCallCount).toBe(0);
    expect(
      emittedEvents.find(
        (entry) => entry.eventName === "display:gift-animation",
      ),
    ).toBeUndefined();
  });

  it("starts gift media effects before animation resolution settles", async () => {
    const obsCalls: string[] = [];
    let resolveAnimation: ((value: GiftAnimationResult) => void) | undefined;
    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: false,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(false),
        gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
        gui: { enableOverlay: true, enableDock: false, showGifts: true },
      },
      sourcesManager: {
        clearTextSource: async () => {},
        updateTextSource: async () => {},
      },
      obsManager: {
        call: async (method: string) => {
          obsCalls.push(method);
          return {};
        },
      },
      goalsManager: { processDonationGoal: async () => {} },
      eventBus: { emit: () => {} },
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername,
      giftAnimationResolver: {
        resolveFromNotificationData: () =>
          new Promise<GiftAnimationResult>((resolve) => {
            resolveAnimation = resolve;
          }),
      },
    });

    const handlePromise = effects.handleGiftEffects(
      {
        type: "platform:gift",
        platform: "tiktok",
        data: {
          username: "test-user",
          userId: "test-user-id",
          giftType: "Corgi",
          giftCount: 1,
          amount: 299,
          currency: "coins",
        },
      },
      [],
    );

    await waitForDelay(1);

    expect(obsCalls).toContain("TriggerMediaInputAction");

    requireResolver(resolveAnimation)(null);
    await handlePromise;
  });

  it("does not finish gift effects before animation hold resolution completes", async () => {
    let resolveAnimation: ((value: GiftAnimationResult) => void) | undefined;
    let settled = false;
    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: false,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(false),
        gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
        gui: { enableOverlay: true, enableDock: false, showGifts: true },
      },
      sourcesManager: {
        clearTextSource: async () => {},
        updateTextSource: async () => {},
      },
      obsManager: { call: async () => ({}) },
      goalsManager: { processDonationGoal: async () => {} },
      eventBus: { emit: () => {} },
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername,
      giftAnimationResolver: {
        resolveFromNotificationData: () =>
          new Promise<GiftAnimationResult>((resolve) => {
            resolveAnimation = resolve;
          }),
      },
    });

    const item: EffectQueueItem = {
      type: "platform:gift",
      platform: "tiktok",
      data: {
        username: "test-user",
        userId: "test-user-id",
        giftType: "Corgi",
        giftCount: 1,
        amount: 299,
        currency: "coins",
      },
    };

    const handlePromise = effects.handleGiftEffects(item, []).then(() => {
      settled = true;
    });

    await waitForDelay(1);
    expect(settled).toBe(false);

    requireResolver(resolveAnimation)({
      mediaFilePath: "/tmp/test-animation.mp4",
      mediaContentType: "video/mp4",
      durationMs: 4200,
      animationConfig: {
        profileName: "portrait",
        sourceWidth: 960,
        sourceHeight: 864,
        renderWidth: 480,
        renderHeight: 854,
        rgbFrame: [0, 0, 480, 854],
        aFrame: [480, 0, 480, 854],
      },
    });

    await handlePromise;
    expect(item.holdDurationMs).toBe(4200);
  });

  it("waits for exact tuple completion when correlation id is absent", async () => {
    const eventBus = new TestEventBus();

    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: false,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(false),
      },
      sourcesManager: {
        clearTextSource: async () => {},
        updateTextSource: async () => {},
      },
      obsManager: { call: async () => ({}) },
      goalsManager: { processDonationGoal: async () => {} },
      eventBus,
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername: () => "test-user",
    });

    const pending = effects.waitForVfxCompletion(
      {
        commandKey: "test-key",
        command: "!test",
        filename: "test-file",
        mediaSource: "test-source",
      },
      { timeoutMs: 50 },
    );

    eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
      commandKey: "test-key",
      command: "!test",
      filename: "different-file",
      mediaSource: "test-source",
    });

    await waitForDelay(1);
    eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
      commandKey: "test-key",
      command: "!test",
      filename: "test-file",
      mediaSource: "test-source",
    });

    const result = await pending;
    expect(result.reason).toBe("completed");
    expect(result.payload?.filename).toBe("test-file");
  });

  it("does not treat command executed as completion signal", async () => {
    const eventBus = new TestEventBus();

    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: false,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(false),
      },
      sourcesManager: {
        clearTextSource: async () => {},
        updateTextSource: async () => {},
      },
      obsManager: { call: async () => ({}) },
      goalsManager: { processDonationGoal: async () => {} },
      eventBus,
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername: () => "test-user",
    });

    const pending = effects.waitForVfxCompletion(
      { correlationId: "test-correlation-id" },
      { timeoutMs: 50 },
    );
    eventBus.emit(PlatformEvents.VFX_COMMAND_EXECUTED, {
      correlationId: "test-correlation-id",
    });

    await waitForDelay(1);
    eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
      correlationId: "test-correlation-id",
    });

    const result = await pending;
    expect(result.reason).toBe("completed");
  });

  it("cleans up gift completion listeners when VFX emit fails", async () => {
    const eventBus = new TestEventBus();

    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: false,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(false),
        gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
      },
      sourcesManager: {
        clearTextSource: async () => {},
        updateTextSource: async () => {},
      },
      obsManager: { call: async () => ({}) },
      goalsManager: { processDonationGoal: async () => {} },
      eventBus,
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername,
    });

    await effects.handleGiftEffects(
      {
        type: "platform:gift",
        platform: "tiktok",
        vfxConfig: {
          commandKey: "gifts",
          command: "!gift",
          filename: "gift.mp4",
          mediaSource: "vfx",
          vfxFilePath: "/tmp/vfx",
        },
        data: { username: "test-user" },
      },
      [],
    );

    expect(eventBus.listenerCount(PlatformEvents.VFX_EFFECT_COMPLETED)).toBe(0);
  });

  it("holds gift effect completion until matching VFX completion event", async () => {
    const eventBus = new TestEventBus();

    let capturedCorrelationId: string | null = null;
    eventBus.on(PlatformEvents.VFX_COMMAND_RECEIVED, (payload: Record<string, unknown>) => {
      if (typeof payload.correlationId !== "string") {
        throw new Error("Expected VFX command payload to include correlationId");
      }
      capturedCorrelationId = payload.correlationId;
    });

    const effects = new DisplayQueueEffects({
      config: {
        ttsEnabled: false,
        obs: { ttsTxt: "tts" },
        handcam: handcamConfig(false),
        gifts: { giftVideoSource: "gift-video", giftAudioSource: "gift-audio" },
      },
      sourcesManager: {
        clearTextSource: async () => {},
        updateTextSource: async () => {},
      },
      obsManager: { call: async () => ({}) },
      goalsManager: { processDonationGoal: async () => {} },
      eventBus,
      delay: async () => {},
      handleDisplayQueueError: () => {},
      extractUsername,
    });

    let settled = false;
    const pending = effects
      .handleGiftEffects(
        {
          type: "platform:gift",
          platform: "tiktok",
          vfxConfig: {
            commandKey: "gifts",
            command: "!gift",
            filename: "gift.mp4",
            mediaSource: "vfx",
            vfxFilePath: "/tmp/vfx",
          },
          data: { username: "test-user", userId: "test-user-id" },
        },
        [],
      )
      .then(() => {
        settled = true;
      });

    await waitForDelay(1);
    expect(settled).toBe(false);
    expect(typeof capturedCorrelationId).toBe("string");

    eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
      correlationId: capturedCorrelationId,
    });
    await pending;
    expect(settled).toBe(true);
  });
});
