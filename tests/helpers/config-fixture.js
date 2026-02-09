'use strict';

const { ConfigValidator } = require('../../src/utils/config-validator');
const { buildConfig } = require('../../src/core/config-builders');

const RAW_TEST_CONFIG = {
    general: {
        debugEnabled: 'false',
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
        enabled: 'false',
        sourceName: 'test-handcam',
        glowFilterName: 'Glow',
        maxSize: '50',
        rampUpDuration: '0.5',
        holdDuration: '8.0',
        rampDownDuration: '0.5',
        totalSteps: '30',
        easingEnabled: 'true'
    },
    cooldowns: {
        defaultCooldown: '60',
        heavyCommandCooldown: '300',
        heavyCommandThreshold: '4',
        heavyCommandWindow: '360',
        maxEntries: '1000',
        cmdCooldown: '60',
        globalCmdCooldown: '60'
    },
    commands: {},
    tiktok: { enabled: 'false', viewerCountSource: 'test-tiktok-viewer-count' },
    twitch: { enabled: 'false', viewerCountSource: 'test-twitch-viewer-count' },
    youtube: { enabled: 'false', viewerCountSource: 'test-youtube-viewer-count' },
    http: {},
    spam: {
        enabled: 'true',
        detectionWindow: '60',
        maxIndividualNotifications: '5',
        lowValueThreshold: '10'
    }
};

function getRawTestConfig() {
    return JSON.parse(JSON.stringify(RAW_TEST_CONFIG));
}

function createSourcesConfigFixture(overrides = {}) {
    return {
        chatGroupName: 'test-chat-group',
        notificationGroupName: 'test-notification-group',
        fadeDelay: 750,
        ...overrides
    };
}

function createStreamElementsConfigFixture(overrides = {}) {
    return {
        enabled: true,
        dataLoggingEnabled: false,
        dataLoggingPath: './logs',
        ...overrides
    };
}

function createHandcamConfigFixture(overrides = {}) {
    return {
        enabled: true,
        sourceName: 'test-handcam-source',
        glowFilterName: 'test-glow-filter',
        maxSize: 50,
        rampUpDuration: 0.5,
        holdDuration: 8.0,
        rampDownDuration: 0.5,
        totalSteps: 30,
        easingEnabled: true,
        ...overrides
    };
}

function createTikTokConfigFixture(overrides = {}) {
    return {
        enabled: true,
        username: 'test-tiktok-user',
        dataLoggingEnabled: false,
        dataLoggingPath: './logs',
        ...overrides
    };
}

function createTwitchConfigFixture(overrides = {}) {
    return {
        enabled: true,
        username: 'test-twitch-user',
        channel: 'test-twitch-channel',
        clientId: 'test-client-id',
        broadcasterId: 'test-broadcaster-id',
        dataLoggingEnabled: false,
        dataLoggingPath: './logs',
        ...overrides
    };
}

function createYouTubeConfigFixture(overrides = {}) {
    return {
        enabled: true,
        username: 'test-youtube-channel',
        streamDetectionMethod: 'youtubei',
        dataLoggingEnabled: false,
        dataLoggingPath: './logs',
        ...overrides
    };
}

function applyInheritableOverrides(generalOverrides, platformConfig, platformOverrides) {
    if (!generalOverrides) return { ...platformConfig, ...platformOverrides };
    
    const inheritableFlags = Object.keys(ConfigValidator._parseInheritableFlags({}));
    const propagated = { ...platformConfig };
    
    for (const flag of inheritableFlags) {
        if (generalOverrides[flag] !== undefined) {
            propagated[flag] = generalOverrides[flag];
        }
    }

    if (Object.prototype.hasOwnProperty.call(platformConfig, 'sharesEnabled') && generalOverrides.sharesEnabled !== undefined) {
        propagated.sharesEnabled = generalOverrides.sharesEnabled;
    }
    
    return { ...propagated, ...platformOverrides };
}

function createConfigFixture(overrides = {}) {
    const normalized = ConfigValidator.normalize(getRawTestConfig());
    const base = buildConfig(normalized);
    
    const {
        general: generalOverrides,
        cooldowns: cooldownsOverrides,
        commands: commandsOverrides,
        obs: obsOverrides,
        timing: timingOverrides,
        spam: spamOverrides,
        http: httpOverrides,
        handcam: handcamOverrides,
        tiktok: tiktokOverrides,
        twitch: twitchOverrides,
        youtube: youtubeOverrides,
        ...restOverrides
    } = overrides;
    
    return {
        ...base,
        general: { ...base.general, ...generalOverrides },
        cooldowns: { ...base.cooldowns, ...cooldownsOverrides },
        commands: { ...base.commands, ...commandsOverrides },
        obs: { ...base.obs, ...obsOverrides },
        timing: { ...base.timing, ...timingOverrides },
        spam: { ...base.spam, ...spamOverrides },
        http: { ...base.http, ...httpOverrides },
        handcam: { ...base.handcam, ...handcamOverrides },
        tiktok: applyInheritableOverrides(generalOverrides, base.tiktok, tiktokOverrides),
        twitch: applyInheritableOverrides(generalOverrides, base.twitch, twitchOverrides),
        youtube: applyInheritableOverrides(generalOverrides, base.youtube, youtubeOverrides),
        ...restOverrides
    };
}

module.exports = {
    createSourcesConfigFixture,
    createStreamElementsConfigFixture,
    createHandcamConfigFixture,
    createTikTokConfigFixture,
    createTwitchConfigFixture,
    createYouTubeConfigFixture,
    createConfigFixture,
    getRawTestConfig
};
