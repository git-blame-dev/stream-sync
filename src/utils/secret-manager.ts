import type { AppLogger } from '../core/logger/types';
import fs from 'node:fs';
import { getYouTubeCapabilityErrors } from '../core/config-schema';
import { randomUUID } from 'node:crypto';
import readline from 'node:readline';

import { createPlatformErrorHandler } from './platform-error-handler';
import { initializeStaticSecrets } from '../core/secrets';
import { encodeEnvValue, parseEnvContent } from './env-file-parser';
import { resolveLogger } from './logger-resolver';

type LoggerLike = Partial<Pick<AppLogger<string>, 'debug' | 'info' | 'warn' | 'error'>>;

type SecretsConfig = Record<string, Record<string, unknown>>;

type EnabledSectionsConfig = {
    tiktok?: Record<string, unknown>;
    twitch?: Record<string, unknown>;
    obs?: Record<string, unknown>;
    streamelements?: Record<string, unknown>;
    youtube?: Record<string, unknown>;
};

type SecretDefinition = {
    id: string;
    envKey: string;
    configPath: string[];
    requiredWhen?: (config: EnabledSectionsConfig) => boolean;
    promptText: string;
    optional?: boolean;
};

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

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const normalize = (value: unknown): string | null => {
    if (value === null || value === undefined) return null;
    const trimmed = String(value).trim();
    return trimmed.length ? trimmed : null;
};

const applySecureFilePermissions = (filePath: string, mode: number, logger: LoggerLike, errorHandler: ReturnType<typeof createPlatformErrorHandler>) => {
    if (process.platform === 'win32') {
        return;
    }

    try {
        fs.chmodSync(filePath, mode);
    } catch (error) {
        if (errorHandler && typeof errorHandler.handleDataLoggingError === 'function') {
            errorHandler.handleDataLoggingError(error, 'secret-manager', 'Failed to set env file permissions');
        } else if (errorHandler && typeof errorHandler.logOperationalError === 'function') {
            errorHandler.logOperationalError(`Failed to set env file permissions: ${getErrorMessage(error)}`, 'secret-manager');
        } else {
            logger?.warn?.(`Failed to set env file permissions: ${getErrorMessage(error)}`, 'secret-manager');
        }
    }
};

const parseEnvFile = (envFilePath: string | null): Record<string, string> => {
    if (!envFilePath) return {};
    try {
        if (!fs.existsSync(envFilePath)) return {};
        const content = fs.readFileSync(envFilePath, 'utf8');
        return parseEnvContent(content, { ignoreEmptyKeys: false });
    } catch (error) {
        // eslint-disable-next-line no-console -- bootstrap-time; structured logger not available
        console.error(`Failed to parse env file ${envFilePath}: ${getErrorMessage(error)}`);
        return {};
    }
};

const isInteractiveTTY = (interactiveFlag: unknown): boolean => {
    if (typeof interactiveFlag === 'boolean') {
        return interactiveFlag;
    }
    const isCi = String(process.env.CI || '').toLowerCase() === 'true';
    return !!(process.stdin && process.stdin.isTTY && !isCi);
};

const defaultPromptFor = async (secretId: string, promptText?: string): Promise<string> => {
    const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout
    });

    const answer = await new Promise<string>((resolve) => {
        rl.question(promptText || `Enter value for ${secretId}: `, (value) => {
            resolve(value);
        });
    });

    rl.close();
    return answer;
};

