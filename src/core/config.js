
const fs = require('fs');
const ini = require('ini');
const { handleUserFacingError } = require('../utils/user-friendly-errors');
const { createRuntimeConstants } = require('./runtime-constants');
const { DEFAULT_HTTP_USER_AGENTS, parseUserAgentList } = require('./http-config');
const { DEFAULTS } = require('./config-defaults');
const { ConfigValidator } = require('../utils/config-validator');

class ConfigManager {
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
            this.config = ini.parse(configContent);
            this.isLoaded = true;
            this.validate();

            if (process.env.NODE_ENV !== 'test') {
                const debugEnabled = this.getBoolean('general', 'debugEnabled', false);
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
            } else {
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
        return {
            general: {
                debugEnabled: false,
                cmdCoolDown: 60,
                globalCmdCoolDown: 60,
                viewerCountPollingInterval: 60,
                chatMsgGroup: 'test-chat-grp',
                maxMessageLength: 500
            },
            obs: {
                enabled: false,
                address: 'ws://localhost:4455',
                connectionTimeoutMs: 5000,
                notificationMsgGroup: 'test-notification-grp',
                chatPlatformLogoTwitch: 'test-twitch-img',
                chatPlatformLogoYouTube: 'test-youtube-img',
                chatPlatformLogoTikTok: 'test-tiktok-img',
                notificationPlatformLogoTwitch: 'test-twitch-img',
                notificationPlatformLogoYouTube: 'test-youtube-img',
                notificationPlatformLogoTikTok: 'test-tiktok-img'
            },
            timing: {
                fadeDuration: 750,
                transitionDelay: 200,
                chatMessageDuration: 4000,
                notificationClearDelay: 500
            },
            handcam: {
                glowEnabled: false,
                sourceName: 'test-handcam',
                sceneName: 'test-handcam-scene',
                glowFilterName: 'Glow',
                maxSize: 50,
                rampUpDuration: 0.5,
                holdDuration: 8.0,
                rampDownDuration: 0.5,
                totalSteps: 30,
                incrementPercent: 3.33,
                easingEnabled: true,
                animationInterval: 16
            },
            cooldowns: {
                defaultCooldown: 60,
                heavyCommandCooldown: 300,
                heavyCommandThreshold: 4,
                heavyCommandWindow: 360,
                maxEntries: 1000
            },
            commands: { enabled: false },
            tiktok: { enabled: false },
            twitch: { enabled: false },
            youtube: { enabled: false },
            http: {}
        };
    }

