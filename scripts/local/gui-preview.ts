import EventEmitter from 'node:events';
import { createRequire } from 'node:module';
import * as TwitchEventRouterModule from '../../src/platforms/twitch/events/event-router.ts';
import * as CommandCooldownServiceModule from '../../src/services/CommandCooldownService.ts';
import * as UserTrackingServiceModule from '../../src/services/UserTrackingService.ts';
import * as VFXCommandServiceModule from '../../src/services/VFXCommandService.ts';

type UnknownRecord = Record<string, unknown>;

type PreviewLogFn = (...args: unknown[]) => void;

interface PreviewLogger {
    debug: PreviewLogFn;
    console: PreviewLogFn;
    info: PreviewLogFn;
    warn: PreviewLogFn;
    error: PreviewLogFn;
}

type PreviewEventBus = {
    emit: (eventName: string, payload?: unknown) => void;
    subscribe: (eventName: string, handler: (payload: unknown) => void) => () => void;
};

type TwitchEventRouterFactory = (options: UnknownRecord) => {
    handleNotificationEvent: (subscriptionType: string, event: UnknownRecord, metadata: UnknownRecord) => void;
};

type CreateUserTrackingService = () => {
    isFirstMessage: (userId: unknown, context: unknown) => unknown;
};

type CreateVFXCommandService = (...args: unknown[]) => unknown;

type CommandCooldownServiceCtor = new (options?: {
    config: UnknownRecord;
    eventBus: PreviewEventBus;
    logger: PreviewLogger;
}) => {
    dispose?: () => void;
};

const createTwitchEventSubEventRouterCandidate = (TwitchEventRouterModule as {
    createTwitchEventSubEventRouter?: TwitchEventRouterFactory;
}).createTwitchEventSubEventRouter;
if (typeof createTwitchEventSubEventRouterCandidate !== 'function') {
    throw new Error('gui-preview requires createTwitchEventSubEventRouter');
}
const createTwitchEventSubEventRouter: TwitchEventRouterFactory = createTwitchEventSubEventRouterCandidate;

const createUserTrackingServiceCandidate = (UserTrackingServiceModule as {
    createUserTrackingService?: CreateUserTrackingService;
}).createUserTrackingService;
if (typeof createUserTrackingServiceCandidate !== 'function') {
    throw new Error('gui-preview requires createUserTrackingService');
}
const createUserTrackingService: CreateUserTrackingService = createUserTrackingServiceCandidate;

const createVFXCommandServiceCandidate = (VFXCommandServiceModule as {
    createVFXCommandService?: CreateVFXCommandService;
}).createVFXCommandService;
if (typeof createVFXCommandServiceCandidate !== 'function') {
    throw new Error('gui-preview requires createVFXCommandService');
}
const createVFXCommandService: CreateVFXCommandService = createVFXCommandServiceCandidate;

const CommandCooldownServiceClassCandidate = (CommandCooldownServiceModule as {
    CommandCooldownService?: CommandCooldownServiceCtor;
}).CommandCooldownService;
if (typeof CommandCooldownServiceClassCandidate !== 'function') {
    throw new Error('gui-preview requires CommandCooldownService');
}
const CommandCooldownServiceClass: CommandCooldownServiceCtor = CommandCooldownServiceClassCandidate;

const load = createRequire(__filename);
const configModule = load('../../src/core/config');
const { logger: defaultLogger } = load('../../src/core/logging');
const { createEventBus } = load('../../src/core/EventBus');
const { PlatformEvents } = load('../../src/interfaces/PlatformEvents');
const { PRIORITY_LEVELS, NOTIFICATION_CONFIGS } = load('../../src/core/constants');
const { createPlatformErrorHandler } = load('../../src/utils/platform-error-handler');
const { safeSetInterval, safeSetTimeout, safeDelay } = load('../../src/utils/timeout-validator');
const { createGuiTransportService } = load('../../src/services/gui/gui-transport-service');
const { PlatformEventRouter } = load('../../src/services/PlatformEventRouter.ts');
const { ChatNotificationRouter } = load('../../src/services/ChatNotificationRouter.ts');
const NotificationManager = load('../../src/notifications/NotificationManager');
const { DisplayQueue } = load('../../src/obs/display-queue');
const { createTikTokGiftAnimationResolver } = load('../../src/services/tiktok-gift-animation/resolver');
const { createYouTubeEventRouter } = load('../../src/platforms/youtube/events/event-router');
const { setupTikTokEventListeners } = load('../../src/platforms/tiktok/events/event-router.ts');
const { DEFAULT_AVATAR_URL } = load('../../src/constants/avatar');

type PreviewAdapter = 'twitch' | 'youtube' | 'tiktok';

interface PreviewScenarioStep {
    type: string;
    adapter: PreviewAdapter;
}

interface PreviewScenarioEvent {
    platform: PreviewAdapter;
    adapter: PreviewAdapter;
    rawEvent: UnknownRecord;
}

interface PreviewIngestAdapter {
    ingest: (rawEvent: UnknownRecord) => Promise<void>;
}

interface PreviewIngestAdapters {
    twitch: PreviewIngestAdapter;
    youtube: PreviewIngestAdapter;
    tiktok: PreviewIngestAdapter;
}

interface PreviewPipeline {
    eventBus: PreviewEventBus;
    emitIngestEvent: (event: UnknownRecord) => void;
    dispose: () => Promise<void>;
}

interface PreviewService {
    start: () => Promise<void>;
    stop: () => Promise<void>;
}

interface PreviewErrorHandler {
    handleEventProcessingError: (error: unknown, context: string, payload: unknown, message: string) => void;
}

interface CreatePreviewIngestAdaptersOptions {
    config?: UnknownRecord;
    logger?: PreviewLogger | UnknownRecord;
    emitPlatformEvent: (event: UnknownRecord) => void;
}

interface CreatePreviewPipelineOptions {
    config?: UnknownRecord;
    logger?: PreviewLogger | UnknownRecord;
    eventBus?: PreviewEventBus;
    obsManager?: {
        isReady: () => Promise<boolean>;
        call: (method: string, params?: UnknownRecord) => Promise<UnknownRecord>;
    };
    displayQueue?: unknown;
    commandCooldownService?: {
        dispose?: () => void;
    };
    userTrackingService?: {
        isFirstMessage?: (userId: unknown, context: unknown) => unknown;
    };
    vfxCommandService?: unknown;
    notificationManager?: {
        handleNotification?: (type: string, platform: string, payload: UnknownRecord) => Promise<UnknownRecord>;
    };
    platformLifecycleService?: {
        getPlatformConnectionTime?: (platform?: string) => unknown;
    };
    delay?: (ms: number) => Promise<unknown>;
    giftAnimationResolver?: {
        resolveFromNotificationData?: (payload: unknown) => Promise<unknown>;
    };
}

