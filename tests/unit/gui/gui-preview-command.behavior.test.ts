import { describe, expect, it } from "bun:test";
import * as previewModule from "../../../scripts/local/gui-preview.ts";
import { DEMO_CHARACTER_CATALOG } from "../../../gui/src/demo/demo-catalog.ts";
import { waitForDelay } from "../../helpers/time-utils";

type UnknownRecord = Record<string, any>;

function requireValue<T>(value: T | undefined, description: string): T {
  if (value === undefined) {
    throw new Error(`Missing ${description}`);
  }

  return value;
}

function createYouTubeChatItem(options: {
  username: string;
  userId: string;
  message: string;
  timestamp: string;
  avatarUrl?: string;
  isMember?: boolean;
}): UnknownRecord {
  return {
    type: "AddChatItemAction",
    item: {
      type: "LiveChatTextMessage",
      id: `test-${options.userId}`,
      author: {
        id: options.userId,
        name: options.username,
        thumbnails: options.avatarUrl ? [{ url: options.avatarUrl }] : [],
        badges: options.isMember
          ? [{ tooltip: "Member", custom_thumbnail: [] }]
          : [],
        is_moderator: false,
      },
      message: {
        text: options.message,
        runs: [{ text: options.message }],
      },
      timestamp: options.timestamp,
    },
  };
}

type PreviewAdapter = "twitch" | "youtube" | "tiktok";

type ScenarioEvent = {
  platform: PreviewAdapter;
  adapter: PreviewAdapter;
  scenarioType?: string;
  notificationType?: string;
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
  createPreviewDelay: (
    delayImpl?: (
      delay: unknown,
      fallback?: number,
      context?: string,
    ) => Promise<void>,
  ) => (ms: number) => Promise<void>;
  buildPreviewConfig: (baseConfig?: UnknownRecord) => UnknownRecord;
  buildPreviewScenarioEvents: (
    durationMs?: number,
    intervalMs?: number,
    scenario?: "all" | "chat" | "notifications" | "funding",
  ) => ScenarioEvent[];
  parsePreviewScenario: (
    args: readonly string[],
  ) => "all" | "chat" | "notifications" | "funding";
  createPreviewPipeline: (options?: UnknownRecord) => PreviewPipeline;
  createPreviewIngestAdapters: (options: {
    config?: UnknownRecord;
    logger?: UnknownRecord;
    emitPlatformEvent: (event: UnknownRecord) => void;
    [key: string]: unknown;
  }) => PreviewIngestAdapters;
  runPreviewScenario: (options: {
    adapters: Partial<Record<PreviewAdapter, { ingest: (rawEvent: UnknownRecord) => Promise<void> | void }>>;
    scenarioEvents: ScenarioEvent[];
    intervalMs: number;
    durationMs: number;
    safeSetIntervalImpl: (
      callback: () => void,
      durationMs: number,
    ) => number | ReturnType<typeof setInterval>;
    safeSetTimeoutImpl: (resolve: () => void, durationMs: number) => unknown;
    dispatchImmediately?: boolean;
    signal?: AbortSignal;
    clearIntervalImpl?: (handle: ReturnType<typeof setInterval> | number) => void;
    clearTimeoutImpl?: (handle: unknown) => void;
    errorHandler: {
      handleEventProcessingError: (
        error: unknown,
        context: string,
        payload: unknown,
        message: string,
      ) => void;
    };
  }) => Promise<{
    intervalHandle: number | ReturnType<typeof setInterval>;
    dispatchedEvents: ScenarioEvent[];
  }>;
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
      getAddress: () => { port: number } | string | null;
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
    scenario?: "all" | "chat" | "notifications";
    keepOpen?: boolean;
    waitForShutdownImpl?: () => Promise<void>;
    createNotificationExitWaiterImpl?: (
      eventBus: PreviewPipeline["eventBus"],
      notificationType: string,
      timeoutMs: number,
    ) => { promise: Promise<void>; cancel: () => void };
    [key: string]: unknown;
  }) => Promise<void>;
};

