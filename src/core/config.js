const fs = require('fs');
const ini = require('ini');
const { handleUserFacingError } = require('../utils/user-friendly-errors');
const { DEFAULTS } = require('./config-schema');
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

const DEFAULT_LOGGING_CONFIG = {
    console: { enabled: true, level: 'console' },
    file: { enabled: true, level: 'debug', directory: DEFAULTS.LOG_DIRECTORY },
    debug: { enabled: false },
    platforms: {
        twitch: { enabled: true, fileLogging: true },
        youtube: { enabled: true, fileLogging: true },
        tiktok: { enabled: true, fileLogging: true }
    },
    chat: { enabled: true, separateFiles: true, directory: DEFAULTS.LOG_DIRECTORY }
};

function validateLoggingConfig(userConfig = {}) {
    const config = { ...DEFAULT_LOGGING_CONFIG };

    if (userConfig.logging) {
        Object.assign(config, userConfig.logging);
    }

    if (userConfig.general && userConfig.general.debugEnabled !== undefined) {
        const { getDebugMode } = require('./logging');
        const debugAlreadySetByCommandLine = getDebugMode();

        if (!debugAlreadySetByCommandLine) {
            config.debug.enabled = userConfig.general.debugEnabled;
            config.console.level = userConfig.general.debugEnabled ? 'debug' : 'console';
        } else {
            config.console.level = 'debug';
        }
    }

    const validLevels = ['error', 'warn', 'console', 'info', 'debug'];
    if (!validLevels.includes(config.console.level)) {
        config.console.level = 'console';
    }
    if (!validLevels.includes(config.file.level)) {
        config.file.level = 'debug';
    }

    if (userConfig.logging) {
        if (userConfig.logging.consoleLevel && validLevels.includes(userConfig.logging.consoleLevel)) {
            config.console.level = userConfig.logging.consoleLevel;
        }
        if (userConfig.logging.fileLevel && validLevels.includes(userConfig.logging.fileLevel)) {
            config.file.level = userConfig.logging.fileLevel;
        }
        if (userConfig.logging.fileLoggingEnabled !== undefined && userConfig.logging.fileLoggingEnabled !== null) {
            config.file.enabled = userConfig.logging.fileLoggingEnabled;
        }
    }

    config.file.directory = DEFAULTS.LOG_DIRECTORY;
    config.chat.enabled = config.file.enabled;
    config.chat.separateFiles = true;
    config.chat.directory = DEFAULTS.LOG_DIRECTORY;

    return config;
}

module.exports = {
    get config() { return getConfig(); },
    loadConfig,
    validateLoggingConfig,
    _resetConfigForTesting,
    _getConfigPath
};
