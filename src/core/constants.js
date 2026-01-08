const PRIORITY_LEVELS = {
    CHAT: 1,
    GREETING: 2,
    COMMAND: 4,
    FOLLOW: 2,
    GIFT: 4,
    REDEMPTION: 4,
    MEMBER: 3,
    RAID: 6,
    SHARE: 6,
    ENVELOPE: 8,
    GIFTPAYPIGGY: 11,
    LOW: 0,
    DEFAULT: 1,
    HIGH: 15,
    MANUAL: 16
};

const PLATFORM_TERMINOLOGY = {
    follow: {
        youtube: 'subscribed',
        tiktok: 'followed',
        twitch: 'followed'
    },
    follower: {
        youtube: 'subscriber',
        tiktok: 'follower',
        twitch: 'follower'
    }
};

const ERROR_MESSAGES = {
    CONFIG_NOT_FOUND: 'Configuration file not found',
    CONFIG_INVALID: 'Invalid configuration format',
    OBS_CONNECTION_FAILED: 'Failed to connect to OBS WebSocket',
    PLATFORM_CONNECTION_FAILED: 'Failed to connect to platform',
    INVALID_COMMAND_CONFIG: 'Invalid command configuration',
    VFX_FILE_NOT_FOUND: 'VFX file not found',
    API_QUOTA_EXCEEDED: 'API quota exceeded',
    NETWORK_ERROR: 'Network connection error'
};

const SUCCESS_MESSAGES = {
    CONFIG_LOADED: 'Configuration loaded successfully',
    OBS_CONNECTED: 'Connected to OBS WebSocket',
    PLATFORM_CONNECTED: 'Connected to platform',
    COMMAND_EXECUTED: 'Command executed successfully',
    VFX_PLAYED: 'VFX played successfully',
    NOTIFICATION_SENT: 'Notification sent successfully'
};

const REGEX_PATTERNS = {
    USERNAME_VALIDATION: /^[a-zA-Z0-9_-]{1,50}$/,
    COMMAND_VALIDATION: /^![a-zA-Z0-9_-]+$/,
    URL_VALIDATION: /^https?:\/\/.+/,
    YOUTUBE_VIDEO_ID: /(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{11})/,
    TIKTOK_USERNAME: /@?([a-zA-Z0-9_.]+)/,
    TWITCH_USERNAME: /^[a-zA-Z0-9_]{4,25}$/
};

const NOTIFICATION_TYPES = {
    FOLLOW: 'follow',
    GIFT: 'gift',
    ENVELOPE: 'envelope',
    PAYPIGGY: 'paypiggy',
    GIFTPAYPIGGY: 'giftpaypiggy',
    RAID: 'raid',
    SHARE: 'share',
    COMMAND: 'command',
    GREETING: 'greeting',
    FAREWELL: 'farewell',
    REDEMPTION: 'redemption',
    CHAT: 'chat',
    GENERAL: 'general'
};

const NOTIFICATION_CONFIGS = {
    follow: {
        timing: 'simultaneous',
        settingKey: 'followsEnabled',
        commandKey: 'follows',
        hasSpecialProcessing: false
    },
    gift: {
        timing: 'three_step',
        settingKey: 'giftsEnabled',
        commandKey: 'gifts',
        hasSpecialProcessing: true
    },
    envelope: {
        timing: 'sequential',
        settingKey: 'giftsEnabled',
        commandKey: 'gifts',
        hasSpecialProcessing: false
    },
    paypiggy: {
        timing: 'sequential',
        settingKey: 'paypiggiesEnabled',
        commandKey: 'paypiggies',
        hasSpecialProcessing: false
    },
    giftpaypiggy: {
        timing: 'sequential',
        settingKey: 'giftsEnabled',
        commandKey: 'gifts',
        hasSpecialProcessing: false
    },
    raid: {
        timing: 'sequential',
        settingKey: 'raidsEnabled',
        commandKey: 'raids',
        hasSpecialProcessing: false
    },
    share: {
        timing: 'sequential',
        settingKey: 'sharesEnabled',
        commandKey: 'shares',
        hasSpecialProcessing: false
    },
    command: {
        timing: 'sequential',
        settingKey: 'commandsEnabled',
        commandKey: 'commands',
        hasSpecialProcessing: false
    },
    greeting: {
        timing: 'sequential',
        settingKey: 'greetingsEnabled',
        commandKey: 'greetings',
        hasSpecialProcessing: false
    },
    farewell: {
        timing: 'sequential',
        settingKey: 'farewellsEnabled',
        commandKey: 'farewell',
        hasSpecialProcessing: false
    },
    redemption: {
        timing: 'sequential',
        settingKey: 'redemptionsEnabled',
        commandKey: 'redemptions',
        hasSpecialProcessing: false
    },
    chat: {
        timing: 'immediate',
        settingKey: 'messagesEnabled',
        commandKey: 'chat',
        hasSpecialProcessing: false
    },
    general: {
        timing: 'sequential',
        settingKey: 'notificationsEnabled',
        commandKey: 'general',
        hasSpecialProcessing: false
    }
};

const CURRENCY_FORMAT = {
    TIKTOK: {
        symbol: 'coins',
        format: (amount, count = 1) => {
            const total = amount * count;
            const text = total === 1 ? 'coin' : 'coins';
            return ` [${total} ${text}]`;
        }
    },
    TWITCH: {
        symbol: 'bits',
        format: (amount, count = 1) => {
            const total = amount * count;
            const dollars = (total * 0.01).toFixed(2);
            return ` (${total} bits - $${dollars})`;
        }
    },
    YOUTUBE: {
        symbol: 'USD',
        format: (amount, count = 1) => {
            const total = amount * count;
            return ` ($${total.toFixed(2)})`;
        }
    }
};

const CHEERMOTE_PATTERNS = {
    DEFAULT_TYPE_COMPARISON: 'cheer',
    BITS_SUFFIX: ' Bits'
};

const VIEWER_COUNT_CONSTANTS = {
    MS_PER_SECOND: 1000,
    PLATFORM_NAMES: ['tiktok', 'twitch', 'youtube'],
    VIEWER_COUNT_ZERO: 0,
    LOG_CONTEXT: {
        VIEWER_COUNT: 'ViewerCount',
        OBS_OBSERVER: 'OBSObserver'
    },
    ERROR_MESSAGES: {
        MISSING_OBSERVER_INTERFACE: 'Observer must implement getObserverId() method',
        MISSING_OBS_CONNECTION: 'OBS not connected, skipping viewer count update',
        INVALID_VIEWER_COUNT: 'Invalid viewer count received from platform',
        INVALID_PLATFORM_NAME: 'Platform name must be a non-empty string',
        INVALID_POLLING_INTERVAL: 'Polling interval must be between 5 and 3600 seconds'
    },
    OBSERVER: {
        DEFAULT_OBS_OBSERVER_ID: 'obs-viewer-count-observer'
    }
};

module.exports = {
    PRIORITY_LEVELS,
    NOTIFICATION_CONFIGS,
    NOTIFICATION_TYPES,
    PLATFORM_TERMINOLOGY,
    ERROR_MESSAGES,
    SUCCESS_MESSAGES,
    REGEX_PATTERNS,
    CURRENCY_FORMAT,
    CHEERMOTE_PATTERNS,
    VIEWER_COUNT_CONSTANTS
};
