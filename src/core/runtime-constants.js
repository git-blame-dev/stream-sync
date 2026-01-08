'use strict';

const { DEFAULT_HTTP_USER_AGENTS, parseUserAgentList } = require('./http-config');

const DEFAULT_INNERTUBE_INSTANCE_TTL = 300000;
const DEFAULT_INNERTUBE_MIN_TTL = 60000;
function requireSection(config, sectionName) {
    if (!config || !config[sectionName]) {
        throw new Error(`Missing required configuration section: ${sectionName}`);
    }
    return config[sectionName];
}

function requireString(value, configPath, { allowEmpty = false } = {}) {
    if (value === undefined || value === null) {
        throw new Error(`Missing required configuration: ${configPath}`);
    }
    const normalized = String(value);
    if (!allowEmpty && normalized.trim().length === 0) {
        throw new Error(`Missing required configuration: ${configPath}`);
    }
    return normalized.trim();
}

function requireNumber(value, configPath, { min = 0, integer = false } = {}) {
    if (value === undefined || value === null || value === '') {
        throw new Error(`Missing required configuration: ${configPath}`);
    }
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        throw new Error(`Invalid configuration value for ${configPath}`);
    }
    if (parsed < min) {
        throw new Error(`Invalid configuration value for ${configPath}`);
    }
    if (integer && !Number.isInteger(parsed)) {
        throw new Error(`Invalid configuration value for ${configPath}`);
    }
    return parsed;
}

function requireBoolean(value, configPath) {
    if (value === undefined || value === null) {
        throw new Error(`Missing required configuration: ${configPath}`);
    }
    if (typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        const lowered = value.trim().toLowerCase();
        if (lowered === 'true') return true;
        if (lowered === 'false') return false;
    }
    throw new Error(`Invalid configuration value for ${configPath}`);
}

function parseDurationMs(value, configPath, { min = 0 } = {}) {
    const numeric = requireNumber(value, configPath, { min });
    return numeric;
}

function parseDurationSecondsToMs(value, configPath, { minSeconds = 0 } = {}) {
    const numeric = requireNumber(value, configPath, { min: minSeconds });
    return numeric * 1000;
}

function buildPlatformLogoMap(obsConfig, configPathPrefix) {
    return {
        twitch: requireString(obsConfig[`${configPathPrefix}Twitch`], `obs.${configPathPrefix}Twitch`),
        youtube: requireString(obsConfig[`${configPathPrefix}YouTube`], `obs.${configPathPrefix}YouTube`),
        tiktok: requireString(obsConfig[`${configPathPrefix}TikTok`], `obs.${configPathPrefix}TikTok`)
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

    const viewerCountPollingIntervalSeconds = requireNumber(
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
        STATUSBAR_GROUP_NAME: requireString(generalConfig.chatMsgGroup, 'general.chatMsgGroup', { allowEmpty: true }),
        STATUSBAR_NOTIFICATION_GROUP_NAME: requireString(obsConfig.notificationMsgGroup, 'obs.notificationMsgGroup'),
        NOTIFICATION_CONFIG: {
            fadeDelay: parseDurationMs(timingConfig.fadeDuration, 'timing.fadeDuration', { min: 0 })
        },
        NOTIFICATION_CLEAR_DELAY: parseDurationMs(timingConfig.notificationClearDelay, 'timing.notificationClearDelay', { min: 0 }),
        CHAT_TRANSITION_DELAY: parseDurationMs(timingConfig.transitionDelay, 'timing.transitionDelay', { min: 0 }),
        CHAT_MESSAGE_DURATION: parseDurationMs(timingConfig.chatMessageDuration, 'timing.chatMessageDuration', { min: 0 }),
        OBS_CONNECTION_TIMEOUT: parseDurationMs(obsConfig.connectionTimeoutMs, 'obs.connectionTimeoutMs', { min: 1 }),
        PLATFORM_TIMEOUTS: {
            INNERTUBE_INSTANCE_TTL: DEFAULT_INNERTUBE_INSTANCE_TTL,
            INNERTUBE_MIN_TTL: DEFAULT_INNERTUBE_MIN_TTL
        },
        VIEWER_COUNT_POLLING_INTERVAL_SECONDS: viewerCountPollingIntervalSeconds,
        HANDCAM_GLOW_CONFIG: {
            ENABLED: requireBoolean(handcamConfig.glowEnabled, 'handcam.glowEnabled'),
            SOURCE_NAME: requireString(handcamConfig.sourceName, 'handcam.sourceName'),
            SCENE_NAME: requireString(handcamConfig.sceneName, 'handcam.sceneName'),
            FILTER_NAME: requireString(handcamConfig.glowFilterName, 'handcam.glowFilterName'),
            DEFAULT_MAX_SIZE: requireNumber(handcamConfig.maxSize, 'handcam.maxSize', { min: 1 }),
            DEFAULT_RAMP_UP_DURATION: requireNumber(handcamConfig.rampUpDuration, 'handcam.rampUpDuration', { min: 0 }),
            DEFAULT_HOLD_DURATION: requireNumber(handcamConfig.holdDuration, 'handcam.holdDuration', { min: 0 }),
            DEFAULT_RAMP_DOWN_DURATION: requireNumber(handcamConfig.rampDownDuration, 'handcam.rampDownDuration', { min: 0 }),
            DEFAULT_TOTAL_STEPS: requireNumber(handcamConfig.totalSteps, 'handcam.totalSteps', { min: 1, integer: true }),
            DEFAULT_INCREMENT_PERCENT: requireNumber(handcamConfig.incrementPercent, 'handcam.incrementPercent', { min: 0 }),
            DEFAULT_EASING_ENABLED: requireBoolean(handcamConfig.easingEnabled, 'handcam.easingEnabled'),
            DEFAULT_ANIMATION_INTERVAL: requireNumber(handcamConfig.animationInterval, 'handcam.animationInterval', { min: 1 })
        },
        COOLDOWN_CONFIG: {
            DEFAULT_COOLDOWN: parseDurationSecondsToMs(cooldownConfig.defaultCooldown, 'cooldowns.defaultCooldown', { minSeconds: 1 }),
            HEAVY_COMMAND_COOLDOWN: parseDurationSecondsToMs(cooldownConfig.heavyCommandCooldown, 'cooldowns.heavyCommandCooldown', { minSeconds: 1 }),
            HEAVY_COMMAND_THRESHOLD: requireNumber(cooldownConfig.heavyCommandThreshold, 'cooldowns.heavyCommandThreshold', { min: 1, integer: true }),
            HEAVY_COMMAND_WINDOW: parseDurationSecondsToMs(cooldownConfig.heavyCommandWindow, 'cooldowns.heavyCommandWindow', { minSeconds: 1 }),
            MAX_COOLDOWN_ENTRIES: requireNumber(cooldownConfig.maxEntries, 'cooldowns.maxEntries', { min: 1, integer: true })
        },
        USER_AGENTS: resolvedUserAgents,
        MAX_MESSAGE_LENGTH: requireNumber(generalConfig.maxMessageLength, 'general.maxMessageLength', { min: 1, integer: true })
    };
}

module.exports = {
    createRuntimeConstants
};
