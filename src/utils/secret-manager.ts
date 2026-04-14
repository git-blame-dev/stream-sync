import fs from 'node:fs';
import readline from 'node:readline';

import { createPlatformErrorHandler } from './platform-error-handler';
import { initializeStaticSecrets } from '../core/secrets';
import { parseEnvContent } from './env-file-parser';
import loggerResolverModule from './logger-resolver.js';

const { resolveLogger } = loggerResolverModule as {
    resolveLogger: (loggerCandidate: unknown, fallbackContext: string) => {
        debug?: (message: string, context?: string, payload?: unknown) => void;
        info?: (message: string, context?: string, payload?: unknown) => void;
        warn?: (message: string, context?: string, payload?: unknown) => void;
        error?: (message: string, context?: string, payload?: unknown) => void;
    };
};

type LoggerLike = {
    debug?: (message: string, context?: string, payload?: unknown) => void;
    info?: (message: string, context?: string, payload?: unknown) => void;
    warn?: (message: string, context?: string, payload?: unknown) => void;
    error?: (message: string, context?: string, payload?: unknown) => void;
};

type SecretsConfig = Record<string, Record<string, unknown>>;

type EnsureSecretsOptions = {
    config?: SecretsConfig;
    logger?: unknown;
    promptFor?: (secretId: string, promptText?: string) => Promise<unknown>;
    interactive?: boolean;
    envFilePath?: string | null;
    envFileReadEnabled?: unknown;
    envFileWriteEnabled?: unknown;
    readEnvFile?: (envFilePath: string | null) => Record<string, string>;
    writeEnvFile?: (
        envFilePath: string | null,
        updates: Record<string, string>,
        logger: LoggerLike,
        errorHandler: ReturnType<typeof createPlatformErrorHandler>
    ) => string[];
};

const normalize = (value) => {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed.length ? trimmed : null;
};

const maskValue = (value, prefix = 4, suffix = 4) => {
    if (!value) return '';
    if (value.length <= prefix + suffix) {
        return `${value.slice(0, 2)}...`;
    }
    return `${value.slice(0, prefix)}...${value.slice(-suffix)}`;
};

const applySecureFilePermissions = (filePath, mode, logger, errorHandler) => {
    if (process.platform === 'win32') {
        return;
    }

    try {
        fs.chmodSync(filePath, mode);
    } catch (error) {
        if (errorHandler && typeof errorHandler.handleDataLoggingError === 'function') {
            errorHandler.handleDataLoggingError(error, 'secret-manager', 'Failed to set env file permissions');
        } else if (errorHandler && typeof errorHandler.logOperationalError === 'function') {
            errorHandler.logOperationalError(`Failed to set env file permissions: ${error.message}`, 'secret-manager');
        } else {
            logger?.warn?.(`Failed to set env file permissions: ${error.message}`, 'secret-manager');
        }
    }
};

const parseEnvFile = (envFilePath) => {
    if (!envFilePath) return {};
    try {
        if (!fs.existsSync(envFilePath)) return {};
        const content = fs.readFileSync(envFilePath, 'utf8');
        return parseEnvContent(content, { ignoreEmptyKeys: false });
    } catch (error) {
        // eslint-disable-next-line no-console -- bootstrap-time; structured logger not available
        console.error(`Failed to parse env file ${envFilePath}: ${error.message}`);
        return {};
    }
};

const isInteractiveTTY = (interactiveFlag) => {
    if (typeof interactiveFlag === 'boolean') {
        return interactiveFlag;
    }
    const isCi = String(process.env.CI || '').toLowerCase() === 'true';
    return !!(process.stdin && process.stdin.isTTY && !isCi);
};

const defaultPromptFor = async (secretId, promptText) => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const answer = await new Promise((resolve) => {
        rl.question(promptText || `Enter value for ${secretId}: `, (value) => {
            resolve(value);
        });
    });

    rl.close();
    return answer;
};

