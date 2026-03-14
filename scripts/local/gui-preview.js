const configModule = require('../../src/core/config');
const { logger: defaultLogger } = require('../../src/core/logging');
const { createEventBus } = require('../../src/core/EventBus');
const { PlatformEvents } = require('../../src/interfaces/PlatformEvents');
const { PRIORITY_LEVELS, NOTIFICATION_CONFIGS } = require('../../src/core/constants');
const { createPlatformErrorHandler } = require('../../src/utils/platform-error-handler');
const { safeSetInterval, safeSetTimeout } = require('../../src/utils/timeout-validator');
const { createGuiTransportService } = require('../../src/services/gui/gui-transport-service');
const PlatformEventRouter = require('../../src/services/PlatformEventRouter');
const ChatNotificationRouter = require('../../src/services/ChatNotificationRouter');
const { createVFXCommandService } = require('../../src/services/VFXCommandService');
const CommandCooldownService = require('../../src/services/CommandCooldownService');
const { createUserTrackingService } = require('../../src/services/UserTrackingService');
const NotificationManager = require('../../src/notifications/NotificationManager');
const { DisplayQueue } = require('../../src/obs/display-queue');

const PREVIEW_DURATION_MS = 30000;
const PREVIEW_INTERVAL_MS = 2000;

const PREVIEW_EMOTE_URL = 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0';
const PREVIEW_AVATAR_URL = 'https://static-cdn.jtvnw.net/jtv_user_pictures/xarth/404_user_70x70.png';
const PREVIEW_EMOTE_ID = 'emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7';
const PREVIEW_MESSAGE_TEXT = 'test message hello world this is a message to everyone how are we today?';

