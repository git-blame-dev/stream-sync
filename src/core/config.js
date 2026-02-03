
const fs = require('fs');
const ini = require('ini');
const { handleUserFacingError } = require('../utils/user-friendly-errors');
const { DEFAULTS } = require('./config-defaults');
const { ConfigValidator } = require('../utils/config-validator');

let loadedConfig = null;
let configPath = './config.ini';

function loadConfig() {
    if (loadedConfig) {
        return loadedConfig;
    }

    const overridePath = process.env.CHAT_BOT_CONFIG_PATH;
    if (overridePath && overridePath.trim()) {
        configPath = overridePath.trim();
    }

    try {
        if (!fs.existsSync(configPath)) {
            throw new Error(`Configuration file not found: ${configPath}`);
        }

        const configContent = fs.readFileSync(configPath, 'utf-8');
        const rawConfig = ini.parse(configContent);

        if (!rawConfig.general) {
            throw new Error('Missing required configuration section: general');
        }

        const normalized = ConfigValidator.normalize(rawConfig);
        const validation = ConfigValidator.validate(normalized);

        if (!validation.isValid) {
            const error = new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
            handleUserFacingError(error, {
                category: 'configuration',
                operation: 'validation'
            }, {
                showInConsole: true,
                includeActions: true,
                logTechnical: false
            });
            throw error;
        }

        if (validation.warnings.length > 0) {
            validation.warnings.forEach(warning => {
                process.stdout.write(`[WARN] [Config] ${warning}\n`);
            });
        }

        loadedConfig = normalized;

        const debugEnabled = normalized.general.debugEnabled;
        if (debugEnabled && process.env.NODE_ENV !== 'test') {
            process.stdout.write(`[INFO] [Config] Successfully loaded configuration from ${configPath}\n`);
        }

        return loadedConfig;
    } catch (error) {
        if (error.code === 'ENOENT') {
            const configError = new Error(`Configuration file not found: ${configPath}`);
            handleUserFacingError(configError, {
                category: 'configuration',
                operation: 'startup'
            }, {
                showInConsole: true,
                includeActions: true,
                logTechnical: false
            });
        } else if (!error.message.includes('Configuration validation failed')) {
            handleUserFacingError(error, {
                category: 'configuration',
                operation: 'loading'
            }, {
                showInConsole: true,
                includeActions: true,
                logTechnical: false
            });
        }
        throw error;
    }
}

function _resetConfigForTesting() {
    loadedConfig = null;
    _cachedConfig = null;
    configPath = './config.ini';
}

function _getConfigPath() {
    return configPath;
}

function buildGeneralConfig(normalized) {
    const g = normalized.general;
    return {
        ...g,
        cmdCooldownMs: g.cmdCoolDown * 1000,
        globalCmdCooldownMs: g.globalCmdCoolDown * 1000,
        viewerCountPollingIntervalMs: g.viewerCountPollingInterval * 1000,
        suppressionWindowMs: g.suppressionWindow * 1000,
        suppressionDurationMs: g.suppressionDuration * 1000,
        suppressionCleanupIntervalMs: g.suppressionCleanupInterval * 1000
    };
}