interface CreatePreviewRuntimeOptions {
    config: UnknownRecord;
    logger: PreviewLogger;
    displayQueue: unknown;
    notificationManager: {
        handleNotification: (type: string, platform: string, payload: UnknownRecord) => Promise<unknown>;
    };
    commandCooldownService: {
        dispose?: () => void;
    };
    userTrackingService: {
        isFirstMessage: (userId: unknown, context: unknown) => unknown;
    };
    vfxCommandService: unknown;
    platformLifecycleService: {
        getPlatformConnectionTime?: (platform?: string) => unknown;
    };
}

interface PreviewRuntime {
    config: UnknownRecord;
    logger: PreviewLogger;
    displayQueue: unknown;
    notificationManager: {
        handleNotification: (type: string, platform: string, payload: UnknownRecord) => Promise<unknown>;
    };
    commandCooldownService: {
        dispose?: () => void;
    };
    userTrackingService: {
        isFirstMessage: (userId: unknown, context: unknown) => unknown;
    };
    vfxCommandService: unknown;
    platformLifecycleService: {
        getPlatformConnectionTime?: (platform?: string) => unknown;
    };
    gracefulExitService: null;
    isFirstMessage: (userId: unknown, context: unknown) => unknown;
    handleFollowNotification?: (platform: string, username: string, payload?: UnknownRecord) => Promise<unknown>;
    handleShareNotification?: (platform: string, username: string, payload?: UnknownRecord) => Promise<unknown>;
    handleRaidNotification?: (platform: string, username: string, payload?: UnknownRecord) => Promise<unknown>;
    handleGiftNotification?: (platform: string, username: string, payload?: UnknownRecord) => Promise<unknown>;
    handlePaypiggyNotification?: (platform: string, username: string, payload?: UnknownRecord) => Promise<unknown>;
    handleGiftPaypiggyNotification?: (platform: string, username: string, payload?: UnknownRecord) => Promise<unknown>;
    handleFarewellNotification?: (platform: string, username: string, payload?: UnknownRecord) => Promise<unknown>;
    handleEnvelopeNotification?: (platform: string, payload?: UnknownRecord) => Promise<unknown>;
    handleChatMessage?: (platform: string, normalizedData?: UnknownRecord) => Promise<unknown>;
}

interface RunPreviewScenarioOptions {
    adapters: Partial<Record<PreviewAdapter, PreviewIngestAdapter>>;
    scenarioEvents: PreviewScenarioEvent[];
    intervalMs: number;
    durationMs: number;
    safeSetIntervalImpl: (handler: () => void, delayMs: number) => ReturnType<typeof setInterval> | number;
    safeSetTimeoutImpl: (handler: () => void, delayMs: number) => unknown;
    errorHandler: PreviewErrorHandler;
}

interface DisposePreviewPipelineOptions {
    intervalHandle?: ReturnType<typeof setInterval> | number | null;
    service?: PreviewService | null;
    pipeline?: PreviewPipeline | null;
    errorHandler: PreviewErrorHandler;
}

interface RunGuiPreviewOptions {
    baseConfig?: UnknownRecord;
    durationMs?: number;
    intervalMs?: number;
    logger?: PreviewLogger | UnknownRecord;
    createPreviewPipelineImpl?: (options: CreatePreviewPipelineOptions) => PreviewPipeline;
    createPreviewIngestAdaptersImpl?: (options: CreatePreviewIngestAdaptersOptions) => PreviewIngestAdapters;
    createGuiTransportServiceImpl?: (options: {
        config: UnknownRecord;
        eventBus: PreviewEventBus;
        logger: PreviewLogger;
    }) => PreviewService;
    safeSetIntervalImpl?: (handler: () => void, delayMs: number) => ReturnType<typeof setInterval> | number;
    safeSetTimeoutImpl?: (handler: () => void, delayMs: number) => unknown;
    stdout?: {
        write: (text: string) => void;
    };
    delay?: (ms: number) => Promise<unknown>;
    giftAnimationResolver?: {
        resolveFromNotificationData: (payload: unknown) => Promise<unknown>;
    };
    eventBus?: PreviewEventBus;
}

const PREVIEW_DURATION_MS = 32000;
const PREVIEW_INTERVAL_MS = 2000;

const PREVIEW_AVATAR_URL = DEFAULT_AVATAR_URL;
const PREVIEW_MESSAGE_TEXT = 'test message hello world this is a message to everyone how are we today?';
const PREVIEW_MEDIA_CATALOG: Record<PreviewAdapter, UnknownRecord> = {
    twitch: {
        avatarUrl: PREVIEW_AVATAR_URL,
        badges: [
            {
                imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/3267646d-33f0-4b17-b3df-f923a41db1d0/3',
                source: 'twitch',
                label: 'Moderator'
            },
            {
                imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/511b78a9-ab37-472f-9569-457753bbe7d3/3',
                source: 'twitch',
                label: 'Founder'
            },
            {
                imageUrl: 'https://static-cdn.jtvnw.net/badges/v1/bbbe0db0-a598-423e-86d0-f9fb98ca1933/3',
                source: 'twitch',
                label: 'Prime Gaming'
            }
        ],
        emote: {
            id: 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
            imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
        }
    },
    youtube: {
        avatarUrl: PREVIEW_AVATAR_URL,
        badges: [
            {
                imageUrl: 'https://yt3.ggpht.com/qh4HyXNMbx5x0_HtQ53rpdtMdEv7OTq6hsebWwybYRlKtdYH5m6bq8kviuVZMvxAbGHWH86FV15Opfs=s32-c-k',
                source: 'youtube',
                label: 'Member'
            }
        ],
        emote: {
            id: 'UCkszU2WH9gy1mb0dV-11UJg/G8AfY6yWGuKuhL0PlbiA2AE',
            imageUrl: 'https://yt3.ggpht.com/KOxdr_z3A5h1Gb7kqnxqOCnbZrBmxI2B_tRQ453BhTWUhYAlpg5ZP8IKEBkcvRoY8grY91Q=w48-h48-c-k-nd'
        }
    },
    tiktok: {
        avatarUrl: PREVIEW_AVATAR_URL,
        badges: [
            {
                imageUrl: 'https://p16-webcast.tiktokcdn.com/webcast-sg/webcast_admin_badge_tiktok.png~tplv-obj.image',
                source: 'tiktok',
                label: 'Moderator'
            },
            {
                imageUrl: 'https://p16-webcast.tiktokcdn.com/webcast-va/grade_badge_icon_lite_lv20_v1.png~tplv-obj.image',
                source: 'tiktok',
                label: 'Level'
            }
        ],
        emote: {
            id: '0123456789012345678',
            imageUrl: 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0'
        },
        gift: {
            name: 'Corgi',
            giftId: '6267',
            primaryEffectId: '9695',
            imageUrl: 'https://p16-webcast.tiktokcdn.com/img/maliva/webcast-va/148eef0884fdb12058d1c6897d1e02b9~tplv-obj.png',
            unitAmount: 299,
            animation: {
                resourceModelUrl: 'https://sf16-webcast.tiktokcdn.com/obj/maliva/webcast-va/resource/942b9cf600824c3a4834d1d73cc058d2.zip',
                videoResources: [
                    {
                        videoTypeName: 'h264',
                        videoUrl: {
                            urlList: [
                                'https://sf16-webcast.tiktokcdn.com/obj/maliva/webcast-va/resource/942b9cf600824c3a4834d1d73cc058d2.zip'
                            ]
                        }
                    },
                    {
                        videoTypeName: 'bytevc1opt',
                        videoUrl: {
                            urlList: [
                                'https://sf16-webcast.tiktokcdn.com/obj/maliva/webcast-va/resource/02e8c5dfa12e71ed4a2015b1d7d8c36d.zip'
                            ]
                        }
                    },
                    {
                        videoTypeName: '480p',
                        videoUrl: {
                            urlList: [
                                'https://sf16-webcast.tiktokcdn.com/obj/maliva/webcast-va/resource/e2e5daca28d71225a72bd4fbb9698e64.zip'
                            ]
                        }
                    }
                ]
            }
        }
    }
};

