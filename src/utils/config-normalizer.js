const { DEFAULTS } = require('../core/config-defaults');
const { ConfigValidator } = require('./config-validator');

const dropUndefinedValues = (valueMap) => Object.fromEntries(
    Object.entries(valueMap).filter(([, value]) => value !== undefined)
);

function normalizeYouTubeConfig(config) {
    if (!config) return config;

    const snakeCaseKeys = Object.keys(config).filter((key) => key.includes('_'));
    if (snakeCaseKeys.length > 0) {
        const overrideSuggestions = {
            channel_id: 'username',
            enable_api: 'enableAPI'
        };
        const toCamelCase = (value) => value.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase());
        const suggestions = snakeCaseKeys.map((key) => {
            const suggested = overrideSuggestions[key] || toCamelCase(key);
            return `${key} -> ${suggested}`;
        });
        throw new Error(`YouTube config must use camelCase keys. Update: ${suggestions.join(', ')}`);
    }

    const dataLoggingEnabled = ConfigValidator.parseBoolean(config.dataLoggingEnabled);
    const retryAttempts = ConfigValidator.parseNumber(config.retryAttempts, { min: 1 });
    const streamPollingInterval = ConfigValidator.parseNumber(config.streamPollingInterval, { min: 1 });
    const fullCheckInterval = ConfigValidator.parseNumber(config.fullCheckInterval, { min: 1 });
    const maxStreams = ConfigValidator.parseNumber(config.maxStreams, { min: 0 });

    const normalized = {
        enabled: ConfigValidator.parseBoolean(config.enabled),
        username: config.username,
        enableAPI: ConfigValidator.parseBoolean(config.enableAPI),
        streamDetectionMethod: config.streamDetectionMethod,
        viewerCountMethod: config.viewerCountMethod,
        viewerCountEnabled: ConfigValidator.parseBoolean(config.viewerCountEnabled),
        viewerCountSource: config.viewerCountSource,
        messagesEnabled: ConfigValidator.parseBoolean(config.messagesEnabled),
        commandsEnabled: ConfigValidator.parseBoolean(config.commandsEnabled),
        greetingsEnabled: ConfigValidator.parseBoolean(config.greetingsEnabled),
        farewellsEnabled: ConfigValidator.parseBoolean(config.farewellsEnabled),
        followsEnabled: ConfigValidator.parseBoolean(config.followsEnabled),
        giftsEnabled: ConfigValidator.parseBoolean(config.giftsEnabled),
        raidsEnabled: ConfigValidator.parseBoolean(config.raidsEnabled),
        paypiggiesEnabled: ConfigValidator.parseBoolean(config.paypiggiesEnabled),
        ignoreSelfMessages: ConfigValidator.parseBoolean(config.ignoreSelfMessages),
        pollInterval: ConfigValidator.parseNumber(config.pollInterval, { min: 1 }),
        dataLoggingEnabled: dataLoggingEnabled ?? DEFAULTS.youtube.dataLoggingEnabled,
        dataLoggingPath: DEFAULTS.LOG_DIRECTORY,
        retryAttempts: retryAttempts ?? DEFAULTS.youtube.retryAttempts,
        streamPollingInterval: streamPollingInterval ?? DEFAULTS.youtube.streamPollingInterval,
        fullCheckInterval: fullCheckInterval ?? DEFAULTS.youtube.fullCheckInterval,
        maxStreams: maxStreams ?? DEFAULTS.youtube.maxStreams
    };

    return dropUndefinedValues(normalized);
}

module.exports = {
    normalizeYouTubeConfig
};
