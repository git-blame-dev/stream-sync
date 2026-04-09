import { DEFAULTS } from './config-schema';

const VALID_LOG_LEVELS = ['error', 'warn', 'console', 'info', 'debug'];

type NormalizedConfig = Record<string, Record<string, unknown>>;
type GenericRecord = Record<string, unknown>;
type PlatformConfigRecord = Record<string, unknown>;

const DEFAULT_LOGGING_CONFIG = {
    console: { enabled: true, level: 'console' },
    file: { enabled: true, level: 'debug', directory: DEFAULTS.LOG_DIRECTORY },
    platforms: {
        twitch: { enabled: true, fileLogging: true },
        youtube: { enabled: true, fileLogging: true },
        tiktok: { enabled: true, fileLogging: true }
    },
    chat: { enabled: true, separateFiles: true, directory: DEFAULTS.LOG_DIRECTORY }
};

function buildLoggingConfig(normalized: NormalizedConfig, options: { debugMode?: boolean } = {}) {
    const config = structuredClone(DEFAULT_LOGGING_CONFIG);
    const logging = (normalized.logging || {}) as {
        consoleLevel?: string;
        fileLevel?: string;
        fileLoggingEnabled?: boolean | null;
    };
    const general = (normalized.general || {}) as {
        debugEnabled?: boolean;
    };

    if (logging.consoleLevel && VALID_LOG_LEVELS.includes(logging.consoleLevel)) {
        config.console.level = logging.consoleLevel;
    }
    if (logging.fileLevel && VALID_LOG_LEVELS.includes(logging.fileLevel)) {
        config.file.level = logging.fileLevel;
    }
    if (logging.fileLoggingEnabled !== undefined && logging.fileLoggingEnabled !== null) {
        config.file.enabled = logging.fileLoggingEnabled;
    }

    if (options.debugMode || general.debugEnabled) {
        config.console.level = 'debug';
    }

    config.file.directory = DEFAULTS.LOG_DIRECTORY;
    config.chat.enabled = config.file.enabled;
    config.chat.separateFiles = true;
    config.chat.directory = DEFAULTS.LOG_DIRECTORY;

    return config;
}

function buildGeneralConfig(normalized: NormalizedConfig): GenericRecord {
    const g = normalized.general as GenericRecord & {
        viewerCountPollingInterval: number;
    };

    return {
        ...g,
        viewerCountPollingIntervalMs: g.viewerCountPollingInterval * 1000
    };
}

function buildPlatformConfig(platformName: string, normalized: NormalizedConfig, generalConfig: GenericRecord): PlatformConfigRecord {
    const platform = (normalized[platformName] || {}) as PlatformConfigRecord & {
        pollInterval?: number;
    };
    const generalViewerPollMs = generalConfig.viewerCountPollingIntervalMs as number;

    const result: PlatformConfigRecord = {
        ...platform,
        pollIntervalMs: platform.pollInterval ? platform.pollInterval * 1000 : generalViewerPollMs,
        dataLoggingPath: DEFAULTS.LOG_DIRECTORY
    };

    for (const [key, value] of Object.entries(result)) {
        if (value === null && generalConfig[key] !== undefined) {
            result[key] = generalConfig[key];
        }
    }

    return result;
}

function buildYoutubeConfig(normalized: NormalizedConfig, generalConfig: GenericRecord): PlatformConfigRecord {
    return buildPlatformConfig('youtube', normalized, generalConfig);
}

function buildObsConfig(normalized: NormalizedConfig): GenericRecord {
    const obs = normalized.obs as GenericRecord & {
        chatPlatformLogoTwitch: string;
        chatPlatformLogoYouTube: string;
        chatPlatformLogoTikTok: string;
        notificationPlatformLogoTwitch: string;
        notificationPlatformLogoYouTube: string;
        notificationPlatformLogoTikTok: string;
    };

    return {
        ...obs,
        chatPlatformLogos: {
            twitch: obs.chatPlatformLogoTwitch,
            youtube: obs.chatPlatformLogoYouTube,
            tiktok: obs.chatPlatformLogoTikTok
        },
        notificationPlatformLogos: {
            twitch: obs.notificationPlatformLogoTwitch,
            youtube: obs.notificationPlatformLogoYouTube,
            tiktok: obs.notificationPlatformLogoTikTok
        }
    };
}

function buildHandcamConfig(normalized: NormalizedConfig): GenericRecord {
    const h = normalized.handcam as GenericRecord & {
        enabled: boolean;
        sourceName: string;
        glowFilterName: string;
        maxSize: number;
        rampUpDuration: number;
        holdDuration: number;
        rampDownDuration: number;
        totalSteps: number;
        easingEnabled: boolean;
    };

    return {
        enabled: h.enabled,
        sourceName: h.sourceName,
        glowFilterName: h.glowFilterName,
        maxSize: h.maxSize,
        rampUpDuration: h.rampUpDuration,
        holdDuration: h.holdDuration,
        rampDownDuration: h.rampDownDuration,
        totalSteps: h.totalSteps,
        easingEnabled: h.easingEnabled
    };
}

function buildVfxConfig(normalized: NormalizedConfig): { filePath: unknown } {
    const vfx = normalized.vfx as { filePath: unknown };
    return { filePath: vfx.filePath };
}

