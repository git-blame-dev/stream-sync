
const normalizeOptionalBoolean = (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') {
        const lowerValue = value.toLowerCase();
        if (lowerValue === 'true') return true;
        if (lowerValue === 'false') return false;
    }
    return undefined;
};

const normalizeOptionalNumber = (value, { min } = {}) => {
    if (value === undefined || value === null) return undefined;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return undefined;
    if (typeof min === 'number' && parsed < min) return undefined;
    return parsed;
};

const dropUndefinedValues = (valueMap) => Object.fromEntries(
    Object.entries(valueMap).filter(([, value]) => value !== undefined)
);

const DEFAULT_LOG_DIRECTORY = './logs';

const DEFAULT_YOUTUBE_CONFIG = {
    retryAttempts: 3,
    maxStreams: 5,
    streamPollingInterval: 60,
    fullCheckInterval: 300000,
    dataLoggingEnabled: false,
    dataLoggingPath: DEFAULT_LOG_DIRECTORY
};

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
    
    const dataLoggingEnabled = normalizeOptionalBoolean(config.dataLoggingEnabled);
    const retryAttempts = normalizeOptionalNumber(config.retryAttempts, { min: 1 });
    const streamPollingInterval = normalizeOptionalNumber(config.streamPollingInterval, { min: 1 });
    const fullCheckInterval = normalizeOptionalNumber(config.fullCheckInterval, { min: 1 });
    const maxStreams = normalizeOptionalNumber(config.maxStreams, { min: 0 });
    const normalized = {
        enabled: normalizeOptionalBoolean(config.enabled),
        username: config.username,
        apiKey: config.apiKey,
        enableAPI: normalizeOptionalBoolean(config.enableAPI),
        streamDetectionMethod: config.streamDetectionMethod,
        viewerCountMethod: config.viewerCountMethod,
        viewerCountEnabled: normalizeOptionalBoolean(config.viewerCountEnabled),
        viewerCountSource: config.viewerCountSource,
        messagesEnabled: normalizeOptionalBoolean(config.messagesEnabled),
        commandsEnabled: normalizeOptionalBoolean(config.commandsEnabled),
        greetingsEnabled: normalizeOptionalBoolean(config.greetingsEnabled),
        farewellsEnabled: normalizeOptionalBoolean(config.farewellsEnabled),
        followsEnabled: normalizeOptionalBoolean(config.followsEnabled),
        giftsEnabled: normalizeOptionalBoolean(config.giftsEnabled),
        raidsEnabled: normalizeOptionalBoolean(config.raidsEnabled),
        paypiggiesEnabled: normalizeOptionalBoolean(config.paypiggiesEnabled),
        greetNewCommentors: normalizeOptionalBoolean(config.greetNewCommentors),
        ignoreSelfMessages: normalizeOptionalBoolean(config.ignoreSelfMessages),
        pollInterval: normalizeOptionalNumber(config.pollInterval, { min: 1 }),
        dataLoggingEnabled: dataLoggingEnabled ?? DEFAULT_YOUTUBE_CONFIG.dataLoggingEnabled,
        dataLoggingPath: DEFAULT_LOG_DIRECTORY,
        retryAttempts: retryAttempts ?? DEFAULT_YOUTUBE_CONFIG.retryAttempts,
        streamPollingInterval: streamPollingInterval ?? DEFAULT_YOUTUBE_CONFIG.streamPollingInterval,
        fullCheckInterval: fullCheckInterval ?? DEFAULT_YOUTUBE_CONFIG.fullCheckInterval,
        maxStreams: maxStreams ?? DEFAULT_YOUTUBE_CONFIG.maxStreams
    };

    return dropUndefinedValues(normalized);
}

