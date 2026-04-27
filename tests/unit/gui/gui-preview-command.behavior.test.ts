import { describe, expect, it } from "bun:test";
import * as previewModule from "../../../scripts/local/gui-preview.ts";
import { waitForDelay } from "../../helpers/time-utils";

type UnknownRecord = Record<string, any>;

type PreviewAdapter = "twitch" | "youtube" | "tiktok";

type ScenarioEvent = {
  platform: PreviewAdapter;
  adapter: PreviewAdapter;
  rawEvent: UnknownRecord;
};

type PreviewPipeline = {
  eventBus: {
    emit: (eventName: string, payload?: UnknownRecord) => void;
    subscribe: (
      eventName: string,
      handler: (payload: UnknownRecord) => void,
    ) => () => void;
  };
  emitIngestEvent: (event: UnknownRecord) => void;
  dispose: () => Promise<void>;
};

type PreviewIngestAdapters = Record<
  PreviewAdapter,
  { ingest: (rawEvent: UnknownRecord) => Promise<void> }
>;

type PreviewModule = {
  PREVIEW_DURATION_MS: number;
  PREVIEW_INTERVAL_MS: number;
  PREVIEW_MEDIA_CATALOG: UnknownRecord;
  buildPreviewConfig: (baseConfig?: UnknownRecord) => UnknownRecord;
  buildPreviewScenarioEvents: (
    durationMs?: number,
    intervalMs?: number,
  ) => ScenarioEvent[];
  createPreviewPipeline: (options?: UnknownRecord) => PreviewPipeline;
  createPreviewIngestAdapters: (options: {
    config?: UnknownRecord;
    logger?: UnknownRecord;
    emitPlatformEvent: (event: UnknownRecord) => void;
    [key: string]: unknown;
  }) => PreviewIngestAdapters;
  runPreviewScenario: (options: {
    adapters: PreviewIngestAdapters;
    scenarioEvents: ScenarioEvent[];
    intervalMs: number;
    durationMs: number;
    safeSetIntervalImpl: (
      callback: () => void,
      durationMs: number,
    ) => number | ReturnType<typeof setInterval>;
    safeSetTimeoutImpl: (resolve: () => void, durationMs: number) => unknown;
    errorHandler: {
      handleEventProcessingError: (
        error: unknown,
        context: string,
        payload: unknown,
        message: string,
      ) => void;
    };
  }) => Promise<number | ReturnType<typeof setInterval>>;
  runGuiPreview: (options?: {
    logger?: UnknownRecord;
    baseConfig?: UnknownRecord;
    durationMs?: number;
    intervalMs?: number;
    eventBus?: PreviewPipeline["eventBus"];
    createPreviewPipelineImpl?: (args: UnknownRecord) => PreviewPipeline;
    createGuiTransportServiceImpl?: (args: UnknownRecord) => {
      start: () => Promise<void>;
      stop: () => Promise<void>;
    };
    safeSetIntervalImpl?: (
      callback: () => void,
      durationMs: number,
    ) => number | ReturnType<typeof setInterval>;
    safeSetTimeoutImpl?: (resolve: () => void, durationMs: number) => unknown;
    giftAnimationResolver?: UnknownRecord;
    delay?: (ms: number) => Promise<unknown>;
    stdout?: {
      write: (text: string) => void;
    };
    [key: string]: unknown;
  }) => Promise<void>;
};

const {
  PREVIEW_DURATION_MS,
  PREVIEW_INTERVAL_MS,
  PREVIEW_MEDIA_CATALOG,
  buildPreviewConfig,
  buildPreviewScenarioEvents,
  createPreviewPipeline,
  createPreviewIngestAdapters,
  runPreviewScenario,
  runGuiPreview,
} = previewModule as PreviewModule;