const PREVIEW_SCENARIO_TEMPLATE = [
    { type: 'chat-hi', adapter: 'twitch' },
    { type: 'gift', adapter: 'tiktok' },
    { type: 'chat-hello', adapter: 'youtube' },
    { type: 'chat', adapter: 'twitch' },
    { type: 'chat', adapter: 'youtube' },
    { type: 'chat', adapter: 'tiktok' },
    { type: 'chat-no', adapter: 'tiktok' },
    { type: 'follow', adapter: 'tiktok' },
    { type: 'chat-command', adapter: 'youtube' },
    { type: 'chat-farewell', adapter: 'twitch' },
    { type: 'raid', adapter: 'twitch' },
    { type: 'chat-member-hi', adapter: 'youtube' },
    { type: 'share', adapter: 'tiktok' },
    { type: 'paypiggy', adapter: 'youtube' },
    { type: 'giftpaypiggy', adapter: 'youtube' },
    { type: 'envelope', adapter: 'tiktok' }
];

const PREVIEW_PLATFORM_ACCOUNTS = [
    {
        platform: 'twitch',
        username: 'test-twitch-account',
        userId: 'test-twitch-account-id'
    },
    {
        platform: 'youtube',
        username: 'test-youtube-account',
        userId: 'test-youtube-account-id'
    },
    {
        platform: 'tiktok',
        username: 'test-tiktok-account',
        userId: 'test-tiktok-account-id'
    }
];

const NOOP_LOGGER = {
    debug: () => {},
    console: () => {},
    info: () => {},
    warn: () => {},
    error: () => {}
};

function createGuiPreviewErrorHandler(logger: PreviewLogger): PreviewErrorHandler {
    return createPlatformErrorHandler(logger, 'gui-preview');
}

function resolveLogger(logger?: PreviewLogger | UnknownRecord): PreviewLogger {
    const source: UnknownRecord = (logger && typeof logger.error === 'function')
        ? logger
        : ((defaultLogger && typeof defaultLogger.error === 'function') ? defaultLogger : NOOP_LOGGER);

    return {
        debug: typeof source.debug === 'function' ? source.debug.bind(source) : NOOP_LOGGER.debug,
        console: typeof source.console === 'function'
            ? source.console.bind(source)
            : (typeof source.info === 'function' ? source.info.bind(source) : NOOP_LOGGER.console),
        info: typeof source.info === 'function' ? source.info.bind(source) : NOOP_LOGGER.info,
        warn: typeof source.warn === 'function' ? source.warn.bind(source) : NOOP_LOGGER.warn,
        error: typeof source.error === 'function' ? source.error.bind(source) : NOOP_LOGGER.error
    };
}

function mergeSection(
    baseSection?: UnknownRecord | null,
    overrideSection?: UnknownRecord | null,
    forcedSection?: UnknownRecord | null
): UnknownRecord {
    return {
        ...(baseSection || {}),
        ...(overrideSection || {}),
        ...(forcedSection || {})
    };
}

function buildPreviewConfig(baseConfig: UnknownRecord = {}): UnknownRecord {
    const sourceConfig = configModule.config || {};
    const overrideConfig = baseConfig || {};

    const merged = {
        ...sourceConfig,
        ...overrideConfig
    };

    const resolveNonEmptyString = (preferredValue: unknown, fallbackValue: unknown): string => {
        if (typeof preferredValue === 'string' && preferredValue.trim().length > 0) {
            return preferredValue;
        }
        if (typeof fallbackValue === 'string' && fallbackValue.trim().length > 0) {
            return fallbackValue;
        }
        return '';
    };

    merged.general = mergeSection(sourceConfig.general, overrideConfig.general, {
        messagesEnabled: true,
        commandsEnabled: true,
        greetingsEnabled: true,
        farewellsEnabled: true,
        followsEnabled: true,
        giftsEnabled: true,
        raidsEnabled: true,
        sharesEnabled: true,
        paypiggiesEnabled: true,
        filterOldMessages: false
    });

    merged.ttsEnabled = false;

    const platformFlags = {
        messagesEnabled: true,
        commandsEnabled: true,
        greetingsEnabled: true,
        farewellsEnabled: true,
        followsEnabled: true,
        giftsEnabled: true,
        raidsEnabled: true,
        sharesEnabled: true,
        paypiggiesEnabled: true
    };

    merged.twitch = mergeSection(sourceConfig.twitch, overrideConfig.twitch, platformFlags);
    merged.youtube = mergeSection(sourceConfig.youtube, overrideConfig.youtube, platformFlags);
    merged.tiktok = mergeSection(sourceConfig.tiktok, overrideConfig.tiktok, {
        ...platformFlags,
        sharesEnabled: true
    });

    merged.gui = mergeSection(sourceConfig.gui, overrideConfig.gui, {
        enableDock: true,
        enableOverlay: true,
        uiCompareMode: true,
        showMessages: true,
        showCommands: true,
        showGreetings: true,
        showFarewells: true,
        showFollows: true,
        showShares: true,
        showRaids: true,
        showGifts: true,
        showPaypiggies: true,
        showGiftPaypiggies: true,
        showEnvelopes: true
    });

    merged.chat = mergeSection(sourceConfig.chat, overrideConfig.chat, {
        sourceName: 'preview-chat-source',
        sceneName: 'preview-chat-scene',
        groupName: null,
        platformLogos: {}
    });

    merged.notification = mergeSection(sourceConfig.notification, overrideConfig.notification, {
        sourceName: 'preview-notification-source',
        sceneName: 'preview-notification-scene',
        groupName: null,
        platformLogos: {}
    });

    merged.gifts = mergeSection(sourceConfig.gifts, overrideConfig.gifts, {
        giftVideoSource: 'preview-gift-video',
        giftAudioSource: 'preview-gift-audio'
    });

    const sourceCooldowns = sourceConfig.cooldowns || {};
    const overrideCooldowns = overrideConfig.cooldowns || {};
    merged.cooldowns = {
        ...sourceCooldowns,
        ...overrideCooldowns,
        cmdCooldown: 0,
        cmdCooldownMs: 0,
        globalCmdCooldown: 0,
        globalCmdCooldownMs: 0,
        heavyCommandCooldown: 0,
        heavyCommandCooldownMs: 0,
        heavyCommandWindow: overrideCooldowns.heavyCommandWindow ?? sourceCooldowns.heavyCommandWindow ?? 1,
        heavyCommandWindowMs: overrideCooldowns.heavyCommandWindowMs ?? sourceCooldowns.heavyCommandWindowMs ?? 1000,
        heavyCommandThreshold: overrideCooldowns.heavyCommandThreshold ?? sourceCooldowns.heavyCommandThreshold ?? 999,
        maxEntries: overrideCooldowns.maxEntries ?? sourceCooldowns.maxEntries ?? 1000
    };

    merged.farewell = mergeSection(sourceConfig.farewell, overrideConfig.farewell, {
        timeout: overrideConfig?.farewell?.timeout ?? sourceConfig?.farewell?.timeout ?? 1,
        command: resolveNonEmptyString(overrideConfig?.farewell?.command, sourceConfig?.farewell?.command) || '!bye'
    });

    merged.displayQueue = mergeSection(sourceConfig.displayQueue, overrideConfig.displayQueue, {
        autoProcess: true
    });

    merged.timing = mergeSection(sourceConfig.timing, overrideConfig.timing, {
        transitionDelay: 120,
        notificationClearDelay: 0,
        commentDuration: 1500
    });

    merged.commands = {
        ...(sourceConfig.commands || {}),
        ...(overrideConfig.commands || {}),
        preview: resolveNonEmptyString(overrideConfig?.commands?.preview, sourceConfig?.commands?.preview)
            || '!preview,Preview Media,1000'
    };

    return merged;
}

