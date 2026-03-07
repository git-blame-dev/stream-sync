const { DEFAULTS } = require('./config-schema');

const VALID_LOG_LEVELS = ['error', 'warn', 'console', 'info', 'debug'];

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

function buildLoggingConfig(normalized, options = {}) {
    const config = structuredClone(DEFAULT_LOGGING_CONFIG);
    const logging = normalized.logging;

    if (logging.consoleLevel && VALID_LOG_LEVELS.includes(logging.consoleLevel)) {
        config.console.level = logging.consoleLevel;
    }
    if (logging.fileLevel && VALID_LOG_LEVELS.includes(logging.fileLevel)) {
        config.file.level = logging.fileLevel;
    }
    if (logging.fileLoggingEnabled !== undefined && logging.fileLoggingEnabled !== null) {
        config.file.enabled = logging.fileLoggingEnabled;
    }

    if (options.debugMode || normalized.general.debugEnabled) {
        config.console.level = 'debug';
    }

    config.file.directory = DEFAULTS.LOG_DIRECTORY;
    config.chat.enabled = config.file.enabled;
    config.chat.separateFiles = true;
    config.chat.directory = DEFAULTS.LOG_DIRECTORY;

    return config;
}

function buildGeneralConfig(normalized) {
    const g = normalized.general;
    return {
        ...g,
        viewerCountPollingIntervalMs: g.viewerCountPollingInterval * 1000
    };
}

function buildPlatformConfig(platformName, normalized, generalConfig) {
    const platform = normalized[platformName] || {};

    const result = {
        ...platform,
        pollIntervalMs: platform.pollInterval ? platform.pollInterval * 1000 : generalConfig.viewerCountPollingIntervalMs,
        dataLoggingPath: DEFAULTS.LOG_DIRECTORY
    };

    for (const [key, value] of Object.entries(result)) {
        if (value === null && generalConfig[key] !== undefined) {
            result[key] = generalConfig[key];
        }
    }

    return result;
}

function buildYoutubeConfig(normalized, generalConfig) {
    return buildPlatformConfig('youtube', normalized, generalConfig);
}

function buildObsConfig(normalized) {
    const obs = normalized.obs;
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

function buildHandcamConfig(normalized) {
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

function buildVfxConfig(normalized) {
    return { filePath: normalized.vfx.filePath };
}

function buildGiftConfig(normalized) {
    const g = normalized.gifts;
    return {
        command: g.command,
        giftVideoSource: g.giftVideoSource,
        giftAudioSource: g.giftAudioSource
    };
}

function buildEnvelopeConfig(normalized) {
    return { command: normalized.envelopes.command };
}

function buildStreamElementsConfig(normalized) {
    const se = normalized.streamelements;
    return {
        enabled: se.enabled,
        youtubeChannelId: se.youtubeChannelId,
        twitchChannelId: se.twitchChannelId,
        dataLoggingEnabled: se.dataLoggingEnabled,
        dataLoggingPath: DEFAULTS.LOG_DIRECTORY
    };
}

function buildSpamConfig(normalized) {
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

function buildCooldownsConfig(normalized) {
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

function buildConfig(normalized, options = {}) {
    const general = buildGeneralConfig(normalized);

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
        follows: { command: normalized.follows.command },
        raids: { command: normalized.raids.command },
        paypiggies: { command: normalized.paypiggies.command },
        greetings: { command: normalized.greetings.command },
        shares: { command: normalized.shares.command },
        farewell: { ...normalized.farewell },
        streamelements: buildStreamElementsConfig(normalized),
        commands: { ...normalized.commands },
        logging: buildLoggingConfig(normalized, options)
    };
}

module.exports = {
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
