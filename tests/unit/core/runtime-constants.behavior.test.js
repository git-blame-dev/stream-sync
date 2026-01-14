const { describe, test, expect } = require('bun:test');
const { createRuntimeConstants } = require('../../../src/core/runtime-constants');

const buildRequiredConfig = () => ({
    general: {
        chatMsgGroup: 'statusbar chat grp',
        viewerCountPollingInterval: 30,
        maxMessageLength: 500
    },
    obs: {
        chatPlatformLogoTwitch: 'twitch-img',
        chatPlatformLogoYouTube: 'youtube-img',
        chatPlatformLogoTikTok: 'tiktok-img',
        notificationPlatformLogoTwitch: 'twitch-img',
        notificationPlatformLogoYouTube: 'youtube-img',
        notificationPlatformLogoTikTok: 'tiktok-img',
        notificationMsgGroup: 'statusbar notification grp',
        connectionTimeoutMs: 8000
    },
    timing: {
        fadeDuration: 750,
        transitionDelay: 250,
        chatMessageDuration: 4000,
        notificationClearDelay: 500
    },
    youtube: {},
    handcam: {
        glowEnabled: true,
        sourceName: 'handcam',
        sceneName: 'handcam scene',
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
    twitch: {}
});

describe('runtime constants factory', () => {
    test('throws when required config sections are missing', () => {
        expect(() => createRuntimeConstants({})).toThrow('Missing required configuration section: general');
    });

    test('builds runtime constants from required config values', () => {
        const runtimeConstants = createRuntimeConstants(buildRequiredConfig());

        expect(runtimeConstants.CHAT_PLATFORM_LOGOS).toEqual({
            twitch: 'twitch-img',
            youtube: 'youtube-img',
            tiktok: 'tiktok-img'
        });
        expect(runtimeConstants.NOTIFICATION_PLATFORM_LOGOS).toEqual({
            twitch: 'twitch-img',
            youtube: 'youtube-img',
            tiktok: 'tiktok-img'
        });
        expect(runtimeConstants.STATUSBAR_GROUP_NAME).toBe('statusbar chat grp');
        expect(runtimeConstants.STATUSBAR_NOTIFICATION_GROUP_NAME).toBe('statusbar notification grp');
        expect(runtimeConstants.NOTIFICATION_CONFIG.fadeDelay).toBe(750);
        expect(runtimeConstants.NOTIFICATION_CLEAR_DELAY).toBe(500);
        expect(runtimeConstants.CHAT_TRANSITION_DELAY).toBe(250);
        expect(runtimeConstants.CHAT_MESSAGE_DURATION).toBe(4000);
        expect(runtimeConstants.OBS_CONNECTION_TIMEOUT).toBe(8000);
        expect(runtimeConstants.PLATFORM_TIMEOUTS).toEqual({
            INNERTUBE_INSTANCE_TTL: 300000,
            INNERTUBE_MIN_TTL: 60000
        });
        expect(runtimeConstants.VIEWER_COUNT_POLLING_INTERVAL_SECONDS).toBe(30);
        expect(runtimeConstants.HANDCAM_GLOW_CONFIG).toMatchObject({
            ENABLED: true,
            SOURCE_NAME: 'handcam',
            SCENE_NAME: 'handcam scene',
            FILTER_NAME: 'Glow',
            DEFAULT_MAX_SIZE: 50,
            DEFAULT_TOTAL_STEPS: 30,
            DEFAULT_EASING_ENABLED: true
        });
        expect(runtimeConstants.COOLDOWN_CONFIG).toEqual({
            DEFAULT_COOLDOWN: 60000,
            HEAVY_COMMAND_COOLDOWN: 300000,
            HEAVY_COMMAND_THRESHOLD: 4,
            HEAVY_COMMAND_WINDOW: 360000,
            MAX_COOLDOWN_ENTRIES: 1000
        });
        expect(Array.isArray(runtimeConstants.USER_AGENTS)).toBe(true);
        expect(runtimeConstants.USER_AGENTS.length).toBeGreaterThan(0);
        expect(runtimeConstants.MAX_MESSAGE_LENGTH).toBe(500);
    });

    test('uses configured http user agents when provided', () => {
        const config = buildRequiredConfig();
        config.http = {
            userAgents: 'ExampleAgent/1.0 | ExampleAgent/2.0'
        };

        const runtimeConstants = createRuntimeConstants(config);

        expect(runtimeConstants.USER_AGENTS).toEqual(['ExampleAgent/1.0', 'ExampleAgent/2.0']);
    });
});
