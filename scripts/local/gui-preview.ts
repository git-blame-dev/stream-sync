import EventEmitter from 'node:events';
import { createRequire } from 'node:module';
import path from 'node:path';
import * as TwitchEventRouterModule from '../../src/platforms/twitch/events/event-router.ts';
import * as CommandCooldownServiceModule from '../../src/services/CommandCooldownService.ts';
import * as UserTrackingServiceModule from '../../src/services/UserTrackingService.ts';
import * as VFXCommandServiceModule from '../../src/services/VFXCommandService.ts';
import { validateFundingGoalLabel } from '../../src/core/funding-goal-label.ts';
import { DEMO_CHARACTER_CATALOG } from '../../gui/src/demo/demo-catalog.ts';

type UnknownRecord = Record<string, unknown>;

class PreviewAsyncEventEmitter extends EventEmitter {
    async emitAsync(eventName: string | symbol, payload: unknown): Promise<void> {
        const listeners = this.listeners(eventName);
        await Promise.all(listeners.map((listener) => Promise.resolve(listener(payload))));
    }
}

function isPreviewRecord(value: unknown): value is UnknownRecord {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function toPreviewRecord(value: unknown): UnknownRecord {
    return isPreviewRecord(value) ? value : {};
}

function getPreviewRecord(record: UnknownRecord, key: string): UnknownRecord {
    return toPreviewRecord(record[key]);
}

function getPreviewString(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

function getPreviewEventName(value: unknown): string | symbol {
    return typeof value === 'string' || typeof value === 'symbol' ? value : '';
}

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

interface PreviewTwitchPlatform {
    handlers: Record<string, (payload: UnknownRecord) => void>;
    apiClient: UnknownRecord | null;
    onMessageHandler: (event: UnknownRecord) => Promise<void>;
    handleFollowEvent: (payload: UnknownRecord) => Promise<void>;
    handleGiftEvent: (payload: UnknownRecord) => Promise<void>;
    handleRaidEvent: (payload: UnknownRecord) => Promise<void>;
    handlePaypiggyEvent: (payload: UnknownRecord) => Promise<void>;
    handlePaypiggyGiftEvent: (payload: UnknownRecord) => Promise<void>;
}

type PreviewTwitchPlatformCtor = new (config: UnknownRecord, dependencies: UnknownRecord) => PreviewTwitchPlatform;

interface PreviewYouTubePlatform {
    handlers: Record<string, (payload: UnknownRecord) => void>;
    eventRouter: {
        routeEvent: (chatItem: unknown, eventType: unknown) => Promise<boolean>;
    };
}

type PreviewYouTubePlatformCtor = new (config: UnknownRecord, dependencies: UnknownRecord) => PreviewYouTubePlatform;

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
const { DISPLAY_EVENT_TYPES } = load('../../src/interfaces/DisplayEvents');
const { PRIORITY_LEVELS, NOTIFICATION_CONFIGS } = load('../../src/core/constants');
const { createPlatformErrorHandler } = load('../../src/utils/platform-error-handler');
const { safeSetInterval, safeSetTimeout, safeDelay } = load('../../src/utils/timeout-validator');
const { createGuiTransportService } = load('../../src/services/gui/gui-transport-service');
const { createOperatorControlService, OPERATOR_CONTROL_KEYS } = load('../../src/services/operator/operator-control-service');
const { createOperatorAppearanceService } = load('../../src/services/operator/operator-appearance-service');
const { createOperatorLogSource } = load('../../src/services/operator/operator-log-source');
const { PlatformEventRouter } = load('../../src/services/PlatformEventRouter.ts');
const { ChatNotificationRouter } = load('../../src/services/ChatNotificationRouter.ts');
type PreviewNotificationManager = {
    handleNotification: (type: string, platform: string, payload: UnknownRecord) => Promise<unknown>;
    prepareNotification: (type: string, platform: string, payload: UnknownRecord) => Promise<unknown>;
};

type NotificationManagerCtor = new (...args: unknown[]) => PreviewNotificationManager;

const NotificationManagerModule = load('../../src/notifications/NotificationManager') as {
    default?: NotificationManagerCtor;
    NotificationManager?: NotificationManagerCtor;
};
const NotificationManager = NotificationManagerModule.default || NotificationManagerModule.NotificationManager;
if (typeof NotificationManager !== 'function') {
    throw new Error('gui-preview requires NotificationManager constructor export');
}
const NotificationManagerClass: NotificationManagerCtor = NotificationManager;
const { DisplayQueue } = load('../../src/obs/display-queue');
const { setupTikTokEventListeners } = load('../../src/platforms/tiktok/events/event-router.ts');
const { createTikTokEventFactory } = load('../../src/platforms/tiktok/events/event-factory.ts');
const { normalizeTikTokGiftEvent } = load('../../src/platforms/tiktok/events/event-normalizer.ts');
const { extractTikTokUserData, extractTikTokAvatarUrl } = load('../../src/utils/tiktok-data-extraction.ts');
const { resolveTikTokTimestampISO } = load('../../src/utils/platform-timestamp.ts');
const { TwitchPlatform: TwitchPlatformClass } = load('../../src/platforms/twitch.ts') as {
    TwitchPlatform: PreviewTwitchPlatformCtor;
};
const { YouTubePlatform: YouTubePlatformClass } = load('../../src/platforms/youtube.ts') as {
    YouTubePlatform: PreviewYouTubePlatformCtor;
};

type PreviewAdapter = 'twitch' | 'youtube' | 'tiktok';
type PreviewScenario = 'all' | 'chat' | 'notifications' | 'funding';

interface PreviewScenarioStep {
    type: string;
    adapter: PreviewAdapter;
}

interface PreviewPlatformAccount {
    platform: PreviewAdapter;
    username: string;
    userId: string;
}

interface PreviewMediaBadge {
    imageUrl: string;
    source: PreviewAdapter;
    label: string;
}

interface PreviewMediaEmote {
    id: string;
    imageUrl: string;
}

interface PreviewMediaGift {
    name: string;
    giftId: string;
    primaryEffectId: string;
    imageUrl: string;
    unitAmount: number;
    animation: {
        resourceModelUrl: string;
        videoResources: readonly UnknownRecord[];
    };
}

interface PreviewMedia {
    avatarUrl: string;
    badges: readonly PreviewMediaBadge[];
    emote: PreviewMediaEmote;
    gift?: PreviewMediaGift;
}

interface PreviewScenarioEvent {
    platform: PreviewAdapter;
    adapter: PreviewAdapter;
    scenarioType: string;
    notificationType?: string;
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
    getSseClientCount?: () => number;
}

interface PreviewErrorHandler {
    handleEventProcessingError: (error: unknown, context: string, payload: unknown, message: string) => void;
}

interface PreviewNotificationExitWaiter {
    promise: Promise<void>;
    cancel: () => void;
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
    notificationManager?: PreviewNotificationManager;
    platformLifecycleService?: {
        getPlatformConnectionTime?: (platform?: string) => unknown;
    };
    delay?: (ms: number) => Promise<unknown>;
    notificationDelay?: (ms: number) => Promise<void>;
    giftAnimationResolver?: {
        resolveFromNotificationData?: (payload: unknown) => Promise<unknown>;
    };
}

interface CreatePreviewRuntimeOptions {
    config: UnknownRecord;
    logger: PreviewLogger;
    displayQueue: unknown;
    notificationManager: PreviewNotificationManager;
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
    notificationManager: PreviewNotificationManager;
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
    prepareFarewellNotification?: (platform: string, username: string, payload?: UnknownRecord) => Promise<unknown>;
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
    dispatchImmediately?: boolean;
}

interface PreviewScenarioRunResult {
    intervalHandle: ReturnType<typeof setInterval> | number;
    dispatchedEvents: PreviewScenarioEvent[];
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
    scenario?: PreviewScenario;
    logger?: PreviewLogger | UnknownRecord;
    createPreviewPipelineImpl?: (options: CreatePreviewPipelineOptions) => PreviewPipeline;
    createPreviewIngestAdaptersImpl?: (options: CreatePreviewIngestAdaptersOptions) => PreviewIngestAdapters;
    createGuiTransportServiceImpl?: (options: {
        config: UnknownRecord;
        eventBus: PreviewEventBus;
        logger: PreviewLogger;
        fundingGoal?: UnknownRecord;
        operatorControls?: UnknownRecord;
        operatorAppearance?: UnknownRecord;
        operatorLogs?: UnknownRecord;
        assetsRoot?: string;
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
    keepOpen?: boolean;
    waitForShutdownImpl?: () => Promise<void>;
    createNotificationExitWaiterImpl?: (
        eventBus: PreviewEventBus,
        notificationType: string,
        timeoutMs: number
    ) => PreviewNotificationExitWaiter;
}

const PREVIEW_DURATION_MS = 32000;
const FUNDING_PREVIEW_DURATION_MS = 120000;
const PREVIEW_INTERVAL_MS = 2000;
const PREVIEW_NOTIFICATION_EXIT_TIMEOUT_MS = 41000;

function waitForPreviewShutdown(): Promise<void> {
    return new Promise((resolve) => {
        const finish = () => {
            process.removeListener('SIGINT', finish);
            process.removeListener('SIGTERM', finish);
            resolve();
        };
        process.once('SIGINT', finish);
        process.once('SIGTERM', finish);
    });
}

function createPreviewDelay(
    delayImpl: (delay: unknown, fallback?: number, context?: string) => Promise<void> = safeDelay
): (ms: number) => Promise<void> {
    return (ms: number) => {
        const parsed = Number(ms);
        if (parsed === 0) {
            return Promise.resolve();
        }
        const resolved = Number.isFinite(parsed) && parsed > 0 ? parsed : 5000;
        return delayImpl(resolved, resolved, 'gui-preview delay');
    };
}

const PREVIEW_MESSAGE_TEXT = 'test message hello world this is a message to everyone how are we today?';
const PREVIEW_MEDIA_CATALOG: Record<PreviewAdapter, PreviewMedia> = {
    twitch: {
        avatarUrl: DEMO_CHARACTER_CATALOG.Goku,
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
        avatarUrl: DEMO_CHARACTER_CATALOG.Ichigo,
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
        avatarUrl: DEMO_CHARACTER_CATALOG.Naruto,
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

const PREVIEW_SCENARIO_TEMPLATE: readonly PreviewScenarioStep[] = [
    { type: 'chat-member-hi', adapter: 'youtube' },
    { type: 'chat', adapter: 'twitch' },
    { type: 'chat-hello', adapter: 'youtube' },
    { type: 'gift', adapter: 'tiktok' },
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
const FUNDING_PREVIEW_SCENARIO_TEMPLATE: readonly PreviewScenarioStep[] = [
    { type: 'gift', adapter: 'tiktok' },
    { type: 'paypiggy', adapter: 'youtube' },
    { type: 'giftpaypiggy', adapter: 'youtube' },
    { type: 'gift', adapter: 'tiktok' },
    { type: 'paypiggy', adapter: 'youtube' }
];
const FUNDING_PREVIEW_AMOUNTS_USD = [25, 25, 25, 25, 50] as const;

const PREVIEW_PLATFORM_ACCOUNTS: readonly [PreviewPlatformAccount, ...PreviewPlatformAccount[]] = [
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
const PREVIEW_SYNTHETIC_MEMBER_IDENTITY = 'youtube:test-youtube-account';

function parsePreviewScenario(args: readonly string[]): PreviewScenario {
    const inlineValue = args.find((argument) => argument.startsWith('--scenario='))?.slice('--scenario='.length);
    const separateIndex = args.indexOf('--scenario');
    const separateValue = separateIndex >= 0 ? args[separateIndex + 1] : undefined;
    const value = inlineValue || separateValue || 'all';
    if (value === 'all' || value === 'chat' || value === 'notifications' || value === 'funding') {
        return value;
    }
    throw new Error(`Unknown GUI preview scenario: ${value}. Expected all, chat, notifications, or funding.`);
}

function getPreviewNotificationType(scenarioType: string): string | undefined {
    const notificationTypes: Record<string, string> = {
        follow: PlatformEvents.FOLLOW,
        gift: PlatformEvents.GIFT,
        raid: PlatformEvents.RAID,
        share: PlatformEvents.SHARE,
        paypiggy: PlatformEvents.PAYPIGGY,
        giftpaypiggy: PlatformEvents.GIFTPAYPIGGY,
        envelope: PlatformEvents.ENVELOPE
    };
    return notificationTypes[scenarioType];
}

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
    const sourceConfig = toPreviewRecord(configModule.config);
    const overrideConfig = toPreviewRecord(baseConfig);

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

    const sourceGeneral = getPreviewRecord(sourceConfig, 'general');
    const overrideGeneral = getPreviewRecord(overrideConfig, 'general');
    const sourceCooldowns = getPreviewRecord(sourceConfig, 'cooldowns');
    const overrideCooldowns = getPreviewRecord(overrideConfig, 'cooldowns');
    const sourceFarewell = getPreviewRecord(sourceConfig, 'farewell');
    const overrideFarewell = getPreviewRecord(overrideConfig, 'farewell');
    const sourceCommands = getPreviewRecord(sourceConfig, 'commands');
    const overrideCommands = getPreviewRecord(overrideConfig, 'commands');
    const sourceGreetings = getPreviewRecord(sourceConfig, 'greetings');
    const overrideGreetings = getPreviewRecord(overrideConfig, 'greetings');
    merged.greetings = mergeSection(sourceGreetings, overrideGreetings);
    merged.profiles = {
        ...getPreviewRecord(overrideConfig, 'profiles'),
        'synthetic-member': {
            id: 'synthetic-member',
            identities: [PREVIEW_SYNTHETIC_MEMBER_IDENTITY],
            greetingCommand: '!preview',
            rowTheme: 'red',
            rowEffects: ['particles']
        }
    };

    merged.general = mergeSection(sourceGeneral, overrideGeneral, {
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

    merged.obs = mergeSection(getPreviewRecord(sourceConfig, 'obs'), getPreviewRecord(overrideConfig, 'obs'), {
        ttsChatEnabled: false,
        ttsNotificationsEnabled: false
    });

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

    merged.twitch = mergeSection(getPreviewRecord(sourceConfig, 'twitch'), getPreviewRecord(overrideConfig, 'twitch'), platformFlags);
    merged.youtube = mergeSection(getPreviewRecord(sourceConfig, 'youtube'), getPreviewRecord(overrideConfig, 'youtube'), platformFlags);
    merged.tiktok = mergeSection(getPreviewRecord(sourceConfig, 'tiktok'), getPreviewRecord(overrideConfig, 'tiktok'), {
        ...platformFlags,
        sharesEnabled: true
    });

    merged.gui = mergeSection(getPreviewRecord(sourceConfig, 'gui'), getPreviewRecord(overrideConfig, 'gui'), {
        enableDock: true,
        enableOverlay: true,
        enableNotifications: true,
        enableOperator: true,
        port: 3400,
        dockFeedMode: 'all',
        overlayFeedMode: 'chat',
        notificationIdleHoldMs: 5000,
        monetizationIdleHoldMs: 30000,
        notificationTransitionMs: 1000,
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

    merged.chat = mergeSection(getPreviewRecord(sourceConfig, 'chat'), getPreviewRecord(overrideConfig, 'chat'), {
        sourceName: 'preview-chat-source',
        sceneName: 'preview-chat-scene',
        groupName: null,
        platformLogos: {}
    });

    merged.fundingGoal = {
        ...getPreviewRecord(sourceConfig, 'fundingGoal'),
        ...getPreviewRecord(overrideConfig, 'fundingGoal'),
        enabled: true,
        label: '🎮 New Controller',
        targetUsd: 100
    };

    merged.notification = mergeSection(getPreviewRecord(sourceConfig, 'notification'), getPreviewRecord(overrideConfig, 'notification'), {
        sourceName: 'preview-notification-source',
        sceneName: 'preview-notification-scene',
        groupName: null,
        platformLogos: {}
    });

    merged.gifts = mergeSection(getPreviewRecord(sourceConfig, 'gifts'), getPreviewRecord(overrideConfig, 'gifts'), {
        giftVideoSource: 'preview-gift-video',
        giftAudioSource: 'preview-gift-audio'
    });

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

    merged.farewell = mergeSection(sourceFarewell, overrideFarewell, {
        timeout: overrideFarewell.timeout ?? sourceFarewell.timeout ?? 1,
        command: resolveNonEmptyString(overrideFarewell.command, sourceFarewell.command) || '!bye'
    });

    merged.displayQueue = mergeSection(getPreviewRecord(sourceConfig, 'displayQueue'), getPreviewRecord(overrideConfig, 'displayQueue'), {
        autoProcess: true,
        rowIntervalMs: 0
    });

    merged.timing = mergeSection(getPreviewRecord(sourceConfig, 'timing'), getPreviewRecord(overrideConfig, 'timing'));

    merged.commands = {
        ...sourceCommands,
        ...overrideCommands,
        preview: resolveNonEmptyString(overrideCommands.preview, sourceCommands.preview)
            || '!preview,Preview Media,1000'
    };

    return merged;
}

function createPreviewFundingGoalService() {
    const configuredLabel = '🎮 New Controller';
    let snapshot = {
        enabled: true,
        id: 'preview-funding-goal',
        label: configuredLabel,
        labelOverridden: false,
        currentUsd: 0,
        targetUsd: 100,
        completed: false,
        revision: 0,
        sessionId: 'preview-session'
    };
    const listeners = new Set<(value: typeof snapshot) => void>();
    const publish = () => listeners.forEach((listener) => listener(snapshot));
    return {
        get snapshot() { return snapshot; },
        async adjust(amountUsd: number) {
            const amountMicros = Math.round(amountUsd * 1_000_000);
            if (!Number.isFinite(amountUsd) || !Number.isSafeInteger(amountMicros) || amountMicros === 0) {
                throw new RangeError('Funding goal adjustment must be a finite nonzero amount');
            }
            const currentMicros = Math.round(snapshot.currentUsd * 1_000_000) + amountMicros;
            if (!Number.isSafeInteger(currentMicros) || currentMicros < 0) {
                throw new RangeError('Funding goal total cannot be negative or exceed the supported range');
            }
            const currentUsd = currentMicros / 1_000_000;
            snapshot = {
                ...snapshot,
                currentUsd,
                completed: currentUsd >= snapshot.targetUsd,
                revision: snapshot.revision + 1
            };
            publish();
        },
        async setTotal(amountUsd: number) {
            const amountMicros = Math.round(amountUsd * 1_000_000);
            if (!Number.isFinite(amountUsd) || !Number.isSafeInteger(amountMicros) || amountMicros < 0) {
                throw new RangeError('Funding goal total must be a non-negative amount');
            }
            const currentUsd = amountMicros / 1_000_000;
            snapshot = {
                ...snapshot,
                currentUsd,
                completed: currentUsd >= snapshot.targetUsd,
                revision: snapshot.revision + 1
            };
            publish();
        },
        async setLabel(label: string) {
            const validated = validateFundingGoalLabel(label);
            if (snapshot.label === validated) return;
            snapshot = {
                ...snapshot,
                label: validated,
                labelOverridden: true,
                revision: snapshot.revision + 1
            };
            publish();
        },
        async resetLabel() {
            if (!snapshot.labelOverridden) return;
            snapshot = {
                ...snapshot,
                label: configuredLabel,
                labelOverridden: false,
                revision: snapshot.revision + 1
            };
            publish();
        },
        async advance(amountUsd: number) { return this.adjust(amountUsd); },
        subscribe(listener: (value: typeof snapshot) => void) { listeners.add(listener); return () => listeners.delete(listener); },
        dispose() { listeners.clear(); }
    };
}

function createPreviewMemoryFileSystem() {
    return {
        readFile: async () => {
            throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        },
        mkdir: async () => undefined,
        writeFile: async () => undefined,
        rename: async () => undefined,
        unlink: async () => undefined
    };
}

function createYouTubePreviewAuthor(options: {
    username: string;
    userId: string;
    media: PreviewMedia;
    includeBadges: boolean;
    isMember: boolean;
}): UnknownRecord {
    const { username, userId, media, includeBadges, isMember } = options;
    const badges = (includeBadges ? media.badges : []).map((badge) => ({
        tooltip: isMember ? `Member: ${badge.label}` : badge.label,
        custom_thumbnail: [{ url: badge.imageUrl, width: 32, height: 32 }]
    }));
    if (isMember && badges.length === 0) {
        badges.push({ tooltip: 'Member', custom_thumbnail: [] });
    }
    return {
        id: userId,
        name: username,
        thumbnails: [{ url: media.avatarUrl, width: 64, height: 64 }],
        badges,
        is_moderator: false,
        is_verified: false,
        is_verified_artist: false
    };
}

function createYouTubePreviewChatItem(options: {
    username: string;
    userId: string;
    timestamp: string;
    text: string;
    media: PreviewMedia;
    includeBadges: boolean;
    isMember: boolean;
    includeEmotes: boolean;
    index: number;
}): UnknownRecord {
    const { username, userId, timestamp, text, media, includeBadges, isMember, includeEmotes, index } = options;
    const emoteRun = (suffix: number) => ({
        emoji: {
            emoji_id: `${media.emote.id}-${suffix}`,
            is_custom: true,
            image: [{ url: media.emote.imageUrl, width: 48, height: 48 }]
        }
    });
    return {
        type: 'AddChatItemAction',
        item: {
            type: 'LiveChatTextMessage',
            id: `test-youtube-chat-${index}`,
            author: createYouTubePreviewAuthor({ username, userId, media, includeBadges, isMember }),
            message: {
                text,
                runs: includeEmotes
                    ? [
                        emoteRun(1),
                        { text: ' test message ' },
                        emoteRun(2),
                        { text: ' hello world this is a message to everyone ' },
                        emoteRun(3),
                        { text: ' how are we today?' }
                    ]
                    : [{ text }]
            },
            timestamp
        }
    };
}

function createYouTubePreviewMonetizationItem(options: {
    scenarioType: string;
    username: string;
    userId: string;
    timestamp: string;
    media: PreviewMedia;
    index: number;
}): UnknownRecord {
    const { scenarioType, username, userId, timestamp, media, index } = options;
    const author = createYouTubePreviewAuthor({
        username,
        userId,
        media,
        includeBadges: true,
        isMember: true
    });
    const baseItem = {
        id: `test-youtube-${scenarioType}-${index}`,
        author,
        timestamp,
        message: { text: '' }
    };

    if (scenarioType === 'giftpaypiggy') {
        return {
            type: 'AddChatItemAction',
            item: {
                ...baseItem,
                type: 'LiveChatSponsorshipsGiftPurchaseAnnouncement',
                header: {
                    author_name: { text: username },
                    author_photo: [{ url: media.avatarUrl, width: 64, height: 64 }]
                },
                primary_text: { text: 'Sent 3 gift memberships' },
                giftMembershipsCount: 3,
                membershipGiftCount: 3
            }
        };
    }

    if (scenarioType === 'gift') {
        return {
            type: 'AddChatItemAction',
            item: {
                ...baseItem,
                type: 'LiveChatPaidSticker',
                purchase_amount: '$5.00',
                sticker_accessibility_label: 'Preview sticker',
                sticker: [{ url: media.emote.imageUrl, width: 88, height: 88 }]
            }
        };
    }

    return {
        type: 'AddChatItemAction',
        item: {
            ...baseItem,
            type: 'LiveChatMembershipItem',
            headerPrimaryText: { text: 'Member for 2 months' },
            headerSubtext: { text: 'Member' },
            memberMilestoneDurationInMonths: 2,
            message: { text: 'Glad to be here!' }
        }
    };
}

function buildPreviewScenarioEvents(
    durationMs: number = PREVIEW_DURATION_MS,
    intervalMs: number = PREVIEW_INTERVAL_MS,
    scenario: PreviewScenario = 'all'
): PreviewScenarioEvent[] {
    const scenarioTemplate = scenario === 'all'
        ? PREVIEW_SCENARIO_TEMPLATE
        : scenario === 'funding'
            ? FUNDING_PREVIEW_SCENARIO_TEMPLATE
            : PREVIEW_SCENARIO_TEMPLATE.filter((step) => scenario === 'chat'
                ? step.type.startsWith('chat')
                : !step.type.startsWith('chat'));
    const eventCount = scenario === 'all'
        ? Math.floor(durationMs / intervalMs)
        : scenarioTemplate.length;
    const events: PreviewScenarioEvent[] = [];

    const getAccount = (platform: PreviewAdapter): PreviewPlatformAccount => PREVIEW_PLATFORM_ACCOUNTS.find((entry) => entry.platform === platform) || PREVIEW_PLATFORM_ACCOUNTS[0];
    const firstPrimaryChatByPlatform = new Set();

    for (let index = 0; index < eventCount; index += 1) {
        const scenarioStep = scenarioTemplate[index % scenarioTemplate.length];
        if (!scenarioStep) {
            throw new Error(`Missing preview scenario step for index ${index}`);
        }
        const scenarioType = scenarioStep.type;
        const notificationType = getPreviewNotificationType(scenarioType);
        const scenarioMetadata = {
            scenarioType,
            ...(notificationType ? { notificationType } : {})
        };
        const adapter = scenarioStep.adapter;
        const account = getAccount(adapter);
        const media = PREVIEW_MEDIA_CATALOG[adapter];
        const gift = media.gift;
        const timestamp = new Date(Date.UTC(2024, 0, 1, 0, 0, index)).toISOString();
        const isYouTubeMemberChat = adapter === 'youtube' && (scenarioType === 'chat' || scenarioType === 'chat-member-hi');
        const username = isYouTubeMemberChat ? account.username : `${account.username}-${index}`;
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
                    ...scenarioMetadata,
                    platform: 'twitch',
                    adapter: 'twitch',
                    rawEvent: {
                        subscriptionType: 'channel.chat.message',
                        metadata: {
                            message_timestamp: timestamp
                        },
                        event: {
                            ...base,
                            chatter_user_name: username,
                            chatter_user_id: userId,
                            chatter_user_login: userId,
                            broadcaster_user_name: 'test-preview-broadcaster',
                            broadcaster_user_id: 'test-preview-broadcaster-id',
                            broadcaster_user_login: 'test-preview-broadcaster',
                            badges: includePreviewBadges
                                ? [
                                    { set_id: 'moderator', id: '1', info: '' },
                                    { set_id: 'founder', id: '0', info: '1' },
                                    { set_id: 'premium', id: '1', info: '' }
                                ]
                                : [],
                            color: '#9146ff',
                            message: {
                                text,
                                fragments: scenarioType === 'chat'
                                    ? [
                                        {
                                            type: 'emote',
                                            text: ':preview1:',
                                            emote: {
                                                id: media.emote.id || 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                                                emote_set_id: 'preview',
                                                format: ['animated', 'static'],
                                                scale: ['1.0', '2.0', '3.0']
                                            }
                                        },
                                        { type: 'text', text: ' test message ' },
                                        {
                                            type: 'emote',
                                            text: ':preview2:',
                                            emote: {
                                                id: media.emote.id || 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                                                emote_set_id: 'preview',
                                                format: ['animated', 'static'],
                                                scale: ['1.0', '2.0', '3.0']
                                            }
                                        },
                                        { type: 'text', text: ' hello world this is a message to everyone ' },
                                        {
                                            type: 'emote',
                                            text: ':preview3:',
                                            emote: {
                                                id: media.emote.id || 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7',
                                                emote_set_id: 'preview',
                                                format: ['animated', 'static'],
                                                scale: ['1.0', '2.0', '3.0']
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
                ...scenarioMetadata,
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
                ...scenarioMetadata,
                platform: 'youtube',
                adapter: 'youtube',
                rawEvent: {
                    eventType,
                    chatItem: eventType === 'LiveChatTextMessage'
                        ? createYouTubePreviewChatItem({
                            username,
                            userId,
                            timestamp,
                            text,
                            media,
                            includeBadges: includePreviewBadges,
                            isMember: isPreviewPaypiggyChat || isMemberHiChat,
                            includeEmotes: isPreviewPaypiggyChat,
                            index
                        })
                        : createYouTubePreviewMonetizationItem({
                            scenarioType,
                            username,
                            userId,
                            timestamp,
                            media,
                            index
                        })
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
                        emoteId: media.emote.id || '0123456789012345678',
                        image: {
                            imageUrl: media.emote.imageUrl
                        }
                    }
                },
                {
                    placeInComment: 17,
                    emote: {
                        emoteId: media.emote.id || '0123456789012345678',
                        image: {
                            imageUrl: media.emote.imageUrl
                        }
                    }
                },
                {
                    placeInComment: 33,
                    emote: {
                        emoteId: media.emote.id || '0123456789012345678',
                        image: {
                            imageUrl: media.emote.imageUrl
                        }
                    }
                }
            ]
            : undefined;
        events.push({
            ...scenarioMetadata,
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
                    giftName: gift?.name || 'Rose',
                    repeatCount: scenarioType === 'gift' ? 1 : 5,
                    diamondCount: scenarioType === 'gift'
                        ? Number(gift?.unitAmount || 10)
                        : 10,
                    ...(scenarioType === 'envelope' ? { giftCoins: 10, currency: 'coins' } : {}),
                    ...(scenarioType === 'gift' && gift?.imageUrl
                        ? {
                            gift: {
                                giftPictureUrl: gift.imageUrl
                            },
                            giftDetails: {
                                id: gift.giftId,
                                giftName: gift.name,
                                diamondCount: Number(gift.unitAmount || 10),
                                giftType: 0,
                                primaryEffectId: gift.primaryEffectId,
                                giftImage: {
                                    url: [gift.imageUrl]
                                }
                            },
                            asset: {
                                resourceModel: {
                                    urlList: [gift.animation.resourceModelUrl]
                                },
                                videoResourceList: gift.animation.videoResources
                            },
                            repeatEnd: 1
                        }
                        : {}),
                    msgId: `test-${scenarioType}-${index}`,
                    timestamp,
                    common: {
                        createTime: Math.floor(Date.parse(timestamp) / 1000)
                    }
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

    class PreviewRawPlatformDataLoggingService {
        async logRawPlatformData(): Promise<void> {}
    }

    const twitchPlatform = new TwitchPlatformClass(getPreviewRecord(config, 'twitch'), {
        logger: resolvedLogger,
        twitchAuth: {
            isReady: () => true,
            refreshTokens: async () => true
        },
        RawPlatformDataLoggingService: PreviewRawPlatformDataLoggingService,
        retrySystem: null
    });
    const twitchBadgeSetIds = ['moderator', 'founder', 'premium'];
    twitchPlatform.apiClient = {
        getUserById: async () => ({ profile_image_url: PREVIEW_MEDIA_CATALOG.twitch.avatarUrl }),
        getGlobalChatBadges: async () => PREVIEW_MEDIA_CATALOG.twitch.badges.map((badge, index) => ({
            set_id: twitchBadgeSetIds[index],
            versions: [{ id: index === 1 ? '0' : '1', image_url_4x: badge.imageUrl, title: badge.label }]
        })),
        getChannelChatBadges: async () => [],
        getCheermotes: async () => []
    };
    const emitTwitchPayload = (type: string) => (payload: UnknownRecord) => {
        emitPlatformEvent({ type, platform: 'twitch', data: payload });
    };
    twitchPlatform.handlers = {
        onChat: emitTwitchPayload(PlatformEvents.CHAT_MESSAGE),
        onFollow: emitTwitchPayload(PlatformEvents.FOLLOW),
        onGift: emitTwitchPayload(PlatformEvents.GIFT),
        onRaid: emitTwitchPayload(PlatformEvents.RAID),
        onPaypiggy: emitTwitchPayload(PlatformEvents.PAYPIGGY),
        onGiftPaypiggy: emitTwitchPayload(PlatformEvents.GIFTPAYPIGGY)
    };
    const pendingTwitchEvents: Promise<void>[] = [];
    const twitchRouter = createTwitchEventSubEventRouter({
        config,
        logger: resolvedLogger,
        emit(eventName: string, payload: UnknownRecord) {
            const handlers: Record<string, (event: UnknownRecord) => Promise<void>> = {
                chatMessage: (event) => twitchPlatform.onMessageHandler(event),
                follow: (event) => twitchPlatform.handleFollowEvent(event),
                gift: (event) => twitchPlatform.handleGiftEvent(event),
                raid: (event) => twitchPlatform.handleRaidEvent(event),
                paypiggy: (event) => twitchPlatform.handlePaypiggyEvent(event),
                paypiggyGift: (event) => twitchPlatform.handlePaypiggyGiftEvent(event)
            };
            const handler = handlers[eventName];
            if (handler) {
                pendingTwitchEvents.push(handler(payload));
            }
        }
    });

    const youtubePlatform = new YouTubePlatformClass(getPreviewRecord(config, 'youtube'), {
        logger: resolvedLogger,
        streamDetectionService: {
            detectLiveStreams: async () => []
        },
        RawPlatformDataLoggingService: PreviewRawPlatformDataLoggingService,
        rawPlatformDataLoggingService: new PreviewRawPlatformDataLoggingService()
    });
    const emitYouTubePayload = (type: string) => (payload: UnknownRecord) => {
        emitPlatformEvent({ type, platform: 'youtube', data: payload });
    };
    youtubePlatform.handlers = {
        onChat: emitYouTubePayload(PlatformEvents.CHAT_MESSAGE),
        onGift: emitYouTubePayload(PlatformEvents.GIFT),
        onPaypiggy: emitYouTubePayload(PlatformEvents.PAYPIGGY),
        onGiftPaypiggy: emitYouTubePayload(PlatformEvents.GIFTPAYPIGGY)
    };

    const tiktokConnection = new PreviewAsyncEventEmitter();
    const tiktokEventFactory = createTikTokEventFactory({ platformName: 'tiktok' });
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
        async _handleChatMessage(_raw: UnknownRecord, normalizedData: UnknownRecord) {
            const payload = tiktokEventFactory.createChatMessage(_raw, {
                normalizedData: {
                    ...normalizedData,
                    badgeImages: Array.isArray(normalizedData?.badgeImages)
                        ? normalizedData.badgeImages
                        : (Array.isArray(_raw?.badgeImages) ? _raw.badgeImages : [])
                }
            });
            emitPlatformEvent({ type: PlatformEvents.CHAT_MESSAGE, platform: 'tiktok', data: payload });
        },
        async handleTikTokGift(data: UnknownRecord) {
            const normalizedGift = normalizeTikTokGiftEvent(data, {
                platformName: 'tiktok',
                getTimestamp: (payload: UnknownRecord) => resolveTikTokTimestampISO(payload),
                getPlatformMessageId: (payload: UnknownRecord) => getPreviewString(payload.msgId)
            });
            const eventData = tiktokEventFactory.createGift({
                ...normalizedGift,
                enhancedGiftData: {
                    username: normalizedGift.username,
                    userId: normalizedGift.userId,
                    giftType: normalizedGift.giftType,
                    giftCount: normalizedGift.giftCount,
                    amount: normalizedGift.amount,
                    currency: normalizedGift.currency,
                    isAggregated: false,
                    isStreakCompleted: normalizedGift.repeatEnd === true,
                    originalData: {
                        asset: data.asset,
                        giftDetails: data.giftDetails,
                        gift: data.gift
                    }
                }
            });
            emitPlatformEvent({ type: PlatformEvents.GIFT, platform: 'tiktok', data: eventData });
        },
        async handleTikTokFollow(data: UnknownRecord) {
            const identity = extractTikTokUserData(data);
            const eventData = tiktokEventFactory.createFollow({
                ...identity,
                avatarUrl: extractTikTokAvatarUrl(data),
                timestamp: resolveTikTokTimestampISO(data),
                metadata: { platform: 'tiktok' }
            });
            emitPlatformEvent({ type: PlatformEvents.FOLLOW, platform: 'tiktok', data: eventData });
        },
        async handleTikTokShare(data: UnknownRecord) {
            const identity = extractTikTokUserData(data);
            const eventData = tiktokEventFactory.createShare({
                ...identity,
                avatarUrl: extractTikTokAvatarUrl(data),
                timestamp: resolveTikTokTimestampISO(data),
                metadata: { platform: 'tiktok' }
            });
            emitPlatformEvent({ type: PlatformEvents.SHARE, platform: 'tiktok', data: eventData });
        },
        async handleTikTokSocial(data: UnknownRecord) {
            if (String(data.displayType || '').toLowerCase() !== 'share') {
                return;
            }
            await this.handleTikTokShare(data);
        },
        async _handleStandardEvent(_eventType: string, data: UnknownRecord, options: UnknownRecord) {
            if (options.factoryMethod !== 'createEnvelope') {
                throw new Error(`Unsupported preview TikTok factory: ${String(options.factoryMethod)}`);
            }
            const eventData = tiktokEventFactory.createEnvelope({
                ...data,
                avatarUrl: extractTikTokAvatarUrl(data)
            });
            emitPlatformEvent({ type: String(options.emitType), platform: 'tiktok', data: eventData });
        }
    };
    setupTikTokEventListeners(tiktokPlatform);

    return {
        twitch: {
            async ingest(rawEvent: UnknownRecord) {
                twitchRouter.handleNotificationEvent(getPreviewString(rawEvent.subscriptionType), toPreviewRecord(rawEvent.event), toPreviewRecord(rawEvent.metadata));
                const pending = pendingTwitchEvents.splice(0, pendingTwitchEvents.length);
                await Promise.all(pending);
            }
        },
        youtube: {
            async ingest(rawEvent: UnknownRecord) {
                await youtubePlatform.eventRouter.routeEvent(rawEvent.chatItem, getPreviewString(rawEvent.eventType));
            }
        },
        tiktok: {
            async ingest(rawEvent: UnknownRecord) {
                await tiktokConnection.emitAsync(getPreviewEventName(rawEvent.eventType), rawEvent.data);
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
    runtime.prepareFarewellNotification = async (platform: string, username: string, payload: UnknownRecord = {}) => {
        return notificationManager.prepareNotification('farewell', platform, {
            ...payload,
            username,
            type: 'farewell'
        });
    };
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
    const config = toPreviewRecord(options.config);
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
        processDonationGoal: async () => {},
        processPaypiggyGoal: async () => {}
    };

    const displayQueue = options.displayQueue || new DisplayQueue(
        obsManager,
        {
            ...getPreviewRecord(config, 'displayQueue'),
            autoProcess: true,
            timing: config.timing,
            obs: config.obs,
            chat: getPreviewRecord(config, 'chat'),
            notification: getPreviewRecord(config, 'notification'),
             gui: getPreviewRecord(config, 'gui'),
             notificationIdleHoldMs: getPreviewRecord(config, 'gui').notificationIdleHoldMs,
             monetizationIdleHoldMs: getPreviewRecord(config, 'gui').monetizationIdleHoldMs,
             notificationTransitionMs: getPreviewRecord(config, 'gui').notificationTransitionMs,
            gifts: getPreviewRecord(config, 'gifts'),
            twitch: getPreviewRecord(config, 'twitch'),
            youtube: getPreviewRecord(config, 'youtube'),
            tiktok: getPreviewRecord(config, 'tiktok')
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
            ...((typeof options.notificationDelay === 'function' || typeof options.delay !== 'function')
                ? { notificationDelay: typeof options.notificationDelay === 'function' ? options.notificationDelay : async () => {} }
                : {}),
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

    const notificationManager = options.notificationManager || new NotificationManagerClass({
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
        const payloadRecord = toPreviewRecord(payload);
        eventBus.emit(PlatformEvents.VFX_COMMAND_EXECUTED, {
            ...payloadRecord,
            type: PlatformEvents.VFX_COMMAND_EXECUTED
        });
        eventBus.emit(PlatformEvents.VFX_EFFECT_COMPLETED, {
            ...payloadRecord,
            type: PlatformEvents.VFX_EFFECT_COMPLETED
        });
    });
    let disposed = false;

    return {
        eventBus,
        emitIngestEvent(event: UnknownRecord) {
            eventBus.emit('platform:event', event);
        },
        async dispose() {
            if (disposed) {
                return;
            }
            disposed = true;

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

            const stoppableDisplayQueue = displayQueue as { stop?: () => Promise<void> | void };
            if (typeof stoppableDisplayQueue.stop === 'function') {
                try {
                    await stoppableDisplayQueue.stop();
                } catch (error) {
                    errorHandler.handleEventProcessingError(error, 'pipeline-dispose', null, 'Failed stopping preview display queue');
                }
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

async function runPreviewScenario(options: RunPreviewScenarioOptions): Promise<PreviewScenarioRunResult> {
    const {
        adapters,
        scenarioEvents,
        intervalMs,
        durationMs,
        safeSetIntervalImpl,
        safeSetTimeoutImpl,
        errorHandler,
        dispatchImmediately = true
    } = options;

    let eventIndex = 0;
    const dispatchedEvents: PreviewScenarioEvent[] = [];
    const inFlight = new Set<Promise<void>>();
    const dispatchNextEvent = () => {
        if (eventIndex >= scenarioEvents.length) {
            return;
        }

        const event = scenarioEvents[eventIndex];
        if (!event) {
            return;
        }
        const adapter = adapters[event.adapter];
        if (adapter && typeof adapter.ingest === 'function') {
            dispatchedEvents.push(event);
            const pending = Promise.resolve(adapter.ingest(event.rawEvent)).catch((error: unknown) => {
                errorHandler.handleEventProcessingError(error, 'preview-ingest', event.rawEvent, 'Failed processing preview ingest event');
            });
            inFlight.add(pending);
            void pending.finally(() => inFlight.delete(pending));
        }
        eventIndex += 1;
    };

    if (dispatchImmediately) {
        dispatchNextEvent();
    }

    const intervalHandle = safeSetIntervalImpl(() => {
        dispatchNextEvent();
    }, intervalMs);

    await new Promise<void>((resolve) => {
        safeSetTimeoutImpl(() => resolve(), durationMs);
    });
    clearInterval(intervalHandle);
    await Promise.all([...inFlight]);

    return { intervalHandle, dispatchedEvents };
}

function createNotificationExitWaiter(
    eventBus: PreviewEventBus,
    notificationType: string,
    timeoutMs: number
): PreviewNotificationExitWaiter {
    let cancel = () => {};
    const promise = new Promise<void>((resolve, reject) => {
        let settled = false;
        let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
        let unsubscribe = () => {};
        const settle = (callback: () => void) => {
            if (settled) return;
            settled = true;
            unsubscribe();
            if (timeoutHandle !== null) {
                clearTimeout(timeoutHandle);
            }
            callback();
        };
        unsubscribe = eventBus.subscribe(DISPLAY_EVENT_TYPES.NOTIFICATION_LIFECYCLE, (payload: unknown) => {
            const lifecycle = toPreviewRecord(payload);
            if (lifecycle.phase === 'exit-started' && lifecycle.type === notificationType) {
                settle(resolve);
            }
        });
        timeoutHandle = safeSetTimeout(() => {
            settle(() => reject(new Error(`Timed out waiting for ${notificationType} preview notification to exit`)));
        }, timeoutMs);
        cancel = () => settle(resolve);
    });
    return { promise, cancel: () => cancel() };
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
    const scenario = options.scenario || 'all';
    const requestedDurationMs = options.durationMs;
    const requestedIntervalMs = options.intervalMs;
    const intervalMs = typeof requestedIntervalMs === 'number' && Number.isInteger(requestedIntervalMs) && requestedIntervalMs > 0
        ? requestedIntervalMs
        : PREVIEW_INTERVAL_MS;
    const scenarioEvents = buildPreviewScenarioEvents(PREVIEW_DURATION_MS, intervalMs, scenario);
    const minimumScenarioDurationMs = scenarioEvents.length * intervalMs;
    const defaultDurationMs = scenario === 'funding'
        ? FUNDING_PREVIEW_DURATION_MS
        : options.scenario ? minimumScenarioDurationMs : PREVIEW_DURATION_MS;
    const durationMs = typeof requestedDurationMs === 'number' && Number.isInteger(requestedDurationMs) && requestedDurationMs > 0
        ? requestedDurationMs
        : defaultDurationMs;
    if (options.scenario && durationMs < minimumScenarioDurationMs) {
        throw new Error(`GUI preview scenario ${scenario} requires at least ${minimumScenarioDurationMs}ms to dispatch every fixture`);
    }

    const logger = resolveLogger(options.logger);
    const errorHandler = createGuiPreviewErrorHandler(logger);
    const createPreviewPipelineImpl = options.createPreviewPipelineImpl || createPreviewPipeline;
    const createPreviewIngestAdaptersImpl = options.createPreviewIngestAdaptersImpl || createPreviewIngestAdapters;
    const createGuiTransportServiceImpl = options.createGuiTransportServiceImpl || createGuiTransportService;
    const safeSetIntervalImpl = options.safeSetIntervalImpl || safeSetInterval;
    const safeSetTimeoutImpl = options.safeSetTimeoutImpl || safeSetTimeout;
    const createNotificationExitWaiterImpl = options.createNotificationExitWaiterImpl || createNotificationExitWaiter;
    const stdout = options.stdout || process.stdout;
    const delay = options.delay || createPreviewDelay();

    let pipeline: PreviewPipeline | null = null;
    let service: PreviewService | null = null;
    let intervalHandle: ReturnType<typeof setInterval> | number | null = null;
    let notificationExitWaiter: PreviewNotificationExitWaiter | null = null;
    let unsubscribeFundingPreview: (() => void) | null = null;
    const giftAnimationResolver = options.giftAnimationResolver || {
        resolveFromNotificationData: async () => null
    };

    try {
        const previewPipelineOptions: CreatePreviewPipelineOptions = {
            config,
            logger,
            giftAnimationResolver,
            delay
        };
        if (options.eventBus) {
            previewPipelineOptions.eventBus = options.eventBus;
        }

        pipeline = createPreviewPipelineImpl(previewPipelineOptions);

        if (!pipeline || typeof pipeline.emitIngestEvent !== 'function' || !pipeline.eventBus) {
            throw new Error('Preview pipeline requires eventBus and emitIngestEvent');
        }
        const activePipeline = pipeline;

        const previewFundingGoal = createPreviewFundingGoalService();
        const previewFileSystem = createPreviewMemoryFileSystem();
        const previewControls = await createOperatorControlService({
            defaults: Object.fromEntries(OPERATOR_CONTROL_KEYS.map((key: string) => [key, true])),
            filePath: '/preview/operator-controls.json',
            fs: previewFileSystem
        });
        const previewAppearance = await createOperatorAppearanceService({
            defaults: {
                compactRows: true,
                rowBackgroundsEnabled: false,
                maxDisplayableBadges: 3
            },
            filePath: '/preview/operator-appearance.json',
            fs: previewFileSystem
        });
        const previewLogs = createOperatorLogSource();
        let fundingStep = 0;
        unsubscribeFundingPreview = activePipeline.eventBus.subscribe('platform:event', (payload) => {
            const type = getPreviewString(toPreviewRecord(payload).type);
            if (fundingStep < FUNDING_PREVIEW_AMOUNTS_USD.length &&
                (type === 'platform:gift' || type === 'platform:paypiggy' || type === 'platform:giftpaypiggy')) {
                const amountUsd = FUNDING_PREVIEW_AMOUNTS_USD[fundingStep];
                fundingStep += 1;
                if (amountUsd !== undefined) void previewFundingGoal.advance(amountUsd);
            }
        });
        const activeService = createGuiTransportServiceImpl({
            config,
            eventBus: activePipeline.eventBus,
            logger,
            fundingGoal: previewFundingGoal,
            operatorControls: previewControls,
            operatorAppearance: previewAppearance,
            operatorLogs: previewLogs,
            assetsRoot: path.resolve(__dirname, '../../gui/dist')
        });
        service = activeService;

        await activeService.start();

        const guiConfig = getPreviewRecord(config, 'gui');
        const host = typeof guiConfig.host === 'string' ? guiConfig.host : '127.0.0.1';
        const port = typeof guiConfig.port === 'number' || typeof guiConfig.port === 'string' ? guiConfig.port : 3000;
        stdout.write(`GUI preview running with ${Math.floor(durationMs / 1000)}s dispatch window\n`);
        stdout.write(`Scenario: ${scenario}\n`);
        stdout.write(`Dock URL: http://${host}:${port}/dock\n`);
        stdout.write(`Notifications URL: http://${host}:${port}/notifications\n`);
        stdout.write(`Notifications minimal URL: http://${host}:${port}/notifications?appearance=minimal\n`);
        stdout.write('For TikTok gift animation preview, run: bun run gui:preview:gift-animation\n');
        stdout.write(`Overlay URL: http://${host}:${port}/overlay\n`);
        stdout.write(`Operator URL: http://${host}:${port}/operator\n`);
        stdout.write(`Overlay minimal URL: http://${host}:${port}/overlay?appearance=minimal\n`);
        stdout.write(`Goal URL: http://${host}:${port}/goal\n`);
        stdout.write(`Goal minimal URL: http://${host}:${port}/goal?appearance=minimal\n`);
        if (scenario === 'funding') {
            stdout.write('Funding progression: $0 → $25 → $50 → $75 → $100 → $150\n');
        }

        if (typeof activeService.getSseClientCount === 'function' && activeService.getSseClientCount() === 0) {
            stdout.write('Waiting for a GUI page to connect before starting the scenario...\n');
            while (activeService.getSseClientCount() === 0) {
                await delay(100);
            }
        }

        const adapters = createPreviewIngestAdaptersImpl({
            config,
            logger,
            emitPlatformEvent: (event: UnknownRecord) => activePipeline.emitIngestEvent(event)
        });
        const finalNotificationType = options.scenario
            ? [...scenarioEvents].reverse().find((event) => event.notificationType)?.notificationType
            : undefined;
        if (finalNotificationType) {
            notificationExitWaiter = createNotificationExitWaiterImpl(
                activePipeline.eventBus,
                finalNotificationType,
                durationMs + PREVIEW_NOTIFICATION_EXIT_TIMEOUT_MS
            );
        }
        const scenarioResult = await runPreviewScenario({
            adapters,
            scenarioEvents,
            intervalMs,
            durationMs,
            safeSetIntervalImpl,
            safeSetTimeoutImpl,
            errorHandler,
            dispatchImmediately: scenario !== 'funding'
        });
        intervalHandle = scenarioResult.intervalHandle;

        if (finalNotificationType && notificationExitWaiter) {
            stdout.write(`Waiting for ${finalNotificationType} notification lifecycle to finish...\n`);
            await notificationExitWaiter.promise;
        }

        if (options.keepOpen) {
            stdout.write('GUI preview scenario finished; server remains running until Ctrl+C\n');
            await (options.waitForShutdownImpl || waitForPreviewShutdown)();
        } else {
            stdout.write('GUI preview finished\n');
        }
    } catch (error) {
        errorHandler.handleEventProcessingError(error, 'preview-run', null, 'GUI preview failed');
        throw error;
    } finally {
        notificationExitWaiter?.cancel();
        unsubscribeFundingPreview?.();
        await disposePreviewPipeline({
            intervalHandle,
            service,
            pipeline,
            errorHandler
        });
    }
}

if (require.main === module) {
    const cliArgs = process.argv.slice(2);
    const keepOpen = !cliArgs.includes('--once');
    runGuiPreview({ scenario: parsePreviewScenario(cliArgs), keepOpen }).catch((error: unknown) => {
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
    parsePreviewScenario,
    createPreviewDelay,
    buildPreviewConfig,
    buildPreviewScenarioEvents,
    createPreviewPipeline,
    createPreviewIngestAdapters,
    runPreviewScenario,
    runGuiPreview
};
