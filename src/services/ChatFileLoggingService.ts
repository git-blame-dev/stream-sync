import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger as defaultLogger } from '../core/logging';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { getSystemTimestampISO } from '../utils/timestamp';

type LoggerLike = typeof defaultLogger;

type LoggingConfig = {
    dataLoggingPath?: string;
    dataLoggingVerbose?: boolean;
};

type LoggingDependencies = {
    logger?: LoggerLike;
    config?: LoggingConfig;
};

type PlatformLoggingConfig = {
    dataLoggingEnabled?: boolean;
    dataLoggingVerbose?: boolean;
};

class ChatFileLoggingService {
    logger: LoggerLike;
    errorHandler: {
        handleDataLoggingError?: (error: Error, dataType: string, message: string) => void;
        logOperationalError?: (message: string, source: string, context?: unknown) => void;
    };
    config: LoggingConfig;
    dataLoggingPath?: string;

    constructor(dependencies: LoggingDependencies = {}) {
        this.logger = dependencies.logger || defaultLogger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'chat-file-logging');
        this.config = dependencies.config || {};
        this.dataLoggingPath = this.config.dataLoggingPath;
    }

    async logRawPlatformData(platform, eventType, data, platformConfig: PlatformLoggingConfig = {}) {
        if (!platformConfig.dataLoggingEnabled) {
            return;
        }

        if (!this.dataLoggingPath) {
            this._handleLoggingError('Data logging path is not configured', null);
            return;
        }

        try {
            const ingestTimestamp = getSystemTimestampISO();
            const logEntry = {
                ingestTimestamp,
                platform,
                eventType,
                payload: data
            };

            const logFileName = `${platform}-data-log.ndjson`;
            const logFilePath = path.join(this.dataLoggingPath, logFileName);

            await this.ensureDirectoryExists(this.dataLoggingPath);

            const logLine = JSON.stringify(logEntry) + '\n';
            await fs.appendFile(logFilePath, logLine, 'utf8');

            if (platformConfig.dataLoggingVerbose) {
                this.logger.debug?.(`Logged ${eventType} data for ${platform} to ${logFilePath}`, 'ChatFileLoggingService');
            }
        } catch (error) {
            this._handleLoggingError(`Error logging platform data for ${platform}: ${error.message}`, error);
        }
    }

    async ensureDirectoryExists(dirPath) {
        try {
            await fs.access(dirPath);
        } catch {
            // Directory doesn't exist, create it
            await fs.mkdir(dirPath, { recursive: true });
            if (this.config.dataLoggingVerbose) {
                this.logger.debug?.(`Created directory: ${dirPath}`, 'ChatFileLoggingService');
            }
        }
    }

    async getLogStatistics(platform, platformConfig: PlatformLoggingConfig = {}) {
        if (!this.dataLoggingPath) {
            return {
                error: 'Data logging path is not configured',
                exists: false
            };
        }

        try {
            const logFileName = `${platform}-data-log.ndjson`;
            const logFilePath = path.join(this.dataLoggingPath, logFileName);

            const stats = await fs.stat(logFilePath);
            return {
                size: stats.size,
                lastModified: stats.mtime,
                path: logFilePath
            };
        } catch (error) {
            return {
                error: error.message,
                exists: false
            };
        }
    }

    _handleLoggingError(message, error, dataType = 'platform-data') {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleDataLoggingError?.(error, dataType, message);
        } else {
            this.errorHandler?.logOperationalError?.(message, 'ChatFileLoggingService', {
                dataType,
                error: error?.message || error
            });
        }
    }
}

export { ChatFileLoggingService };
