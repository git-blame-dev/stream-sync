import fs from 'fs';
import ini from 'ini';

import { buildConfig } from './config-builders';
import type { BuiltConfig, NormalizedConfig } from './types/config-types';
import { parseEnvContent } from '../utils/env-file-parser';
import configValidatorModule from '../utils/config-validator';
import { handleUserFacingError } from '../utils/user-friendly-errors';

type RawConfig = NormalizedConfig;

type ConfigValidatorApi = {
    parseBoolean: (value: unknown, defaultValue: boolean) => boolean;
    parseString: (value: unknown, defaultValue: string) => string;
    normalize: (rawConfig: RawConfig) => RawConfig;
    validate: (normalizedConfig: RawConfig) => {
        isValid: boolean;
        errors: string[];
    };
};

const { ConfigValidator } = configValidatorModule as unknown as {
    ConfigValidator: ConfigValidatorApi;
};

let loadedConfig: RawConfig | null = null;
let cachedConfig: BuiltConfig | null = null;
let configPath = './config.ini';

function getErrorCode(error: unknown): string | null {
    if (typeof error === 'object' && error !== null && 'code' in error) {
        const code = (error as { code?: unknown }).code;
        return typeof code === 'string' ? code : null;
    }

    return null;
}

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

function preloadEnvFromConfig(rawConfig: RawConfig) {
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
        const rawConfig = ini.parse(configContent) as RawConfig;

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

        const debugEnabled = normalized.general?.debugEnabled;
        if (debugEnabled === true) {
            process.stdout.write(`[INFO] [Config] Successfully loaded configuration from ${configPath}\n`);
        }

        return loadedConfig;
    } catch (error: unknown) {
        const code = getErrorCode(error);
        const message = getErrorMessage(error);

        if (code === 'ENOENT') {
            const configError = new Error(`Configuration file not found: ${configPath}`);
            handleUserFacingError(configError, {
                category: 'configuration',
                operation: 'startup'
            }, {
                showInConsole: true,
                includeActions: true,
                logTechnical: false
            });
        } else if (!message.includes('Configuration validation failed')) {
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
    cachedConfig = null;
    configPath = './config.ini';
}

function _getConfigPath() {
    return configPath;
}

function getConfig() {
    if (!cachedConfig) {
        const normalizedConfig = loadConfig();
        cachedConfig = buildConfig(normalizedConfig);
    }
    return cachedConfig;
}

const config = new Proxy({} as BuiltConfig, {
    get(_target, property, receiver) {
        return Reflect.get(getConfig() as object, property, receiver);
    },
    set(_target, property, value) {
        return Reflect.set(getConfig() as object, property, value);
    },
    has(_target, property) {
        return Reflect.has(getConfig() as object, property);
    },
    ownKeys() {
        return Reflect.ownKeys(getConfig() as object);
    },
    getOwnPropertyDescriptor(_target, property) {
        const descriptor = Object.getOwnPropertyDescriptor(getConfig() as object, property);
        return descriptor ? { ...descriptor, configurable: true } : undefined;
    }
}) as BuiltConfig;

export {
    config,
    loadConfig,
    _resetConfigForTesting,
    _getConfigPath
};
