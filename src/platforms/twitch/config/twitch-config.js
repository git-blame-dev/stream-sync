const { ConfigValidator } = require('../../../utils/config-validator');
const { DEFAULTS } = require('../../../core/config-defaults');

const dropUndefinedValues = (valueMap) => Object.fromEntries(
    Object.entries(valueMap).filter(([, value]) => value !== undefined)
);

const TWITCH_CONFIG_VALIDATION_RULES = {
    required: {
        enabled: { type: 'boolean', message: 'Platform must be enabled' },
        username: { type: 'string', message: 'Username is required for Twitch authentication' },
        channel: { type: 'string', message: 'Channel name is required for Twitch chat connection' },
        clientId: { type: 'string', message: 'Client ID is required for Twitch authentication' }
    },
    optional: {
        eventsubEnabled: { type: 'boolean', default: true, message: 'EventSub configuration' },
        dataLoggingEnabled: { type: 'boolean', default: false, message: 'Data logging configuration' }
    }
};

function normalizeTwitchPlatformConfig(rawConfig = {}) {
    const normalized = {
        enabled: ConfigValidator.parseBoolean(rawConfig.enabled, DEFAULTS.twitch.enabled),
        username: rawConfig.username,
        channel: rawConfig.channel,
        clientId: rawConfig.clientId,
        tokenStorePath: rawConfig.tokenStorePath,
        eventsubEnabled: ConfigValidator.parseBoolean(rawConfig.eventsubEnabled, DEFAULTS.twitch.eventsubEnabled),
        dataLoggingEnabled: ConfigValidator.parseBoolean(rawConfig.dataLoggingEnabled, DEFAULTS.twitch.dataLoggingEnabled),
        dataLoggingPath: DEFAULTS.LOG_DIRECTORY,
        viewerCountEnabled: ConfigValidator.parseBoolean(rawConfig.viewerCountEnabled),
        viewerCountSource: rawConfig.viewerCountSource,
        messagesEnabled: ConfigValidator.parseBoolean(rawConfig.messagesEnabled),
        commandsEnabled: ConfigValidator.parseBoolean(rawConfig.commandsEnabled),
        greetingsEnabled: ConfigValidator.parseBoolean(rawConfig.greetingsEnabled),
        farewellsEnabled: ConfigValidator.parseBoolean(rawConfig.farewellsEnabled),
        followsEnabled: ConfigValidator.parseBoolean(rawConfig.followsEnabled),
        giftsEnabled: ConfigValidator.parseBoolean(rawConfig.giftsEnabled),
        raidsEnabled: ConfigValidator.parseBoolean(rawConfig.raidsEnabled),
        paypiggiesEnabled: ConfigValidator.parseBoolean(rawConfig.paypiggiesEnabled),
        greetNewCommentors: ConfigValidator.parseBoolean(rawConfig.greetNewCommentors),
        ignoreSelfMessages: ConfigValidator.parseBoolean(rawConfig.ignoreSelfMessages),
        pollInterval: ConfigValidator.parseNumber(rawConfig.pollInterval, { min: 1 })
    };

    return dropUndefinedValues(normalized);
}

function validateTwitchPlatformConfig(options = {}) {
    const { config = {}, twitchAuth } = options;
    const validation = validatePlatformConfig(config, TWITCH_CONFIG_VALIDATION_RULES);

    const errors = [...validation.errors];
    const warnings = [...validation.warnings];
    const authReady = twitchAuth?.isReady?.();

    if (!twitchAuth) {
        errors.push('twitchAuth: TwitchPlatform requires an injected twitchAuth');
    } else if (config.enabled && !authReady) {
        warnings.push('twitchAuth: expected ready auth but found not ready');
    }

    return {
        ...validation,
        isValid: errors.length === 0,
        errors,
        warnings,
        authReady
    };
}

function validatePlatformConfig(config, validationConfig) {
    const errors = [];
    const warnings = [];
    const details = {};

    Object.entries(validationConfig.required || {}).forEach(([field, rules]) => {
        const value = config[field];
        const fieldValidation = validateConfigField(field, value, rules, true);

        if (!fieldValidation.isValid) {
            errors.push(fieldValidation.error);
        }
        details[field] = fieldValidation;
    });

    Object.entries(validationConfig.optional || {}).forEach(([field, rules]) => {
        const value = config[field];
        const fieldValidation = validateConfigField(field, value, rules, false);

        if (!fieldValidation.isValid && fieldValidation.hasValue) {
            warnings.push(fieldValidation.error);
        }
        details[field] = fieldValidation;
    });

    return {
        isValid: errors.length === 0,
        errors,
        warnings,
        details,
        platform: 'twitch',
        configuredFields: Object.keys(config).length,
        validatedAt: new Date().toISOString()
    };
}

function validateConfigField(field, value, rules, isRequired) {
    const hasValue = value !== undefined && value !== null;

    if (isRequired && !hasValue) {
        return {
            isValid: false,
            hasValue: false,
            error: `${field}: ${rules.message || 'This field is required'}`,
            type: rules.type,
            value: value
        };
    }

    if (!isRequired && !hasValue) {
        return {
            isValid: true,
            hasValue: false,
            type: rules.type,
            defaultValue: rules.default,
            value: value
        };
    }

    const expectedType = rules.type;
    const actualType = typeof value;

    if (expectedType && actualType !== expectedType) {
        if (expectedType === 'boolean' && actualType === 'string') {
            const normalizedValue = value.toLowerCase();
            if (normalizedValue === 'true' || normalizedValue === 'false') {
                return {
                    isValid: true,
                    hasValue: true,
                    type: expectedType,
                    value: normalizedValue === 'true',
                    normalized: true
                };
            }
        }

        return {
            isValid: false,
            hasValue: true,
            error: `${field}: Expected ${expectedType} but got ${actualType}. ${rules.message || ''}`,
            type: expectedType,
            actualType: actualType,
            value: value
        };
    }

    if (expectedType === 'string' && typeof value === 'string' && value.trim().length === 0) {
        return {
            isValid: false,
            hasValue: true,
            error: `${field}: Cannot be empty. ${rules.message || ''}`,
            type: expectedType,
            value: value
        };
    }

    return {
        isValid: true,
        hasValue: true,
        type: expectedType,
        value: value
    };
}

module.exports = {
    normalizeTwitchPlatformConfig,
    validateTwitchPlatformConfig
};