function buildPreviewScenarioEvents(
    durationMs: number = PREVIEW_DURATION_MS,
    intervalMs: number = PREVIEW_INTERVAL_MS
): PreviewScenarioEvent[] {
    const eventCount = Math.floor(durationMs / intervalMs);
    const events: PreviewScenarioEvent[] = [];

    const getAccount = (platform: PreviewAdapter): UnknownRecord => PREVIEW_PLATFORM_ACCOUNTS.find((entry) => entry.platform === platform) || PREVIEW_PLATFORM_ACCOUNTS[0];
    const firstPrimaryChatByPlatform = new Set();

    for (let index = 0; index < eventCount; index += 1) {
        const scenarioStep = PREVIEW_SCENARIO_TEMPLATE[index % PREVIEW_SCENARIO_TEMPLATE.length] as PreviewScenarioStep;
        const scenarioType = scenarioStep.type;
        const adapter = scenarioStep.adapter;
        const account = getAccount(adapter);
        const media = PREVIEW_MEDIA_CATALOG[adapter] || { avatarUrl: PREVIEW_AVATAR_URL, emote: null };
        const timestamp = new Date(Date.UTC(2024, 0, 1, 0, 0, index)).toISOString();
        const username = `${account.username}-${index}`;
        const userId = `${account.userId}-${index}`;
        const base = {
            username,
            userId,
            timestamp
        };
        const isPrimaryChatStep = scenarioType === 'chat';
        const includePreviewBadges = isPrimaryChatStep && !firstPrimaryChatByPlatform.has(adapter);
        if (includePreviewBadges) {
            firstPrimaryChatByPlatform.add(adapter);
        }

        if (adapter === 'twitch') {
            if (scenarioType === 'chat' || scenarioType === 'chat-hi' || scenarioType === 'chat-hello' || scenarioType === 'chat-command' || scenarioType === 'chat-farewell') {
                const text = scenarioType === 'chat-command'
                    ? '!preview'
                    : (scenarioType === 'chat-hi'
                        ? 'hi'
                        : (scenarioType === 'chat-hello'
                            ? 'hello'
                            : (scenarioType === 'chat-farewell' ? '!bye' : PREVIEW_MESSAGE_TEXT)));
                events.push({
                    platform: 'twitch',
                    adapter: 'twitch',
                    rawEvent: {
                        subscriptionType: 'channel.chat.message',
                        metadata: {
                            message_timestamp: timestamp,
                            previewPaypiggy: scenarioType === 'chat'
                        },
                        event: {
                            ...base,
                            user_name: username,
                            user_id: userId,
                            user_login: userId,
                            isPaypiggy: scenarioType === 'chat',
                            badgeImages: includePreviewBadges ? media.badges : undefined,
                            is_mod: false,
                            is_broadcaster: false,
                            message: {
                                text,
                                fragments: scenarioType === 'chat'
                                    ? [
                                        {
                                            type: 'emote',
                                            text: ':preview1:',
                                            emote: {
                                                id: media.emote?.id || 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                                                emote_set_id: 'preview'
                                            }
                                        },
                                        { type: 'text', text: ' test message ' },
                                        {
                                            type: 'emote',
                                            text: ':preview2:',
                                            emote: {
                                                id: media.emote?.id || 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                                                emote_set_id: 'preview'
                                            }
                                        },
                                        { type: 'text', text: ' hello world this is a message to everyone ' },
                                        {
                                            type: 'emote',
                                            text: ':preview3:',
                                            emote: {
                                                id: media.emote?.id || 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                                                emote_set_id: 'preview'
                                            }
                                        },
                                        { type: 'text', text: ' how are we today?' }
                                    ]
                                    : [{ type: 'text', text }]
                            }
                        }
                    }
                });
                continue;
            }

            const twitchMap: Record<string, string> = {
                follow: 'channel.follow',
                gift: 'channel.bits.use',
                raid: 'channel.raid',
                paypiggy: 'channel.subscribe',
                giftpaypiggy: 'channel.subscription.gift'
            };
            const subscriptionType = twitchMap[scenarioType] || 'channel.follow';
            events.push({
                platform: 'twitch',
                adapter: 'twitch',
                rawEvent: {
                    subscriptionType,
                    metadata: {
                        message_timestamp: timestamp
                    },
                    event: {
                        ...base,
                        id: `test-${scenarioType}-${index}`,
                        user_name: username,
                        user_id: userId,
                        user_login: userId,
                        followed_at: timestamp,
                        from_broadcaster_user_name: username,
                        from_broadcaster_user_id: userId,
                        from_broadcaster_user_login: userId,
                        viewers: 42,
                        tier: '1000',
                        total: 2,
                        bits: 100,
                        is_anonymous: false,
                        is_gift: false
                    }
                }
            });
            continue;
        }

        if (adapter === 'youtube') {
            const isMemberHiChat = scenarioType === 'chat-member-hi';
            const isPreviewPaypiggyChat = scenarioType === 'chat';
            const eventType = scenarioType === 'giftpaypiggy'
                ? 'LiveChatSponsorshipsGiftPurchaseAnnouncement'
                : (scenarioType === 'gift' ? 'LiveChatPaidSticker' : (scenarioType === 'paypiggy' ? 'LiveChatMembershipItem' : 'LiveChatTextMessage'));
            const text = isMemberHiChat
                ? 'Hi!'
                : (scenarioType === 'chat-command'
                ? '!preview'
                : (scenarioType === 'chat-hi'
                    ? 'hi'
                    : (scenarioType === 'chat-hello'
                        ? 'hello'
                        : (scenarioType === 'chat-farewell' ? '!bye' : `preview message ${index}`))));
            events.push({
                platform: 'youtube',
                adapter: 'youtube',
                rawEvent: {
                    eventType,
                    chatItem: {
                        testData: {
                            ...base,
                            username,
                            userId,
                            message: text,
                            isPaypiggy: isPreviewPaypiggyChat || isMemberHiChat,
                            badgeImages: includePreviewBadges ? media.badges : undefined,
                            avatarUrl: media.avatarUrl,
                            messageParts: isPreviewPaypiggyChat
                                ? [
                                    {
                                        type: 'emote',
                                        imageUrl: media.emote?.imageUrl,
                                        emoteId: `${media.emote?.id || 'yt-preview-emote'}-1`
                                    },
                                    {
                                        type: 'text',
                                        text: ' test message '
                                    },
                                    {
                                        type: 'emote',
                                        imageUrl: media.emote?.imageUrl,
                                        emoteId: `${media.emote?.id || 'yt-preview-emote'}-2`
                                    },
                                    {
                                        type: 'text',
                                        text: ' hello world this is a message to everyone '
                                    },
                                    {
                                        type: 'emote',
                                        imageUrl: media.emote?.imageUrl,
                                        emoteId: `${media.emote?.id || 'yt-preview-emote'}-3`
                                    },
                                    {
                                        type: 'text',
                                        text: ' how are we today?'
                                    }
                                ]
                                : undefined,
                            amount: 5,
                            currency: 'USD',
                            giftCount: 3,
                            tier: '1'
                        }
                    }
                }
            });
            continue;
        }

        const tiktokEventType = scenarioType === 'gift'
            ? 'GIFT'
            : (scenarioType === 'follow' ? 'FOLLOW' : (scenarioType === 'share' ? 'SOCIAL' : (scenarioType === 'envelope' ? 'ENVELOPE' : 'CHAT')));
        const comment = scenarioType === 'chat-command'
            ? '!preview'
            : (scenarioType === 'chat-hi'
                ? 'hi'
                : (scenarioType === 'chat-hello'
                    ? 'hello'
                    : (scenarioType === 'chat-farewell'
                        ? '!bye'
                        : (scenarioType === 'chat-no'
                            ? 'test no no no no no no no no no no no no no no no no no no on no no no no no no no no no no no no no no no no no . no no no no no no no no no no on no no no no no'
                            : PREVIEW_MESSAGE_TEXT))));
        const tiktokEmotes = scenarioType === 'chat'
            ? [
                {
                    placeInComment: 5,
                    emote: {
                        emoteId: media.emote?.id || '0123456789012345678',
                        image: {
                            imageUrl: media.emote?.imageUrl
                        }
                    }
                },
                {
                    placeInComment: 17,
                    emote: {
                        emoteId: media.emote?.id || '0123456789012345678',
                        image: {
                            imageUrl: media.emote?.imageUrl
                        }
                    }
                },
                {
                    placeInComment: 33,
                    emote: {
                        emoteId: media.emote?.id || '0123456789012345678',
                        image: {
                            imageUrl: media.emote?.imageUrl
                        }
                    }
                }
            ]
            : undefined;
        events.push({
            platform: 'tiktok',
            adapter: 'tiktok',
            rawEvent: {
                eventType: tiktokEventType,
                data: {
                    ...base,
                    user: {
                        uniqueId: userId,
                        nickname: username,
                        profilePictureUrl: media.avatarUrl,
                        userId,
                        followRole: 0,
                        userBadges: []
                    },
                    badgeImages: includePreviewBadges ? media.badges : undefined,
                    comment,
                    isModerator: false,
                    isOwner: false,
                    userIdentity: {
                        isSubscriberOfAnchor: scenarioType === 'chat' || scenarioType === 'chat-no'
                    },
                    emotes: tiktokEmotes,
                    displayType: scenarioType === 'share' ? 'share' : undefined,
                    giftName: media?.gift?.name || 'Rose',
                    repeatCount: scenarioType === 'gift' ? 1 : 5,
                    diamondCount: scenarioType === 'gift'
                        ? Number(media?.gift?.unitAmount || 10)
                        : 10,
                    ...(scenarioType === 'gift' && media?.gift?.imageUrl
                        ? {
                            gift: {
                                giftPictureUrl: media.gift.imageUrl
                            },
                            giftDetails: {
                                id: media.gift.giftId,
                                giftName: media.gift.name,
                                diamondCount: Number(media.gift.unitAmount || 10),
                                primaryEffectId: media.gift.primaryEffectId,
                                giftImage: {
                                    url: [media.gift.imageUrl]
                                }
                            },
                            asset: {
                                resourceModel: {
                                    urlList: [media.gift.animation.resourceModelUrl]
                                },
                                videoResourceList: media.gift.animation.videoResources
                            }
                        }
                        : {}),
                    msgId: `test-${scenarioType}-${index}`,
                    createTime: Math.floor(Date.parse(timestamp) / 1000)
                }
            }
        });
    }

    return events;
}