describe("GUI local preview command behavior", () => {
  it("uses 32s duration and 2s message cadence constants", () => {
    expect(PREVIEW_DURATION_MS).toBe(32000);
    expect(PREVIEW_INTERVAL_MS).toBe(2000);
  });

  it("builds deterministic ingest events for the full preview window", () => {
    const events = buildPreviewScenarioEvents();

    expect(events.length).toBe(16);
    expect(events[0]).toEqual(
      expect.objectContaining({
        platform: "twitch",
      }),
    );
    expect(events[1]).toEqual(
      expect.objectContaining({
        platform: "tiktok",
      }),
    );
    expect(events[2]).toEqual(
      expect.objectContaining({
        platform: "youtube",
      }),
    );
    expect(events[0].adapter).toBe("twitch");
    expect(events[1].adapter).toBe("tiktok");
    expect(events[2].adapter).toBe("youtube");
    expect(events[0].rawEvent).toBeDefined();
  });

  it("inserts youtube member hi chat immediately after raid notification", () => {
    const events = buildPreviewScenarioEvents();
    const raidIndex = events.findIndex(
      (event) =>
        event.adapter === "twitch" &&
        event.rawEvent?.subscriptionType === "channel.raid",
    );

    expect(raidIndex).toBeGreaterThan(-1);

    const memberHiEvent = events[raidIndex + 1];
    expect(memberHiEvent.adapter).toBe("youtube");
    expect(memberHiEvent.rawEvent.eventType).toBe("LiveChatTextMessage");
    expect(memberHiEvent.rawEvent.chatItem.testData.message).toBe("Hi!");
    expect(memberHiEvent.rawEvent.chatItem.testData.isPaypiggy).toBe(true);
  });

  it("builds scenario steps that include all adapter families", () => {
    const events = buildPreviewScenarioEvents(20000, 2000);
    const adapters = new Set(events.map((event) => event.adapter));

    expect(adapters.has("twitch")).toBe(true);
    expect(adapters.has("youtube")).toBe(true);
    expect(adapters.has("tiktok")).toBe(true);
  });

  it("injects deterministic media URLs into raw ingest payloads", () => {
    const events = buildPreviewScenarioEvents(20000, 2000);

    const twitchChat = events.find(
      (event) =>
        event.adapter === "twitch" &&
        event.rawEvent?.subscriptionType === "channel.chat.message" &&
        Array.isArray(event.rawEvent?.event?.message?.fragments) &&
        event.rawEvent.event.message.fragments.some(
          (fragment: UnknownRecord) => fragment.type === "emote",
        ),
    );
    const youtubeStep = events.find((event) => event.adapter === "youtube")!;
    const tiktokStep = events.find((event) => event.adapter === "tiktok")!;
    const requiredTwitchChat = twitchChat!;

    expect(
      requiredTwitchChat.rawEvent.event.message.fragments[0].emote.id,
    ).toContain(PREVIEW_MEDIA_CATALOG.twitch.emote.id);
    expect(youtubeStep.rawEvent.chatItem.testData.avatarUrl).toBe(
      PREVIEW_MEDIA_CATALOG.youtube.avatarUrl,
    );
    expect(tiktokStep.rawEvent.data.user.profilePictureUrl).toBe(
      PREVIEW_MEDIA_CATALOG.tiktok.avatarUrl,
    );
  });

  it("includes tiktok corgi gift payload with animation resources for preview", () => {
    const events = buildPreviewScenarioEvents(32000, 2000);
    const tiktokGiftStep = events.find(
      (event) =>
        event.adapter === "tiktok" && event.rawEvent?.eventType === "GIFT",
    )!;

    expect(tiktokGiftStep).toBeDefined();
    expect(events[1]?.rawEvent?.eventType).toBe("GIFT");
    expect(events[1]?.adapter).toBe("tiktok");
    expect(tiktokGiftStep.rawEvent.data.repeatCount).toBe(1);
    expect(tiktokGiftStep.rawEvent.data.giftName).toBe("Corgi");
    expect(tiktokGiftStep.rawEvent.data.gift.giftPictureUrl).toBe(
      PREVIEW_MEDIA_CATALOG.tiktok.gift.imageUrl,
    );
    expect(
      Array.isArray(tiktokGiftStep.rawEvent.data.asset.videoResourceList),
    ).toBe(true);
    expect(
      tiktokGiftStep.rawEvent.data.asset.videoResourceList.length,
    ).toBeGreaterThan(0);
  });

  it("uses explicit stable media catalog values without test-only URLs", () => {
    const events = buildPreviewScenarioEvents(20000, 2000);
    const serialized = JSON.stringify(events);

    expect(serialized.includes(PREVIEW_MEDIA_CATALOG.twitch.emote.id)).toBe(
      true,
    );
    expect(serialized.includes(PREVIEW_MEDIA_CATALOG.youtube.avatarUrl)).toBe(
      true,
    );
    expect(serialized.includes(PREVIEW_MEDIA_CATALOG.tiktok.avatarUrl)).toBe(
      true,
    );
    expect(serialized.includes(PREVIEW_MEDIA_CATALOG.youtube.emote.id)).toBe(
      true,
    );
    expect(serialized.includes(PREVIEW_MEDIA_CATALOG.tiktok.emote.id)).toBe(
      true,
    );
  });

  it("forces preview gate keys and gui toggles in preview config", () => {
    const config = buildPreviewConfig({
      gui: {
        enableDock: false,
        enableOverlay: false,
        host: "127.0.0.1",
        port: 3399,
      },
    });

    expect(config.gui.enableDock).toBe(true);
    expect(config.gui.enableOverlay).toBe(true);
    expect(config.gui.uiCompareMode).toBe(true);
    expect(config.gui.showMessages).toBe(true);
    expect(config.gui.showCommands).toBe(true);
    expect(config.gui.showGreetings).toBe(true);
    expect(config.gui.showFarewells).toBe(true);
    expect(config.gui.showFollows).toBe(true);
    expect(config.gui.showShares).toBe(true);
    expect(config.gui.showRaids).toBe(true);
    expect(config.gui.showGifts).toBe(true);
    expect(config.gui.showPaypiggies).toBe(true);
    expect(config.gui.showGiftPaypiggies).toBe(true);
    expect(config.gui.showEnvelopes).toBe(true);

    expect(config.twitch.messagesEnabled).toBe(true);
    expect(config.twitch.commandsEnabled).toBe(true);
    expect(config.twitch.greetingsEnabled).toBe(true);
    expect(config.twitch.farewellsEnabled).toBe(true);
    expect(config.twitch.followsEnabled).toBe(true);
    expect(config.twitch.giftsEnabled).toBe(true);
    expect(config.twitch.raidsEnabled).toBe(true);
    expect(config.twitch.sharesEnabled).toBe(true);
    expect(config.twitch.paypiggiesEnabled).toBe(true);

    expect(config.tiktok.messagesEnabled).toBe(true);
    expect(config.tiktok.commandsEnabled).toBe(true);
    expect(config.tiktok.greetingsEnabled).toBe(true);
    expect(config.tiktok.farewellsEnabled).toBe(true);
    expect(config.tiktok.followsEnabled).toBe(true);
    expect(config.tiktok.giftsEnabled).toBe(true);
    expect(config.tiktok.sharesEnabled).toBe(true);
    expect(config.tiktok.raidsEnabled).toBe(true);
    expect(config.tiktok.paypiggiesEnabled).toBe(true);

    expect(config.youtube.messagesEnabled).toBe(true);
    expect(config.youtube.commandsEnabled).toBe(true);
    expect(config.youtube.greetingsEnabled).toBe(true);
    expect(config.youtube.farewellsEnabled).toBe(true);
    expect(config.youtube.followsEnabled).toBe(true);
    expect(config.youtube.giftsEnabled).toBe(true);
    expect(config.youtube.raidsEnabled).toBe(true);
    expect(config.youtube.sharesEnabled).toBe(true);
    expect(config.youtube.paypiggiesEnabled).toBe(true);

    expect(typeof config.farewell.timeout).toBe("number");
    expect(typeof config.farewell.command).toBe("string");
    expect(config.commands.preview).toBeDefined();
    expect(config.cooldowns.cmdCooldown).toBe(0);
    expect(config.cooldowns.cmdCooldownMs).toBe(0);
    expect(config.cooldowns.globalCmdCooldown).toBe(0);
    expect(config.cooldowns.globalCmdCooldownMs).toBe(0);
    expect(config.cooldowns.heavyCommandCooldown).toBe(0);
    expect(config.cooldowns.heavyCommandCooldownMs).toBe(0);
  });

  it("runs preview via ingest pipeline and stops cleanly", async () => {
    const writes: string[] = [];
    const emittedEvents: UnknownRecord[] = [];
    let started = false;
    let stopped = false;
    let disposed = false;
    let intervalTick: null | (() => void) = null;
    const createdPipelineArgs: UnknownRecord[] = [];
    const createdTransportArgs: UnknownRecord[] = [];

    const fakeEventBus = {
      subscribe() {
        return () => {};
      },
      emit(eventName: string, payload?: UnknownRecord) {
        emittedEvents.push({ eventName, payload });
      },
    };

    const fakePipeline = {
      eventBus: fakeEventBus,
      emitIngestEvent(event: UnknownRecord) {
        fakeEventBus.emit("platform:event", event);
      },
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

    await runGuiPreview({
      baseConfig: {
        gui: {
          enableDock: false,
          enableOverlay: false,
          host: "127.0.0.1",
          port: 3399,
        },
      },
      durationMs: 4,
      intervalMs: 2,
      eventBus: fakeEventBus,
      createPreviewPipelineImpl: (args: UnknownRecord) => {
        createdPipelineArgs.push(args);
        return fakePipeline;
      },
      createGuiTransportServiceImpl: (args: UnknownRecord) => {
        createdTransportArgs.push(args);
        return fakeService;
      },
      safeSetIntervalImpl: (callback: () => void) => {
        intervalTick = callback;
        return 1;
      },
      safeSetTimeoutImpl: (resolve: () => void, duration: number) => {
        expect(duration).toBe(4);
        intervalTick?.();
        intervalTick?.();
        resolve();
      },
      stdout: {
        write: (text: string) => writes.push(text),
      },
    });

    expect(started).toBe(true);
    expect(stopped).toBe(true);
    expect(disposed).toBe(true);
    expect(createdPipelineArgs.length).toBe(1);
    expect(createdTransportArgs.length).toBe(1);
    expect(typeof createdPipelineArgs[0].delay).toBe("function");
    expect(createdPipelineArgs[0].giftAnimationResolver).toBeDefined();
    expect(
      typeof createdPipelineArgs[0].giftAnimationResolver
        .resolveFromNotificationData,
    ).toBe("function");
    expect(createdTransportArgs[0].eventBus).toBe(fakeEventBus);
    expect(emittedEvents.length).toBeGreaterThanOrEqual(1);
    expect(emittedEvents[0].eventName).toBe("platform:event");
    expect(
      emittedEvents.some((entry) => entry.eventName === "display:row"),
    ).toBe(false);
    expect(writes.some((line) => line.includes("Dock URL"))).toBe(true);
    expect(writes.some((line) => line.includes("TikTok Animation URL"))).toBe(
      true,
    );
    expect(writes.some((line) => line.includes("GUI preview finished"))).toBe(
      true,
    );
  });

  it("ingests all default scenario events and ends on envelope within preview duration", async () => {
    const scenarioEvents = buildPreviewScenarioEvents(32000, 2000);
    const ingested: UnknownRecord[] = [];
    let intervalTick: null | (() => void) = null;

    const adapters = {
      twitch: {
        async ingest(rawEvent: UnknownRecord) {
          ingested.push({ adapter: "twitch", rawEvent });
        },
      },
      youtube: {
        async ingest(rawEvent: UnknownRecord) {
          ingested.push({ adapter: "youtube", rawEvent });
        },
      },
      tiktok: {
        async ingest(rawEvent: UnknownRecord) {
          ingested.push({ adapter: "tiktok", rawEvent });
        },
      },
    };

    await runPreviewScenario({
      adapters,
      scenarioEvents,
      intervalMs: 2000,
      durationMs: 32000,
      safeSetIntervalImpl: (callback: () => void) => {
        intervalTick = callback;
        return 1;
      },
      safeSetTimeoutImpl: (resolve: () => void, duration: number) => {
        expect(duration).toBe(32000);
        for (let index = 0; index < 15; index += 1) {
          intervalTick?.();
        }
        resolve();
      },
      errorHandler: {
        handleEventProcessingError() {},
      },
    });

    expect(ingested).toHaveLength(16);
    expect(ingested[15].adapter).toBe("tiktok");
    expect(ingested[15].rawEvent.eventType).toBe("ENVELOPE");
  });

  it("routes ingest events through the preview pipeline boundaries", async () => {
    const routedNotifications: UnknownRecord[] = [];
    const routedChats: UnknownRecord[] = [];
    let disposedCooldown = false;

    const config = buildPreviewConfig();
    const pipeline = createPreviewPipeline({
      config,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      displayQueue: {
        addItem(item: UnknownRecord) {
          routedChats.push(item);
        },
      },
      notificationManager: {
        async handleNotification(
          type: string,
          platform: string,
          data: UnknownRecord,
        ) {
          routedNotifications.push({ type, platform, data });
          return { success: true };
        },
      },
      commandCooldownService: {
        dispose() {
          disposedCooldown = true;
        },
        checkUserCooldown() {
          return true;
        },
        checkGlobalCooldown() {
          return true;
        },
        updateUserCooldown() {},
        updateGlobalCooldown() {},
      },
      userTrackingService: {
        isFirstMessage() {
          return false;
        },
      },
      vfxCommandService: {
        async selectVFXCommand() {
          return null;
        },
        matchFarewell() {
          return null;
        },
        async getVFXConfig() {
          return null;
        },
      },
      platformLifecycleService: {
        getPlatformConnectionTime() {
          return null;
        },
      },
    });

    const timestamp = new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString();

    pipeline.emitIngestEvent({
      type: "platform:chat-message",
      platform: "twitch",
      data: {
        username: "test-user",
        userId: "test-user-id",
        avatarUrl: "https://example.com/avatar.png",
        timestamp,
        message: { text: "hello" },
      },
    });

    pipeline.emitIngestEvent({
      type: "platform:follow",
      platform: "youtube",
      data: {
        username: "test-follower",
        userId: "test-follower-id",
        avatarUrl: "https://example.com/avatar.png",
        timestamp,
      },
    });

    for (let attempt = 0; attempt < 20; attempt += 1) {
      if (routedChats.length > 0 && routedNotifications.length > 0) {
        break;
      }
      await Promise.resolve();
    }

    expect(routedChats.length).toBe(1);
    expect(routedChats[0].type).toBe("chat");
    expect(routedNotifications.length).toBe(1);
    expect(routedNotifications[0].type).toBe("platform:follow");

    await pipeline.dispose();
    expect(disposedCooldown).toBe(true);
  });

  it("creates raw ingest adapters that emit canonical platform events", async () => {
    const emitted: UnknownRecord[] = [];
    const adapters = createPreviewIngestAdapters({
      config: buildPreviewConfig(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      emitPlatformEvent: (event: UnknownRecord) => emitted.push(event),
    });

    await adapters.twitch.ingest({
      subscriptionType: "channel.follow",
      event: {
        user_name: "test-user",
        user_id: "test-user-id",
        user_login: "test-user-id",
        followed_at: new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString(),
        timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString(),
      },
    });

    await adapters.youtube.ingest({
      eventType: "LiveChatTextMessage",
      chatItem: {
        testData: {
          username: "test-youtube-user",
          userId: "test-youtube-user-id",
          timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, 1)).toISOString(),
          message: "hello",
        },
      },
    });

    await adapters.tiktok.ingest({
      eventType: "SOCIAL",
      data: {
        user: {
          uniqueId: "test-tiktok-user-id",
          nickname: "test-tiktok-user",
          userId: "test-tiktok-user-id",
          profilePictureUrl: "https://example.com/avatar.png",
          followRole: 0,
          userBadges: [],
        },
        timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, 2)).toISOString(),
        displayType: "share",
        msgId: "test-msg-id",
      },
    });

    expect(
      emitted.some(
        (event) =>
          event.type === "platform:follow" && event.platform === "twitch",
      ),
    ).toBe(true);
    expect(
      emitted.some(
        (event) =>
          event.type === "platform:chat-message" &&
          event.platform === "youtube",
      ),
    ).toBe(true);
    expect(
      emitted.some(
        (event) =>
          event.type === "platform:share" && event.platform === "tiktok",
      ),
    ).toBe(true);
  });

  it("does not heal twitch preview notifications that omit canonical ids", async () => {
    const emitted: UnknownRecord[] = [];
    const adapters = createPreviewIngestAdapters({
      config: buildPreviewConfig(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      emitPlatformEvent: (event: UnknownRecord) => emitted.push(event),
    });

    const timestamp = new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString();

    await adapters.twitch.ingest({
      subscriptionType: "channel.follow",
      event: {
        user_name: "test-user",
        user_login: "test-user-id",
        followed_at: timestamp,
        timestamp,
      },
    });

    await adapters.twitch.ingest({
      subscriptionType: "channel.raid",
      event: {
        from_broadcaster_user_name: "test-raider",
        from_broadcaster_user_login: "test-raider-id",
        viewers: 10,
        timestamp,
      },
    });

    expect(
      emitted.some(
        (event) =>
          event.type === "platform:follow" && event.platform === "twitch",
      ),
    ).toBe(false);
    expect(
      emitted.some(
        (event) =>
          event.type === "platform:raid" && event.platform === "twitch",
      ),
    ).toBe(false);
  });

  it("falls back to default avatar when ingest payload omits avatarUrl", async () => {
    const emitted: UnknownRecord[] = [];
    const adapters = createPreviewIngestAdapters({
      config: buildPreviewConfig(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      emitPlatformEvent: (event: UnknownRecord) => emitted.push(event),
    });

    await adapters.youtube.ingest({
      eventType: "LiveChatTextMessage",
      chatItem: {
        testData: {
          username: "test-youtube-user",
          userId: "test-youtube-user-id",
          timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, 1)).toISOString(),
          message: "hello",
        },
      },
    });

    const chatEvent = emitted.find(
      (event) =>
        event.type === "platform:chat-message" && event.platform === "youtube",
    )!;
    expect(chatEvent).toBeDefined();
    expect(typeof chatEvent.data.avatarUrl).toBe("string");
    expect(chatEvent.data.avatarUrl.length).toBeGreaterThan(0);
  });

  it("maps additional twitch and youtube ingest events", async () => {
    const emitted: UnknownRecord[] = [];
    const adapters = createPreviewIngestAdapters({
      config: buildPreviewConfig(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      emitPlatformEvent: (event: UnknownRecord) => emitted.push(event),
    });

    const timestamp = new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString();

    await adapters.twitch.ingest({
      subscriptionType: "channel.raid",
      metadata: {
        message_timestamp: timestamp,
      },
      event: {
        from_broadcaster_user_name: "test-raider",
        from_broadcaster_user_id: "test-raider-id",
        from_broadcaster_user_login: "test-raider-id",
        viewers: 10,
        timestamp,
      },
    });

    await adapters.twitch.ingest({
      subscriptionType: "channel.subscription.gift",
      metadata: {
        message_timestamp: timestamp,
      },
      event: {
        user_name: "test-gifter",
        user_id: "test-gifter-id",
        user_login: "test-gifter-id",
        tier: "1000",
        total: 2,
        is_anonymous: false,
        timestamp,
      },
    });

    await adapters.youtube.ingest({
      eventType: "LiveChatSponsorshipsGiftPurchaseAnnouncement",
      chatItem: {
        testData: {
          username: "test-youtube-user",
          userId: "test-youtube-user-id",
          timestamp,
          giftCount: 4,
          tier: "1",
        },
      },
    });

    expect(
      emitted.some(
        (event) =>
          event.type === "platform:raid" && event.platform === "twitch",
      ),
    ).toBe(true);
    expect(
      emitted.some(
        (event) =>
          event.type === "platform:giftpaypiggy" && event.platform === "twitch",
      ),
    ).toBe(true);
    expect(
      emitted.some(
        (event) =>
          event.type === "platform:giftpaypiggy" &&
          event.platform === "youtube",
      ),
    ).toBe(true);
  });

  it("maps additional tiktok ingest events", async () => {
    const emitted: UnknownRecord[] = [];
    const adapters = createPreviewIngestAdapters({
      config: buildPreviewConfig(),
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      emitPlatformEvent: (event: UnknownRecord) => emitted.push(event),
    });

    const timestamp = new Date(Date.UTC(2024, 0, 1, 0, 0, 0)).toISOString();

    await adapters.tiktok.ingest({
      eventType: "GIFT",
      data: {
        user: {
          uniqueId: "test-tiktok-user-id",
          nickname: "test-tiktok-user",
          userId: "test-tiktok-user-id",
          profilePictureUrl: "https://example.com/avatar.png",
          followRole: 0,
          userBadges: [],
        },
        timestamp,
        msgId: "gift-id",
        giftName: "Rose",
        repeatCount: 2,
        diamondCount: 20,
        gift: {
          giftPictureUrl: "https://example.com/tiktok/gift-rose.png",
        },
      },
    });

    await adapters.tiktok.ingest({
      eventType: "ENVELOPE",
      data: {
        user: {
          uniqueId: "test-tiktok-user-id",
          nickname: "test-tiktok-user",
          userId: "test-tiktok-user-id",
          profilePictureUrl: "https://example.com/avatar.png",
          followRole: 0,
          userBadges: [],
        },
        timestamp,
        msgId: "envelope-id",
        giftName: "Rose",
        repeatCount: 1,
        diamondCount: 10,
      },
    });

    const tiktokGiftEvent = emitted.find(
      (event) => event.type === "platform:gift" && event.platform === "tiktok",
    )!;

    expect(tiktokGiftEvent).toBeDefined();
    expect(tiktokGiftEvent.data.giftImageUrl).toBe(
      "https://example.com/tiktok/gift-rose.png",
    );
    expect(
      emitted.some(
        (event) =>
          event.type === "platform:envelope" && event.platform === "tiktok",
      ),
    ).toBe(true);
  });

  it("fails fast when injected preview pipeline is invalid", async () => {
    await expect(
      runGuiPreview({
        createPreviewPipelineImpl: (() => ({ eventBus: {} })) as unknown as (
          args: UnknownRecord,
        ) => PreviewPipeline,
        createGuiTransportServiceImpl: () => ({
          async start() {},
          async stop() {},
        }),
      }),
    ).rejects.toThrow("Preview pipeline requires eventBus and emitIngestEvent");
  });

  it("disposes pipeline when transport stop throws", async () => {
    let disposed = false;
    let intervalTick: null | (() => void) = null;

    const fakeEventBus = {
      subscribe() {
        return () => {};
      },
      emit() {},
    };

    const fakePipeline = {
      eventBus: fakeEventBus,
      emitIngestEvent() {},
      async dispose() {
        disposed = true;
      },
    };

    await runGuiPreview({
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
      },
      durationMs: 4,
      intervalMs: 2,
      createPreviewPipelineImpl: () => fakePipeline,
      createGuiTransportServiceImpl: () => ({
        async start() {},
        async stop() {
          throw new Error("stop failed");
        },
      }),
      safeSetIntervalImpl: (callback: () => void) => {
        intervalTick = callback;
        return 1;
      },
      safeSetTimeoutImpl: (resolve: () => void) => {
        intervalTick?.();
        resolve();
      },
      stdout: {
        write() {},
      },
    });

    expect(disposed).toBe(true);
  });

  it("disposes pipeline when transport start fails", async () => {
    let disposed = false;

    const fakePipeline = {
      eventBus: {
        subscribe() {
          return () => {};
        },
        emit() {},
      },
      emitIngestEvent() {},
      async dispose() {
        disposed = true;
      },
    };

    await expect(
      runGuiPreview({
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
        },
        durationMs: 4,
        intervalMs: 2,
        createPreviewPipelineImpl: () => fakePipeline,
        createGuiTransportServiceImpl: () => ({
          async start() {
            throw new Error("start failed");
          },
          async stop() {},
        }),
        stdout: {
          write() {},
        },
      }),
    ).rejects.toThrow("start failed");

    expect(disposed).toBe(true);
  });

  it("clears active interval handle during cleanup", async () => {
    const handles: Array<number | ReturnType<typeof setInterval>> = [];
    const originalClearInterval = global.clearInterval;
    global.clearInterval = ((handle: unknown) => {
      if (typeof handle === "number" || typeof handle === "object") {
        handles.push(handle as number | ReturnType<typeof setInterval>);
      }
    }) as typeof global.clearInterval;

    let intervalTick: null | (() => void) = null;

    try {
      await runGuiPreview({
        logger: {
          debug: () => {},
          info: () => {},
          warn: () => {},
          error: () => {},
          console: () => {},
        },
        durationMs: 4,
        intervalMs: 2,
        createPreviewPipelineImpl: () => ({
          eventBus: {
            subscribe() {
              return () => {};
            },
            emit() {},
          },
          emitIngestEvent() {},
          async dispose() {},
        }),
        createPreviewIngestAdaptersImpl: () => ({
          twitch: { async ingest() {} },
          youtube: { async ingest() {} },
          tiktok: { async ingest() {} },
        }),
        createGuiTransportServiceImpl: () => ({
          async start() {},
          async stop() {},
        }),
        safeSetIntervalImpl: (callback: () => void) => {
          intervalTick = callback;
          return 77;
        },
        safeSetTimeoutImpl: (resolve: () => void) => {
          intervalTick?.();
          resolve();
        },
        stdout: {
          write() {},
        },
      });
    } finally {
      global.clearInterval = originalClearInterval;
    }

    expect(handles.includes(77)).toBe(true);
  });

  it("runs raw ingest adapters end-to-end through scenario schedule", async () => {
    const routed: UnknownRecord[] = [];
    let intervalTick: null | (() => void) = null;

    await runGuiPreview({
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        console: () => {},
      },
      durationMs: 20,
      intervalMs: 2,
      createPreviewPipelineImpl: () => ({
        eventBus: {
          subscribe() {
            return () => {};
          },
          emit() {},
        },
        emitIngestEvent(event: UnknownRecord) {
          routed.push(event);
        },
        async dispose() {},
      }),
      createGuiTransportServiceImpl: () => ({
        async start() {},
        async stop() {},
      }),
      safeSetIntervalImpl: (callback: () => void) => {
        intervalTick = callback;
        return 1;
      },
      safeSetTimeoutImpl: (resolve: () => void) => {
        for (let i = 0; i < 10; i += 1) {
          intervalTick?.();
        }
        resolve();
      },
      stdout: {
        write() {},
      },
    });

    expect(routed.length).toBeGreaterThan(3);
    expect(routed.some((event) => event.type === "platform:chat-message")).toBe(
      true,
    );
    expect(routed.some((event) => event.type === "platform:follow")).toBe(true);
    expect(routed.some((event) => event.type === "platform:gift")).toBe(true);
  });

  it("continues preview schedule when one ingest step fails", async () => {
    const routed: UnknownRecord[] = [];
    let intervalTick: null | (() => void) = null;
    let failedOnce = false;
    const errors: UnknownRecord[] = [];

    await runGuiPreview({
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        console: () => {},
        error: (...args: unknown[]) => errors.push(args),
      },
      durationMs: 6,
      intervalMs: 2,
      createPreviewPipelineImpl: () => ({
        eventBus: {
          subscribe() {
            return () => {};
          },
          emit() {},
        },
        emitIngestEvent(event: UnknownRecord) {
          routed.push(event);
        },
        async dispose() {},
      }),
      createPreviewIngestAdaptersImpl: () => ({
        twitch: {
          async ingest() {
            if (!failedOnce) {
              failedOnce = true;
              throw new Error("ingest failed");
            }
            routed.push({ type: "platform:follow", platform: "twitch" });
          },
        },
        youtube: {
          async ingest() {
            routed.push({ type: "platform:chat-message", platform: "youtube" });
          },
        },
        tiktok: {
          async ingest() {
            routed.push({ type: "platform:gift", platform: "tiktok" });
          },
        },
      }),
      createGuiTransportServiceImpl: () => ({
        async start() {},
        async stop() {},
      }),
      safeSetIntervalImpl: (callback: () => void) => {
        intervalTick = callback;
        return 1;
      },
      safeSetTimeoutImpl: (resolve: () => void) => {
        intervalTick?.();
        intervalTick?.();
        intervalTick?.();
        resolve();
      },
      stdout: {
        write() {},
      },
    });

    expect(routed.length).toBeGreaterThan(0);
    expect(errors.length).toBeGreaterThan(0);
  });

  it("emits all required row types through full preview pipeline", async () => {
    const config = buildPreviewConfig();
    const rows: UnknownRecord[] = [];

    const pipeline = createPreviewPipeline({
      config,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        console: () => {},
      },
      giftAnimationResolver: {
        async resolveFromNotificationData() {
          return null;
        },
      },
    });

    const unsubscribe = pipeline.eventBus.subscribe(
      "display:row",
      (row: UnknownRecord) => {
        rows.push(row);
      },
    );

    const adapters = createPreviewIngestAdapters({
      config,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        console: () => {},
      },
      emitPlatformEvent: (event: UnknownRecord) =>
        pipeline.emitIngestEvent(event),
    });

    const scenarioEvents = buildPreviewScenarioEvents(32000, 2000);
    for (const event of scenarioEvents) {
      await adapters[event.adapter].ingest(event.rawEvent);
    }

    for (let attempt = 0; attempt < 200; attempt += 1) {
      const emittedTypes = new Set(rows.map((row) => row.type));
      if (
        emittedTypes.has("farewell") &&
        emittedTypes.has("command") &&
        emittedTypes.has("platform:envelope")
      ) {
        break;
      }
      await waitForDelay(1);
    }

    const emittedTypes = new Set(rows.map((row) => row.type));
    expect(emittedTypes.has("chat")).toBe(true);
    expect(emittedTypes.has("command")).toBe(true);
    expect(emittedTypes.has("greeting")).toBe(true);
    expect(emittedTypes.has("farewell")).toBe(true);
    expect(emittedTypes.has("platform:follow")).toBe(true);
    expect(emittedTypes.has("platform:gift")).toBe(true);
    expect(emittedTypes.has("platform:raid")).toBe(true);
    expect(emittedTypes.has("platform:share")).toBe(true);
    expect(emittedTypes.has("platform:paypiggy")).toBe(true);
    expect(emittedTypes.has("platform:giftpaypiggy")).toBe(true);
    expect(emittedTypes.has("platform:envelope")).toBe(true);

    unsubscribe();
    await pipeline.dispose();
  });

  it("uses deterministic no-op gift animation resolver by default in preview pipeline", async () => {
    const config = buildPreviewConfig();
    const emittedEffects: UnknownRecord[] = [];

    const pipeline = createPreviewPipeline({
      config,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        console: () => {},
      },
    });

    const unsubscribeEffect = pipeline.eventBus.subscribe(
      "display:gift-animation",
      (effectPayload: UnknownRecord) => {
        emittedEffects.push(effectPayload);
      },
    );

    const adapters = createPreviewIngestAdapters({
      config,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        console: () => {},
      },
      emitPlatformEvent: (event: UnknownRecord) =>
        pipeline.emitIngestEvent(event),
    });

    const giftEvent = buildPreviewScenarioEvents(32000, 2000).find(
      (event) =>
        event.adapter === "tiktok" && event.rawEvent?.eventType === "GIFT",
    )!;

    expect(giftEvent).toBeDefined();

    await adapters[giftEvent.adapter].ingest(giftEvent.rawEvent);
    await waitForDelay(25);

    expect(emittedEffects).toHaveLength(0);

    unsubscribeEffect();
    await pipeline.dispose();
  });

  it("emits gift animation effect in preview pipeline when resolver returns Corgi animation", async () => {
    const config = buildPreviewConfig();
    const emittedEffects: UnknownRecord[] = [];

    const pipeline = createPreviewPipeline({
      config,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        console: () => {},
      },
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
    });

    const unsubscribeEffect = pipeline.eventBus.subscribe(
      "display:gift-animation",
      (effectPayload: UnknownRecord) => {
        emittedEffects.push(effectPayload);
      },
    );

    const adapters = createPreviewIngestAdapters({
      config,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        console: () => {},
      },
      emitPlatformEvent: (event: UnknownRecord) =>
        pipeline.emitIngestEvent(event),
    });

    const giftEvent = buildPreviewScenarioEvents(32000, 2000).find(
      (event) =>
        event.adapter === "tiktok" && event.rawEvent?.eventType === "GIFT",
    )!;

    expect(giftEvent).toBeDefined();

    await adapters[giftEvent.adapter].ingest(giftEvent.rawEvent);

    for (
      let attempt = 0;
      attempt < 50 && emittedEffects.length === 0;
      attempt += 1
    ) {
      await waitForDelay(1);
    }

    expect(emittedEffects).toHaveLength(1);
    expect(emittedEffects[0].durationMs).toBe(4200);

    unsubscribeEffect();
    await pipeline.dispose();
  });

  it("uses injected delay in preview pipeline so gift hold timing can block later notifications", async () => {
    const config = buildPreviewConfig();
    const delayCalls: number[] = [];

    const pipeline = createPreviewPipeline({
      config,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        console: () => {},
      },
      delay: async (ms: number) => {
        delayCalls.push(ms);
      },
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
    });

    const adapters = createPreviewIngestAdapters({
      config,
      logger: {
        debug: () => {},
        info: () => {},
        warn: () => {},
        error: () => {},
        console: () => {},
      },
      emitPlatformEvent: (event: UnknownRecord) =>
        pipeline.emitIngestEvent(event),
    });

    const giftEvent = buildPreviewScenarioEvents(32000, 2000).find(
      (event) =>
        event.adapter === "tiktok" && event.rawEvent?.eventType === "GIFT",
    )!;

    expect(giftEvent).toBeDefined();

    await adapters[giftEvent.adapter].ingest(giftEvent.rawEvent);

    for (
      let attempt = 0;
      attempt < 50 && !delayCalls.includes(4200);
      attempt += 1
    ) {
      await waitForDelay(1);
    }

    expect(delayCalls.includes(4200)).toBe(true);

    await pipeline.dispose();
  });
});
