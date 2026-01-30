
const { logger } = require('../core/logging');

function validateDisplayConfig(config, type) {
    // Input validation
    if (!config || typeof config !== 'object') {
        logger.warn(`[ConfigValidator] Invalid ${type} config object - expected object but received ${typeof config}`, 'config-validator');
        return false;
    }

    if (!type || typeof type !== 'string') {
        logger.warn('[ConfigValidator] Configuration type must be specified as string (chat/notification)', 'config-validator');
        return false;
    }

    // Extract configuration values with destructuring
    const { sourceName, sceneName, groupName } = config;

    // Check for missing REQUIRED configuration values (sourceName and sceneName only)
    // groupName is OPTIONAL - can be null when groups are disabled
    if (!sourceName || !sceneName) {
        logger.warn(`[ConfigValidator] Missing required ${type} configuration values - skipping display`, 'config-validator', {
            missing: {
                sourceName: !sourceName,
                sceneName: !sceneName
            },
            configType: type,
            providedConfig: {
                sourceName: sourceName || 'missing',
                sceneName: sceneName || 'missing',
                groupName: groupName || 'disabled/null'
            },
            note: 'groupName can be null when groups are disabled'
        });
        return false;
    }

    // Validate that required values are non-empty strings
    if (typeof sourceName !== 'string' || sourceName.trim() === '') {
        logger.warn(`[ConfigValidator] Invalid ${type} sourceName - must be non-empty string`, 'config-validator', {
            sourceName: sourceName,
            sourceNameType: typeof sourceName
        });
        return false;
    }

    if (typeof sceneName !== 'string' || sceneName.trim() === '') {
        logger.warn(`[ConfigValidator] Invalid ${type} sceneName - must be non-empty string`, 'config-validator', {
            sceneName: sceneName,
            sceneNameType: typeof sceneName
        });
        return false;
    }

    // Validate groupName only if it's provided (not null/undefined)
    // When null/undefined, groups are considered intentionally disabled
    if (groupName !== null && groupName !== undefined) {
        if (typeof groupName !== 'string' || groupName.trim() === '') {
            logger.warn(`[ConfigValidator] Invalid ${type} groupName - when provided, must be non-empty string`, 'config-validator', {
                groupName: groupName,
                groupNameType: typeof groupName,
                suggestion: 'Set groupName to null to disable groups instead of empty string'
            });
            return false;
        }
    }

    // All validation passed - log appropriate success message
    if (groupName) {
        logger.debug(`[ConfigValidator] ${type} configuration validation successful (groups enabled)`, 'config-validator', {
            configType: type,
            sourceName: sourceName.trim(),
            sceneName: sceneName.trim(),
            groupName: groupName.trim(),
            groupsEnabled: true
        });
    } else {
        logger.debug(`[ConfigValidator] ${type} configuration validation successful (groups disabled)`, 'config-validator', {
            configType: type,
            sourceName: sourceName.trim(),
            sceneName: sceneName.trim(),
            groupName: 'disabled',
            groupsEnabled: false
        });
    }

    return true;
}

module.exports = {
    validateDisplayConfig
};