function createPreviewIngestAdapters(
    options: CreatePreviewIngestAdaptersOptions
): PreviewIngestAdapters {
    const { config = {}, logger, emitPlatformEvent } = options;
    const resolvedLogger = resolveLogger(logger);

    const emitChatEvent = (platform: PreviewAdapter, payload: UnknownRecord): void => {
        emitPlatformEvent({
            type: PlatformEvents.CHAT_MESSAGE,
            platform,
            data: {
                username: payload.username,
                userId: payload.userId,
                timestamp: payload.timestamp,
                avatarUrl: payload.avatarUrl || PREVIEW_AVATAR_URL,
                isPaypiggy: payload.isPaypiggy === true,
                isMod: payload.isMod === true,
                isBroadcaster: payload.isBroadcaster === true,
                metadata: payload.metadata || {},
                badgeImages: Array.isArray(payload.badgeImages) ? payload.badgeImages : [],
                message: payload.message
            }
        });
    };

    const twitchRouter = createTwitchEventSubEventRouter({
        config,
        logger: resolvedLogger,
        emit(eventName: string, payload: UnknownRecord) {
            if (eventName === 'chatMessage') {
                const messageText = payload?.message?.text || payload?.message || '';
                const messageParts = Array.isArray(payload?.message?.fragments)
                    ? payload.message.fragments
                        .map((fragment: UnknownRecord | null) => {
                            if (!fragment || typeof fragment !== 'object') {
                                return null;
                            }
                            if (fragment.type === 'emote' && fragment?.emote?.id) {
                                return {
                                    type: 'emote',
                                    platform: 'twitch',
                                    emoteId: fragment.emote.id,
                                    imageUrl: `https://static-cdn.jtvnw.net/emoticons/v2/${fragment.emote.id}/animated/dark/3.0`
                                };
                            }
                            if (fragment.type === 'text' && typeof fragment.text === 'string') {
                                return {
                                    type: 'text',
                                    text: fragment.text
                                };
                            }
                            return null;
                        })
                        .filter(Boolean)
                    : [];
                emitChatEvent('twitch', {
                    username: payload?.username || payload?.user_name,
                    userId: payload?.userId || payload?.user_id,
                    timestamp: payload?.timestamp,
                    isPaypiggy: payload?.isPaypiggy === true || payload?.metadata?.previewPaypiggy === true,
                    isMod: payload?.isMod === true || payload?.is_mod === true,
                    isBroadcaster: payload?.isBroadcaster === true || payload?.is_broadcaster === true,
                    metadata: payload?.metadata || {},
                    badgeImages: Array.isArray(payload?.badgeImages) ? payload.badgeImages : [],
                    message: messageParts.length > 0
                        ? {
                            text: messageText,
                            parts: messageParts
                        }
                        : { text: messageText }
                });
                return;
            }

            const map: Record<string, string> = {
                follow: PlatformEvents.FOLLOW,
                gift: PlatformEvents.GIFT,
                raid: PlatformEvents.RAID,
                paypiggy: PlatformEvents.PAYPIGGY,
                paypiggyGift: PlatformEvents.GIFTPAYPIGGY
            };
            const mappedType = map[eventName];
            if (!mappedType) {
                return;
            }
            emitPlatformEvent({ type: mappedType, platform: 'twitch', data: payload });
        }
    });

    const youtubePlatform = {
        logger: resolvedLogger,
        handleLowPriorityEvent() {},
        handleChatTextMessage(chatItem: UnknownRecord) {
            const source = chatItem?.testData || {};
            const messageParts = Array.isArray(source.messageParts)
                ? source.messageParts.filter((part: unknown) => part && typeof part === 'object')
                : [];
            emitChatEvent('youtube', {
                username: source.username,
                userId: source.userId,
                timestamp: source.timestamp,
                isPaypiggy: source.isPaypiggy === true,
                badgeImages: Array.isArray(source.badgeImages) ? source.badgeImages : [],
                message: messageParts.length > 0
                    ? {
                        text: source.message || '',
                        parts: messageParts
                    }
                    : { text: source.message || '' }
            });
        },
        handleSuperChat(chatItem: UnknownRecord) {
            const source = chatItem?.testData || {};
            emitPlatformEvent({ type: PlatformEvents.PAYPIGGY, platform: 'youtube', data: source });
        },
        handleSuperSticker(chatItem: UnknownRecord) {
            const source = chatItem?.testData || {};
            emitPlatformEvent({
                type: PlatformEvents.GIFT,
                platform: 'youtube',
                data: {
                    ...source,
                    id: source.id,
                    giftType: 'SuperSticker',
                    giftCount: 1,
                    amount: source.amount,
                    currency: source.currency
                }
            });
        },
        handleMembership(chatItem: UnknownRecord) {
            const source = chatItem?.testData || {};
            emitPlatformEvent({ type: PlatformEvents.PAYPIGGY, platform: 'youtube', data: source });
        },
        handleGiftMembershipPurchase(chatItem: UnknownRecord) {
            const source = chatItem?.testData || {};
            emitPlatformEvent({
                type: PlatformEvents.GIFTPAYPIGGY,
                platform: 'youtube',
                data: {
                    ...source,
                    giftCount: source.giftCount,
                    tier: source.tier
                }
            });
        }
    };
    const youtubeRouter = createYouTubeEventRouter({ platform: youtubePlatform });

    const tiktokConnection = new EventEmitter();
    const tiktokPlatform = {
        logger: resolvedLogger,
        config,
        platformName: 'tiktok',
        connection: tiktokConnection,
        listenersConfigured: false,
        connectionTime: 0,
        WebcastEvent: {
            CHAT: 'CHAT',
            GIFT: 'GIFT',
            FOLLOW: 'FOLLOW',
            ROOM_USER: 'ROOM_USER',
            ENVELOPE: 'ENVELOPE',
            SUBSCRIBE: 'SUBSCRIBE',
            SUPER_FAN: 'SUPER_FAN',
            SOCIAL: 'SOCIAL',
            ERROR: 'ERROR',
            DISCONNECT: 'DISCONNECT',
            STREAM_END: 'STREAM_END'
        },
        ControlEvent: {
            DISCONNECTED: 'disconnected',
            ERROR: 'error'
        },
        errorHandler: createGuiPreviewErrorHandler(resolvedLogger),
        _logIncomingEvent: async () => {},
        _getTimestamp(data: UnknownRecord) {
            return data.timestamp;
        },
        _getPlatformMessageId(data: UnknownRecord) {
            return data.msgId || null;
        },
        _handleChatMessage(_raw: UnknownRecord, normalizedData: UnknownRecord) {
            const payload = {
                ...normalizedData,
                badgeImages: Array.isArray(normalizedData?.badgeImages)
                    ? normalizedData.badgeImages
                    : (Array.isArray(_raw?.badgeImages) ? _raw.badgeImages : [])
            };
            emitChatEvent('tiktok', payload);
        },
        handleTikTokGift(data: UnknownRecord) {
            const sourceUser = data?.user || {};
            const giftImageUrl = typeof data?.gift?.giftPictureUrl === 'string'
                ? data.gift.giftPictureUrl
                : '';
            const giftName = data?.giftName || data?.giftDetails?.giftName || 'Rose';
            const repeatCount = Number(data?.repeatCount) || 1;
            const unitAmount = Number(data?.diamondCount) || 10;
            emitPlatformEvent({
                type: PlatformEvents.GIFT,
                platform: 'tiktok',
                data: {
                    username: sourceUser.nickname || sourceUser.uniqueId,
                    userId: sourceUser.uniqueId || sourceUser.userId,
                    timestamp: data.timestamp,
                    id: data.msgId,
                    giftType: giftName,
                    ...(giftImageUrl ? { giftImageUrl } : {}),
                    giftCount: repeatCount,
                    repeatCount,
                    unitAmount,
                    amount: unitAmount,
                    currency: 'coins',
                    enhancedGiftData: {
                        username: sourceUser.nickname || sourceUser.uniqueId,
                        userId: sourceUser.uniqueId || sourceUser.userId,
                        giftType: giftName,
                        giftCount: repeatCount,
                        amount: unitAmount,
                        currency: 'coins',
                        isAggregated: false,
                        isStreakCompleted: true,
                        originalData: {
                            asset: data.asset,
                            giftDetails: data.giftDetails,
                            gift: data.gift
                        }
                    }
                }
            });
        },
        handleTikTokFollow(data: UnknownRecord) {
            const sourceUser = data?.user || {};
            emitPlatformEvent({
                type: PlatformEvents.FOLLOW,
                platform: 'tiktok',
                data: {
                    username: sourceUser.nickname || sourceUser.uniqueId,
                    userId: sourceUser.uniqueId || sourceUser.userId,
                    timestamp: data.timestamp
                }
            });
        },
        handleTikTokSocial(data: UnknownRecord) {
            if (String(data.displayType || '').toLowerCase() !== 'share') {
                return;
            }
            const sourceUser = data?.user || {};
            emitPlatformEvent({
                type: PlatformEvents.SHARE,
                platform: 'tiktok',
                data: {
                    username: sourceUser.nickname || sourceUser.uniqueId,
                    userId: sourceUser.uniqueId || sourceUser.userId,
                    timestamp: data.timestamp
                }
            });
        },
        _handleStandardEvent(_eventType: string, data: UnknownRecord, options: UnknownRecord) {
            const sourceUser = data?.user || {};
            emitPlatformEvent({
                type: options.emitType,
                platform: 'tiktok',
                data: {
                    username: sourceUser.nickname || sourceUser.uniqueId,
                    userId: sourceUser.uniqueId || sourceUser.userId,
                    timestamp: data.timestamp,
                    id: data.msgId,
                    giftType: data.giftName || 'Rose',
                    giftCount: Number(data.repeatCount) || 1,
                    amount: Number(data.diamondCount) || 10,
                    currency: 'coins'
                }
            });
        }
    };
    setupTikTokEventListeners(tiktokPlatform);

    return {
        twitch: {
            async ingest(rawEvent: UnknownRecord) {
                twitchRouter.handleNotificationEvent(rawEvent.subscriptionType, rawEvent.event || {}, rawEvent.metadata || {});
            }
        },
        youtube: {
            async ingest(rawEvent: UnknownRecord) {
                await youtubeRouter.routeEvent(rawEvent.chatItem, rawEvent.eventType);
            }
        },
        tiktok: {
            async ingest(rawEvent: UnknownRecord) {
                tiktokConnection.emit(rawEvent.eventType, rawEvent.data);
            }
        }
    };
}

