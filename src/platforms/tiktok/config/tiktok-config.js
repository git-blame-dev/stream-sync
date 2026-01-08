function normalizeTikTokPlatformConfig(rawConfig = {}, configValidator) {
    const safeConfig = (rawConfig && typeof rawConfig === 'object') ? rawConfig : {};
    const trimToUndefined = (value) => (typeof value === 'string' && value.trim() ? value.trim() : undefined);

    if (!configValidator) {
        throw new Error('configValidator is required to normalize TikTok platform config');
    }

    const apiKey = trimToUndefined(configValidator.parseString(safeConfig.apiKey, undefined));

    return {
        enabled: configValidator.parseBoolean(safeConfig.enabled, false),
        username: configValidator.parseString(safeConfig.username, ''),
        apiKey,
        viewerCountEnabled: configValidator.parseBoolean(safeConfig.viewerCountEnabled, true),
        viewerCountSource: configValidator.parseString(safeConfig.viewerCountSource, 'websocket'),
        greetingsEnabled: configValidator.parseBoolean(safeConfig.greetingsEnabled, true),
        giftAggregationEnabled: configValidator.parseBoolean(safeConfig.giftAggregationEnabled, true),
        dataLoggingEnabled: configValidator.parseBoolean(safeConfig.dataLoggingEnabled, false),
        dataLoggingPath: configValidator.parseString(safeConfig.dataLoggingPath, './logs'),
        giftLoggingEnabled: configValidator.parseBoolean(safeConfig.giftLoggingEnabled, false),
        giftLoggingPath: configValidator.parseString(safeConfig.giftLoggingPath, './logs')
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