const persistToEnv = (envFilePath, updates, logger, errorHandler) => {
    if (!envFilePath || !updates || Object.keys(updates).length === 0) {
        return [];
    }

    try {
        const existingLines = fs.existsSync(envFilePath)
            ? fs.readFileSync(envFilePath, 'utf8').split(/\r?\n/)
            : [];

        const indexByKey = {};
        existingLines.forEach((line, idx) => {
            const eq = line.indexOf('=');
            if (eq > 0) {
                const key = line.slice(0, eq).trim();
                indexByKey[key] = idx;
            }
        });

        Object.entries(updates).forEach(([key, value]) => {
            const newLine = `${key}=${value}`;
            if (indexByKey[key] !== undefined) {
                existingLines[indexByKey[key]] = newLine;
            } else {
                existingLines.push(newLine);
            }
        });

        const finalLines = existingLines.filter((line, idx, arr) => line.trim() !== '' || idx < arr.length - 1);
        const finalContent = finalLines.join('\n');
        fs.writeFileSync(envFilePath, finalContent.endsWith('\n') ? finalContent : `${finalContent}\n`, {
            encoding: 'utf8',
            mode: 0o600
        });
        applySecureFilePermissions(envFilePath, 0o600, logger, errorHandler);

        return Object.keys(updates);
    } catch (error) {
        if (errorHandler && typeof errorHandler.handleDataLoggingError === 'function') {
            errorHandler.handleDataLoggingError(error, 'secret-manager', 'Failed to persist secrets to environment file');
        } else if (errorHandler && typeof errorHandler.logOperationalError === 'function') {
            errorHandler.logOperationalError(`Failed to persist secrets: ${error.message}`, 'secret-manager');
        } else {
            logger?.warn?.(`Failed to persist secrets: ${error.message}`, 'secret-manager');
        }
        return [];
    }
};

const boolFromConfig = (value) => {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
};

const SECRET_DEFINITIONS = [
    {
        id: 'TIKTOK_API_KEY',
        envKey: 'TIKTOK_API_KEY',
        configPath: ['tiktok', 'apiKey'],
        requiredWhen: (config) => boolFromConfig(config?.tiktok?.enabled),
        promptText: 'Paste TikTok WebSocket API key (EulerStream signing key): ',
        mask: (value) => maskValue(value, 6, 4)
    },
    {
        id: 'TWITCH_CLIENT_SECRET',
        envKey: 'TWITCH_CLIENT_SECRET',
        configPath: ['twitch', 'clientSecret'],
        requiredWhen: (config) => boolFromConfig(config?.twitch?.enabled),
        promptText: 'Paste Twitch Client Secret: ',
        mask: (value) => maskValue(value, 6, 4)
    },
    {
        id: 'OBS_PASSWORD',
        envKey: 'OBS_PASSWORD',
        configPath: ['obs', 'password'],
        requiredWhen: (config) => boolFromConfig(config?.obs?.enabled),
        promptText: 'Paste OBS WebSocket password: ',
        mask: (value) => maskValue(value, 2, 2)
    },
    {
        id: 'STREAMELEMENTS_JWT_TOKEN',
        envKey: 'STREAMELEMENTS_JWT_TOKEN',
        configPath: ['streamelements', 'jwtToken'],
        requiredWhen: (config) => boolFromConfig(config?.streamelements?.enabled),
        promptText: 'Paste StreamElements JWT token: ',
        mask: (value) => maskValue(value, 4, 3)
    },
    {
        id: 'YOUTUBE_API_KEY',
        envKey: 'YOUTUBE_API_KEY',
        configPath: ['youtube', 'apiKey'],
        requiredWhen: (config) => {
            if (!boolFromConfig(config?.youtube?.enabled)) {
                return false;
            }
            const enableApi = boolFromConfig(config?.youtube?.enableAPI);
            const streamDetectionMethod = String(config?.youtube?.streamDetectionMethod || '').trim().toLowerCase();
            const viewerCountMethod = String(config?.youtube?.viewerCountMethod || '').trim().toLowerCase();
            return enableApi || streamDetectionMethod === 'api' || viewerCountMethod === 'api';
        },
        promptText: 'Paste YouTube Data API key (optional unless API mode enabled): ',
        mask: (value) => maskValue(value, 6, 4),
        optional: true
    }
];

