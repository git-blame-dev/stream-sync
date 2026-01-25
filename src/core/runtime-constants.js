'use strict';

const { DEFAULT_HTTP_USER_AGENTS, parseUserAgentList } = require('./http-config');
const { ConfigValidator } = require('../utils/config-validator');

const DEFAULT_INNERTUBE_INSTANCE_TTL = 300000;
const DEFAULT_INNERTUBE_MIN_TTL = 60000;

function requireSection(config, sectionName) {
    if (!config || !config[sectionName]) {
        throw new Error(`Missing required configuration section: ${sectionName}`);
    }
    return config[sectionName];
}

function buildPlatformLogoMap(obsConfig, configPathPrefix) {
    return {
        twitch: ConfigValidator.requireString(obsConfig[`${configPathPrefix}Twitch`], `obs.${configPathPrefix}Twitch`),
        youtube: ConfigValidator.requireString(obsConfig[`${configPathPrefix}YouTube`], `obs.${configPathPrefix}YouTube`),
        tiktok: ConfigValidator.requireString(obsConfig[`${configPathPrefix}TikTok`], `obs.${configPathPrefix}TikTok`)
    };
}

function createRuntimeConstants(rawConfig) {
    const config = rawConfig || {};
    const generalConfig = requireSection(config, 'general');
    const obsConfig = requireSection(config, 'obs');
    const timingConfig = requireSection(config, 'timing');
    requireSection(config, 'youtube');
    const handcamConfig = requireSection(config, 'handcam');
    const cooldownConfig = requireSection(config, 'cooldowns');
    requireSection(config, 'twitch');

    const chatPlatformLogos = buildPlatformLogoMap(obsConfig, 'chatPlatformLogo');
    const notificationPlatformLogos = buildPlatformLogoMap(obsConfig, 'notificationPlatformLogo');

    const viewerCountPollingIntervalSeconds = ConfigValidator.requireNumber(
        generalConfig.viewerCountPollingInterval,
        'general.viewerCountPollingInterval',
        { min: 0 }
    );
    const httpConfig = config.http || {};
    const configuredUserAgents = parseUserAgentList(httpConfig.userAgents);
    const resolvedUserAgents = configuredUserAgents.length > 0
        ? configuredUserAgents
        : DEFAULT_HTTP_USER_AGENTS.slice();

    return {
        CHAT_PLATFORM_LOGOS: chatPlatformLogos,
        NOTIFICATION_PLATFORM_LOGOS: notificationPlatformLogos,
        STATUSBAR_GROUP_NAME: ConfigValidator.requireString(generalConfig.chatMsgGroup, 'general.chatMsgGroup', { allowEmpty: true }),
        STATUSBAR_NOTIFICATION_GROUP_NAME: ConfigValidator.requireString(obsConfig.notificationMsgGroup, 'obs.notificationMsgGroup'),
        NOTIFICATION_CONFIG: {
            fadeDelay: ConfigValidator.requireNumber(timingConfig.fadeDuration, 'timing.fadeDuration', { min: 0 })
        },
        NOTIFICATION_CLEAR_DELAY: ConfigValidator.requireNumber(timingConfig.notificationClearDelay, 'timing.notificationClearDelay', { min: 0 }),
        CHAT_TRANSITION_DELAY: ConfigValidator.requireNumber(timingConfig.transitionDelay, 'timing.transitionDelay', { min: 0 }),
        CHAT_MESSAGE_DURATION: ConfigValidator.requireNumber(timingConfig.chatMessageDuration, 'timing.chatMessageDuration', { min: 0 }),
        OBS_CONNECTION_TIMEOUT: ConfigValidator.requireNumber(obsConfig.connectionTimeoutMs, 'obs.connectionTimeoutMs', { min: 1 }),
        PLATFORM_TIMEOUTS: {
            INNERTUBE_INSTANCE_TTL: DEFAULT_INNERTUBE_INSTANCE_TTL,
            INNERTUBE_MIN_TTL: DEFAULT_INNERTUBE_MIN_TTL
        },
        VIEWER_COUNT_POLLING_INTERVAL_SECONDS: viewerCountPollingIntervalSeconds,
        HANDCAM_GLOW_CONFIG: {
            ENABLED: ConfigValidator.requireBoolean(handcamConfig.glowEnabled, 'handcam.glowEnabled'),
            SOURCE_NAME: ConfigValidator.requireString(handcamConfig.sourceName, 'handcam.sourceName'),
            SCENE_NAME: ConfigValidator.requireString(handcamConfig.sceneName, 'handcam.sceneName'),
            FILTER_NAME: ConfigValidator.requireString(handcamConfig.glowFilterName, 'handcam.glowFilterName'),
            DEFAULT_MAX_SIZE: ConfigValidator.requireNumber(handcamConfig.maxSize, 'handcam.maxSize', { min: 1 }),
            DEFAULT_RAMP_UP_DURATION: ConfigValidator.requireNumber(handcamConfig.rampUpDuration, 'handcam.rampUpDuration', { min: 0 }),
            DEFAULT_HOLD_DURATION: ConfigValidator.requireNumber(handcamConfig.holdDuration, 'handcam.holdDuration', { min: 0 }),
            DEFAULT_RAMP_DOWN_DURATION: ConfigValidator.requireNumber(handcamConfig.rampDownDuration, 'handcam.rampDownDuration', { min: 0 }),
            DEFAULT_TOTAL_STEPS: ConfigValidator.requireNumber(handcamConfig.totalSteps, 'handcam.totalSteps', { min: 1, integer: true }),
            DEFAULT_INCREMENT_PERCENT: ConfigValidator.requireNumber(handcamConfig.incrementPercent, 'handcam.incrementPercent', { min: 0 }),
            DEFAULT_EASING_ENABLED: ConfigValidator.requireBoolean(handcamConfig.easingEnabled, 'handcam.easingEnabled'),
            DEFAULT_ANIMATION_INTERVAL: ConfigValidator.requireNumber(handcamConfig.animationInterval, 'handcam.animationInterval', { min: 1 })
        },
        COOLDOWN_CONFIG: {
            DEFAULT_COOLDOWN: ConfigValidator.requireNumber(cooldownConfig.defaultCooldown, 'cooldowns.defaultCooldown', { min: 1 }) * 1000,
            HEAVY_COMMAND_COOLDOWN: ConfigValidator.requireNumber(cooldownConfig.heavyCommandCooldown, 'cooldowns.heavyCommandCooldown', { min: 1 }) * 1000,
            HEAVY_COMMAND_THRESHOLD: ConfigValidator.requireNumber(cooldownConfig.heavyCommandThreshold, 'cooldowns.heavyCommandThreshold', { min: 1, integer: true }),
            HEAVY_COMMAND_WINDOW: ConfigValidator.requireNumber(cooldownConfig.heavyCommandWindow, 'cooldowns.heavyCommandWindow', { min: 1 }) * 1000,
            MAX_COOLDOWN_ENTRIES: ConfigValidator.requireNumber(cooldownConfig.maxEntries, 'cooldowns.maxEntries', { min: 1, integer: true })
        },
        USER_AGENTS: resolvedUserAgents,
        MAX_MESSAGE_LENGTH: ConfigValidator.requireNumber(generalConfig.maxMessageLength, 'general.maxMessageLength', { min: 1, integer: true })
    };
}

module.exports = {
    createRuntimeConstants
};