function normalizeTwitchConfig(config) {
    if (!config) return config;
    
    const normalized = {
        enabled: normalizeOptionalBoolean(config.enabled),
        username: config.username,
        channel: config.channel,
        clientId: config.clientId,
        tokenStorePath: config.tokenStorePath,
        tokenExpiresAt: config.tokenExpiresAt,
        eventsub_enabled: normalizeOptionalBoolean(config.eventsub_enabled),
        dataLoggingEnabled: normalizeOptionalBoolean(config.dataLoggingEnabled),
        dataLoggingPath: DEFAULT_LOG_DIRECTORY,
        viewerCountEnabled: normalizeOptionalBoolean(config.viewerCountEnabled),
        viewerCountSource: config.viewerCountSource,
        messagesEnabled: normalizeOptionalBoolean(config.messagesEnabled),
        commandsEnabled: normalizeOptionalBoolean(config.commandsEnabled),
        greetingsEnabled: normalizeOptionalBoolean(config.greetingsEnabled),
        farewellsEnabled: normalizeOptionalBoolean(config.farewellsEnabled),
        followsEnabled: normalizeOptionalBoolean(config.followsEnabled),
        giftsEnabled: normalizeOptionalBoolean(config.giftsEnabled),
        raidsEnabled: normalizeOptionalBoolean(config.raidsEnabled),
        paypiggiesEnabled: normalizeOptionalBoolean(config.paypiggiesEnabled),
        greetNewCommentors: normalizeOptionalBoolean(config.greetNewCommentors),
        ignoreSelfMessages: normalizeOptionalBoolean(config.ignoreSelfMessages),
        pollInterval: normalizeOptionalNumber(config.pollInterval, { min: 1 })
    };

    return dropUndefinedValues(normalized);
}

function normalizeTikTokConfig(config) {
    if (!config) return config;
    
    const normalized = {
        enabled: normalizeOptionalBoolean(config.enabled),
        username: config.username,
        apiKey: config.apiKey,
        viewerCountEnabled: normalizeOptionalBoolean(config.viewerCountEnabled),
        viewerCountSource: config.viewerCountSource,
        greetingsEnabled: normalizeOptionalBoolean(config.greetingsEnabled),
        giftAggregationEnabled: normalizeOptionalBoolean(config.giftAggregationEnabled),
        dataLoggingEnabled: normalizeOptionalBoolean(config.dataLoggingEnabled),
        dataLoggingPath: DEFAULT_LOG_DIRECTORY,
        messagesEnabled: normalizeOptionalBoolean(config.messagesEnabled),
        commandsEnabled: normalizeOptionalBoolean(config.commandsEnabled),
        farewellsEnabled: normalizeOptionalBoolean(config.farewellsEnabled),
        followsEnabled: normalizeOptionalBoolean(config.followsEnabled),
        giftsEnabled: normalizeOptionalBoolean(config.giftsEnabled),
        raidsEnabled: normalizeOptionalBoolean(config.raidsEnabled),
        paypiggiesEnabled: normalizeOptionalBoolean(config.paypiggiesEnabled),
        greetNewCommentors: normalizeOptionalBoolean(config.greetNewCommentors),
        ignoreSelfMessages: normalizeOptionalBoolean(config.ignoreSelfMessages),
        pollInterval: normalizeOptionalNumber(config.pollInterval, { min: 1 })
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
    
    // Validate username (channelId no longer required)
    if (!config.username) {
        errors.push('Channel username required');
        return {
            isValid: false,
            errors,
            userMessage: 'YouTube channel username required for search-based stream detection'
        };
    }

    // Validate streamDetectionMethod
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

    // Validate API key if using API methods
    if (method === 'api' && !config.apiKey) {
        errors.push('API key required for API-based detection');
        return {
            isValid: false,
            errors,
            userMessage: 'API key required for advanced stream detection methods'
        };
    }

    // Normalize and return valid config
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
    normalizeTwitchConfig,
    normalizeTikTokConfig,
    validateRequiredKeys,
    validateYouTubeConfig,
    DEFAULT_YOUTUBE_CONFIG
};
