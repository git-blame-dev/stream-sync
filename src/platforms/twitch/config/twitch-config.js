const { ConfigValidatorStatic } = require('../../../utils/config-validator');

const dropUndefinedValues = (valueMap) => Object.fromEntries(
    Object.entries(valueMap).filter(([, value]) => value !== undefined)
);

const DEFAULT_LOG_DIRECTORY = './logs';

const TWITCH_CONFIG_VALIDATION_RULES = {
    required: {
        enabled: { type: 'boolean', message: 'Platform must be enabled' },
        username: { type: 'string', message: 'Username is required for Twitch authentication' },
        channel: { type: 'string', message: 'Channel name is required for Twitch chat connection' }
    },
    optional: {
        eventsub_enabled: { type: 'boolean', default: true, message: 'EventSub configuration' },
        dataLoggingEnabled: { type: 'boolean', default: false, message: 'Data logging configuration' }
    }
};

function normalizeTwitchPlatformConfig(rawConfig = {}) {
    const normalized = {
        enabled: ConfigValidatorStatic.parseBoolean(rawConfig.enabled, false),
        username: rawConfig.username,
        channel: rawConfig.channel,
        clientId: rawConfig.clientId,
        tokenStorePath: rawConfig.tokenStorePath,
        tokenExpiresAt: rawConfig.tokenExpiresAt,
        eventsub_enabled: ConfigValidatorStatic.parseBoolean(rawConfig.eventsub_enabled, true),
        dataLoggingEnabled: ConfigValidatorStatic.parseBoolean(rawConfig.dataLoggingEnabled, false),
        dataLoggingPath: DEFAULT_LOG_DIRECTORY,
        viewerCountEnabled: ConfigValidatorStatic.parseBoolean(rawConfig.viewerCountEnabled, undefined),
        viewerCountSource: rawConfig.viewerCountSource,
        messagesEnabled: ConfigValidatorStatic.parseBoolean(rawConfig.messagesEnabled, undefined),
        commandsEnabled: ConfigValidatorStatic.parseBoolean(rawConfig.commandsEnabled, undefined),
        greetingsEnabled: ConfigValidatorStatic.parseBoolean(rawConfig.greetingsEnabled, undefined),
        farewellsEnabled: ConfigValidatorStatic.parseBoolean(rawConfig.farewellsEnabled, undefined),
        followsEnabled: ConfigValidatorStatic.parseBoolean(rawConfig.followsEnabled, undefined),
        giftsEnabled: ConfigValidatorStatic.parseBoolean(rawConfig.giftsEnabled, undefined),
        raidsEnabled: ConfigValidatorStatic.parseBoolean(rawConfig.raidsEnabled, undefined),
        paypiggiesEnabled: ConfigValidatorStatic.parseBoolean(rawConfig.paypiggiesEnabled, undefined),
        greetNewCommentors: ConfigValidatorStatic.parseBoolean(rawConfig.greetNewCommentors, undefined),
        ignoreSelfMessages: ConfigValidatorStatic.parseBoolean(rawConfig.ignoreSelfMessages, undefined),
        pollInterval: ConfigValidatorStatic.parseNumber(rawConfig.pollInterval, undefined, { min: 1 })
    };

    return dropUndefinedValues(normalized);
}

function validateTwitchPlatformConfig(options = {}) {
    const { config = {}, authManager } = options;
    const validation = validatePlatformConfig(config, TWITCH_CONFIG_VALIDATION_RULES);

    const errors = [...validation.errors];
    const warnings = [...validation.warnings];
    const authState = authManager?.getState?.();

    if (!authManager) {
        errors.push('authManager: TwitchPlatform requires an injected authManager');
    } else if (config.enabled && authState !== 'READY') {
        warnings.push(`authManager: expected READY state but found ${authState}`);
    }

    return {
        ...validation,
        isValid: errors.length === 0,
        errors,
        warnings,
        authState
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
