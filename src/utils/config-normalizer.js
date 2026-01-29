const { DEFAULTS } = require('../core/config-defaults');
const { ConfigValidator } = require('./config-validator');
const { secrets } = require('../core/secrets');

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
        greetNewCommentors: ConfigValidator.parseBoolean(config.greetNewCommentors),
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

function validateRequiredKeys(config, requiredKeys, platformName = 'Platform') {
    const missing = requiredKeys.filter(key => !config[key]);

    if (missing.length > 0) {
        throw new Error(
            `${platformName} configuration missing required keys: ${missing.join(', ')}`
        );
    }
}

function validateYouTubeConfig(config) {
    if (!config || typeof config !== 'object') {
        return {
            isValid: false,
            errors: ['Configuration must be an object'],
            userMessage: 'Invalid YouTube configuration format'
        };
    }

    const errors = [];

    if (!config.username) {
        errors.push('Channel username required');
        return {
            isValid: false,
            errors,
            userMessage: 'YouTube channel username required for search-based stream detection'
        };
    }

    const validMethods = ['scraping', 'api', 'youtubei'];
    const method = config.streamDetectionMethod;

    if (!method) {
        errors.push('Stream detection method required');
        return {
            isValid: false,
            errors,
            userMessage: 'Stream detection method required. Use scraping, api, or youtubei.'
        };
    }

    if (!validMethods.includes(method)) {
        errors.push(`Invalid stream detection method: ${method}`);
        return {
            isValid: false,
            errors,
            userMessage: 'Invalid stream detection method. Use scraping, api, or youtubei.'
        };
    }

    if (method === 'api' && !secrets.youtube.apiKey) {
        errors.push('API key required for API-based detection');
        return {
            isValid: false,
            errors,
            userMessage: 'API key required for advanced stream detection methods'
        };
    }

    const normalizedConfig = normalizeYouTubeConfig(config);

    return {
        isValid: true,
        errors: [],
        streamDetectionMethod: normalizedConfig.streamDetectionMethod,
        userMessage: '',
        ...normalizedConfig
    };
}

module.exports = {
    normalizeYouTubeConfig,
    validateRequiredKeys,
    validateYouTubeConfig
};
