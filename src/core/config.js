
const fs = require('fs');
const ini = require('ini');
const { handleUserFacingError } = require('../utils/user-friendly-errors');
const { DEFAULTS } = require('./config-defaults');
const { ConfigValidator } = require('../utils/config-validator');

class ConfigLoader {
    constructor(defaultConfigPath = './config.ini') {
        this.defaultConfigPath = defaultConfigPath;
        this.configPath = defaultConfigPath;
        this.config = null;
        this.isLoaded = false;
    }

    load() {
        try {
            if (this.isLoaded) {
                return;
            }

            const overridePath = process.env.CHAT_BOT_CONFIG_PATH;
            if (overridePath && overridePath.trim()) {
                this.configPath = overridePath.trim();
            }

            if (!fs.existsSync(this.configPath)) {
                if (process.env.NODE_ENV === 'test') {
                    this.config = this._getTestDefaultConfig();
                    this.isLoaded = true;
                    return;
                }
                throw new Error(`Configuration file not found: ${this.configPath}`);
            }

            const configContent = fs.readFileSync(this.configPath, 'utf-8');
            const rawConfig = ini.parse(configContent);
            
            const requiredSections = ['general', 'obs', 'commands'];
            const missingSections = requiredSections.filter(section => !rawConfig[section]);
            if (missingSections.length > 0) {
                throw new Error(`Missing required configuration sections: ${missingSections.join(', ')}`);
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
            
            if (validation.warnings.length > 0 && process.env.NODE_ENV !== 'test') {
                validation.warnings.forEach(warning => {
                    process.stdout.write(`[WARN] [Config] ${warning}\n`);
                });
            }
            
            this.config = normalized;
            this.isLoaded = true;

            if (process.env.NODE_ENV !== 'test') {
                const debugEnabled = normalized.general.debugEnabled;
                if (debugEnabled) {
                    process.stdout.write(`[INFO] [Config] Successfully loaded configuration from ${this.configPath}\n`);
                }
            }
        } catch (error) {
            if (error.code === 'ENOENT') {
                const configError = new Error(`Configuration file not found: ${this.configPath}`);
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

    _getTestDefaultConfig() {
        return ConfigValidator.normalize({
            general: {
                debugEnabled: 'false',
                cmdCoolDown: '60',
                globalCmdCoolDown: '60',
                viewerCountPollingInterval: '60',
                chatMsgGroup: 'test-chat-grp',
                maxMessageLength: '500'
            },
            obs: {
                enabled: 'false',
                address: 'ws://localhost:4455',
                connectionTimeoutMs: '5000',
                notificationMsgGroup: 'test-notification-grp',
                chatPlatformLogoTwitch: 'test-twitch-img',
                chatPlatformLogoYouTube: 'test-youtube-img',
                chatPlatformLogoTikTok: 'test-tiktok-img',
                notificationPlatformLogoTwitch: 'test-twitch-img',
                notificationPlatformLogoYouTube: 'test-youtube-img',
                notificationPlatformLogoTikTok: 'test-tiktok-img'
            },
            timing: {
                fadeDuration: '750',
                transitionDelay: '200',
                chatMessageDuration: '4000',
                notificationClearDelay: '500'
            },
            handcam: {
                glowEnabled: 'false',
                sourceName: 'test-handcam',
                sceneName: 'test-handcam-scene',
                glowFilterName: 'Glow',
                maxSize: '50',
                rampUpDuration: '0.5',
                holdDuration: '8.0',
                rampDownDuration: '0.5',
                totalSteps: '30',
                incrementPercent: '3.33',
                easingEnabled: 'true',
                animationInterval: '16'
            },
            cooldowns: {
                defaultCooldown: '60',
                heavyCommandCooldown: '300',
                heavyCommandThreshold: '4',
                heavyCommandWindow: '360',
                maxEntries: '1000'
            },
            commands: { enabled: 'false' },
            tiktok: { enabled: 'false' },
            twitch: { enabled: 'false' },
            youtube: { enabled: 'false' },
            http: {}
        });
    }

    get(section, key, defaultValue = undefined) {
        if (!this.isLoaded) {
            this.load();
        }

        if (!this.config[section]) {
            return defaultValue;
        }

        return this.config[section][key] !== undefined ? this.config[section][key] : defaultValue;
    }

    getBoolean(section, key, defaultValue = false) {
        const value = this.get(section, key);
        return ConfigValidator.parseBoolean(value, defaultValue);
    }

    getNumber(section, key, defaultValue = 0) {
        const value = this.get(section, key);
        return ConfigValidator.parseNumber(value, { defaultValue });
    }

    getString(section, key, defaultValue = '') {
        const value = this.get(section, key);
        return ConfigValidator.parseString(value, defaultValue);
    }

    getSection(section) {
        if (!this.isLoaded) {
            this.load();
        }
        return this.config[section] || {};
    }

    getRaw() {
        if (!this.isLoaded) {
            this.load();
        }
        return this.config;
    }

    reload() {
        this.isLoaded = false;
        this.load();
    }
}

const configManager = new ConfigLoader();

const resolveSecretValue = (envKey) => {
    const rawValue = process.env[envKey];
    if (rawValue === undefined || rawValue === null) {
        return undefined;
    }
    const trimmed = String(rawValue).trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

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
    const notificationFlags = [
        'messagesEnabled', 'commandsEnabled', 'greetingsEnabled', 'farewellsEnabled',
        'followsEnabled', 'giftsEnabled', 'raidsEnabled', 'paypiggiesEnabled', 'ignoreSelfMessages'
    ];
    
    const result = {
        ...platform,
        pollIntervalMs: platform.pollInterval ? platform.pollInterval * 1000 : generalConfig.viewerCountPollingIntervalMs,
        dataLoggingPath: DEFAULTS.LOG_DIRECTORY
    };
    
    if (result.greetNewCommentors === null) {
        result.greetNewCommentors = generalConfig.greetNewCommentors;
    }
    
    notificationFlags.forEach(flag => {
        if (result[flag] === null) {
            result[flag] = generalConfig[flag];
        }
    });
    
    if (platformName !== 'twitch') {
        const envKey = platformName === 'tiktok' ? 'TIKTOK_API_KEY' : 'YOUTUBE_API_KEY';
        Object.defineProperty(result, 'apiKey', {
            get: () => resolveSecretValue(envKey),
            enumerable: true
        });
    }
    
    return result;
}

function buildTiktokConfig(normalized, generalConfig) {
    return buildPlatformConfig('tiktok', normalized, generalConfig);
}

function buildTwitchConfig(normalized, generalConfig) {
    const base = buildPlatformConfig('twitch', normalized, generalConfig);
    
    Object.defineProperty(base, 'clientId', {
        get: () => resolveSecretValue('TWITCH_CLIENT_ID'),
        enumerable: true
    });
    
    Object.defineProperty(base, 'clientSecret', {
        get: () => resolveSecretValue('TWITCH_CLIENT_SECRET'),
        enumerable: true
    });
    
    return base;
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
        get password() { return resolveSecretValue('OBS_PASSWORD'); },
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
        sceneName: h.sceneName,
        glowFilterName: h.glowFilterName,
        maxSize: h.maxSize,
        rampUpDuration: h.rampUpDuration,
        holdDuration: h.holdDuration,
        rampDownDuration: h.rampDownDuration,
        totalSteps: h.totalSteps,
        incrementPercent: h.incrementPercent,
        easingEnabled: h.easingEnabled,
        animationInterval: h.animationInterval
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
        command: g.command,
        giftVideoSource: g.giftVideoSource,
        giftAudioSource: g.giftAudioSource,
        scene: g.giftScene,
        lowValueThreshold: g.lowValueThreshold,
        spamDetectionEnabled: g.spamDetectionEnabled,
        spamDetectionWindow: g.spamDetectionWindow,
        maxIndividualNotifications: g.maxIndividualNotifications
    };
}

function buildStreamElementsConfig(normalized) {
    const se = normalized.streamelements;
    return {
        enabled: se.enabled,
        youtubeChannelId: se.youtubeChannelId || undefined,
        twitchChannelId: se.twitchChannelId || undefined,
        get jwtToken() { return resolveSecretValue('STREAMELEMENTS_JWT_TOKEN'); },
        dataLoggingEnabled: se.dataLoggingEnabled,
        dataLoggingPath: DEFAULTS.LOG_DIRECTORY
    };
}

function buildTimingConfig(normalized) {
    return { ...normalized.timing };
}

function buildSpamConfig(normalized) {
    const g = normalized.gifts;
    return {
        lowValueThreshold: g.lowValueThreshold,
        spamDetectionEnabled: g.spamDetectionEnabled,
        spamDetectionWindow: g.spamDetectionWindow,
        maxIndividualNotifications: g.maxIndividualNotifications
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
        farewell: { ...normalized.farewell },
        streamelements: buildStreamElementsConfig(normalized),
        commands: { ...normalized.commands },
        get raw() { return configManager.getRaw(); }
    };
}

configManager.load();
const config = buildConfig(configManager.config);

const DEFAULT_LOGGING_CONFIG = {
    console: { enabled: true, level: 'console' }, // Only user-facing messages (chat, notifications, errors)
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
    
    // Merge user config with defaults
    if (userConfig.logging) {
        Object.assign(config, userConfig.logging);
    }
    
    // Backward compatibility mapping
    if (userConfig.general && userConfig.general.debugEnabled !== undefined) {
        // Only apply config file debug setting if not already set by command line
        const { getDebugMode } = require('./logging');
        const debugAlreadySetByCommandLine = getDebugMode();
        
        if (!debugAlreadySetByCommandLine) {
            config.debug.enabled = userConfig.general.debugEnabled;
            // When debug mode is enabled, set console level to 'debug' to show debug messages
            if (userConfig.general.debugEnabled) {
                config.console.level = 'debug';
            } else {
                // When debug mode is disabled, ensure console level is 'console' for user-facing messages only
                config.console.level = 'console';
            }
        } else {
            // Command line debug flag was used, ensure console level is debug
            config.console.level = 'debug';
        }
    }
    
    // Validate log levels
    const validLevels = ['error', 'warn', 'console', 'info', 'debug'];
    if (!validLevels.includes(config.console.level)) {
        config.console.level = 'console';
    }
    if (!validLevels.includes(config.file.level)) {
        config.file.level = 'debug';
    }
    
    // Handle new logging section configuration
    if (userConfig.logging) {
        if (userConfig.logging.consoleLevel && validLevels.includes(userConfig.logging.consoleLevel)) {
            config.console.level = userConfig.logging.consoleLevel;
        }
        if (userConfig.logging.fileLevel && validLevels.includes(userConfig.logging.fileLevel)) {
            config.file.level = userConfig.logging.fileLevel;
        }
        if (userConfig.logging.fileLoggingEnabled !== undefined) {
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
    config,
    configManager,
    validateLoggingConfig,
    DEFAULT_LOGGING_CONFIG
}; 