function createPreviewRuntime(options: CreatePreviewRuntimeOptions) {
    const {
        config,
        logger,
        displayQueue,
        notificationManager,
        commandCooldownService,
        userTrackingService,
        vfxCommandService,
        platformLifecycleService
    } = options;

    const runtime: PreviewRuntime = {
        config,
        logger,
        displayQueue,
        notificationManager,
        commandCooldownService,
        userTrackingService,
        vfxCommandService,
        platformLifecycleService,
        gracefulExitService: null,
        isFirstMessage: (userId: unknown, context: unknown) => userTrackingService.isFirstMessage(userId, context)
    };

    const forwardNotification = (notificationType: string) => async (platform: string, username: string, payload: UnknownRecord = {}) => {
        const response = await notificationManager.handleNotification(notificationType, platform, {
            ...payload,
            username,
            type: notificationType
        });
        return response;
    };

    runtime.handleFollowNotification = forwardNotification(PlatformEvents.FOLLOW);
    runtime.handleShareNotification = forwardNotification(PlatformEvents.SHARE);
    runtime.handleRaidNotification = forwardNotification(PlatformEvents.RAID);
    runtime.handleGiftNotification = forwardNotification(PlatformEvents.GIFT);
    runtime.handlePaypiggyNotification = forwardNotification(PlatformEvents.PAYPIGGY);
    runtime.handleGiftPaypiggyNotification = forwardNotification(PlatformEvents.GIFTPAYPIGGY);
    runtime.handleFarewellNotification = forwardNotification('farewell');
    runtime.handleEnvelopeNotification = async (platform: string, payload: UnknownRecord = {}) => {
        return notificationManager.handleNotification(PlatformEvents.ENVELOPE, platform, {
            ...payload,
            type: PlatformEvents.ENVELOPE
        });
    };

    const chatNotificationRouter = new ChatNotificationRouter({
        runtime,
        logger,
        config
    });

    runtime.handleChatMessage = async (platform: string, normalizedData: UnknownRecord = {}) => {
        return chatNotificationRouter.handleChatMessage(platform, normalizedData);
    };

    return {
        runtime,
        chatNotificationRouter
    };
}

