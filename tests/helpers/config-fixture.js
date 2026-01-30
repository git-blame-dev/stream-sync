'use strict';

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
        sceneName: 'test-handcam-scene',
        glowFilterName: 'test-glow-filter',
        maxSize: 50,
        rampUpDuration: 0.5,
        holdDuration: 6.0,
        rampDownDuration: 0.5,
        totalSteps: 30,
        incrementPercent: 3.33,
        easingEnabled: true,
        animationInterval: 16,
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

function createConfigFixture(overrides = {}) {
    const {
        general: generalOverrides,
        cooldowns: cooldownsOverrides,
        tts: ttsOverrides,
        commands: commandsOverrides,
        obs: obsOverrides,
        timing: timingOverrides,
        monitoring: monitoringOverrides,
        ...restOverrides
    } = overrides;
    return {
        general: {
            maxMessageLength: 500,
            viewerCountPollingIntervalMs: 30000,
            debugEnabled: false,
            ttsEnabled: false,
            messagesEnabled: true,
            commandsEnabled: true,
            greetingsEnabled: true,
            farewellsEnabled: true,
            followsEnabled: true,
            giftsEnabled: true,
            raidsEnabled: true,
            sharesEnabled: true,
            paypiggiesEnabled: true,
            userSuppressionEnabled: false,
            maxNotificationsPerUser: 5,
            suppressionWindowMs: 60000,
            suppressionDurationMs: 300000,
            suppressionCleanupIntervalMs: 300000,
            streamDetectionEnabled: false,
            streamRetryInterval: 15,
            streamMaxRetries: 3,
            continuousMonitoringInterval: 60,
            ...generalOverrides
        },
        cooldowns: {
            defaultCooldownMs: 60000,
            heavyCommandCooldownMs: 300000,
            heavyCommandThreshold: 4,
            heavyCommandWindowMs: 360000,
            maxEntries: 1000,
            ...cooldownsOverrides
        },
        tts: {
            enabled: false,
            deduplicationEnabled: true,
            debugDeduplication: false,
            onlyForGifts: false,
            voice: 'default',
            rate: 1,
            volume: 1,
            ...ttsOverrides
        },
        commands: {
            enabled: false,
            ...commandsOverrides
        },
        obs: {
            notificationTxt: 'test-notification-text',
            notificationScene: 'test-notification-scene',
            notificationMsgGroup: 'test-notification-group',
            ...obsOverrides
        },
        timing: {
            greetingDuration: 3000,
            commandDuration: 3000,
            chatDuration: 3000,
            notificationDuration: 3000,
            ...timingOverrides
        },
        monitoring: {
            ...monitoringOverrides
        },
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
    createConfigFixture
};