const PREVIEW_EVENT_TYPES = [
    PlatformEvents.CHAT_MESSAGE,
    PlatformEvents.FOLLOW,
    'command',
    'greeting',
    'farewell',
    PlatformEvents.GIFT,
    PlatformEvents.RAID,
    PlatformEvents.SHARE,
    PlatformEvents.PAYPIGGY,
    PlatformEvents.GIFTPAYPIGGY,
    PlatformEvents.ENVELOPE
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

function createGuiPreviewErrorHandler(logger) {
    return createPlatformErrorHandler(logger, 'gui-preview');
}

function resolveLogger(logger) {
    const source = (logger && typeof logger.error === 'function')
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

function mergeSection(baseSection, overrideSection, forcedSection) {
    return {
        ...(baseSection || {}),
        ...(overrideSection || {}),
        ...(forcedSection || {})
    };
}

function buildPreviewConfig(baseConfig) {
    const sourceConfig = configModule.config || {};
    const overrideConfig = baseConfig || {};

    const merged = {
        ...sourceConfig,
        ...overrideConfig
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

    const platformFlags = {
        messagesEnabled: true,
        commandsEnabled: true,
        greetingsEnabled: true,
        farewellsEnabled: true,
        followsEnabled: true,
        giftsEnabled: true,
        raidsEnabled: true,
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

    const sourceCooldowns = sourceConfig.cooldowns || {};
    const overrideCooldowns = overrideConfig.cooldowns || {};
    merged.cooldowns = {
        ...sourceCooldowns,
        ...overrideCooldowns,
        cmdCooldown: overrideCooldowns.cmdCooldown ?? sourceCooldowns.cmdCooldown ?? 0,
        cmdCooldownMs: overrideCooldowns.cmdCooldownMs ?? sourceCooldowns.cmdCooldownMs ?? 0,
        globalCmdCooldown: overrideCooldowns.globalCmdCooldown ?? sourceCooldowns.globalCmdCooldown ?? 0,
        globalCmdCooldownMs: overrideCooldowns.globalCmdCooldownMs ?? sourceCooldowns.globalCmdCooldownMs ?? 0,
        heavyCommandCooldown: overrideCooldowns.heavyCommandCooldown ?? sourceCooldowns.heavyCommandCooldown ?? 0,
        heavyCommandCooldownMs: overrideCooldowns.heavyCommandCooldownMs ?? sourceCooldowns.heavyCommandCooldownMs ?? 0,
        heavyCommandWindow: overrideCooldowns.heavyCommandWindow ?? sourceCooldowns.heavyCommandWindow ?? 1,
        heavyCommandWindowMs: overrideCooldowns.heavyCommandWindowMs ?? sourceCooldowns.heavyCommandWindowMs ?? 1000,
        heavyCommandThreshold: overrideCooldowns.heavyCommandThreshold ?? sourceCooldowns.heavyCommandThreshold ?? 999,
        maxEntries: overrideCooldowns.maxEntries ?? sourceCooldowns.maxEntries ?? 1000
    };

    merged.farewell = mergeSection(sourceConfig.farewell, overrideConfig.farewell, {
        timeout: overrideConfig?.farewell?.timeout ?? sourceConfig?.farewell?.timeout ?? 1
    });

    merged.displayQueue = mergeSection(sourceConfig.displayQueue, overrideConfig.displayQueue, {
        autoProcess: false
    });

    merged.commands = {
        ...(sourceConfig.commands || {}),
        ...(overrideConfig.commands || {})
    };

    return merged;
}

function buildPreviewMessageParts(platform) {
    return {
        text: PREVIEW_MESSAGE_TEXT,
        parts: [
            {
                type: 'emote',
                platform,
                emoteId: PREVIEW_EMOTE_ID,
                imageUrl: PREVIEW_EMOTE_URL
            },
            {
                type: 'text',
                text: ' test message '
            },
            {
                type: 'emote',
                platform,
                emoteId: PREVIEW_EMOTE_ID,
                imageUrl: PREVIEW_EMOTE_URL
            },
            {
                type: 'text',
                text: ' hello world this is a message to everyone '
            },
            {
                type: 'emote',
                platform,
                emoteId: PREVIEW_EMOTE_ID,
                imageUrl: PREVIEW_EMOTE_URL
            },
            {
                type: 'text',
                text: ' how are we today?'
            }
        ]
    };
}

function buildPreviewEventData(type, account, index, timestamp) {
    const baseData = {
        username: account.username,
        userId: account.userId,
        timestamp,
        avatarUrl: PREVIEW_AVATAR_URL
    };

    if (type === PlatformEvents.CHAT_MESSAGE) {
        const message = index < 3
            ? buildPreviewMessageParts(account.platform)
            : { text: `preview message ${index}` };
        return {
            ...baseData,
            isPaypiggy: index === 0,
            message
        };
    }

    if (type === 'command') {
        return {
            ...baseData,
            command: '!preview',
            commandName: 'preview'
        };
    }

    if (type === 'farewell') {
        return {
            ...baseData,
            command: '!bye',
            trigger: '!bye'
        };
    }

    if (type === PlatformEvents.GIFT || type === PlatformEvents.ENVELOPE) {
        return {
            ...baseData,
            id: `test-gift-id-${index}`,
            giftType: 'Rose',
            giftCount: 5,
            amount: 50,
            currency: 'coins'
        };
    }

    if (type === PlatformEvents.GIFTPAYPIGGY) {
        return {
            ...baseData,
            giftCount: 3,
            tier: '1'
        };
    }

    if (type === PlatformEvents.RAID) {
        return {
            ...baseData,
            viewerCount: 42
        };
    }

    if (type === PlatformEvents.PAYPIGGY) {
        return {
            ...baseData,
            tier: '1',
            months: 2,
            message: 'membership'
        };
    }

    return baseData;
}

function buildPreviewScenarioEvents(durationMs = PREVIEW_DURATION_MS, intervalMs = PREVIEW_INTERVAL_MS) {
    const eventCount = Math.floor(durationMs / intervalMs);
    const events = [];

    for (let index = 0; index < eventCount; index += 1) {
        const type = PREVIEW_EVENT_TYPES[index % PREVIEW_EVENT_TYPES.length];
        const account = PREVIEW_PLATFORM_ACCOUNTS[index % PREVIEW_PLATFORM_ACCOUNTS.length];
        const timestamp = new Date(Date.UTC(2024, 0, 1, 0, 0, index)).toISOString();

        events.push({
            type,
            platform: account.platform,
            data: buildPreviewEventData(type, account, index, timestamp)
        });
    }

    return events;
}

function createPreviewRuntime(options) {
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

    const runtime = {
        config,
        logger,
        displayQueue,
        notificationManager,
        commandCooldownService,
        userTrackingService,
        vfxCommandService,
        platformLifecycleService,
        gracefulExitService: null,
        isFirstMessage: (userId, context) => userTrackingService.isFirstMessage(userId, context)
    };

    const forwardNotification = (notificationType) => async (platform, username, payload = {}) => {
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
    runtime.handleEnvelopeNotification = async (platform, payload = {}) => {
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

    runtime.handleChatMessage = async (platform, normalizedData = {}) => {
        return chatNotificationRouter.handleChatMessage(platform, normalizedData);
    };

    return {
        runtime,
        chatNotificationRouter
    };
}

function createPreviewPipeline(options = {}) {
    const config = options.config;
    const logger = resolveLogger(options.logger);
    const errorHandler = createGuiPreviewErrorHandler(logger);
    const eventBus = options.eventBus || createEventBus();

    const obsManager = options.obsManager || {
        isReady: async () => false
    };

    const displayQueue = options.displayQueue || new DisplayQueue(
        obsManager,
        {
            ...(config.displayQueue || {}),
            autoProcess: false,
            timing: config.timing,
            obs: config.obs
        },
        {
            PRIORITY_LEVELS,
            NOTIFICATION_CONFIGS
        },
        eventBus
    );

    const commandCooldownService = options.commandCooldownService || new CommandCooldownService({
        config,
        eventBus,
        logger
    });

    const userTrackingService = options.userTrackingService || createUserTrackingService();
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

    return {
        eventBus,
        emitIngestEvent(event) {
            eventBus.emit('platform:event', event);
        },
        async dispose() {
            try {
                platformEventRouter.dispose();
            } catch (error) {
                errorHandler.handleEventProcessingError(error, 'pipeline-dispose', null, 'Failed disposing platform router');
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

async function runPreviewScenario(options = {}) {
    const {
        pipeline,
        scenarioEvents,
        intervalMs,
        durationMs,
        safeSetIntervalImpl,
        safeSetTimeoutImpl
    } = options;

    let eventIndex = 0;
    const intervalHandle = safeSetIntervalImpl(() => {
        if (eventIndex >= scenarioEvents.length) {
            return;
        }

        pipeline.emitIngestEvent(scenarioEvents[eventIndex]);
        eventIndex += 1;
    }, intervalMs);

    await new Promise((resolve) => {
        safeSetTimeoutImpl(resolve, durationMs);
    });

    return intervalHandle;
}

async function disposePreviewPipeline(options = {}) {
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

async function runGuiPreview(options = {}) {
    const config = buildPreviewConfig(options.baseConfig);
    const durationMs = Number.isInteger(options.durationMs) && options.durationMs > 0
        ? options.durationMs
        : PREVIEW_DURATION_MS;
    const intervalMs = Number.isInteger(options.intervalMs) && options.intervalMs > 0
        ? options.intervalMs
        : PREVIEW_INTERVAL_MS;

    const logger = resolveLogger(options.logger);
    const errorHandler = createGuiPreviewErrorHandler(logger);
    const createPreviewPipelineImpl = options.createPreviewPipelineImpl || createPreviewPipeline;
    const createGuiTransportServiceImpl = options.createGuiTransportServiceImpl || createGuiTransportService;
    const safeSetIntervalImpl = options.safeSetIntervalImpl || safeSetInterval;
    const safeSetTimeoutImpl = options.safeSetTimeoutImpl || safeSetTimeout;
    const stdout = options.stdout || process.stdout;

    let pipeline = null;
    let service = null;
    let intervalHandle = null;

    try {
        pipeline = createPreviewPipelineImpl({
            config,
            logger,
            eventBus: options.eventBus
        });

        if (!pipeline || typeof pipeline.emitIngestEvent !== 'function' || !pipeline.eventBus) {
            throw new Error('Preview pipeline requires eventBus and emitIngestEvent');
        }

        service = createGuiTransportServiceImpl({
            config,
            eventBus: pipeline.eventBus,
            logger
        });

        await service.start();

        const host = config.gui.host;
        const port = config.gui.port;
        stdout.write(`GUI preview running for ${Math.floor(durationMs / 1000)}s\n`);
        stdout.write(`Dock URL: http://${host}:${port}/dock\n`);
        stdout.write(`Overlay URL: http://${host}:${port}/overlay\n`);

        const scenarioEvents = buildPreviewScenarioEvents(durationMs, intervalMs);
        intervalHandle = await runPreviewScenario({
            pipeline,
            scenarioEvents,
            intervalMs,
            durationMs,
            safeSetIntervalImpl,
            safeSetTimeoutImpl
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
    runGuiPreview().catch((error) => {
        process.stderr.write(`GUI preview failed: ${error && error.message ? error.message : error}\n`);
        process.exit(1);
    });
}

module.exports = {
    PREVIEW_DURATION_MS,
    PREVIEW_INTERVAL_MS,
    buildPreviewConfig,
    buildPreviewScenarioEvents,
    createPreviewPipeline,
    runPreviewScenario,
    disposePreviewPipeline,
    runGuiPreview
};