function createPreviewPipeline(options: CreatePreviewPipelineOptions = {}): PreviewPipeline {
    const config = options.config || {};
    const logger = resolveLogger(options.logger);
    const errorHandler = createGuiPreviewErrorHandler(logger);
    const eventBus = options.eventBus || createEventBus();

    const obsManager = options.obsManager || {
        isReady: async () => true,
        call: async () => ({})
    };

    const previewSourcesManager = {
        clearTextSource: async () => {},
        updateTextSource: async () => {},
        updateChatMsgText: async () => {},
        setPlatformLogoVisibility: async () => {},
        setGroupSourceVisibility: async () => {},
        setChatDisplayVisibility: async () => {},
        setNotificationPlatformLogoVisibility: async () => {},
        setNotificationDisplayVisibility: async () => {}
    };

    const previewGoalsManager = {
        processDonationGoal: async () => {}
    };

    const displayQueue = options.displayQueue || new DisplayQueue(
        obsManager,
        {
            ...(config.displayQueue || {}),
            autoProcess: true,
            timing: config.timing,
            obs: config.obs,
            chat: config.chat || {},
            notification: config.notification || {},
            gui: config.gui || {},
            gifts: config.gifts || {},
            twitch: config.twitch || {},
            youtube: config.youtube || {},
            tiktok: config.tiktok || {}
        },
        {
            PRIORITY_LEVELS,
            NOTIFICATION_CONFIGS
        },
        eventBus,
        {
            sourcesManager: previewSourcesManager,
            goalsManager: previewGoalsManager,
            delay: typeof options.delay === 'function' ? options.delay : async () => {},
            giftAnimationResolver: options.giftAnimationResolver || {
                resolveFromNotificationData: async () => null
            }
        }
    );

    const commandCooldownService = options.commandCooldownService || new CommandCooldownServiceClass({
        config,
        eventBus,
        logger
    });

    const userTrackingService = (options.userTrackingService || createUserTrackingService()) as {
        isFirstMessage: (userId: unknown, context: unknown) => unknown;
    };
    const vfxCommandService = options.vfxCommandService || createVFXCommandService(config, eventBus);

    const notificationManager = options.notificationManager || new NotificationManager({
        logger,
        constants: {
            PRIORITY_LEVELS,
            NOTIFICATION_CONFIGS
        },
        obsGoals: {
            processDonationGoal: () => {}
        },
        eventBus,
        config,
        vfxCommandService,
        userTrackingService,
        displayQueue
    });

    const platformLifecycleService = options.platformLifecycleService || {
        getPlatformConnectionTime: () => null
    };

    const { runtime } = createPreviewRuntime({
        config,
        logger,
        displayQueue,
        notificationManager,
        commandCooldownService,
        userTrackingService,
        vfxCommandService,
        platformLifecycleService
    });

    const platformEventRouter = new PlatformEventRouter({
        eventBus,
        runtime,
        notificationManager,
        config,
        logger
    });

    const unsubscribePreviewVfxAck = eventBus.subscribe(PlatformEvents.VFX_COMMAND_RECEIVED, (payload: unknown) => {
        safeSetTimeout(() => {
            eventBus.emit(PlatformEvents.VFX_COMMAND_EXECUTED, payload);
        }, 0);
    });

    return {
        eventBus,
        emitIngestEvent(event: UnknownRecord) {
            eventBus.emit('platform:event', event);
        },
        async dispose() {
            try {
                platformEventRouter.dispose();
            } catch (error) {
                errorHandler.handleEventProcessingError(error, 'pipeline-dispose', null, 'Failed disposing platform router');
            }

            try {
                unsubscribePreviewVfxAck();
            } catch (error) {
                errorHandler.handleEventProcessingError(error, 'pipeline-dispose', null, 'Failed disposing preview VFX acknowledgement');
            }

            if (commandCooldownService && typeof commandCooldownService.dispose === 'function') {
                try {
                    commandCooldownService.dispose();
                } catch (error) {
                    errorHandler.handleEventProcessingError(error, 'pipeline-dispose', null, 'Failed disposing command cooldown service');
                }
            }
        }
    };
}

