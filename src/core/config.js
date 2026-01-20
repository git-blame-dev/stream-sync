
const fs = require('fs');
const ini = require('ini');
const { handleUserFacingError } = require('../utils/user-friendly-errors');
const { createRuntimeConstants } = require('./runtime-constants');
const { DEFAULT_HTTP_USER_AGENTS, parseUserAgentList } = require('./http-config');

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
            const youtubeChannelId = resolveSecretValue('streamelements', 'youtubeChannelId');
            const twitchChannelId = resolveSecretValue('streamelements', 'twitchChannelId');
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

        const youtubeEnabled = this.getBoolean('youtube', 'enabled', false);
        if (youtubeEnabled) {
            const enableAPI = this.getBoolean('youtube', 'enableAPI', false);
            const streamDetectionMethod = this.getString('youtube', 'streamDetectionMethod', 'youtubei').trim().toLowerCase();
            const viewerCountMethod = this.getString('youtube', 'viewerCountMethod', 'youtubei').trim().toLowerCase();
            const needsApiKey = enableAPI || streamDetectionMethod === 'api' || viewerCountMethod === 'api';
            if (needsApiKey && !resolveSecretValue('youtube', 'apiKey')) {
                const error = new Error('Missing required configuration: YouTube API key');
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
        const value = this.get(section, key, defaultValue);
        if (typeof value === 'boolean') return value;
        // Only "true" (case-insensitive) should return true, everything else returns false
        return String(value).trim().toLowerCase() === 'true';
    }

    getNumber(section, key, defaultValue = 0) {
        const value = this.get(section, key, defaultValue);
        const parsed = parseFloat(value);
        return isNaN(parsed) ? defaultValue : parsed;
    }

    getString(section, key, defaultValue = '') {
        return String(this.get(section, key, defaultValue));
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

const resolveSecretValue = (section, key) => {
    const rawValue = configManager.get(section, key);
    if (rawValue === undefined || rawValue === null) {
        return undefined;
    }
    const trimmed = String(rawValue).trim();
    return trimmed.length > 0 ? trimmed : undefined;
};

const resolveFallbackUsername = () => {
    if (!configManager.config || !configManager.config.general) {
        return 'Unknown User';
    }
    const rawValue = configManager.config.general.fallbackUsername;
    if (rawValue === undefined || rawValue === null) {
        return 'Unknown User';
    }
    const trimmed = String(rawValue).trim();
    return trimmed.length > 0 ? trimmed : 'Unknown User';
};

const resolveHttpUserAgents = () => {
    const rawAgents = configManager.get('http', 'userAgents');
    const parsed = parseUserAgentList(rawAgents);
    return parsed.length > 0 ? parsed : DEFAULT_HTTP_USER_AGENTS.slice();
};

const httpConfig = {
    get userAgents() { return resolveHttpUserAgents(); },
    get defaultTimeoutMs() { return configManager.getNumber('http', 'defaultTimeoutMs', 10000); },
    get reachabilityTimeoutMs() { return configManager.getNumber('http', 'reachabilityTimeoutMs', 5000); },
    get enhancedTimeoutMs() { return configManager.getNumber('http', 'enhancedTimeoutMs', 3000); },
    get enhancedReachabilityTimeoutMs() { return configManager.getNumber('http', 'enhancedReachabilityTimeoutMs', 3000); }
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
        get dataLoggingEnabled() { return configManager.getBoolean(platformName, 'dataLoggingEnabled', false); }
    };

    if (platformName !== 'twitch') {
        // Unified apiKey for all platforms except Twitch (token-only auth)
        Object.defineProperty(platformConfig, 'apiKey', {
            get: function() { 
                return resolveSecretValue(platformName, 'apiKey');
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

    // YouTube specific granular settings
    if (platformName === 'youtube') {
        Object.assign(platformConfig, {
            get enableAPI() {
                return configManager.getBoolean('youtube', 'enableAPI', false);
            },
            get streamDetectionMethod() {
                const method = configManager.getString('youtube', 'streamDetectionMethod', 'youtubei').toLowerCase();
                return ['youtubei', 'api'].includes(method) ? method : 'youtubei';
            },
            get viewerCountMethod() {
                const method = configManager.getString('youtube', 'viewerCountMethod', 'youtubei').toLowerCase();
                return ['youtubei', 'api'].includes(method) ? method : 'youtubei';
            },
            get chatMethod() { return 'scraping'; },
            get maxStreams() { return configManager.getNumber('youtube', 'maxStreams', 0); }, // 0 = unlimited
        });
    }

    return platformConfig;
}

// --- Main Configuration Objects ---

const generalConfig = {
    // Cooldown for commands in milliseconds
    get cmdCooldownMs() { return (configManager.getNumber('general', 'cmdCoolDown', 60)) * 1000; },
    
    // Global per-command cooldown in milliseconds (prevents any user from using same command too frequently)
    get globalCmdCooldownMs() { return (parseInt(configManager.get('general', 'globalCmdCoolDown'), 10) || 60) * 1000; },

    // Interval for polling viewer counts in milliseconds
    get viewerCountPollingIntervalMs() { return (configManager.getNumber('general', 'viewerCountPollingInterval', 60)) * 1000; },

    // OBS scene name for viewer counts
    get viewerCountScene() { return configManager.get('general', 'viewerCountScene', 'viewer-count-scene'); },

    // Chat message text source name
    get chatMsgTxt() { return configManager.get('general', 'chatMsgTxt', 'chat-message-text'); },

    // Chat message scene name
    get chatMsgScene() { return configManager.get('general', 'chatMsgScene', 'chat-message-scene'); },

    // Chat message group name (disabled - using direct source access)
    get chatMsgGroup() { return configManager.get('general', 'chatMsgGroup', 'chat-message-group'); },

    // Enable/disable debug logging
    get debugEnabled() { return configManager.getBoolean('general', 'debugEnabled', false); },
    get envFilePath() {
        const envFilePath = configManager.getString('general', 'envFilePath', './.env');
        return envFilePath && envFilePath.trim() ? envFilePath : './.env';
    },
    get envFileReadEnabled() { return configManager.getBoolean('general', 'envFileReadEnabled', true); },
    get envFileWriteEnabled() { return configManager.getBoolean('general', 'envFileWriteEnabled', true); },

    // Global notification settings
    get messagesEnabled() { return configManager.getBoolean('general', 'messagesEnabled', true); },
    get commandsEnabled() { return configManager.getBoolean('general', 'commandsEnabled', true); },
    get greetingsEnabled() { return configManager.getBoolean('general', 'greetingsEnabled', true); },
    get farewellsEnabled() { return configManager.getBoolean('general', 'farewellsEnabled', true); },
    get followsEnabled() { return configManager.getBoolean('general', 'followsEnabled', true); },
    get giftsEnabled() { return configManager.getBoolean('general', 'giftsEnabled', true); },
    get raidsEnabled() { return configManager.getBoolean('general', 'raidsEnabled', true); },
    get paypiggiesEnabled() { return configManager.getBoolean('general', 'paypiggiesEnabled', true); },
    get greetNewCommentors() { return configManager.getBoolean('general', 'greetNewCommentors', false); },
    get filterOldMessages() { return configManager.getBoolean('general', 'filterOldMessages', true); },
    get logChatMessages() { return configManager.getBoolean('general', 'logChatMessages', false); },
    get keywordParsingEnabled() { return configManager.getBoolean('general', 'keywordParsingEnabled', true); },
    get ignoreSelfMessages() { return configManager.getBoolean('general', 'ignoreSelfMessages', false); },
    get fallbackUsername() { return resolveFallbackUsername(); },

    // Per-user notification suppression defaults
    get userSuppressionEnabled() { return configManager.getBoolean('general', 'userSuppressionEnabled', true); },
    get maxNotificationsPerUser() { return configManager.getNumber('general', 'maxNotificationsPerUser', 5); },
    get suppressionWindowMs() { return configManager.getNumber('general', 'suppressionWindowMs', 60000); },
    get suppressionDurationMs() { return configManager.getNumber('general', 'suppressionDurationMs', 300000); },
    get suppressionCleanupIntervalMs() { return configManager.getNumber('general', 'suppressionCleanupIntervalMs', 300000); },
    
    // TTS (Text-To-Speech) functionality
    get ttsEnabled() { return configManager.getBoolean('general', 'ttsEnabled', false); },

    // Stream detection (cross-platform defaults)
    get streamDetectionEnabled() { return configManager.getBoolean('general', 'streamDetectionEnabled', true); },
    get streamRetryInterval() { return configManager.getNumber('general', 'streamRetryInterval', 15); },
    get streamMaxRetries() { return configManager.getNumber('general', 'streamMaxRetries', -1); },
    get continuousMonitoringInterval() { return configManager.getNumber('general', 'continuousMonitoringInterval', 60); }
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
        
        // Add Twitch-specific properties as getters (these will override raw fields if present)
        Object.assign(_twitchConfig, {
            get channel() { return configManager.getString('twitch', 'channel', ''); },
            get eventsub_enabled() { return configManager.getBoolean('twitch', 'eventsub_enabled', false); },
            get clientId() {
                return resolveSecretValue('twitch', 'clientId');
            },
            get tokenStorePath() {
                const tokenStorePath = configManager.getString('twitch', 'tokenStorePath', './data/twitch-tokens.json');
                return tokenStorePath.trim() ? tokenStorePath : './data/twitch-tokens.json';
            }
        });
    }
    return _twitchConfig;
}

function getYoutubeConfig() {
    if (!_youtubeConfig) _youtubeConfig = createPlatformConfig('youtube');
    return _youtubeConfig;
}

const obsConfig = {
    // OBS WebSocket server address
    get address() { return configManager.getString('obs', 'address', 'ws://localhost:4455'); },
    // OBS WebSocket server password
    get password() {
        const value = configManager.get('obs', 'password');
        return value === undefined || value === null ? undefined : String(value);
    },
    // OBS integration enabled/disabled
    get enabled() { return configManager.getBoolean('obs', 'enabled', false); },
    // Text source name for notifications
    get notificationTxt() { return configManager.getString('obs', 'notificationTxt', 'notification-text'); },
    // Text source name for chat messages
    get chatMsgTxt() { return configManager.getString('obs', 'chatMsgTxt', 'chat-message-text'); },
    // Scene name for notifications
    get notificationScene() { return configManager.getString('obs', 'notificationScene', 'notification-scene'); },
    get notificationMsgGroup() { return configManager.getString('obs', 'notificationMsgGroup', 'notification-group'); },
    get ttsTxt() { return configManager.getString('obs', 'ttsTxt', 'tts-text'); },
    get ttsScene() { return configManager.getString('obs', 'ttsScene', 'tts-scene'); }
};

const handcamConfig = {
    get enabled() { return configManager.getBoolean('handcam', 'glowEnabled', false); },
    get sourceName() { return configManager.getString('handcam', 'sourceName', 'handcam-source'); },
    get sceneName() { return configManager.getString('handcam', 'sceneName', 'handcam-scene'); },
    get glowFilterName() { return configManager.getString('handcam', 'glowFilterName', 'Glow'); },
    get maxSize() { return configManager.getNumber('handcam', 'maxSize', 50); },
    get rampUpDuration() { return configManager.getNumber('handcam', 'rampUpDuration', 0.5); },
    get holdDuration() { return configManager.getNumber('handcam', 'holdDuration', 6.0); },
    get rampDownDuration() { return configManager.getNumber('handcam', 'rampDownDuration', 0.5); },
    get totalSteps() { return configManager.getNumber('handcam', 'totalSteps', 30); },
    get incrementPercent() { return configManager.getNumber('handcam', 'incrementPercent', 3.33); },
    get easingEnabled() { return configManager.getBoolean('handcam', 'easingEnabled', true); },
    get animationInterval() { return configManager.getNumber('handcam', 'animationInterval', 16); }
};

const goalsConfig = {
    get enabled() { return configManager.getBoolean('goals', 'enabled', false); },
    get goalScene() { return configManager.getString('goals', 'goalScene', 'goals-scene'); },
    get tiktokGoalEnabled() { return configManager.getBoolean('goals', 'tiktokGoalEnabled', true); },
    get tiktokGoalSource() { return configManager.getString('goals', 'tiktokGoalSource'); },
    get tiktokGoalTarget() { return configManager.getNumber('goals', 'tiktokGoalTarget', 1000); },
    get tiktokGoalCurrency() { return configManager.getString('goals', 'tiktokGoalCurrency', 'coins'); },
    get tiktokPaypiggyEquivalent() { return configManager.getNumber('goals', 'tiktokPaypiggyEquivalent', 50); },
    get youtubeGoalEnabled() { return configManager.getBoolean('goals', 'youtubeGoalEnabled', true); },
    get youtubeGoalSource() { return configManager.getString('goals', 'youtubeGoalSource'); },
    get youtubeGoalTarget() { return configManager.getNumber('goals', 'youtubeGoalTarget', 1.00); },
    get youtubeGoalCurrency() { return configManager.getString('goals', 'youtubeGoalCurrency', 'dollars'); },
    get youtubePaypiggyPrice() { return configManager.getNumber('goals', 'youtubePaypiggyPrice', 4.99); },
    get twitchGoalEnabled() { return configManager.getBoolean('goals', 'twitchGoalEnabled', true); },
    get twitchGoalSource() { return configManager.getString('goals', 'twitchGoalSource'); },
    get twitchGoalTarget() { return configManager.getNumber('goals', 'twitchGoalTarget', 100); },
    get twitchGoalCurrency() { return configManager.getString('goals', 'twitchGoalCurrency', 'bits'); },
    get twitchPaypiggyEquivalent() { return configManager.getNumber('goals', 'twitchPaypiggyEquivalent', 350); }
};

const vfxConfig = {
    get filePath() { return configManager.getString('vfx', 'vfxFilePath', ''); }
};

const giftConfig = {
    get command() { return configManager.getString('gifts', 'command', ''); },
    get giftVideoSource() { return configManager.getString('gifts', 'giftVideoSource', 'gift-video'); },
    get giftAudioSource() { return configManager.getString('gifts', 'giftAudioSource', 'gift-audio'); },
    get scene() { return configManager.getString('gifts', 'giftScene', 'gift-scene'); },
    get lowValueThreshold() { return configManager.getNumber('gifts', 'lowValueThreshold', 10); },
    get spamDetectionEnabled() { return configManager.getBoolean('gifts', 'spamDetectionEnabled', true); },
    get spamDetectionWindow() { return configManager.getNumber('gifts', 'spamDetectionWindow', 5); },
    get maxIndividualNotifications() { return configManager.getNumber('gifts', 'maxIndividualNotifications', 2); }
};

const streamElementsConfig = {
    get enabled() { return configManager.getBoolean('streamelements', 'enabled', false); },
    get youtubeChannelId() { return resolveSecretValue('streamelements', 'youtubeChannelId'); },
    get twitchChannelId() { return resolveSecretValue('streamelements', 'twitchChannelId'); },
    get jwtToken() { return resolveSecretValue('streamelements', 'jwtToken'); },
    get dataLoggingEnabled() { return configManager.getBoolean('streamelements', 'dataLoggingEnabled', false); },
    get dataLoggingPath() { return configManager.getString('streamelements', 'dataLoggingPath', './logs'); }
};

// Timing configuration
const timingConfig = {
    get chatMessageDuration() { return configManager.getNumber('timing', 'chatMessageDuration', 4500); },
    get defaultNotificationDuration() { return configManager.getNumber('timing', 'defaultNotificationDuration', 3000); },
    get greetingDuration() { return configManager.getNumber('timing', 'greetingDuration', 3000); },
    get followDuration() { return configManager.getNumber('timing', 'followDuration', 3000); },
    get giftDuration() { return configManager.getNumber('timing', 'giftDuration', 3000); },
    get memberDuration() { return configManager.getNumber('timing', 'memberDuration', 3000); },
    get raidDuration() { return configManager.getNumber('timing', 'raidDuration', 3000); },
    get fadeDuration() { return configManager.getNumber('timing', 'fadeDuration', 750); },
    get transitionDelay() { return configManager.getNumber('timing', 'transitionDelay', 200); },
    get notificationClearDelay() { return configManager.getNumber('timing', 'notificationClearDelay', 500); }
};

// Unified spam detection configuration that maps to existing gift settings
const spamConfig = {
    get lowValueThreshold() { return configManager.getNumber('gifts', 'lowValueThreshold', 10); },
    get spamDetectionEnabled() { return configManager.getBoolean('gifts', 'spamDetectionEnabled', true); },
    get spamDetectionWindow() { return configManager.getNumber('gifts', 'spamDetectionWindow', 5); },
    get maxIndividualNotifications() { return configManager.getNumber('gifts', 'maxIndividualNotifications', 2); }
};

// TTS (Text-to-Speech) deduplication and behavior configuration
const ttsConfig = {
    // Global deduplication setting - prevents duplicate TTS for monetization events
    get deduplicationEnabled() { return configManager.getBoolean('tts', 'deduplicationEnabled', true); },
    
    // Debug logging for TTS deduplication decisions
    get debugDeduplication() { return configManager.getBoolean('tts', 'debugDeduplication', false); },

    // Optional TTS routing settings
    get onlyForGifts() { return configManager.getBoolean('tts', 'onlyForGifts', false); },
    get voice() { return configManager.getString('tts', 'voice', 'default'); },
    get rate() { return configManager.getNumber('tts', 'rate', 1.0); },
    get volume() { return configManager.getNumber('tts', 'volume', 1.0); },
    
    // Platform-specific deduplication controls
    get twitchDeduplicationEnabled() { return configManager.getBoolean('tts', 'twitchDeduplicationEnabled', true); },
    get youtubeDeduplicationEnabled() { return configManager.getBoolean('tts', 'youtubeDeduplicationEnabled', true); },
    get tiktokDeduplicationEnabled() { return configManager.getBoolean('tts', 'tiktokDeduplicationEnabled', true); },
    
    // Performance monitoring
    get performanceWarningThreshold() { return configManager.getNumber('tts', 'performanceWarningThreshold', 50); }
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
            enabled: configManager.getBoolean('farewell', 'enabled', false),
            command: configManager.getString('farewell', 'command', '') 
        }; 
    },
    get streamelements() { return streamElementsConfig; },
    get commands() { 
        const commandsSection = configManager.getSection('commands');
        return {
            ...commandsSection,
            get enabled() { return configManager.getBoolean('commands', 'enabled', false); }
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
    file: { enabled: true, level: 'debug' },      // All logs for troubleshooting
    debug: { enabled: false },
    platforms: { 
        twitch: { enabled: true, fileLogging: true }, 
        youtube: { enabled: true, fileLogging: true }, 
        tiktok: { enabled: true, fileLogging: true } 
    },
    chat: { enabled: true, separateFiles: true }
};

function validateLoggingConfig(userConfig = {}) {
    const config = { ...DEFAULT_LOGGING_CONFIG };
    
    // Merge user config with defaults
    if (userConfig.logging) {
        Object.assign(config, userConfig.logging);
    }
    
    // Backward compatibility mapping
    if (userConfig.general?.debugEnabled !== undefined) {
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
    
    if (userConfig.general?.logChatMessages !== undefined) {
        config.chat.enabled = userConfig.general.logChatMessages;
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
