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

const NOTIFICATION_CONFIGS = {
    'platform:follow': {
        timing: 'simultaneous',
        settingKey: 'followsEnabled',
        commandKey: 'follows',
        hasSpecialProcessing: false
    },
    'platform:gift': {
        timing: 'three_step',
        settingKey: 'giftsEnabled',
        commandKey: 'gifts',
        hasSpecialProcessing: true
    },
    'platform:envelope': {
        timing: 'sequential',
        settingKey: 'giftsEnabled',
        commandKey: 'gifts',
        hasSpecialProcessing: false
    },
    'platform:paypiggy': {
        timing: 'sequential',
        settingKey: 'paypiggiesEnabled',
        commandKey: 'paypiggies',
        hasSpecialProcessing: false
    },
    'platform:giftpaypiggy': {
        timing: 'sequential',
        settingKey: 'giftsEnabled',
        commandKey: 'gifts',
        hasSpecialProcessing: false
    },
    'platform:raid': {
        timing: 'sequential',
        settingKey: 'raidsEnabled',
        commandKey: 'raids',
        hasSpecialProcessing: false
    },
    'platform:share': {
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
    'platform:chat-message': {
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
    ERROR_MESSAGES,
    VIEWER_COUNT_CONSTANTS
};
