'use strict';

const { DEFAULT_HTTP_USER_AGENTS, parseUserAgentList } = require('./http-config');
const { ConfigValidator } = require('../utils/config-validator');
const { DEFAULTS } = require('./config-defaults');

const DEFAULT_INNERTUBE_INSTANCE_TTL = 300000;
const DEFAULT_INNERTUBE_MIN_TTL = 60000;

function requireSection(config, sectionName) {
    if (!config || !config[sectionName]) {
        throw new Error(`Missing required configuration section: ${sectionName}`);
    }
    return config[sectionName];
}

function getSection(config, sectionName) {
    return (config && config[sectionName]) || {};
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
    const timingConfig = getSection(config, 'timing');
    requireSection(config, 'youtube');
    const handcamConfig = getSection(config, 'handcam');
    const cooldownConfig = getSection(config, 'cooldowns');
    requireSection(config, 'twitch');

    const chatPlatformLogos = buildPlatformLogoMap(obsConfig, 'chatPlatformLogo');
    const notificationPlatformLogos = buildPlatformLogoMap(obsConfig, 'notificationPlatformLogo');

    const viewerCountPollingIntervalSeconds = ConfigValidator.parseNumber(
        generalConfig.viewerCountPollingInterval,
        { defaultValue: DEFAULTS.general.viewerCountPollingInterval, min: 0 }
    );
    const httpConfig = config.http || {};
    const configuredUserAgents = parseUserAgentList(httpConfig.userAgents);
    const resolvedUserAgents = configuredUserAgents.length > 0
        ? configuredUserAgents
        : DEFAULT_HTTP_USER_AGENTS.slice();

    return {
        CHAT_PLATFORM_LOGOS: chatPlatformLogos,
        NOTIFICATION_PLATFORM_LOGOS: notificationPlatformLogos,
        STATUSBAR_GROUP_NAME: ConfigValidator.parseString(generalConfig.chatMsgGroup, ''),
        STATUSBAR_NOTIFICATION_GROUP_NAME: ConfigValidator.requireString(obsConfig.notificationMsgGroup, 'obs.notificationMsgGroup'),
        NOTIFICATION_CONFIG: {
            fadeDelay: ConfigValidator.parseNumber(timingConfig.fadeDuration, { defaultValue: DEFAULTS.timing.fadeDuration, min: 0 })
        },
        NOTIFICATION_CLEAR_DELAY: ConfigValidator.parseNumber(timingConfig.notificationClearDelay, { defaultValue: DEFAULTS.timing.notificationClearDelay, min: 0 }),
        CHAT_TRANSITION_DELAY: ConfigValidator.parseNumber(timingConfig.transitionDelay, { defaultValue: DEFAULTS.timing.transitionDelay, min: 0 }),
        CHAT_MESSAGE_DURATION: ConfigValidator.parseNumber(timingConfig.chatMessageDuration, { defaultValue: DEFAULTS.timing.chatMessageDuration, min: 0 }),
        OBS_CONNECTION_TIMEOUT: ConfigValidator.parseNumber(obsConfig.connectionTimeoutMs, { defaultValue: DEFAULTS.obs.connectionTimeoutMs, min: 1 }),
        PLATFORM_TIMEOUTS: {
            INNERTUBE_INSTANCE_TTL: DEFAULT_INNERTUBE_INSTANCE_TTL,
            INNERTUBE_MIN_TTL: DEFAULT_INNERTUBE_MIN_TTL
        },
        VIEWER_COUNT_POLLING_INTERVAL_SECONDS: viewerCountPollingIntervalSeconds,
        HANDCAM_GLOW_CONFIG: {
            ENABLED: ConfigValidator.parseBoolean(handcamConfig.glowEnabled, DEFAULTS.handcam.glowEnabled),
            SOURCE_NAME: ConfigValidator.parseString(handcamConfig.sourceName, DEFAULTS.handcam.sourceName),
            SCENE_NAME: ConfigValidator.parseString(handcamConfig.sceneName, DEFAULTS.handcam.sceneName),
            FILTER_NAME: ConfigValidator.parseString(handcamConfig.glowFilterName, DEFAULTS.handcam.glowFilterName),
            DEFAULT_MAX_SIZE: ConfigValidator.parseNumber(handcamConfig.maxSize, { defaultValue: DEFAULTS.handcam.maxSize, min: 1 }),
            DEFAULT_RAMP_UP_DURATION: ConfigValidator.parseNumber(handcamConfig.rampUpDuration, { defaultValue: DEFAULTS.handcam.rampUpDuration, min: 0 }),
            DEFAULT_HOLD_DURATION: ConfigValidator.parseNumber(handcamConfig.holdDuration, { defaultValue: DEFAULTS.handcam.holdDuration, min: 0 }),
            DEFAULT_RAMP_DOWN_DURATION: ConfigValidator.parseNumber(handcamConfig.rampDownDuration, { defaultValue: DEFAULTS.handcam.rampDownDuration, min: 0 }),
            DEFAULT_TOTAL_STEPS: ConfigValidator.parseNumber(handcamConfig.totalSteps, { defaultValue: DEFAULTS.handcam.totalSteps, min: 1, integer: true }),
            DEFAULT_INCREMENT_PERCENT: ConfigValidator.parseNumber(handcamConfig.incrementPercent, { defaultValue: DEFAULTS.handcam.incrementPercent, min: 0 }),
            DEFAULT_EASING_ENABLED: ConfigValidator.parseBoolean(handcamConfig.easingEnabled, DEFAULTS.handcam.easingEnabled),
            DEFAULT_ANIMATION_INTERVAL: ConfigValidator.parseNumber(handcamConfig.animationInterval, { defaultValue: DEFAULTS.handcam.animationInterval, min: 1 })
        },
        COOLDOWN_CONFIG: {
            DEFAULT_COOLDOWN: ConfigValidator.parseNumber(cooldownConfig.defaultCooldown, { defaultValue: DEFAULTS.cooldowns.defaultCooldown, min: 1 }) * 1000,
            HEAVY_COMMAND_COOLDOWN: ConfigValidator.parseNumber(cooldownConfig.heavyCommandCooldown, { defaultValue: DEFAULTS.cooldowns.heavyCommandCooldown, min: 1 }) * 1000,
            HEAVY_COMMAND_THRESHOLD: ConfigValidator.parseNumber(cooldownConfig.heavyCommandThreshold, { defaultValue: DEFAULTS.cooldowns.heavyCommandThreshold, min: 1, integer: true }),
            HEAVY_COMMAND_WINDOW: ConfigValidator.parseNumber(cooldownConfig.heavyCommandWindow, { defaultValue: DEFAULTS.cooldowns.heavyCommandWindow, min: 1 }) * 1000,
            MAX_COOLDOWN_ENTRIES: ConfigValidator.parseNumber(cooldownConfig.maxEntries, { defaultValue: DEFAULTS.cooldowns.maxEntries, min: 1, integer: true })
        },
        USER_AGENTS: resolvedUserAgents,
        MAX_MESSAGE_LENGTH: ConfigValidator.parseNumber(generalConfig.maxMessageLength, { defaultValue: 500, min: 1, integer: true })
    };
}

module.exports = {
    createRuntimeConstants
};
