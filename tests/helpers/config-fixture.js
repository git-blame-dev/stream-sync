'use strict';

function createSourcesConfigFixture(overrides = {}) {
    return {
        chatGroupName: 'statusbar chat grp',
        notificationGroupName: 'statusbar notification grp',
        fadeDelay: 750,
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
    createConfigFixture
};
