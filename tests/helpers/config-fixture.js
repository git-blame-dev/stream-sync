'use strict';

function createSourcesConfigFixture(overrides = {}) {
    return {
        chatGroupName: 'statusbar chat grp',
        notificationGroupName: 'statusbar notification grp',
        fadeDelay: 750,
        ...overrides
    };
}

function createStreamElementsConfigFixture(overrides = {}) {
    return {
        enabled: false,
        dataLoggingEnabled: false,
        dataLoggingPath: './logs',
        ...overrides
    };
}

function createHandcamConfigFixture(overrides = {}) {
    return {
        enabled: false,
        sourceName: 'test-handcam-source',
        sceneName: 'test-handcam-scene',
        glowFilterName: 'Glow',
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

function createConfigFixture(overrides = {}) {
    const { general: generalOverrides, cooldowns: cooldownsOverrides, ...restOverrides } = overrides;
    return {
        general: {
            maxMessageLength: 500,
            viewerCountPollingIntervalMs: 30000,
            ...(generalOverrides || {})
        },
        cooldowns: {
            defaultCooldownMs: 60000,
            heavyCommandCooldownMs: 300000,
            heavyCommandThreshold: 4,
            heavyCommandWindowMs: 360000,
            maxEntries: 1000,
            ...(cooldownsOverrides || {})
        },
        ...restOverrides
    };
}

module.exports = {
    createSourcesConfigFixture,
    createStreamElementsConfigFixture,
    createHandcamConfigFixture,
    createConfigFixture
};