const {
  PREVIEW_DURATION_MS,
  PREVIEW_INTERVAL_MS,
  PREVIEW_MEDIA_CATALOG,
  createPreviewDelay,
  buildPreviewConfig,
  buildPreviewScenarioEvents,
  parsePreviewScenario,
  createPreviewPipeline,
  createPreviewIngestAdapters,
  runPreviewScenario,
  runGuiPreview,
} = previewModule as PreviewModule;

describe("GUI local preview command behavior", () => {
  it("preserves zero-delay preview queue processing", async () => {
    const calls: unknown[][] = [];
    const delay = createPreviewDelay(async (...args: unknown[]) => {
      calls.push(args);
    });

    await delay(0);
    expect(calls).toEqual([]);

    await delay(25);
    expect(calls).toEqual([[25, 25, "gui-preview delay"]]);
  });

  it("waits for an injected shutdown signal when keep-open is enabled", async () => {
    const writes: string[] = [];
    let shutdownWaited = false;
    let stopped = false;
    const eventBus = { subscribe() { return () => {}; }, emit() {} };
    await runGuiPreview({
      durationMs: 1,
      intervalMs: 1,
      keepOpen: true,
      waitForShutdownImpl: async () => { shutdownWaited = true; },
      createPreviewPipelineImpl: () => ({ eventBus, emitIngestEvent() {}, async dispose() {} }),
      createPreviewIngestAdaptersImpl: () => ({ twitch: { async ingest() {} }, youtube: { async ingest() {} }, tiktok: { async ingest() {} } }),
      createGuiTransportServiceImpl: () => ({
        async start() {},
        async stop() { stopped = true; },
        getAddress: () => ({ port: 3399 }),
      }),
      safeSetIntervalImpl: (callback) => { callback(); return 1; },
      safeSetTimeoutImpl: (resolve) => resolve(),
      stdout: { write: (text: string) => writes.push(text) },
    });
    expect(shutdownWaited).toBe(true);
    expect(stopped).toBe(true);
    expect(writes.some((line) => line.includes("server remains running until Ctrl+C"))).toBe(true);
    expect(writes.some((line) => line === "GUI preview finished\n")).toBe(false);
  });

  it("uses 32s duration and 2s message cadence constants", () => {
    expect(PREVIEW_DURATION_MS).toBe(32000);
    expect(PREVIEW_INTERVAL_MS).toBe(2000);
  });

  it("builds deterministic ingest events for the full preview window", () => {
    const events = buildPreviewScenarioEvents();

    expect(events.length).toBe(16);
    expect(events[0]).toEqual(
      expect.objectContaining({
        platform: "youtube",
      }),
    );
    expect(events[1]).toEqual(
      expect.objectContaining({
        platform: "twitch",
      }),
    );
    expect(events[2]).toEqual(
      expect.objectContaining({
        platform: "youtube",
      }),
    );
    const firstEvent = requireValue(events[0], "first preview event");
    const secondEvent = requireValue(events[1], "second preview event");
    const thirdEvent = requireValue(events[2], "third preview event");
    expect(firstEvent.adapter).toBe("youtube");
    expect(secondEvent.adapter).toBe("twitch");
    expect(thirdEvent.adapter).toBe("youtube");
    expect(firstEvent.rawEvent).toBeDefined();
    expect(firstEvent.rawEvent.eventType).toBe("LiveChatTextMessage");
    expect(firstEvent.rawEvent.chatItem.item.author.badges[0].tooltip).toBe(
      "Member",
    );
    expect(firstEvent.rawEvent.chatItem.item.author.name).toBe(
      "test-youtube-account",
    );
    expect(secondEvent.rawEvent.subscriptionType).toBe("channel.chat.message");
    expect(secondEvent.rawEvent.event.chatter_user_name).toBe(
      "test-twitch-account-1",
    );
    expect(secondEvent.rawEvent.event.badges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ set_id: "moderator" }),
        expect.objectContaining({ set_id: "founder" }),
      ]),
    );
  });

  it("inserts youtube member hi chat immediately after raid notification", () => {
    const events = buildPreviewScenarioEvents();
    const raidIndex = events.findIndex(
      (event) =>
        event.adapter === "twitch" &&
        event.rawEvent?.subscriptionType === "channel.raid",
    );

    expect(raidIndex).toBeGreaterThan(-1);

    const memberHiEvent = requireValue(
      events[raidIndex + 1],
      "youtube member hi preview event",
    );
    expect(memberHiEvent.adapter).toBe("youtube");
    expect(memberHiEvent.rawEvent.eventType).toBe("LiveChatTextMessage");
    expect(memberHiEvent.rawEvent.chatItem.item.message.text).toBe("Hi!");
    expect(memberHiEvent.rawEvent.chatItem.item.author.badges[0].tooltip).toBe(
      "Member",
    );
    expect(memberHiEvent.rawEvent.chatItem.item.author.name).toBe(
      "test-youtube-account",
    );
  });

  it("builds scenario steps that include all adapter families", () => {
    const events = buildPreviewScenarioEvents(20000, 2000);
    const adapters = new Set(events.map((event) => event.adapter));

    expect(adapters.has("twitch")).toBe(true);
    expect(adapters.has("youtube")).toBe(true);
    expect(adapters.has("tiktok")).toBe(true);
  });

  it("selects focused preview scenarios and rejects unknown values", () => {
    expect(parsePreviewScenario([])).toBe("all");
    expect(parsePreviewScenario(["--scenario=chat"])).toBe("chat");
    expect(parsePreviewScenario(["--scenario", "notifications"])).toBe(
      "notifications",
    );
    expect(parsePreviewScenario(["--scenario=funding"])).toBe("funding");
    expect(() => parsePreviewScenario(["--scenario=unknown"])).toThrow(
      "Unknown GUI preview scenario",
    );

    const chatEvents = buildPreviewScenarioEvents(32000, 2000, "chat");
    const notificationEvents = buildPreviewScenarioEvents(
      32000,
      2000,
      "notifications",
    );
    const fundingEvents = buildPreviewScenarioEvents(32000, 2000, "funding");
    expect(chatEvents.length).toBeGreaterThan(0);
    expect(chatEvents.every((event) => event.notificationType === undefined)).toBe(
      true,
    );
    expect(notificationEvents.length).toBeGreaterThan(0);
    expect(
      notificationEvents.every((event) => typeof event.notificationType === "string"),
    ).toBe(true);
    expect(notificationEvents.at(-1)?.notificationType).toBe(
      "platform:envelope",
    );
    expect(fundingEvents.map((event) => event.notificationType)).toEqual([
      "platform:gift",
      "platform:paypiggy",
      "platform:giftpaypiggy",
      "platform:gift",
      "platform:paypiggy",
    ]);
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
    expect(youtubeStep.rawEvent.chatItem.item.author.thumbnails[0].url).toBe(
      PREVIEW_MEDIA_CATALOG.youtube.avatarUrl,
    );
    expect(tiktokStep.rawEvent.data.user.profilePictureUrl).toBe(
      PREVIEW_MEDIA_CATALOG.tiktok.avatarUrl,
    );
    expect(PREVIEW_MEDIA_CATALOG.twitch.avatarUrl).toBe(
      DEMO_CHARACTER_CATALOG.Goku,
    );
    expect(PREVIEW_MEDIA_CATALOG.youtube.avatarUrl).toBe(
      DEMO_CHARACTER_CATALOG.Ichigo,
    );
    expect(PREVIEW_MEDIA_CATALOG.tiktok.avatarUrl).toBe(
      DEMO_CHARACTER_CATALOG.Naruto,
    );
    expect(new Set([
      PREVIEW_MEDIA_CATALOG.twitch.avatarUrl,
      PREVIEW_MEDIA_CATALOG.youtube.avatarUrl,
      PREVIEW_MEDIA_CATALOG.tiktok.avatarUrl,
    ]).size).toBe(3);
  });

  it("enriches native twitch chat with the deterministic Helix avatar", async () => {
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
    const twitchChat = requireValue(
      buildPreviewScenarioEvents().find(
        (event) =>
          event.adapter === "twitch" &&
          event.rawEvent.subscriptionType === "channel.chat.message",
      ),
      "Twitch chat fixture",
    );

    await adapters.twitch.ingest(twitchChat.rawEvent);

    const chatEvent = emitted.find(
      (event) =>
        event.type === "platform:chat-message" && event.platform === "twitch",
    );
    expect(chatEvent?.data?.avatarUrl).toBe(DEMO_CHARACTER_CATALOG.Goku);
  });

  it("includes tiktok corgi gift payload with animation resources for preview", () => {
    const events = buildPreviewScenarioEvents(32000, 2000);
    const tiktokGiftStep = events.find(
      (event) =>
        event.adapter === "tiktok" && event.rawEvent?.eventType === "GIFT",
    )!;

    expect(tiktokGiftStep).toBeDefined();
    expect(events[3]?.rawEvent?.eventType).toBe("GIFT");
    expect(events[3]?.adapter).toBe("tiktok");
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

  it("routes the generated TikTok no-message fixture as canonical chat", async () => {
    const chatNoEvent = requireValue(
      buildPreviewScenarioEvents().find(
        (event) =>
          event.adapter === "tiktok" &&
          String(event.rawEvent?.data?.comment).startsWith("test no no"),
      ),
      "TikTok no-message preview event",
    );
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

    expect(typeof chatNoEvent.rawEvent.data.common?.createTime).toBe("number");
    await adapters.tiktok.ingest(chatNoEvent.rawEvent);

    const emittedChat = emitted.find(
      (event) =>
        event.type === "platform:chat-message" && event.platform === "tiktok",
    );
    expect(emittedChat?.data?.timestamp).toBe(
      chatNoEvent.rawEvent.data.timestamp,
    );
    expect(JSON.stringify(emittedChat?.data?.message)).toContain("test no no");
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
        enableOperator: true,
        host: "127.0.0.1",
        port: 4400,
      },
    });

    expect(config.gui.enableDock).toBe(true);
    expect(config.gui.enableOverlay).toBe(true);
    expect(config.gui.enableOperator).toBe(true);
    expect(config.gui.port).toBe(3399);
    expect(config.fundingGoal).toEqual(expect.objectContaining({ enabled: true, label: '🎮 New Controller', targetUsd: 100 }));
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
    expect(config.gui.notificationIdleHoldMs).toBe(5000);
    expect(config.gui.monetizationIdleHoldMs).toBe(30000);
    expect(config.gui.notificationTransitionMs).toBe(1000);
    expect(config.obs.ttsChatEnabled).toBe(false);
    expect(config.obs.ttsNotificationsEnabled).toBe(false);

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

  it("merges explicit root preview profiles without reading local profiles", () => {
    const syntheticSpriteUrl = "https://example.invalid/synthetic-preview-member.gif";
    const config = buildPreviewConfig({
      profiles: {
        "configured-preview": {
          id: "configured-preview",
          identities: ["youtube:configured-preview-member"],
          greetingCommand: "!preview",
          rowTheme: "red",
          rowEffects: ["particles"],
          spriteUrl: syntheticSpriteUrl,
        },
      },
    });

    expect(config.profiles["configured-preview"]).toEqual(expect.objectContaining({ spriteUrl: syntheticSpriteUrl }));
    expect(config.profiles).not.toHaveProperty("ordinaryMember");
    expect(config.profiles["synthetic-member"]).toEqual(expect.objectContaining({
      identities: ["youtube:test-youtube-account"],
      rowTheme: "red",
      rowEffects: ["particles"],
    }));
    expect(config.profiles["synthetic-member"]).not.toHaveProperty("spriteUrl");
    expect(config.profiles).not.toHaveProperty("previewSupporter");
    expect(config.profiles).not.toHaveProperty("previewMonetization");
  });

  it("runs preview via ingest pipeline and stops cleanly", async () => {
    const writes: string[] = [];
    const emittedEvents: UnknownRecord[] = [];
    let started = false;
    let stopped = false;
    let disposed = false;
    let clientCount = 0;
    let firstIngestSawConnectedClient = false;
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
        if (emittedEvents.length === 0) {
          firstIngestSawConnectedClient = clientCount > 0;
        }
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
      getAddress() {
        return { port: 43123 };
      },
      getSseClientCount() {
        return clientCount;
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
      delay: async () => {
        clientCount = 1;
      },
      stdout: {
        write: (text: string) => writes.push(text),
      },
    });

    expect(started).toBe(true);
    expect(stopped).toBe(true);
    expect(disposed).toBe(true);
    expect(firstIngestSawConnectedClient).toBe(true);
    expect(createdPipelineArgs.length).toBe(1);
    expect(createdTransportArgs.length).toBe(1);
    const createdPipelineArg = requireValue(
      createdPipelineArgs[0],
      "created preview pipeline args",
    );
    expect(typeof createdPipelineArg.delay).toBe("function");
    expect(createdPipelineArg.giftAnimationResolver).toBeDefined();
    expect(
      typeof createdPipelineArg.giftAnimationResolver.resolveFromNotificationData,
    ).toBe("function");
    expect(
      await createdPipelineArg.giftAnimationResolver.resolveFromNotificationData({}),
    ).toBeNull();
    expect(
      requireValue(createdTransportArgs[0], "created transport args").eventBus,
    ).toBe(fakeEventBus);
    const transportArgs = requireValue(createdTransportArgs[0], "created transport args");
    expect(transportArgs.fundingGoal).toBeDefined();
    const fundingGoal = transportArgs.fundingGoal as {
      adjust(amountUsd: number): Promise<void>;
      setLabel(label: string): Promise<void>;
      resetLabel(): Promise<void>;
      snapshot: { currentUsd: number; label: string; labelOverridden: boolean };
    };
    await expect(fundingGoal.adjust(-1)).rejects.toThrow("cannot be negative");
    expect(fundingGoal.snapshot.currentUsd).toBe(0);
    await fundingGoal.setLabel("  🎙️ New Microphone  ");
    expect(fundingGoal.snapshot).toMatchObject({ label: "🎙️ New Microphone", labelOverridden: true });
    await fundingGoal.resetLabel();
    expect(fundingGoal.snapshot).toMatchObject({ label: "🎮 New Controller", labelOverridden: false });
    expect(transportArgs.operatorControls).toBeDefined();
    expect(transportArgs.operatorAppearance).toBeDefined();
    expect(transportArgs.operatorLogs).toBeDefined();
    expect(transportArgs.assetsRoot).toContain("gui/dist");
    expect(emittedEvents.length).toBeGreaterThanOrEqual(1);
    expect(requireValue(emittedEvents[0], "first emitted event").eventName).toBe(
      "platform:event",
    );
    expect(
      emittedEvents.some((entry) => entry.eventName === "display:row"),
    ).toBe(false);
    expect(writes).toContain("Dock URL: http://127.0.0.1:43123/dock\n");
    expect(writes.some((line) => line.includes("Goal URL") && !line.includes("Goal minimal URL"))).toBe(true);
    expect(writes.some((line) => line.includes("Goal minimal URL"))).toBe(true);
    expect(
      writes.some((line) =>
        line.includes("For TikTok gift animation preview, run: bun run gui:preview:gift-animation"),
      ),
    ).toBe(true);
    expect(writes.some((line) => line.includes("tiktok-animations"))).toBe(
      false,
    );
    expect(writes.some((line) => line.includes("GUI preview finished"))).toBe(
      true,
    );
  });

  it("waits for the final production-timed notification lifecycle exit", async () => {
    const writes: string[] = [];
    const waitedFor: UnknownRecord[] = [];
    let intervalTick: null | (() => void) = null;
    let firstTickObserved = false;
    let waiterCreatedBeforeFirstTick = false;
    const eventBus = {
      subscribe() {
        return () => {};
      },
      emit() {},
    };

    await runGuiPreview({
      scenario: "notifications",
      durationMs: 14000,
      intervalMs: 2,
      createPreviewPipelineImpl: () => ({
        eventBus,
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
        getAddress: () => ({ port: 3399 }),
      }),
      safeSetIntervalImpl: (callback: () => void) => {
        intervalTick = () => {
          firstTickObserved = true;
          callback();
        };
        return 1;
      },
      safeSetTimeoutImpl: (resolve: () => void) => {
        for (let index = 0; index < 8; index += 1) intervalTick?.();
        resolve();
      },
      createNotificationExitWaiterImpl: (
        receivedEventBus,
        notificationType,
        timeoutMs,
      ) => {
        waiterCreatedBeforeFirstTick = !firstTickObserved;
        waitedFor.push({ receivedEventBus, notificationType, timeoutMs });
        return { promise: Promise.resolve(), cancel() {} };
      },
      stdout: { write: (text: string) => writes.push(text) },
    });

    expect(waitedFor).toEqual([
      {
        receivedEventBus: eventBus,
        notificationType: "platform:envelope",
        timeoutMs: 55000,
      },
    ]);
    expect(writes.some((line) => line.includes("Scenario: notifications"))).toBe(
      true,
    );
    expect(waiterCreatedBeforeFirstTick).toBe(true);
    expect(
      writes.some((line) => line.includes("Notifications minimal URL")),
    ).toBe(true);
  });

  it("rejects an explicit scenario duration that cannot dispatch every fixture", async () => {
    await expect(
      runGuiPreview({
        scenario: "notifications",
        durationMs: 4000,
        intervalMs: 2000,
        stdout: { write() {} },
      }),
    ).rejects.toThrow("requires at least 14000ms");
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

    const result = await runPreviewScenario({
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
    expect(result.dispatchedEvents).toHaveLength(16);
    const finalIngestedEvent = requireValue(
      ingested[15],
      "final ingested preview event",
    );
    expect(finalIngestedEvent.adapter).toBe("tiktok");
    expect(finalIngestedEvent.rawEvent.eventType).toBe("ENVELOPE");
  });

  it.each(["duration", "abort", "setup", "timeout-setup"])("owns admitted ingest settlement and timer cleanup after %s stop", async (mode) => {
    const controller = new AbortController();
    let tick = () => {};
    let finish = () => {};
    let release = () => {};
    const held = new Promise<void>((resolve) => { release = resolve; });
    let calls = 0;
    let settled = false;
    const cleared: unknown[] = [];
    const failure = new Error("synthetic scheduler failure");
    const run = runPreviewScenario({
      adapters: { twitch: { ingest() { calls += 1; return held; } } },
      scenarioEvents: buildPreviewScenarioEvents(32000, 2000).map((event) => ({ ...event, adapter: "twitch" })),
      intervalMs: 2000,
      durationMs: 32000,
      signal: controller.signal,
      safeSetIntervalImpl(callback) {
        tick = callback;
        if (mode === "setup") throw failure;
        return 41;
      },
      safeSetTimeoutImpl(callback) { finish = callback; if (mode === "timeout-setup") throw failure; return 42; },
      clearIntervalImpl(handle) { cleared.push(handle); },
      clearTimeoutImpl(handle) { cleared.push(handle); },
      errorHandler: { handleEventProcessingError() { throw failure; } },
    });
    const outcome = run.then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
    if (mode === "abort") controller.abort();
    else finish();
    tick();
    await Promise.resolve();
    expect(calls).toBe(1);
    expect(settled).toBe(false);
    release();
    expect(await outcome).toBe(mode === "setup" || mode === "timeout-setup" ? failure : null);
    expect(cleared).toEqual(mode === "setup" ? [] : mode === "timeout-setup" ? [41] : [41, 42]);
  });

  it.each([false, true])("reports synchronous ingest failures and continues admission (reporter throws: %s)", async (reporterThrows) => {
    let calls = 0;
    let reports = 0;
    const failure = new Error("synthetic reporter failure");
    const run = runPreviewScenario({
      adapters: { twitch: { ingest() { calls += 1; if (calls === 1) throw new Error("synthetic ingest failure"); } } },
      scenarioEvents: buildPreviewScenarioEvents(32000, 2000).map((event) => ({ ...event, adapter: "twitch" })),
      intervalMs: 2000,
      durationMs: 32000,
      safeSetIntervalImpl(callback) { callback(); return 41; },
      safeSetTimeoutImpl(callback) { callback(); return 42; },
      clearIntervalImpl() {},
      clearTimeoutImpl() {},
      errorHandler: { handleEventProcessingError() { reports += 1; if (reporterThrows) throw failure; } },
    });
    if (reporterThrows) await expect(run).rejects.toBe(failure);
    else await run;
    expect(calls).toBe(2);
    expect(reports).toBe(1);
  });

  it.each(["already", "ingest", "interval", "timeout"])("closes admission and retires timers on synchronous %s abort", async (phase) => {
    const controller = new AbortController();
    if (phase === "already") controller.abort();
    let calls = 0;
    let timerRegistrations = 0;
    const cleared: unknown[] = [];
    await runPreviewScenario({
      adapters: { twitch: { ingest() { calls += 1; if (phase === "ingest") controller.abort(); } } },
      scenarioEvents: buildPreviewScenarioEvents(32000, 2000).map((event) => ({ ...event, adapter: "twitch" })),
      intervalMs: 2000,
      durationMs: 32000,
      signal: controller.signal,
      safeSetIntervalImpl() { timerRegistrations += 1; if (phase === "interval") controller.abort(); return 41; },
      safeSetTimeoutImpl() { timerRegistrations += 1; if (phase === "timeout") controller.abort(); return 42; },
      clearIntervalImpl(handle) { cleared.push(handle); },
      clearTimeoutImpl(handle) { cleared.push(handle); },
      errorHandler: { handleEventProcessingError() {} },
    });
    expect(calls).toBe(phase === "already" ? 0 : 1);
    expect(timerRegistrations).toBe(phase === "interval" ? 1 : phase === "timeout" ? 2 : 0);
    expect(cleared).toEqual(phase === "interval" ? [41] : phase === "timeout" ? [41, 42] : []);
  });

  it("observes asynchronous reporter failures after stopping timers and joining other ingest", async () => {
    let tick = () => {};
    let finish = () => {};
    let rejectIngest = (_error: Error) => {};
    let release = () => {};
    const failing = new Promise<void>((_resolve, reject) => { rejectIngest = reject; });
    const held = new Promise<void>((resolve) => { release = resolve; });
    const failure = new Error("synthetic asynchronous reporter failure");
    let calls = 0;
    let settled = false;
    const cleared: unknown[] = [];
    const run = runPreviewScenario({
      adapters: { twitch: { ingest() { calls += 1; return calls === 1 ? failing : held; } } },
      scenarioEvents: buildPreviewScenarioEvents(32000, 2000).map((event) => ({ ...event, adapter: "twitch" })),
      intervalMs: 2000,
      durationMs: 32000,
      safeSetIntervalImpl(callback) { tick = callback; return 41; },
      safeSetTimeoutImpl(callback) { finish = callback; return 42; },
      clearIntervalImpl(handle) { cleared.push(handle); },
      clearTimeoutImpl(handle) { cleared.push(handle); },
      errorHandler: { handleEventProcessingError() { throw failure; } },
    });
    const outcome = run.then(() => { settled = true; return null; }, (error: unknown) => { settled = true; return error; });
    tick();
    rejectIngest(new Error("synthetic asynchronous ingest failure"));
    finish();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(false);
    expect(cleared).toEqual([41, 42]);
    tick();
    expect(calls).toBe(2);
    release();
    expect(await outcome).toBe(failure);
  });

  it("routes ingest events through the preview pipeline boundaries", async () => {
    const routedNotifications: UnknownRecord[] = [];
    const routedChats: UnknownRecord[] = [];
    let disposedCooldown = false;
    let stoppedDisplayQueue = false;

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
        async stop() {
          stoppedDisplayQueue = true;
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
    expect(requireValue(routedChats[0], "routed chat").type).toBe("chat");
    expect(routedNotifications.length).toBe(1);
    expect(
      requireValue(routedNotifications[0], "routed notification").type,
    ).toBe("platform:follow");

    await pipeline.dispose();
    expect(disposedCooldown).toBe(true);
    expect(stoppedDisplayQueue).toBe(true);
  });

  it("acknowledges preview VFX commands as executed and completed", async () => {
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
        addItem() {},
        async stop() {},
      },
      commandCooldownService: {
        dispose() {},
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
    const acknowledgements: UnknownRecord[] = [];
    const unsubscribeExecuted = pipeline.eventBus.subscribe(
      "vfx:command-executed",
      (payload: UnknownRecord) => acknowledgements.push(payload),
    );
    const unsubscribeCompleted = pipeline.eventBus.subscribe(
      "vfx:effect-completed",
      (payload: UnknownRecord) => acknowledgements.push(payload),
    );

    pipeline.eventBus.emit("vfx:command-received", {
      correlationId: "test-preview-correlation",
    });
    await waitForDelay(1);

    expect(acknowledgements).toEqual([
      {
        correlationId: "test-preview-correlation",
        type: "vfx:command-executed",
      },
      {
        correlationId: "test-preview-correlation",
        type: "vfx:effect-completed",
      },
    ]);

    unsubscribeExecuted();
    unsubscribeCompleted();
    await pipeline.dispose();
    await pipeline.dispose();
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
      chatItem: createYouTubeChatItem({
        username: "test-youtube-user",
        userId: "test-youtube-user-id",
        timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, 1)).toISOString(),
        message: "hello",
        avatarUrl: DEMO_CHARACTER_CATALOG.Ichigo,
      }),
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
    const youtubeChat = emitted.find(
      (event) =>
        event.type === "platform:chat-message" && event.platform === "youtube",
    );
    expect(youtubeChat?.data?.avatarUrl).toBe(DEMO_CHARACTER_CATALOG.Ichigo);
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
      chatItem: createYouTubeChatItem({
        username: "test-youtube-user",
        userId: "test-youtube-user-id",
        timestamp: new Date(Date.UTC(2024, 0, 1, 0, 0, 1)).toISOString(),
        message: "hello",
      }),
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
        type: "AddChatItemAction",
        item: {
          type: "LiveChatSponsorshipsGiftPurchaseAnnouncement",
          id: "test-youtube-gift-membership",
          timestamp,
          author: {
            id: "test-youtube-user-id",
            name: "test-youtube-user",
          },
          header: {
            author_name: { text: "test-youtube-user" },
            author_photo: [{ url: DEMO_CHARACTER_CATALOG.Ichigo }],
          },
          primary_text: { text: "Sent 4 gift memberships" },
          giftMembershipsCount: 4,
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
        giftDetails: {
          giftName: "Rose",
          diamondCount: 20,
          giftType: 0,
        },
        repeatEnd: 1,
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
        giftCoins: 10,
        currency: "coins",
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
          getAddress: () => ({ port: 3399 }),
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
        getAddress: () => ({ port: 3399 }),
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
          getAddress: () => ({ port: 3399 }),
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
          getAddress: () => ({ port: 3399 }),
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
        getAddress: () => ({ port: 3399 }),
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
            routed.push({ type: "platform:follow", platform: "twitch" });
          },
        },
        youtube: {
          async ingest() {
            if (!failedOnce) {
              failedOnce = true;
              throw new Error("ingest failed");
            }
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
        getAddress: () => ({ port: 3399 }),
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
    expect(requireValue(emittedEffects[0], "gift animation effect").durationMs).toBe(
      4200,
    );

    unsubscribeEffect();
    await pipeline.dispose();
  });

  it("keeps preview row pacing independent from gift effect duration", async () => {
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

    expect(delayCalls.includes(4200)).toBe(false);

    await pipeline.dispose();
  });
});
