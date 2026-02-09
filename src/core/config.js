const fs = require('fs');
const ini = require('ini');
const { handleUserFacingError } = require('../utils/user-friendly-errors');
const { ConfigValidator } = require('../utils/config-validator');
const { buildConfig } = require('./config-builders');

let loadedConfig = null;
let configPath = './config.ini';

function loadConfig() {
    if (loadedConfig) {
        return loadedConfig;
    }

    const overridePath = process.env.CHAT_BOT_CONFIG_PATH;
    if (overridePath && overridePath.trim()) {
        configPath = overridePath.trim();
    }

    try {
        if (!fs.existsSync(configPath)) {
            throw new Error(`Configuration file not found: ${configPath}`);
        }

        const configContent = fs.readFileSync(configPath, 'utf-8');
        const rawConfig = ini.parse(configContent);

        if (!rawConfig.general) {
            throw new Error('Missing required configuration section: general');
        }

        const normalized = ConfigValidator.normalize(rawConfig);
        const validation = ConfigValidator.validate(normalized);

        if (!validation.isValid) {
            const error = new Error(`Configuration validation failed: ${validation.errors.join(', ')}`);
            handleUserFacingError(error, {
                category: 'configuration',
                operation: 'validation'
            }, {
                showInConsole: true,
                includeActions: true,
                logTechnical: false
            });
            throw error;
        }

        if (validation.warnings.length > 0) {
            validation.warnings.forEach(warning => {
                process.stdout.write(`[WARN] [Config] ${warning}\n`);
            });
        }

        loadedConfig = normalized;

        const debugEnabled = normalized.general.debugEnabled;
        if (debugEnabled) {
            process.stdout.write(`[INFO] [Config] Successfully loaded configuration from ${configPath}\n`);
        }

        return loadedConfig;
    } catch (error) {
        if (error.code === 'ENOENT') {
            const configError = new Error(`Configuration file not found: ${configPath}`);
            handleUserFacingError(configError, {
                category: 'configuration',
                operation: 'startup'
            }, {
                showInConsole: true,
                includeActions: true,
                logTechnical: false
            });
        } else if (!error.message.includes('Configuration validation failed')) {
            handleUserFacingError(error, {
                category: 'configuration',
                operation: 'loading'
            }, {
                showInConsole: true,
                includeActions: true,
                logTechnical: false
            });
        }
        throw error;
    }
}

function _resetConfigForTesting() {
    loadedConfig = null;
    _cachedConfig = null;
    configPath = './config.ini';
}

function _getConfigPath() {
    return configPath;
}

let _cachedConfig = null;
function getConfig() {
    if (!_cachedConfig) {
        const normalizedConfig = loadConfig();
        _cachedConfig = buildConfig(normalizedConfig);
    }
    return _cachedConfig;
}

module.exports = {
    get config() { return getConfig(); },
    loadConfig,
    _resetConfigForTesting,
    _getConfigPath
};