function buildHttpConfig(normalized) {
    return { ...normalized.http };
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

function buildTiktokConfig(normalized, generalConfig) {
    return buildPlatformConfig('tiktok', normalized, generalConfig);
}

function buildTwitchConfig(normalized, generalConfig) {
    return buildPlatformConfig('twitch', normalized, generalConfig);
}

function buildYoutubeConfig(normalized, generalConfig) {
    const base = buildPlatformConfig('youtube', normalized, generalConfig);
    base.chatMethod = 'scraping';
    return base;
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
        enabled: h.glowEnabled,
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

function buildGoalsConfig(normalized) {
    return { ...normalized.goals };
}

function buildVfxConfig(normalized) {
    return { filePath: normalized.vfx.vfxFilePath };
}

function buildGiftConfig(normalized) {
    const g = normalized.gifts;
    return {
        giftVideoSource: g.giftVideoSource,
        giftAudioSource: g.giftAudioSource,
        scene: g.giftScene
    };
}

function buildStreamElementsConfig(normalized) {
    const se = normalized.streamelements;
    return {
        enabled: se.enabled,
        youtubeChannelId: se.youtubeChannelId || undefined,
        twitchChannelId: se.twitchChannelId || undefined,
        dataLoggingEnabled: se.dataLoggingEnabled,
        dataLoggingPath: DEFAULTS.LOG_DIRECTORY
    };
}

function buildTimingConfig(normalized) {
    return { ...normalized.timing };
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

function buildTtsConfig(normalized) {
    return { ...normalized.tts };
}

function buildCooldownsConfig(normalized) {
    const c = normalized.cooldowns;
    return {
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

function buildConfig(normalized) {
    const general = buildGeneralConfig(normalized);
    
    return {
        general,
        http: buildHttpConfig(normalized),
        tiktok: buildTiktokConfig(normalized, general),
        twitch: buildTwitchConfig(normalized, general),
        youtube: buildYoutubeConfig(normalized, general),
        obs: buildObsConfig(normalized),
        handcam: buildHandcamConfig(normalized),
        goals: buildGoalsConfig(normalized),
        vfx: buildVfxConfig(normalized),
        gifts: buildGiftConfig(normalized),
        spam: buildSpamConfig(normalized),
        timing: buildTimingConfig(normalized),
        cooldowns: buildCooldownsConfig(normalized),
        tts: buildTtsConfig(normalized),
        follows: { command: normalized.follows.command },
        raids: { command: normalized.raids.command },
        paypiggies: { command: normalized.paypiggies.command },
        greetings: { command: normalized.greetings.command },
        shares: { command: normalized.shares.command },
        farewell: { ...normalized.farewell },
        streamelements: buildStreamElementsConfig(normalized),
        commands: { ...normalized.commands },
        logging: { ...normalized.logging }
    };
}

let _cachedConfig = null;
function getConfig() {
    if (!_cachedConfig) {
        const normalizedConfig = loadConfig();
        _cachedConfig = buildConfig(normalizedConfig);
    }
    return _cachedConfig;
}

const DEFAULT_LOGGING_CONFIG = {
    console: { enabled: true, level: 'console' },
    file: { enabled: true, level: 'debug', directory: DEFAULTS.LOG_DIRECTORY },
    debug: { enabled: false },
    platforms: {
        twitch: { enabled: true, fileLogging: true },
        youtube: { enabled: true, fileLogging: true },
        tiktok: { enabled: true, fileLogging: true }
    },
    chat: { enabled: true, separateFiles: true, directory: DEFAULTS.LOG_DIRECTORY }
};

function validateLoggingConfig(userConfig = {}) {
    const config = { ...DEFAULT_LOGGING_CONFIG };
    
    if (userConfig.logging) {
        Object.assign(config, userConfig.logging);
    }
    
    if (userConfig.general && userConfig.general.debugEnabled !== undefined) {
        const { getDebugMode } = require('./logging');
        const debugAlreadySetByCommandLine = getDebugMode();
        
        if (!debugAlreadySetByCommandLine) {
            config.debug.enabled = userConfig.general.debugEnabled;
            config.console.level = userConfig.general.debugEnabled ? 'debug' : 'console';
        } else {
            config.console.level = 'debug';
        }
    }
    
    const validLevels = ['error', 'warn', 'console', 'info', 'debug'];
    if (!validLevels.includes(config.console.level)) {
        config.console.level = 'console';
    }
    if (!validLevels.includes(config.file.level)) {
        config.file.level = 'debug';
    }
    
    if (userConfig.logging) {
        if (userConfig.logging.consoleLevel && validLevels.includes(userConfig.logging.consoleLevel)) {
            config.console.level = userConfig.logging.consoleLevel;
        }
        if (userConfig.logging.fileLevel && validLevels.includes(userConfig.logging.fileLevel)) {
            config.file.level = userConfig.logging.fileLevel;
        }
        if (userConfig.logging.fileLoggingEnabled !== undefined && userConfig.logging.fileLoggingEnabled !== null) {
            config.file.enabled = userConfig.logging.fileLoggingEnabled;
        }
    }

    config.file.directory = DEFAULTS.LOG_DIRECTORY;
    config.chat.enabled = config.file.enabled;
    config.chat.separateFiles = true;
    config.chat.directory = DEFAULTS.LOG_DIRECTORY;
    
    return config;
}

module.exports = {
    get config() { return getConfig(); },
    loadConfig,
    validateLoggingConfig,
    _resetConfigForTesting,
    _getConfigPath,
    _buildConfig: buildConfig
}; 