async function ensureSecrets(options: EnsureSecretsOptions = {}) {
    const {
        config,
        logger: loggerCandidate = null,
        promptFor = defaultPromptFor,
        interactive,
        envFilePath = null,
        envFileReadEnabled = false,
        envFileWriteEnabled = false,
        readEnvFile = parseEnvFile,
        writeEnvFile = persistToEnv
    } = options;

    const logger = resolveLogger(loggerCandidate, 'Secret manager') as LoggerLike;
    const safeLogger = logger;
    const errorHandler = createPlatformErrorHandler(safeLogger, 'secret-manager');
    const allowPrompt = isInteractiveTTY(interactive);
    const allowEnvFileRead = boolFromConfig(envFileReadEnabled);
    const allowEnvFileWrite = boolFromConfig(envFileWriteEnabled);

    if ((allowEnvFileRead || allowEnvFileWrite) && !envFilePath) {
        const error = new Error('envFilePath is required when env file access is enabled');
        errorHandler.handleEventProcessingError(error, 'secret-manager', null, error.message);
        throw error;
    }

    const envFileVars = allowEnvFileRead ? readEnvFile(envFilePath) : {};

    if (allowEnvFileRead) {
        // Prime process.env from env file for consumers expecting it
        Object.entries(envFileVars).forEach(([key, value]) => {
            if (!process.env[key]) {
                process.env[key] = value;
            }
        });
    }

    const applied: Record<string, { source: 'env' | 'prompt' }> = {};
    const missingRequired: string[] = [];
    const persistUpdates: Record<string, string> = {};

    const getConfigSection = (section) => {
        return config?.[section] ?? {};
    };

    for (const secret of SECRET_DEFINITIONS) {
        const { id, envKey, requiredWhen, promptText, mask, optional } = secret;
        const enabledConfig = {
            tiktok: getConfigSection('tiktok'),
            twitch: getConfigSection('twitch'),
            obs: getConfigSection('obs'),
            streamelements: getConfigSection('streamelements'),
            youtube: getConfigSection('youtube')
        };

        const isRequired = requiredWhen ? requiredWhen(enabledConfig) : !optional;
        const existingEnv = normalize(process.env[envKey] || envFileVars[envKey]);
        let value = existingEnv || null;

        if (value) {
            process.env[envKey] = value;
            applied[id] = { source: 'env' };
            safeLogger.debug?.(`Using ${id} (${mask ? mask(value) : maskValue(value)})`, 'secret-manager');
            continue;
        }

        if (allowPrompt && isRequired) {
            const userInput = await promptFor(id, promptText);
            value = normalize(userInput);
            if (value) {
                process.env[envKey] = value;
                persistUpdates[envKey] = value;
                applied[id] = { source: 'prompt' };
                safeLogger.info?.(`Saved ${id} (${mask ? mask(value) : maskValue(value)})`, 'secret-manager');
                continue;
            }
        }

        if (isRequired) {
            missingRequired.push(envKey);
        }
    }

    const persisted = allowEnvFileWrite
        ? (writeEnvFile(envFilePath, persistUpdates, safeLogger, errorHandler) || [])
        : [];

    if (missingRequired.length > 0 && !allowPrompt) {
        const missingList = missingRequired.join(', ');
        const error = new Error(`Missing required secrets: ${missingList}`);
        safeLogger.error?.(error.message, 'secret-manager');
        throw error;
    }

    if (missingRequired.length > 0) {
        safeLogger.warn?.(`Secrets missing (interactive): ${missingRequired.join(', ')}`, 'secret-manager');
    }

    initializeStaticSecrets();

    return {
        applied,
        persisted,
        missingRequired
    };
}

export {
    ensureSecrets
};
