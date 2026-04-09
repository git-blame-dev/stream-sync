const PRIORITY_LEVELS = {
    CHAT: 1,
    COMMAND: 2,
    FAREWELL: 3,
    GREETING: 4,
    FOLLOW: 5,
    SHARE: 6,
    RAID: 7,
    ENVELOPE: 8,
    GIFT: 9,
    PAYPIGGY: 10,
    GIFTPAYPIGGY: 11
} as const;

const ERROR_MESSAGES = {
    CONFIG_NOT_FOUND: 'Configuration file not found',
    CONFIG_INVALID: 'Invalid configuration format',
    OBS_CONNECTION_FAILED: 'Failed to connect to OBS WebSocket',
    PLATFORM_CONNECTION_FAILED: 'Failed to connect to platform',
    INVALID_COMMAND_CONFIG: 'Invalid command configuration',
    VFX_FILE_NOT_FOUND: 'VFX file not found',
    API_QUOTA_EXCEEDED: 'API quota exceeded',
    NETWORK_ERROR: 'Network connection error'
} as const;

const NOTIFICATION_CONFIGS = {
    'platform:follow': {
        timing: 'simultaneous',
        settingKey: 'followsEnabled',
        commandKey: 'follows'
    },
    'platform:gift': {
        timing: 'three_step',
        settingKey: 'giftsEnabled',
        commandKey: 'gifts'
    },
    'platform:envelope': {
        timing: 'sequential',
        settingKey: 'giftsEnabled',
        commandKey: 'envelopes'
    },
    'platform:paypiggy': {
        timing: 'sequential',
        settingKey: 'paypiggiesEnabled',
        commandKey: 'paypiggies'
    },
    'platform:giftpaypiggy': {
        timing: 'sequential',
        settingKey: 'giftsEnabled',
        commandKey: 'gifts'
    },
    'platform:raid': {
        timing: 'sequential',
        settingKey: 'raidsEnabled',
        commandKey: 'raids'
    },
    'platform:share': {
        timing: 'sequential',
        settingKey: 'sharesEnabled',
        commandKey: 'shares'
    },
    command: {
        timing: 'sequential',
        settingKey: 'commandsEnabled',
        commandKey: 'commands'
    },
    greeting: {
        timing: 'sequential',
        settingKey: 'greetingsEnabled',
        commandKey: 'greetings'
    },
    farewell: {
        timing: 'sequential',
        settingKey: 'farewellsEnabled',
        commandKey: 'farewell'
    },
    'platform:chat-message': {
        timing: 'immediate',
        settingKey: 'messagesEnabled',
        commandKey: 'chat'
    }
} as const;

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
} as const;

export {
    PRIORITY_LEVELS,
    NOTIFICATION_CONFIGS,
    ERROR_MESSAGES,
    VIEWER_COUNT_CONSTANTS
};
