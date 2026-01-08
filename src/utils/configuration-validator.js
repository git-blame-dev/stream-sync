
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

function isGroupsEnabled(config, type) {
    // Input validation
    if (!config || typeof config !== 'object') {
        logger.warn(`[ConfigValidator] Invalid ${type} config for groups check - expected object`, 'config-validator');
        return false;
    }

    if (!type || typeof type !== 'string') {
        logger.warn('[ConfigValidator] Configuration type must be specified for groups check', 'config-validator');
        return false;
    }

    const { groupName, sceneName } = config;

    // If scene name is missing, this is a configuration error (not intentional disabling)
    if (!sceneName || typeof sceneName !== 'string' || sceneName.trim() === '') {
        logger.warn(`[ConfigValidator] Missing ${type} scene name - configuration error`, 'config-validator', {
            configType: type,
            sceneName: sceneName || 'missing',
            groupName: groupName || 'missing'
        });
        return false;
    }

    // Groups are considered enabled if groupName is a non-empty string
    const groupsEnabled = groupName && typeof groupName === 'string' && groupName.trim() !== '';

    if (groupsEnabled) {
        logger.debug(`[ConfigValidator] ${type} groups enabled - using group-based controls`, 'config-validator', {
            configType: type,
            groupName: groupName.trim(),
            sceneName: sceneName.trim()
        });
    } else {
        logger.debug(`[ConfigValidator] ${type} groups disabled - using scene-level controls only`, 'config-validator', {
            configType: type,
            groupName: groupName || 'disabled',
            sceneName: sceneName.trim(),
            reason: 'Groups intentionally disabled or not configured'
        });
    }

    return groupsEnabled;
}

function validateGroupConfig(groupName, groupsEnabled, type) {
    // Input validation
    if (typeof groupsEnabled !== 'boolean') {
        logger.warn(`[ConfigValidator] groupsEnabled must be boolean for ${type} group validation`, 'config-validator');
        return false;
    }

    if (!type || typeof type !== 'string') {
        logger.warn('[ConfigValidator] Configuration type must be specified for group validation', 'config-validator');
        return false;
    }

    // If groups are not enabled, group operations should be skipped (not an error)
    if (!groupsEnabled) {
        logger.debug(`[ConfigValidator] ${type} group operations skipped - groups disabled`, 'config-validator', {
            configType: type,
            groupName: groupName || 'disabled',
            reason: 'Groups not enabled in configuration'
        });
        return false;
    }

    // Groups are enabled, so groupName must be valid
    if (!groupName || typeof groupName !== 'string' || groupName.trim() === '') {
        logger.warn(`[ConfigValidator] Missing ${type} group name but groups are enabled - configuration error`, 'config-validator', {
            configType: type,
            groupName: groupName || 'missing',
            groupsEnabled: groupsEnabled,
            issue: 'Groups enabled but groupName invalid'
        });
        return false;
    }

    // Group validation successful
    logger.debug(`[ConfigValidator] ${type} group validation successful`, 'config-validator', {
        configType: type,
        groupName: groupName.trim(),
        groupsEnabled: groupsEnabled
    });

    return true;
}

function validateBasicGroupScene(config, type) {
    // Input validation
    if (!config || typeof config !== 'object') {
        logger.warn(`[ConfigValidator] Invalid ${type} config for basic validation - expected object`, 'config-validator');
        return false;
    }

    if (!type || typeof type !== 'string') {
        logger.warn('[ConfigValidator] Configuration type must be specified for basic validation', 'config-validator');
        return false;
    }

    const { groupName, sceneName } = config;

    // Check for missing values
    if (!groupName || !sceneName) {
        logger.warn(`[ConfigValidator] Missing ${type} group/scene - skipping visibility`, 'config-validator', {
            configType: type,
            missing: {
                groupName: !groupName,
                sceneName: !sceneName
            },
            providedConfig: {
                groupName: groupName || 'missing',
                sceneName: sceneName || 'missing'
            }
        });
        return false;
    }

    // Validate string types and non-empty values
    if (typeof groupName !== 'string' || groupName.trim() === '') {
        logger.warn(`[ConfigValidator] Invalid ${type} groupName for basic validation`, 'config-validator', {
            groupName: groupName,
            groupNameType: typeof groupName
        });
        return false;
    }

    if (typeof sceneName !== 'string' || sceneName.trim() === '') {
        logger.warn(`[ConfigValidator] Invalid ${type} sceneName for basic validation`, 'config-validator', {
            sceneName: sceneName,
            sceneNameType: typeof sceneName
        });
        return false;
    }

    // Basic validation successful
    logger.debug(`[ConfigValidator] ${type} basic group/scene validation successful`, 'config-validator', {
        configType: type,
        groupName: groupName.trim(),
        sceneName: sceneName.trim()
    });

    return true;
}

module.exports = {
    validateDisplayConfig,
    isGroupsEnabled,
    validateGroupConfig,
    validateBasicGroupScene
};