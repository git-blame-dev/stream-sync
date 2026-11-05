import { describe, expect, it } from "bun:test";
import * as previewModule from "../../../scripts/local/gui-preview.ts";
import { DEMO_CHARACTER_CATALOG } from "../../../gui/src/demo/demo-catalog.ts";
import { safeSetInterval, safeSetTimeout } from "../../../src/utils/timeout-validator";
import { useFakeTimers, useRealTimers, advanceTimersByTime, getTimerCount } from "../../helpers/bun-timers";

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
  runGuiPreview: typeof previewModule.runGuiPreview;
};

const {
  PREVIEW_DURATION_MS,
  PREVIEW_INTERVAL_MS,
  PREVIEW_MEDIA_CATALOG,
  createPreviewDelay,
  buildPreviewConfig,
  buildPreviewScenarioEvents,
  parsePreviewScenario,
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

  it("uses enough preview duration for every scenario at a 2s cadence", () => {
    expect(PREVIEW_DURATION_MS).toBe(34000);
    expect(PREVIEW_INTERVAL_MS).toBe(2000);
  });

  it("builds deterministic ingest events for the full preview window", () => {
    const events = buildPreviewScenarioEvents();

    expect(events.length).toBe(17);
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

  it("rejects an explicit scenario duration that cannot dispatch every fixture", async () => {
    await expect(
      runGuiPreview({
        scenario: "notifications",
        durationMs: 4000,
        intervalMs: 2000,
        stdout: { write() {} },
      }),
    ).rejects.toThrow("requires at least 16000ms");
  });

  it("rejects a malformed public pipeline factory result before acquiring transport", async () => {
    await expect(runGuiPreview({
      logger: { debug() {}, info() {}, warn() {}, error() {}, console() {} },
      createPreviewPipelineImpl: () => ({ eventBus: {} }) as ReturnType<typeof previewModule.createPreviewPipeline>,
      stdout: { write() {} },
    })).rejects.toThrow("Preview pipeline requires eventBus and emitIngestEvent");
  });

  // Scheduler leaves test the public admission/callback contract; composition is
  // exercised with actual adapters, runtime, queue and HTTP in the integration family.
  it("dispatches every fixture through native scheduled boundaries and retires timers", async () => {
    useFakeTimers();
    const events = buildPreviewScenarioEvents();
    const seen: UnknownRecord[] = [];
    try {
      const run = runPreviewScenario({
        adapters: Object.fromEntries(["twitch", "youtube", "tiktok"].map(key =>
          [key, { ingest(rawEvent: UnknownRecord) { seen.push(rawEvent); } }])),
        scenarioEvents: events, intervalMs: 2000, durationMs: PREVIEW_DURATION_MS,
        safeSetIntervalImpl: safeSetInterval, safeSetTimeoutImpl: safeSetTimeout,
        errorHandler: { handleEventProcessingError() { throw new Error("Unexpected scheduler error"); } },
      });
      expect(seen).toEqual([events[0]!.rawEvent]);
      advanceTimersByTime(1999);
      expect(seen).toHaveLength(1);
      advanceTimersByTime(1);
      expect(seen).toHaveLength(2);
      advanceTimersByTime(PREVIEW_DURATION_MS - 2000);
      expect((await run).dispatchedEvents).toEqual(events);
      expect(seen).toEqual(events.map(event => event.rawEvent));
      expect(seen.at(-1)?.eventType).toBe("ENVELOPE");
      expect(getTimerCount()).toBe(0);
      advanceTimersByTime(32000);
      expect(seen).toHaveLength(events.length);
    } finally { useRealTimers(); }
  });

  it.each(["duration", "abort", "setup", "timeout-setup"])("joins admitted callback and retires native timers after %s", async mode => {
    useFakeTimers();
    const controller = new AbortController();
    let release = () => {};
    const held = new Promise<void>(resolve => { release = resolve; });
    let calls = 0;
    let settled = false;
    const failure = new Error("synthetic scheduler failure");
    let outcome: Promise<unknown> | undefined;
    try {
      const run = runPreviewScenario({
        adapters: { twitch: { ingest() { calls++; return held; } } },
        scenarioEvents: buildPreviewScenarioEvents().map(event => ({ ...event, adapter: "twitch" })),
        intervalMs: 2000, durationMs: 32000, signal: controller.signal,
        safeSetIntervalImpl: mode === "setup" ? () => { throw failure; } : safeSetInterval,
        safeSetTimeoutImpl: mode === "timeout-setup" ? () => { throw failure; } : safeSetTimeout,
        errorHandler: { handleEventProcessingError() {} },
      });
      outcome = run.then(() => { settled = true; return null; }, error => { settled = true; return error; });
      if (mode === "abort") controller.abort();
      if (mode === "duration") advanceTimersByTime(32000);
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(getTimerCount()).toBe(0);
      const admitted = calls;
      advanceTimersByTime(64000);
      expect(calls).toBe(admitted);
      release();
      expect(await outcome).toBe(mode === "setup" || mode === "timeout-setup" ? failure : null);
      expect(calls).toBe(mode === "duration" ? 16 : 1);
    } finally { controller.abort(); release(); await outcome; useRealTimers(); }
  });

  it.each([false, true])("reports synchronous callback failure and continues native admission (reporter throws: %s)", async reporterThrows => {
    useFakeTimers();
    let calls = 0;
    let reports = 0;
    const failure = new Error("synthetic reporter failure");
    try {
      const run = runPreviewScenario({
        adapters: { twitch: { ingest() { if (++calls === 1) throw new Error("synthetic ingest failure"); } } },
        scenarioEvents: buildPreviewScenarioEvents().map(event => ({ ...event, adapter: "twitch" })),
        intervalMs: 2000, durationMs: 5000,
        safeSetIntervalImpl: safeSetInterval, safeSetTimeoutImpl: safeSetTimeout,
        errorHandler: { handleEventProcessingError() { reports++; if (reporterThrows) throw failure; } },
      });
      const outcome = run.then(() => null, error => error);
      advanceTimersByTime(5000);
      expect(await outcome).toBe(reporterThrows ? failure : null);
      expect(calls).toBe(3);
      expect(reports).toBe(1);
      expect(getTimerCount()).toBe(0);
    } finally { useRealTimers(); }
  });

  it.each(["already", "ingest", "interval", "timeout"])("retires native registrations on synchronous %s abort", async phase => {
    useFakeTimers();
    const controller = new AbortController();
    if (phase === "already") controller.abort();
    let calls = 0;
    let registrations = 0;
    try {
      await runPreviewScenario({
        adapters: { twitch: { ingest() { calls++; if (phase === "ingest") controller.abort(); } } },
        scenarioEvents: buildPreviewScenarioEvents().map(event => ({ ...event, adapter: "twitch" })),
        intervalMs: 2000, durationMs: 32000, signal: controller.signal,
        safeSetIntervalImpl(callback, ms) {
          const handle = safeSetInterval(callback, ms); registrations++;
          if (phase === "interval") controller.abort();
          return handle;
        },
        safeSetTimeoutImpl(callback, ms) {
          const handle = safeSetTimeout(callback, ms); registrations++;
          if (phase === "timeout") controller.abort();
          return handle;
        },
        errorHandler: { handleEventProcessingError() {} },
      });
      expect(calls).toBe(phase === "already" ? 0 : 1);
      expect(registrations).toBe(phase === "interval" ? 1 : phase === "timeout" ? 2 : 0);
      expect(getTimerCount()).toBe(0);
      advanceTimersByTime(64000);
      expect(calls).toBe(phase === "already" ? 0 : 1);
    } finally { controller.abort(); useRealTimers(); }
  });

  it("joins other admitted callbacks before surfacing an asynchronous reporter failure", async () => {
    useFakeTimers();
    const controller = new AbortController();
    let reject = (_error: Error) => {};
    let release = () => {};
    const failed = new Promise<void>((_resolve, rejectPromise) => { reject = rejectPromise; });
    const held = new Promise<void>(resolve => { release = resolve; });
    const failure = new Error("synthetic asynchronous reporter failure");
    let calls = 0;
    let settled = false;
    let outcome: Promise<unknown> | undefined;
    try {
      const run = runPreviewScenario({
        adapters: { twitch: { ingest() { return ++calls === 1 ? failed : held; } } },
        scenarioEvents: buildPreviewScenarioEvents().map(event => ({ ...event, adapter: "twitch" })),
        intervalMs: 2000, durationMs: 32000, signal: controller.signal,
        safeSetIntervalImpl: safeSetInterval, safeSetTimeoutImpl: safeSetTimeout,
        errorHandler: { handleEventProcessingError() { throw failure; } },
      });
      outcome = run.then(() => { settled = true; return null; }, error => { settled = true; return error; });
      advanceTimersByTime(2000);
      reject(new Error("synthetic asynchronous ingest failure"));
      controller.abort();
      await Promise.resolve(); await Promise.resolve();
      expect(settled).toBe(false);
      expect(getTimerCount()).toBe(0);
      advanceTimersByTime(64000);
      expect(calls).toBe(2);
      release();
      expect(await outcome).toBe(failure);
    } finally { controller.abort(); release(); await outcome; useRealTimers(); }
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

});
