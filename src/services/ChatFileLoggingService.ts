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

type LogStatisticsResult = {
size?: number;
lastModified?: Date;
path?: string;
error?: string;
exists?: boolean;
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
        this.logger = dependencies.logger ?? defaultLogger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'chat-file-logging');
        this.config = dependencies.config ?? {};
        this.dataLoggingPath = this.config.dataLoggingPath;
    }

    async logRawPlatformData(platform: string, eventType: string, data: unknown, platformConfig: PlatformLoggingConfig = {}): Promise<void> {
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

            const logFileName = this.resolveLogFileName(platform, eventType);
            const logFilePath = path.join(this.dataLoggingPath, logFileName);

            await this.ensureDirectoryExists(this.dataLoggingPath);

            const logLine = JSON.stringify(logEntry) + '\n';
            await fs.appendFile(logFilePath, logLine, 'utf8');

            if (platformConfig.dataLoggingVerbose) {
                this.logger.debug?.(`Logged ${eventType} data for ${platform} to ${logFilePath}`, 'ChatFileLoggingService');
            }
        } catch (error) {
            this._handleLoggingError(`Error logging platform data for ${platform}: ${this.resolveErrorMessage(error)}`, error);
        }
    }

    async ensureDirectoryExists(dirPath: string): Promise<void> {
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

    async getLogStatistics(platform: string, platformConfig: PlatformLoggingConfig = {}): Promise<LogStatisticsResult> {
        if (!this.dataLoggingPath) {
            return {
                error: 'Data logging path is not configured',
                exists: false
            };
        }

        try {
            const logFileName = this.resolveLogFileName(platform, 'chat');
            const logFilePath = path.join(this.dataLoggingPath, logFileName);

            const stats = await fs.stat(logFilePath);
            return {
                size: stats.size,
                lastModified: stats.mtime,
                path: logFilePath
            };
        } catch (error) {
            return {
                error: this.resolveErrorMessage(error),
                exists: false
            };
        }
    }

    _handleLoggingError(message: string, error: unknown, dataType = 'platform-data'): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleDataLoggingError?.(error, dataType, message);
        } else {
            this.errorHandler?.logOperationalError?.(message, 'ChatFileLoggingService', {
                dataType,
                error: this.resolveErrorMessage(error)
            });
        }
    }

    resolveLogFileName(platform: string, eventType: string): string {
        if (platform === 'youtube' && eventType === 'unknown-renderer') {
            return 'youtube-unknown-renderer-log.ndjson';
        }

        return `${platform}-data-log.ndjson`;
    }

    resolveErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }

        return String(error);
    }
}

export { ChatFileLoggingService };
