'use strict';

function createRuntimeConstantsFixture(overrides = {}) {
    return {
        CHAT_PLATFORM_LOGOS: {
            twitch: 'twitch-img',
            youtube: 'youtube-img',
            tiktok: 'tiktok-img'
        },
        NOTIFICATION_PLATFORM_LOGOS: {
            twitch: 'twitch-img',
            youtube: 'youtube-img',
            tiktok: 'tiktok-img'
        },
        STATUSBAR_GROUP_NAME: 'statusbar chat grp',
        STATUSBAR_NOTIFICATION_GROUP_NAME: 'statusbar notification grp',
        NOTIFICATION_CONFIG: {
            fadeDelay: 750
        },
        NOTIFICATION_CLEAR_DELAY: 200,
        CHAT_TRANSITION_DELAY: 200,
        CHAT_MESSAGE_DURATION: 4500,
        OBS_CONNECTION_TIMEOUT: 5000,
        PLATFORM_TIMEOUTS: {
            INNERTUBE_INSTANCE_TTL: 300000,
            INNERTUBE_MIN_TTL: 60000
        },
        VIEWER_COUNT_POLLING_INTERVAL_SECONDS: 30,
        HANDCAM_GLOW_CONFIG: {
            ENABLED: true,
            SOURCE_NAME: 'handcam',
            SCENE_NAME: 'handcam scene',
            FILTER_NAME: 'Glow',
            DEFAULT_MAX_SIZE: 50,
            DEFAULT_RAMP_UP_DURATION: 0.5,
            DEFAULT_HOLD_DURATION: 8.0,
            DEFAULT_RAMP_DOWN_DURATION: 0.5,
            DEFAULT_TOTAL_STEPS: 30,
            DEFAULT_INCREMENT_PERCENT: 3.33,
            DEFAULT_EASING_ENABLED: true,
            DEFAULT_ANIMATION_INTERVAL: 16
        },
        COOLDOWN_CONFIG: {
            DEFAULT_COOLDOWN: 60000,
            HEAVY_COMMAND_COOLDOWN: 300000,
            HEAVY_COMMAND_THRESHOLD: 4,
            HEAVY_COMMAND_WINDOW: 360000,
            MAX_COOLDOWN_ENTRIES: 1000
        },
        USER_AGENTS: ['agent-one'],
        MAX_MESSAGE_LENGTH: 500,
        ...overrides
    };
}

function createSourcesConfigFixture(overrides = {}) {
    return {
        chatGroupName: 'statusbar chat grp',
        notificationGroupName: 'statusbar notification grp',
        fadeDelay: 750,
        ...overrides
    };
}

module.exports = {
    createRuntimeConstantsFixture,
    createSourcesConfigFixture
};