async function runPreviewScenario(options: RunPreviewScenarioOptions): Promise<ReturnType<typeof setInterval> | number> {
    const {
        adapters,
        scenarioEvents,
        intervalMs,
        durationMs,
        safeSetIntervalImpl,
        safeSetTimeoutImpl,
        errorHandler
    } = options;

    let eventIndex = 0;
    const dispatchNextEvent = () => {
        if (eventIndex >= scenarioEvents.length) {
            return;
        }

        const event = scenarioEvents[eventIndex];
        const adapter = adapters[event.adapter];
        if (adapter && typeof adapter.ingest === 'function') {
            Promise.resolve(adapter.ingest(event.rawEvent)).catch((error: unknown) => {
                errorHandler.handleEventProcessingError(error, 'preview-ingest', event.rawEvent, 'Failed processing preview ingest event');
            });
        }
        eventIndex += 1;
    };

    dispatchNextEvent();

    const intervalHandle = safeSetIntervalImpl(() => {
        dispatchNextEvent();
    }, intervalMs);

    await new Promise<void>((resolve) => {
        safeSetTimeoutImpl(() => resolve(), durationMs);
    });

    return intervalHandle;
}

async function disposePreviewPipeline(options: DisposePreviewPipelineOptions): Promise<void> {
    const {
        intervalHandle,
        service,
        pipeline,
        errorHandler
    } = options;

    if (intervalHandle) {
        clearInterval(intervalHandle);
    }

    if (service && typeof service.stop === 'function') {
        try {
            await service.stop();
        } catch (error) {
            errorHandler.handleEventProcessingError(error, 'preview-cleanup', null, 'Failed stopping GUI preview transport');
        }
    }

    if (pipeline && typeof pipeline.dispose === 'function') {
        try {
            await pipeline.dispose();
        } catch (error) {
            errorHandler.handleEventProcessingError(error, 'preview-cleanup', null, 'Failed disposing GUI preview pipeline');
        }
    }
}

async function runGuiPreview(options: RunGuiPreviewOptions = {}): Promise<void> {
    const config = buildPreviewConfig(options.baseConfig);
    const requestedDurationMs = options.durationMs;
    const durationMs = typeof requestedDurationMs === 'number' && Number.isInteger(requestedDurationMs) && requestedDurationMs > 0
        ? requestedDurationMs
        : PREVIEW_DURATION_MS;
    const requestedIntervalMs = options.intervalMs;
    const intervalMs = typeof requestedIntervalMs === 'number' && Number.isInteger(requestedIntervalMs) && requestedIntervalMs > 0
        ? requestedIntervalMs
        : PREVIEW_INTERVAL_MS;

    const logger = resolveLogger(options.logger);
    const errorHandler = createGuiPreviewErrorHandler(logger);
    const createPreviewPipelineImpl = options.createPreviewPipelineImpl || createPreviewPipeline;
    const createPreviewIngestAdaptersImpl = options.createPreviewIngestAdaptersImpl || createPreviewIngestAdapters;
    const createGuiTransportServiceImpl = options.createGuiTransportServiceImpl || createGuiTransportService;
    const safeSetIntervalImpl = options.safeSetIntervalImpl || safeSetInterval;
    const safeSetTimeoutImpl = options.safeSetTimeoutImpl || safeSetTimeout;
    const stdout = options.stdout || process.stdout;
    const delay = options.delay || ((ms: number) => {
        const parsed = Number(ms);
        return safeDelay(parsed, Number.isFinite(parsed) ? parsed : 5000, 'gui-preview delay');
    });

    let pipeline: PreviewPipeline | null = null;
    let service: PreviewService | null = null;
    let intervalHandle: ReturnType<typeof setInterval> | number | null = null;
    const giftAnimationResolver = options.giftAnimationResolver || createTikTokGiftAnimationResolver({ logger });

    try {
        pipeline = createPreviewPipelineImpl({
            config,
            logger,
            eventBus: options.eventBus,
            giftAnimationResolver,
            delay
        });

        if (!pipeline || typeof pipeline.emitIngestEvent !== 'function' || !pipeline.eventBus) {
            throw new Error('Preview pipeline requires eventBus and emitIngestEvent');
        }
        const activePipeline = pipeline;

        const activeService = createGuiTransportServiceImpl({
            config,
            eventBus: activePipeline.eventBus,
            logger
        });
        service = activeService;

        await activeService.start();

        const host = config.gui.host;
        const port = config.gui.port;
        stdout.write(`GUI preview running for ${Math.floor(durationMs / 1000)}s\n`);
        stdout.write(`Dock URL: http://${host}:${port}/dock\n`);
        stdout.write(`TikTok Animation URL: http://${host}:${port}/tiktok-animations\n`);
        stdout.write(`Overlay URL: http://${host}:${port}/overlay\n`);

        const scenarioEvents = buildPreviewScenarioEvents(durationMs, intervalMs);
        const adapters = createPreviewIngestAdaptersImpl({
            config,
            logger,
            emitPlatformEvent: (event: UnknownRecord) => activePipeline.emitIngestEvent(event)
        });
        intervalHandle = await runPreviewScenario({
            adapters,
            scenarioEvents,
            intervalMs,
            durationMs,
            safeSetIntervalImpl,
            safeSetTimeoutImpl,
            errorHandler
        });

        stdout.write('GUI preview finished\n');
    } catch (error) {
        errorHandler.handleEventProcessingError(error, 'preview-run', null, 'GUI preview failed');
        throw error;
    } finally {
        await disposePreviewPipeline({
            intervalHandle,
            service,
            pipeline,
            errorHandler
        });
    }
}

if (require.main === module) {
    runGuiPreview().catch((error: unknown) => {
        const errorMessage = error && typeof error === 'object' && 'message' in error
            ? String((error as { message?: unknown }).message)
            : String(error);
        process.stderr.write(`GUI preview failed: ${errorMessage}\n`);
        process.exit(1);
    });
}

export {
    PREVIEW_DURATION_MS,
    PREVIEW_INTERVAL_MS,
    PREVIEW_MEDIA_CATALOG,
    buildPreviewConfig,
    buildPreviewScenarioEvents,
    createPreviewPipeline,
    createPreviewIngestAdapters,
    runPreviewScenario,
    runGuiPreview
};