function buildGiftConfig(normalized: NormalizedConfig): GenericRecord {
    const gifts = normalized.gifts as GenericRecord & {
        command: string;
        giftVideoSource: string;
        giftAudioSource: string;
    };

    return {
        command: gifts.command,
        giftVideoSource: gifts.giftVideoSource,
        giftAudioSource: gifts.giftAudioSource
    };
}

function buildEnvelopeConfig(normalized: NormalizedConfig): { command: unknown } {
    const envelopes = normalized.envelopes as { command: unknown };
    return { command: envelopes.command };
}

function buildStreamElementsConfig(normalized: NormalizedConfig): GenericRecord {
    const se = normalized.streamelements as GenericRecord & {
        enabled: boolean;
        youtubeChannelId: string;
        twitchChannelId: string;
        dataLoggingEnabled: boolean;
    };

    return {
        enabled: se.enabled,
        youtubeChannelId: se.youtubeChannelId,
        twitchChannelId: se.twitchChannelId,
        dataLoggingEnabled: se.dataLoggingEnabled,
        dataLoggingPath: DEFAULTS.LOG_DIRECTORY
    };
}

function buildSpamConfig(normalized: NormalizedConfig): GenericRecord {
    const s = normalized.spam as GenericRecord & {
        enabled: boolean;
        lowValueThreshold: number;
        detectionWindow: number;
        maxIndividualNotifications: number;
        tiktokEnabled: boolean;
        tiktokLowValueThreshold: number;
        twitchEnabled: boolean;
        twitchLowValueThreshold: number;
        youtubeEnabled: boolean;
        youtubeLowValueThreshold: number;
    };

    return {
        enabled: s.enabled,
        lowValueThreshold: s.lowValueThreshold,
        detectionWindow: s.detectionWindow,
        maxIndividualNotifications: s.maxIndividualNotifications,
        tiktokEnabled: s.tiktokEnabled,
        tiktokLowValueThreshold: s.tiktokLowValueThreshold,
        twitchEnabled: s.twitchEnabled,
        twitchLowValueThreshold: s.twitchLowValueThreshold,
        youtubeEnabled: s.youtubeEnabled,
        youtubeLowValueThreshold: s.youtubeLowValueThreshold
    };
}

function buildCooldownsConfig(normalized: NormalizedConfig): GenericRecord {
    const c = normalized.cooldowns as GenericRecord & {
        cmdCooldown: number;
        globalCmdCooldown: number;
        defaultCooldown: number;
        heavyCommandCooldown: number;
        heavyCommandThreshold: number;
        heavyCommandWindow: number;
        maxEntries: number;
    };

    return {
        cmdCooldown: c.cmdCooldown,
        cmdCooldownMs: c.cmdCooldown * 1000,
        globalCmdCooldown: c.globalCmdCooldown,
        globalCmdCooldownMs: c.globalCmdCooldown * 1000,
        defaultCooldown: c.defaultCooldown,
        defaultCooldownMs: c.defaultCooldown * 1000,
        heavyCommandCooldown: c.heavyCommandCooldown,
        heavyCommandCooldownMs: c.heavyCommandCooldown * 1000,
        heavyCommandThreshold: c.heavyCommandThreshold,
        heavyCommandWindow: c.heavyCommandWindow,
        heavyCommandWindowMs: c.heavyCommandWindow * 1000,
        maxEntries: c.maxEntries
    };
}

function buildConfig(normalized: NormalizedConfig, options: { debugMode?: boolean } = {}) {
    const general = buildGeneralConfig(normalized);
    const follows = normalized.follows as { command: unknown };
    const raids = normalized.raids as { command: unknown };
    const paypiggies = normalized.paypiggies as { command: unknown };
    const greetings = normalized.greetings as GenericRecord & {
        command: unknown;
        customVfxProfiles?: Record<string, unknown>;
    };
    const shares = normalized.shares as { command: unknown };

    return {
        general,
        http: { ...normalized.http },
        tiktok: buildPlatformConfig('tiktok', normalized, general),
        twitch: buildPlatformConfig('twitch', normalized, general),
        youtube: buildYoutubeConfig(normalized, general),
        obs: buildObsConfig(normalized),
        handcam: buildHandcamConfig(normalized),
        goals: { ...normalized.goals },
        vfx: buildVfxConfig(normalized),
        gifts: buildGiftConfig(normalized),
        envelopes: buildEnvelopeConfig(normalized),
        displayQueue: { ...normalized.displayQueue },
        spam: buildSpamConfig(normalized),
        timing: { ...normalized.timing },
        cooldowns: buildCooldownsConfig(normalized),
        gui: { ...normalized.gui },
        follows: { command: follows.command },
        raids: { command: raids.command },
        paypiggies: { command: paypiggies.command },
        greetings: {
            command: greetings.command,
            customVfxProfiles: { ...(greetings.customVfxProfiles || {}) }
        },
        shares: { command: shares.command },
        farewell: { ...normalized.farewell },
        streamelements: buildStreamElementsConfig(normalized),
        commands: { ...normalized.commands },
        logging: buildLoggingConfig(normalized, options)
    };
}

export {
    buildGeneralConfig,
    buildPlatformConfig,
    buildObsConfig,
    buildHandcamConfig,
    buildVfxConfig,
    buildGiftConfig,
    buildEnvelopeConfig,
    buildStreamElementsConfig,
    buildSpamConfig,
    buildCooldownsConfig,
    buildLoggingConfig,
    buildConfig,
    DEFAULT_LOGGING_CONFIG
};
