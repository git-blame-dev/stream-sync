const { DEFAULTS } = require('../../../core/config-defaults');

function normalizeTikTokPlatformConfig(rawConfig = {}, configValidator) {
    const safeConfig = (rawConfig && typeof rawConfig === 'object') ? rawConfig : {};
    const trimToUndefined = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

    if (!configValidator) {
        throw new Error('configValidator is required to normalize TikTok platform config');
    }

    const apiKey = trimToUndefined(configValidator.parseString(safeConfig.apiKey, undefined));

    return {
        enabled: configValidator.parseBoolean(safeConfig.enabled, DEFAULTS.tiktok.enabled),
        username: configValidator.parseString(safeConfig.username, ''),
        apiKey,
        viewerCountEnabled: configValidator.parseBoolean(safeConfig.viewerCountEnabled, DEFAULTS.tiktok.viewerCountEnabled),
        viewerCountSource: configValidator.parseString(safeConfig.viewerCountSource, DEFAULTS.tiktok.viewerCountSource),
        greetingsEnabled: configValidator.parseBoolean(safeConfig.greetingsEnabled, DEFAULTS.tiktok.greetingsEnabled),
        giftAggregationEnabled: configValidator.parseBoolean(safeConfig.giftAggregationEnabled, DEFAULTS.tiktok.giftAggregationEnabled),
        dataLoggingEnabled: configValidator.parseBoolean(safeConfig.dataLoggingEnabled, DEFAULTS.tiktok.dataLoggingEnabled),
        dataLoggingPath: DEFAULTS.LOG_DIRECTORY
    };
}

function validateTikTokPlatformConfig(config = {}) {
    const errors = [];

    if (!config.username) {
        errors.push('Username is required');
    }

    const isValid = errors.length === 0;

    return {
        isValid,
        valid: isValid,
        errors,
        warnings: []
    };
}

module.exports = {
    normalizeTikTokPlatformConfig,
    validateTikTokPlatformConfig
};
