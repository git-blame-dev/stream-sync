const fs = require('fs');
const ini = require('ini');
const { handleUserFacingError } = require('../utils/user-friendly-errors');
const { ConfigValidator } = require('../utils/config-validator');
const { parseEnvContent } = require('../utils/env-file-parser');
const { buildConfig } = require('./config-builders');

/** @type {any} */
let loadedConfig = null;
let configPath = './config.ini';

function preloadEnvFromConfig(rawConfig) {
    const rawGeneral = rawConfig?.general || {};
    const envFileReadEnabled = ConfigValidator.parseBoolean(rawGeneral.envFileReadEnabled, true);
    if (!envFileReadEnabled) {
        return;
    }

    const envFilePath = ConfigValidator.parseString(rawGeneral.envFilePath, './.env') || './.env';
    if (!fs.existsSync(envFilePath)) {
        return;
    }

    const envContent = fs.readFileSync(envFilePath, 'utf-8');
    const envVars = parseEnvContent(envContent);

    const envClientId = envVars.TWITCH_CLIENT_ID;
    if (!envClientId) {
        return;
    }

    if (process.env.TWITCH_CLIENT_ID === undefined || process.env.TWITCH_CLIENT_ID === null || process.env.TWITCH_CLIENT_ID === '') {
        process.env.TWITCH_CLIENT_ID = envClientId;
    }
}

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

        preloadEnvFromConfig(rawConfig);

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

/** @type {any} */
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