const persistToEnv = (envFilePath: string | null, updates: Record<string, string>, logger: LoggerLike, errorHandler: ReturnType<typeof createPlatformErrorHandler>): string[] => {
    if (!envFilePath || !updates || Object.keys(updates).length === 0) {
        return [];
    }

    try {
        const encoded: Record<string, string> = {};
        for (const [key, value] of Object.entries(updates)) {
            const representation = encodeEnvValue(value);
            if (representation === null) {
                logger.warn?.(`${key} is available for this process but was not persisted: its characters cannot roundtrip through the supported env-file loaders`, 'secret-manager');
            } else {
                encoded[key] = representation;
            }
        }
        if (Object.keys(encoded).length === 0) return [];
        const existingLines = fs.existsSync(envFilePath)
            ? fs.readFileSync(envFilePath, 'utf8').split(/\r?\n/)
            : [];

        const indexByKey: Record<string, number> = {};
        existingLines.forEach((line, idx) => {
            const eq = line.indexOf('=');
            if (eq > 0) {
                const key = line.slice(0, eq).trim();
                indexByKey[key] = idx;
            }
        });

        Object.entries(encoded).forEach(([key, value]) => {
            const newLine = `${key}=${value}`;
            if (indexByKey[key] !== undefined) {
                existingLines[indexByKey[key]] = newLine;
            } else {
                existingLines.push(newLine);
            }
        });

        const finalLines = existingLines.filter((line, idx, arr) => line.trim() !== '' || idx < arr.length - 1);
        const finalContent = finalLines.join('\n');
        const tempPath = `${envFilePath}.${process.pid}.${randomUUID()}.tmp`;
        let tempWritten = false;
        try {
            fs.writeFileSync(tempPath, finalContent.endsWith('\n') ? finalContent : `${finalContent}\n`, {
                encoding: 'utf8',
                mode: 0o600,
                flag: 'wx'
            });
            tempWritten = true;
            applySecureFilePermissions(tempPath, 0o600, logger, errorHandler);
            fs.renameSync(tempPath, envFilePath);
        } catch (error) {
            try {
                // An exclusive-create collision belongs to someone else.
                if (tempWritten || (error as NodeJS.ErrnoException)?.code !== 'EEXIST') fs.unlinkSync(tempPath);
            } catch (cleanupError) {
                if ((cleanupError as NodeJS.ErrnoException)?.code !== 'ENOENT') {
                    try {
                        errorHandler.handleDataLoggingError(cleanupError, 'secret-manager', 'Failed to remove env file temp file');
                    } catch {
                        // Cleanup diagnostics must not replace the persistence failure.
                    }
                }
            }
            throw error;
        }

        return Object.keys(encoded);
    } catch (error) {
        try {
            if (errorHandler && typeof errorHandler.handleDataLoggingError === 'function') {
                errorHandler.handleDataLoggingError(error, 'secret-manager', 'Failed to persist secrets to environment file');
            } else if (errorHandler && typeof errorHandler.logOperationalError === 'function') {
                errorHandler.logOperationalError(`Failed to persist secrets: ${getErrorMessage(error)}`, 'secret-manager');
            } else {
                logger?.warn?.(`Failed to persist secrets: ${getErrorMessage(error)}`, 'secret-manager');
            }
        } catch {
            // Diagnostics must not change the failed-persistence result.
        }
        return [];
    }
};

const boolFromConfig = (value: unknown): boolean => {
    if (typeof value === 'boolean') return value;
    const normalized = String(value || '').trim().toLowerCase();
    return normalized === 'true' || normalized === '1';
};

const SECRET_DEFINITIONS: SecretDefinition[] = [
    {
        id: 'TIKTOK_API_KEY',
        envKey: 'TIKTOK_API_KEY',
        configPath: ['tiktok', 'apiKey'],
        requiredWhen: (config) => boolFromConfig(config?.tiktok?.enabled),
        promptText: 'Paste TikTok WebSocket API key (EulerStream signing key): '
    },
    {
        id: 'TWITCH_CLIENT_SECRET',
        envKey: 'TWITCH_CLIENT_SECRET',
        configPath: ['twitch', 'clientSecret'],
        requiredWhen: (config) => boolFromConfig(config?.twitch?.enabled),
        promptText: 'Paste Twitch Client Secret: '
    },
    {
        id: 'OBS_PASSWORD',
        envKey: 'OBS_PASSWORD',
        configPath: ['obs', 'password'],
        requiredWhen: (config) => boolFromConfig(config?.obs?.enabled),
        promptText: 'Paste OBS WebSocket password: '
    },
    {
        id: 'STREAMELEMENTS_JWT_TOKEN',
        envKey: 'STREAMELEMENTS_JWT_TOKEN',
        configPath: ['streamelements', 'jwtToken'],
        requiredWhen: (config) => boolFromConfig(config?.streamelements?.enabled),
        promptText: 'Paste StreamElements JWT token: '
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

    const capabilityErrors = getYouTubeCapabilityErrors(config?.youtube);
    if (capabilityErrors.length) throw new Error(capabilityErrors.join(' '));

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
        Object.entries(envFileVars).forEach(([key, value]) => {
            if (!process.env[key]) {
                process.env[key] = value;
            }
        });
    }

    const applied: Record<string, { source: 'env' | 'prompt' }> = {};
    const missingRequired: string[] = [];
    const persistUpdates: Record<string, string> = {};

    const getConfigSection = (section: string): Record<string, unknown> => {
        return config?.[section] ?? {};
    };

    for (const secret of SECRET_DEFINITIONS) {
        const { id, envKey, requiredWhen, promptText, optional } = secret;
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

            continue;
        }

        if (allowPrompt && isRequired) {
            const userInput = await promptFor(id, promptText);
            value = normalize(userInput);
            if (value) {
                process.env[envKey] = value;
                persistUpdates[envKey] = value;
                applied[id] = { source: 'prompt' };
                safeLogger.debug?.(`Using prompted ${id} for this process`, 'secret-manager');
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