    validate() {
        if (!this.config) {
            throw new Error('Configuration not loaded');
        }

        const requiredSections = ['general', 'obs', 'commands'];
        const missingSections = requiredSections.filter(section => !this.config[section]);
        
        if (missingSections.length > 0) {
            throw new Error(`Missing required configuration sections: ${missingSections.join(', ')}`);
        }

        createRuntimeConstants(this.config);

        // Validate platform sections have usernames if enabled
        const platforms = ['youtube', 'tiktok', 'twitch'];
        const platformDisplayNames = {
            youtube: 'YouTube',
            tiktok: 'TikTok',
            twitch: 'Twitch'
        };
        platforms.forEach(platform => {
            const platformConfig = this.config[platform];
            if (!platformConfig || !this.getBoolean(platform, 'enabled', false)) {
                return;
            }

            const username = this.getString(platform, 'username', '').trim();
            if (!username) {
                const displayName = platformDisplayNames[platform] || platform;
                const error = new Error(`Missing required configuration: ${displayName} username`);
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
        });

        const streamElementsEnabled = this.getBoolean('streamelements', 'enabled', false);
        if (streamElementsEnabled) {
            const youtubeChannelId = resolveConfigValue('streamelements', 'youtubeChannelId');
            const twitchChannelId = resolveConfigValue('streamelements', 'twitchChannelId');
            if (!youtubeChannelId && !twitchChannelId) {
                const error = new Error('Missing required configuration: StreamElements channel ID (YouTube or Twitch)');
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
        }

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
        
        // Clear cached platform configurations to ensure they reload with new config
        _tiktokConfig = null;
        _twitchConfig = null;
        _youtubeConfig = null;
        
        this.load();
    }
}

// Create global configuration manager instance
const configManager = new ConfigManager();

const resolveConfigValue = (section, key) => {
    const rawValue = configManager.get(section, key);
    if (rawValue === undefined || rawValue === null) {
        return undefined;
    }
    const trimmed = String(rawValue).trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const resolveSecretValue = (envKey) => {
    const rawValue = process.env[envKey];
    if (rawValue === undefined || rawValue === null) {
        return undefined;
    }
    const trimmed = String(rawValue).trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const resolvePlatformApiKey = (platformName) => {
    switch (platformName) {
        case 'tiktok':
            return resolveSecretValue('TIKTOK_API_KEY');
        case 'youtube':
            return resolveSecretValue('YOUTUBE_API_KEY');
        default:
            return undefined;
    }
};

const resolveHttpUserAgents = () => {
    const rawAgents = configManager.get('http', 'userAgents');
    const parsed = parseUserAgentList(rawAgents);
    return parsed.length > 0 ? parsed : DEFAULT_HTTP_USER_AGENTS.slice();
};

const httpConfig = {
    get userAgents() { return resolveHttpUserAgents(); },
    get defaultTimeoutMs() { return configManager.getNumber('http', 'defaultTimeoutMs', DEFAULTS.http.defaultTimeoutMs); },
    get reachabilityTimeoutMs() { return configManager.getNumber('http', 'reachabilityTimeoutMs', DEFAULTS.http.reachabilityTimeoutMs); },
    get enhancedTimeoutMs() { return configManager.getNumber('http', 'enhancedTimeoutMs', DEFAULTS.http.enhancedTimeoutMs); },
    get enhancedReachabilityTimeoutMs() { return configManager.getNumber('http', 'enhancedReachabilityTimeoutMs', DEFAULTS.http.enhancedReachabilityTimeoutMs); }
};

// Helper function to create platform-specific config objects with fallback logic
function createPlatformConfig(platformName) {
    const platformConfig = {
        get enabled() { return configManager.getBoolean(platformName, 'enabled', false); },
        get username() { return configManager.getString(platformName, 'username', ''); },
        get greetNewCommentors() {
            const value = configManager.get(platformName, 'greetNewCommentors');
            return value != null ? configManager.getBoolean(platformName, 'greetNewCommentors', false) : generalConfig.greetNewCommentors;
        },
        get viewerCountEnabled() { return configManager.getBoolean(platformName, 'viewerCountEnabled', true); },
        get viewerCountSource() { return configManager.getString(platformName, 'viewerCountSource', `${platformName} viewer count`); },
        get pollInterval() { 
            // Use platform-specific poll interval if available, otherwise fall back to the general setting.
            // The value from config is in seconds, so convert to milliseconds.
            const platformInterval = configManager.getNumber(platformName, 'pollInterval');
            if (platformInterval) {
                return platformInterval * 1000;
            }
            return generalConfig.viewerCountPollingIntervalMs;
        },
        get dataLoggingEnabled() { return configManager.getBoolean('logging', 'platformDataLoggingEnabled', DEFAULTS.logging.platformDataLoggingEnabled); },
        get dataLoggingPath() { return DEFAULTS.LOG_DIRECTORY; }
    };

    if (platformName !== 'twitch') {
        // Unified apiKey for all platforms except Twitch (token-only auth)
        Object.defineProperty(platformConfig, 'apiKey', {
            get: function() { 
                return resolvePlatformApiKey(platformName);
            },
            enumerable: true
        });
    }

    // Add notification flags with fallback
    const notificationFlags = [
        'messagesEnabled',    // Chat messages
        'commandsEnabled',    // VFX commands
        'greetingsEnabled',   // First-time user greetings
        'farewellsEnabled',   // User farewells
        'followsEnabled',     // Follow/subscribe notifications
        'giftsEnabled',       // Gift/donation notifications
        'raidsEnabled',       // Raid notifications (Twitch only)
        'paypiggiesEnabled',  // Paypiggy notifications
        'ignoreSelfMessages'  // Filter broadcaster's own messages
    ];
    notificationFlags.forEach(flag => {
        Object.defineProperty(platformConfig, flag, {
            get: function() {
                // Prioritize platform-specific setting, then fall back to general setting
                const platformValue = configManager.get(platformName, flag, null);
                if (platformValue !== null) {
                    return configManager.getBoolean(platformName, flag);
                }
                return generalConfig[flag];
            },
            enumerable: true
        });
    });

    if (platformName === 'youtube') {
        Object.assign(platformConfig, {
            get enableAPI() {
                return configManager.getBoolean('youtube', 'enableAPI', DEFAULTS.youtube.enableAPI);
            },
            get streamDetectionMethod() {
                const method = configManager.getString('youtube', 'streamDetectionMethod', DEFAULTS.youtube.streamDetectionMethod).toLowerCase();
                return ['youtubei', 'api'].includes(method) ? method : DEFAULTS.youtube.streamDetectionMethod;
            },
            get viewerCountMethod() {
                const method = configManager.getString('youtube', 'viewerCountMethod', DEFAULTS.youtube.viewerCountMethod).toLowerCase();
                return ['youtubei', 'api'].includes(method) ? method : DEFAULTS.youtube.viewerCountMethod;
            },
            get chatMethod() { return 'scraping'; },
            get maxStreams() { return configManager.getNumber('youtube', 'maxStreams', DEFAULTS.youtube.maxStreams); },
        });
    }

    return platformConfig;
}

// --- Main Configuration Objects ---

const generalConfig = {
    get cmdCooldownMs() { return configManager.getNumber('general', 'cmdCoolDown', DEFAULTS.general.cmdCoolDown) * 1000; },
    get globalCmdCooldownMs() { return configManager.getNumber('general', 'globalCmdCoolDown', DEFAULTS.general.globalCmdCoolDown) * 1000; },
    get viewerCountPollingIntervalMs() { return configManager.getNumber('general', 'viewerCountPollingInterval', DEFAULTS.general.viewerCountPollingInterval) * 1000; },
    get viewerCountScene() { return configManager.get('general', 'viewerCountScene', DEFAULTS.general.viewerCountScene); },
    get chatMsgTxt() { return configManager.get('general', 'chatMsgTxt', DEFAULTS.general.chatMsgTxt); },
    get chatMsgScene() { return configManager.get('general', 'chatMsgScene', DEFAULTS.general.chatMsgScene); },
    get chatMsgGroup() { return configManager.get('general', 'chatMsgGroup', DEFAULTS.general.chatMsgGroup); },
    get debugEnabled() { return configManager.getBoolean('general', 'debugEnabled', DEFAULTS.general.debugEnabled); },
    get envFilePath() {
        const envFilePath = configManager.getString('general', 'envFilePath', DEFAULTS.general.envFilePath);
        return envFilePath && envFilePath.trim() ? envFilePath : DEFAULTS.general.envFilePath;
    },
    get envFileReadEnabled() { return configManager.getBoolean('general', 'envFileReadEnabled', DEFAULTS.general.envFileReadEnabled); },
    get envFileWriteEnabled() { return configManager.getBoolean('general', 'envFileWriteEnabled', DEFAULTS.general.envFileWriteEnabled); },
    get messagesEnabled() { return configManager.getBoolean('general', 'messagesEnabled', DEFAULTS.general.messagesEnabled); },
    get commandsEnabled() { return configManager.getBoolean('general', 'commandsEnabled', DEFAULTS.general.commandsEnabled); },
    get greetingsEnabled() { return configManager.getBoolean('general', 'greetingsEnabled', DEFAULTS.general.greetingsEnabled); },
    get farewellsEnabled() { return configManager.getBoolean('general', 'farewellsEnabled', DEFAULTS.general.farewellsEnabled); },
    get followsEnabled() { return configManager.getBoolean('general', 'followsEnabled', DEFAULTS.general.followsEnabled); },
    get giftsEnabled() { return configManager.getBoolean('general', 'giftsEnabled', DEFAULTS.general.giftsEnabled); },
    get raidsEnabled() { return configManager.getBoolean('general', 'raidsEnabled', DEFAULTS.general.raidsEnabled); },
    get paypiggiesEnabled() { return configManager.getBoolean('general', 'paypiggiesEnabled', DEFAULTS.general.paypiggiesEnabled); },
    get greetNewCommentors() { return configManager.getBoolean('general', 'greetNewCommentors', DEFAULTS.general.greetNewCommentors); },
    get filterOldMessages() { return configManager.getBoolean('general', 'filterOldMessages', DEFAULTS.general.filterOldMessages); },
    get logChatMessages() { return configManager.getBoolean('general', 'logChatMessages', DEFAULTS.general.logChatMessages); },
    get keywordParsingEnabled() { return configManager.getBoolean('general', 'keywordParsingEnabled', DEFAULTS.general.keywordParsingEnabled); },
    get ignoreSelfMessages() { return configManager.getBoolean('general', 'ignoreSelfMessages', DEFAULTS.general.ignoreSelfMessages); },
    get fallbackUsername() { return configManager.getString('general', 'fallbackUsername', DEFAULTS.general.fallbackUsername); },
    get anonymousUsername() { return configManager.getString('general', 'anonymousUsername', DEFAULTS.general.anonymousUsername); },
    get userSuppressionEnabled() { return configManager.getBoolean('general', 'userSuppressionEnabled', DEFAULTS.general.userSuppressionEnabled); },
    get maxNotificationsPerUser() { return configManager.getNumber('general', 'maxNotificationsPerUser', DEFAULTS.general.maxNotificationsPerUser); },
    get suppressionWindowMs() { return configManager.getNumber('general', 'suppressionWindow', DEFAULTS.general.suppressionWindow) * 1000; },
    get suppressionDurationMs() { return configManager.getNumber('general', 'suppressionDuration', DEFAULTS.general.suppressionDuration) * 1000; },
    get suppressionCleanupIntervalMs() { return configManager.getNumber('general', 'suppressionCleanupInterval', DEFAULTS.general.suppressionCleanupInterval) * 1000; },
    get ttsEnabled() { return configManager.getBoolean('general', 'ttsEnabled', DEFAULTS.general.ttsEnabled); },
    get streamDetectionEnabled() { return configManager.getBoolean('general', 'streamDetectionEnabled', DEFAULTS.general.streamDetectionEnabled); },
    get streamRetryInterval() { return configManager.getNumber('general', 'streamRetryInterval', DEFAULTS.general.streamRetryInterval); },
    get streamMaxRetries() { return configManager.getNumber('general', 'streamMaxRetries', DEFAULTS.general.streamMaxRetries); },
    get continuousMonitoringInterval() { return configManager.getNumber('general', 'continuousMonitoringInterval', DEFAULTS.general.continuousMonitoringInterval); }
};

// Lazy initialization for platform configs to avoid circular dependency
let _tiktokConfig = null;
let _twitchConfig = null;
let _youtubeConfig = null;

function getTiktokConfig() {
    if (!_tiktokConfig) {
        // Merge raw section to preserve platform-specific options while keeping standardized getters
        const rawSection = configManager.getSection('tiktok') || {};
        _tiktokConfig = Object.assign({}, rawSection, createPlatformConfig('tiktok'));
    }
    return _tiktokConfig;
}

function getTwitchConfig() {
    if (!_twitchConfig) {
        // Start with all raw fields from the [twitch] section
        const rawSection = configManager.getSection('twitch') || {};
        _twitchConfig = Object.assign({}, rawSection, createPlatformConfig('twitch'));
        
        Object.assign(_twitchConfig, {
            get channel() { return configManager.getString('twitch', 'channel', ''); },
            get eventsub_enabled() { return configManager.getBoolean('twitch', 'eventsub_enabled', DEFAULTS.twitch.eventsubEnabled); },
            get tokenStorePath() {
                const tokenStorePath = configManager.getString('twitch', 'tokenStorePath', DEFAULTS.twitch.tokenStorePath);
                return tokenStorePath.trim() ? tokenStorePath : DEFAULTS.twitch.tokenStorePath;
            }
        });

        Object.defineProperty(_twitchConfig, 'clientId', {
            get: function() {
                return resolveSecretValue('TWITCH_CLIENT_ID');
            },
            enumerable: true
        });

        Object.defineProperty(_twitchConfig, 'clientSecret', {
            get: function() {
                return resolveSecretValue('TWITCH_CLIENT_SECRET');
            },
            enumerable: true
        });
    }
    return _twitchConfig;
}

function getYoutubeConfig() {
    if (!_youtubeConfig) _youtubeConfig = createPlatformConfig('youtube');
    return _youtubeConfig;
}

const obsConfig = {
    get address() { return configManager.getString('obs', 'address', DEFAULTS.obs.address); },
    get password() {
        return resolveSecretValue('OBS_PASSWORD');
    },
    get enabled() { return configManager.getBoolean('obs', 'enabled', DEFAULTS.obs.enabled); },
    get notificationTxt() { return configManager.getString('obs', 'notificationTxt', DEFAULTS.obs.notificationTxt); },
    get chatMsgTxt() { return configManager.getString('obs', 'chatMsgTxt', DEFAULTS.obs.chatMsgTxt); },
    get notificationScene() { return configManager.getString('obs', 'notificationScene', DEFAULTS.obs.notificationScene); },
    get notificationMsgGroup() { return configManager.getString('obs', 'notificationMsgGroup', DEFAULTS.obs.notificationMsgGroup); },
    get ttsTxt() { return configManager.getString('obs', 'ttsTxt', DEFAULTS.obs.ttsTxt); },
    get ttsScene() { return configManager.getString('obs', 'ttsScene', DEFAULTS.obs.ttsScene); }
};

const handcamConfig = {
    get enabled() { return configManager.getBoolean('handcam', 'glowEnabled', DEFAULTS.handcam.glowEnabled); },
    get sourceName() { return configManager.getString('handcam', 'sourceName', DEFAULTS.handcam.sourceName); },
    get sceneName() { return configManager.getString('handcam', 'sceneName', DEFAULTS.handcam.sceneName); },
    get glowFilterName() { return configManager.getString('handcam', 'glowFilterName', DEFAULTS.handcam.glowFilterName); },
    get maxSize() { return configManager.getNumber('handcam', 'maxSize', DEFAULTS.handcam.maxSize); },
    get rampUpDuration() { return configManager.getNumber('handcam', 'rampUpDuration', DEFAULTS.handcam.rampUpDuration); },
    get holdDuration() { return configManager.getNumber('handcam', 'holdDuration', DEFAULTS.handcam.holdDuration); },
    get rampDownDuration() { return configManager.getNumber('handcam', 'rampDownDuration', DEFAULTS.handcam.rampDownDuration); },
    get totalSteps() { return configManager.getNumber('handcam', 'totalSteps', DEFAULTS.handcam.totalSteps); },
    get incrementPercent() { return configManager.getNumber('handcam', 'incrementPercent', DEFAULTS.handcam.incrementPercent); },
    get easingEnabled() { return configManager.getBoolean('handcam', 'easingEnabled', DEFAULTS.handcam.easingEnabled); },
    get animationInterval() { return configManager.getNumber('handcam', 'animationInterval', DEFAULTS.handcam.animationInterval); }
};

const goalsConfig = {
    get enabled() { return configManager.getBoolean('goals', 'enabled', DEFAULTS.goals.enabled); },
    get goalScene() { return configManager.getString('goals', 'goalScene', DEFAULTS.goals.goalScene); },
    get tiktokGoalEnabled() { return configManager.getBoolean('goals', 'tiktokGoalEnabled', DEFAULTS.goals.tiktokGoalEnabled); },
    get tiktokGoalSource() { return configManager.getString('goals', 'tiktokGoalSource'); },
    get tiktokGoalTarget() { return configManager.getNumber('goals', 'tiktokGoalTarget', DEFAULTS.goals.tiktokGoalTarget); },
    get tiktokGoalCurrency() { return configManager.getString('goals', 'tiktokGoalCurrency', DEFAULTS.goals.tiktokGoalCurrency); },
    get tiktokPaypiggyEquivalent() { return configManager.getNumber('goals', 'tiktokPaypiggyEquivalent', DEFAULTS.goals.tiktokPaypiggyEquivalent); },
    get youtubeGoalEnabled() { return configManager.getBoolean('goals', 'youtubeGoalEnabled', DEFAULTS.goals.youtubeGoalEnabled); },
    get youtubeGoalSource() { return configManager.getString('goals', 'youtubeGoalSource'); },
    get youtubeGoalTarget() { return configManager.getNumber('goals', 'youtubeGoalTarget', DEFAULTS.goals.youtubeGoalTarget); },
    get youtubeGoalCurrency() { return configManager.getString('goals', 'youtubeGoalCurrency', DEFAULTS.goals.youtubeGoalCurrency); },
    get youtubePaypiggyPrice() { return configManager.getNumber('goals', 'youtubePaypiggyPrice', DEFAULTS.goals.youtubePaypiggyPrice); },
    get twitchGoalEnabled() { return configManager.getBoolean('goals', 'twitchGoalEnabled', DEFAULTS.goals.twitchGoalEnabled); },
    get twitchGoalSource() { return configManager.getString('goals', 'twitchGoalSource'); },
    get twitchGoalTarget() { return configManager.getNumber('goals', 'twitchGoalTarget', DEFAULTS.goals.twitchGoalTarget); },
    get twitchGoalCurrency() { return configManager.getString('goals', 'twitchGoalCurrency', DEFAULTS.goals.twitchGoalCurrency); },
    get twitchPaypiggyEquivalent() { return configManager.getNumber('goals', 'twitchPaypiggyEquivalent', DEFAULTS.goals.twitchPaypiggyEquivalent); }
};

const vfxConfig = {
    get filePath() { return configManager.getString('vfx', 'vfxFilePath', ''); }
};

const giftConfig = {
    get command() { return configManager.getString('gifts', 'command', ''); },
    get giftVideoSource() { return configManager.getString('gifts', 'giftVideoSource', DEFAULTS.gifts.giftVideoSource); },
    get giftAudioSource() { return configManager.getString('gifts', 'giftAudioSource', DEFAULTS.gifts.giftAudioSource); },
    get scene() { return configManager.getString('gifts', 'giftScene', DEFAULTS.gifts.giftScene); },
    get lowValueThreshold() { return configManager.getNumber('gifts', 'lowValueThreshold', DEFAULTS.gifts.lowValueThreshold); },
    get spamDetectionEnabled() { return configManager.getBoolean('gifts', 'spamDetectionEnabled', DEFAULTS.gifts.spamDetectionEnabled); },
    get spamDetectionWindow() { return configManager.getNumber('gifts', 'spamDetectionWindow', DEFAULTS.gifts.spamDetectionWindow); },
    get maxIndividualNotifications() { return configManager.getNumber('gifts', 'maxIndividualNotifications', DEFAULTS.gifts.maxIndividualNotifications); }
};

const streamElementsConfig = {
    get enabled() { return configManager.getBoolean('streamelements', 'enabled', DEFAULTS.streamelements.enabled); },
    get youtubeChannelId() { return resolveConfigValue('streamelements', 'youtubeChannelId'); },
    get twitchChannelId() { return resolveConfigValue('streamelements', 'twitchChannelId'); },
    get jwtToken() { return resolveSecretValue('STREAMELEMENTS_JWT_TOKEN'); },
    get dataLoggingEnabled() { return configManager.getBoolean('logging', 'streamelementsDataLoggingEnabled', DEFAULTS.logging.streamelementsDataLoggingEnabled); },
    get dataLoggingPath() { return DEFAULTS.LOG_DIRECTORY; }
};

const timingConfig = {
    get chatMessageDuration() { return configManager.getNumber('timing', 'chatMessageDuration', DEFAULTS.timing.chatMessageDuration); },
    get defaultNotificationDuration() { return configManager.getNumber('timing', 'defaultNotificationDuration', DEFAULTS.timing.defaultNotificationDuration); },
    get greetingDuration() { return configManager.getNumber('timing', 'greetingDuration', DEFAULTS.timing.greetingDuration); },
    get followDuration() { return configManager.getNumber('timing', 'followDuration', DEFAULTS.timing.followDuration); },
    get giftDuration() { return configManager.getNumber('timing', 'giftDuration', DEFAULTS.timing.giftDuration); },
    get memberDuration() { return configManager.getNumber('timing', 'memberDuration', DEFAULTS.timing.memberDuration); },
    get raidDuration() { return configManager.getNumber('timing', 'raidDuration', DEFAULTS.timing.raidDuration); },
    get fadeDuration() { return configManager.getNumber('timing', 'fadeDuration', DEFAULTS.timing.fadeDuration); },
    get transitionDelay() { return configManager.getNumber('timing', 'transitionDelay', DEFAULTS.timing.transitionDelay); },
    get notificationClearDelay() { return configManager.getNumber('timing', 'notificationClearDelay', DEFAULTS.timing.notificationClearDelay); }
};

const spamConfig = {
    get lowValueThreshold() { return configManager.getNumber('gifts', 'lowValueThreshold', DEFAULTS.gifts.lowValueThreshold); },
    get spamDetectionEnabled() { return configManager.getBoolean('gifts', 'spamDetectionEnabled', DEFAULTS.gifts.spamDetectionEnabled); },
    get spamDetectionWindow() { return configManager.getNumber('gifts', 'spamDetectionWindow', DEFAULTS.gifts.spamDetectionWindow); },
    get maxIndividualNotifications() { return configManager.getNumber('gifts', 'maxIndividualNotifications', DEFAULTS.gifts.maxIndividualNotifications); }
};

const ttsConfig = {
    get deduplicationEnabled() { return configManager.getBoolean('tts', 'deduplicationEnabled', DEFAULTS.tts.deduplicationEnabled); },
    get debugDeduplication() { return configManager.getBoolean('tts', 'debugDeduplication', DEFAULTS.tts.debugDeduplication); },
    get onlyForGifts() { return configManager.getBoolean('tts', 'onlyForGifts', DEFAULTS.tts.onlyForGifts); },
    get voice() { return configManager.getString('tts', 'voice', DEFAULTS.tts.voice); },
    get rate() { return configManager.getNumber('tts', 'rate', DEFAULTS.tts.rate); },
    get volume() { return configManager.getNumber('tts', 'volume', DEFAULTS.tts.volume); },
    get twitchDeduplicationEnabled() { return configManager.getBoolean('tts', 'twitchDeduplicationEnabled', DEFAULTS.tts.twitchDeduplicationEnabled); },
    get youtubeDeduplicationEnabled() { return configManager.getBoolean('tts', 'youtubeDeduplicationEnabled', DEFAULTS.tts.youtubeDeduplicationEnabled); },
    get tiktokDeduplicationEnabled() { return configManager.getBoolean('tts', 'tiktokDeduplicationEnabled', DEFAULTS.tts.tiktokDeduplicationEnabled); },
    get performanceWarningThreshold() { return configManager.getNumber('tts', 'performanceWarningThreshold', DEFAULTS.tts.performanceWarningThreshold); }
};


// Consolidated config object with lazy initialization
const config = {
    get general() { return generalConfig; },
    get http() { return httpConfig; },
    get tiktok() { return getTiktokConfig(); },
    get twitch() { return getTwitchConfig(); },
    get youtube() { return getYoutubeConfig(); },
    get obs() { return obsConfig; },
    get handcam() { return handcamConfig; },
    get goals() { return goalsConfig; },
    get vfx() { return vfxConfig; },
    get gifts() { return giftConfig; },
    get spam() { return spamConfig; },
    get timing() { return timingConfig; },
    get cooldowns() { return configManager.getSection('cooldowns'); },
    get tts() { return ttsConfig; },
    get follows() { return { command: configManager.getString('follows', 'command', '') }; },
    get raids() { return { command: configManager.getString('raids', 'command', '') }; },
    get paypiggies() { return { command: configManager.getString('paypiggies', 'command', '') }; },
    get greetings() { return { command: configManager.getString('greetings', 'command', '') }; },
    get farewell() {
        return {
            enabled: configManager.getBoolean('farewell', 'enabled', DEFAULTS.farewell.enabled),
            command: configManager.getString('farewell', 'command', '')
        };
    },
    get streamelements() { return streamElementsConfig; },
    get commands() {
        const commandsSection = configManager.getSection('commands');
        return {
            ...commandsSection,
            get enabled() { return configManager.getBoolean('commands', 'enabled', DEFAULTS.commands.enabled); }
        };
    },
    get raw() { return configManager.getRaw(); }
};

function validateNewFeaturesConfig(config) {
    const validation = {
        isValid: true,
        errors: [],
        warnings: []
    };


    // Validate cooldown configuration
    if (config.cooldowns) {
        const cooldown = config.cooldowns;
        
        if (cooldown.defaultCooldown && (cooldown.defaultCooldown < 10 || cooldown.defaultCooldown > 3600)) {
            validation.warnings.push('cooldowns.defaultCooldown should be between 10 and 3600 seconds');
        }
        
        if (cooldown.heavyCommandCooldown && (cooldown.heavyCommandCooldown < 60 || cooldown.heavyCommandCooldown > 3600)) {
            validation.warnings.push('cooldowns.heavyCommandCooldown should be between 60 and 3600 seconds');
        }
        
        if (cooldown.heavyCommandThreshold && (cooldown.heavyCommandThreshold < 2 || cooldown.heavyCommandThreshold > 20)) {
            validation.warnings.push('cooldowns.heavyCommandThreshold should be between 2 and 20');
        }
    }

    // Validate handcam glow configuration
    if (config.handcam) {
        const handcam = config.handcam;
        
        if (handcam.maxSize && (handcam.maxSize < 1 || handcam.maxSize > 100)) {
            validation.warnings.push('handcam.maxSize should be between 1 and 100');
        }
        
        if (handcam.rampUpDuration && (handcam.rampUpDuration < 0.1 || handcam.rampUpDuration > 10.0)) {
            validation.warnings.push('handcam.rampUpDuration should be between 0.1 and 10.0 seconds');
        }
        
        if (handcam.holdDuration && (handcam.holdDuration < 0.1 || handcam.holdDuration > 10.0)) {
            validation.warnings.push('handcam.holdDuration should be between 0.1 and 10.0 seconds');
        }
        
        if (handcam.rampDownDuration && (handcam.rampDownDuration < 0.1 || handcam.rampDownDuration > 10.0)) {
            validation.warnings.push('handcam.rampDownDuration should be between 0.1 and 10.0 seconds');
        }
    }

    // Validate retry configuration
    if (config.retry) {
        const retry = config.retry;
        
        if (retry.baseDelay && (retry.baseDelay < 1000 || retry.baseDelay > 30000)) {
            validation.warnings.push('retry.baseDelay should be between 1000 and 30000 milliseconds');
        }
        
        if (retry.maxDelay && (retry.maxDelay < 5000 || retry.maxDelay > 120000)) {
            validation.warnings.push('retry.maxDelay should be between 5000 and 120000 milliseconds');
        }
        
        if (retry.backoffMultiplier && (retry.backoffMultiplier < 1.1 || retry.backoffMultiplier > 3.0)) {
            validation.warnings.push('retry.backoffMultiplier should be between 1.1 and 3.0');
        }
        
        if (retry.maxAttempts && (retry.maxAttempts < 1 || retry.maxAttempts > 50)) {
            validation.warnings.push('retry.maxAttempts should be between 1 and 50');
        }
    }

    return validation;
}

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
    validateNewFeaturesConfig,
    validateLoggingConfig,
    DEFAULT_LOGGING_CONFIG,
    // Export getter functions for direct access if needed
    getTiktokConfig,
    getTwitchConfig,
    getYoutubeConfig
}; 
