import { DEFAULTS } from './config-schema';
import type { NormalizedConfig } from './types/config-types';
import type { LogThreshold } from './logger/types';
import { isLogThreshold } from './logger/levels';

const DEFAULT_LOGGING_CONFIG = {
    console: { enabled: true, level: 'warn' as LogThreshold },
    file: { enabled: true, level: 'debug' as LogThreshold, directory: DEFAULTS.LOG_DIRECTORY, maxBytes: 20971520, maxQueueBytes: 2097152 },
    platforms: {
        twitch: { enabled: true, fileLogging: true },
        youtube: { enabled: true, fileLogging: true },
        tiktok: { enabled: true, fileLogging: true }
    },
    chat: { enabled: true, separateFiles: true, directory: DEFAULTS.LOG_DIRECTORY }
};

function buildLoggingConfig(normalized: { logging?: { consoleLevel?: string | null; fileLevel?: string | null; fileLoggingEnabled?: boolean | null; fileMaxBytes?: number; fileQueueMaxBytes?: number }; general?: { debugEnabled?: boolean | null } }, options: { debugMode?: boolean } = {}) {
    const config = structuredClone(DEFAULT_LOGGING_CONFIG);
    const logging = normalized.logging || {};
    const general = normalized.general || {};
    config.file.maxBytes = logging.fileMaxBytes ?? config.file.maxBytes;
    config.file.maxQueueBytes = logging.fileQueueMaxBytes ?? config.file.maxQueueBytes;

    if (isLogThreshold(logging.consoleLevel)) {
        config.console.level = logging.consoleLevel;
    }
    if (isLogThreshold(logging.fileLevel)) {
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

function buildGeneralConfig<G extends { viewerCountPollingInterval: number }>(normalized: { general: G }) {
    const g = normalized.general;
    return { ...g, viewerCountPollingIntervalMs: g.viewerCountPollingInterval * 1000 };
}

type PlatformName = 'tiktok' | 'twitch' | 'youtube';
type InheritedPlatform<P, G> = {
    [K in keyof P]: null extends P[K] ? K extends keyof G ? Exclude<P[K], null> | G[K] : P[K] : P[K]
};

function buildPlatformConfig<P extends PlatformName, N extends Partial<Record<P, { pollInterval?: number | null; [key: string]: unknown }>>, G extends { viewerCountPollingIntervalMs: number }>(platformName: P, normalized: N, generalConfig: G) {
    const platform = normalized[platformName];
    const result = {
        ...platform,
        pollIntervalMs: platform?.pollInterval == null ? generalConfig.viewerCountPollingIntervalMs : platform.pollInterval * 1000,
        dataLoggingPath: DEFAULTS.LOG_DIRECTORY
    };
    // Only null fields inherit; explicit false and zero are retained.
    const fields: Record<string, unknown> = result;
    const general: Record<string, unknown> = generalConfig;
    for (const [key, value] of Object.entries(fields)) {
        if (value === null && general[key] !== undefined) fields[key] = general[key];
    }
    return result as InheritedPlatform<NonNullable<N[P]>, G> & { pollIntervalMs: number; dataLoggingPath: string };
}

function buildYoutubeConfig(normalized: NormalizedConfig, generalConfig: ReturnType<typeof buildGeneralConfig<NormalizedConfig['general']>>) {
    return buildPlatformConfig('youtube', normalized, generalConfig);
}

function buildObsConfig<O extends object>(normalized: { obs: O }) {
    return { ...normalized.obs };
}

function buildHandcamConfig(normalized: Pick<NormalizedConfig, 'handcam'>) {
    const h = normalized.handcam;

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

function buildVfxConfig(normalized: Pick<NormalizedConfig, 'vfx'>) {
    const vfx = normalized.vfx;
    return { filePath: vfx.filePath };
}

function buildGiftConfig(normalized: Pick<NormalizedConfig, 'gifts'>) {
    const gifts = normalized.gifts;

    return {
        command: gifts.command,
        giftVideoSource: gifts.giftVideoSource,
        giftAudioSource: gifts.giftAudioSource
    };
}

function buildEnvelopeConfig(normalized: Pick<NormalizedConfig, 'envelopes'>) {
    const envelopes = normalized.envelopes;
    return { command: envelopes.command };
}

function buildStreamElementsConfig(normalized: Pick<NormalizedConfig, 'streamelements'>) {
    const se = normalized.streamelements;

    return {
        enabled: se.enabled,
        youtubeChannelId: se.youtubeChannelId,
        twitchChannelId: se.twitchChannelId,
        dataLoggingEnabled: se.dataLoggingEnabled,
        dataLoggingPath: DEFAULTS.LOG_DIRECTORY
    };
}

function buildSpamConfig(normalized: Pick<NormalizedConfig, 'spam'>) {
    const s = normalized.spam;

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

function buildCooldownsConfig(normalized: Pick<NormalizedConfig, 'cooldowns'>) {
    const c = normalized.cooldowns;

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
    const follows = normalized.follows;
    const raids = normalized.raids;
    const paypiggies = normalized.paypiggies;
    const greetings = normalized.greetings;
    const shares = normalized.shares;

    return {
        general,
        http: { ...normalized.http },
        tiktok: buildPlatformConfig('tiktok', normalized, general),
        twitch: buildPlatformConfig('twitch', normalized, general),
        youtube: buildYoutubeConfig(normalized, general),
        obs: buildObsConfig(normalized),
        handcam: buildHandcamConfig(normalized),
        goals: { ...normalized.goals },
        fundingGoal: { ...normalized.fundingGoal },
        monetizationValues: { ...normalized.monetizationValues },
        vfx: buildVfxConfig(normalized),
        gifts: buildGiftConfig(normalized),
        envelopes: buildEnvelopeConfig(normalized),
        displayQueue: { ...normalized.displayQueue },
        spam: buildSpamConfig(normalized),
        cooldowns: buildCooldownsConfig(normalized),
        gui: { ...normalized.gui },
        follows: { command: follows.command },
        raids: { command: raids.command },
        paypiggies: { command: paypiggies.command },
        greetings: {
            command: greetings.command
        },
        profiles: structuredClone(normalized.profiles || {}),
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
