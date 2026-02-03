const { DEFAULTS } = require('../../../core/config-defaults');
const { ConfigValidator } = require('../../../utils/config-validator');

function normalizeTikTokPlatformConfig(rawConfig = {}) {
    const safeConfig = (rawConfig && typeof rawConfig === 'object') ? rawConfig : {};

    return {
        enabled: ConfigValidator.parseBoolean(safeConfig.enabled, DEFAULTS.tiktok.enabled),
        username: ConfigValidator.parseString(safeConfig.username, ''),
        viewerCountEnabled: ConfigValidator.parseBoolean(safeConfig.viewerCountEnabled, DEFAULTS.tiktok.viewerCountEnabled),
        viewerCountSource: ConfigValidator.parseString(safeConfig.viewerCountSource, null),
        greetingsEnabled: ConfigValidator.parseBoolean(safeConfig.greetingsEnabled, DEFAULTS.general.greetingsEnabled),
        giftAggregationEnabled: ConfigValidator.parseBoolean(safeConfig.giftAggregationEnabled, DEFAULTS.tiktok.giftAggregationEnabled),
        dataLoggingEnabled: ConfigValidator.parseBoolean(safeConfig.dataLoggingEnabled, DEFAULTS.tiktok.dataLoggingEnabled),
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
