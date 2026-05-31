import { logger } from '../core/logging';

function validateDisplayConfig(config: { sourceName?: unknown; sceneName?: unknown; groupName?: unknown } | null | undefined, type: string) {
    if (!config || typeof config !== 'object') {
        logger.warn(`[ConfigValidator] Invalid ${type} config object - expected object but received ${typeof config}`, 'config-validator');
        return false;
    }

    if (!type || typeof type !== 'string') {
        logger.warn('[ConfigValidator] Configuration type must be specified as string (chat/notification)', 'config-validator');
        return false;
    }

    const { sourceName, sceneName, groupName } = config;
    const groupsDisabled = groupName === null || groupName === undefined;

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

    let trimmedGroupName: string | null = null;
    if (!groupsDisabled) {
        if (typeof groupName !== 'string' || groupName.trim() === '') {
            logger.warn(`[ConfigValidator] Invalid ${type} groupName - when provided, must be non-empty string`, 'config-validator', {
                groupName: groupName,
                groupNameType: typeof groupName,
                suggestion: 'Set groupName to null to disable groups instead of empty string'
            });
            return false;
        }
        trimmedGroupName = groupName.trim();
    }

    if (trimmedGroupName) {
        logger.debug(`[ConfigValidator] ${type} configuration validation successful (groups enabled)`, 'config-validator', {
            configType: type,
            sourceName: sourceName.trim(),
            sceneName: sceneName.trim(),
            groupName: trimmedGroupName,
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

export {
    validateDisplayConfig
};
