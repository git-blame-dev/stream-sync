import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger as defaultLogger } from '../core/logging';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { RawEventLogWriter } from './RawEventLogWriter';

type LoggerLike = typeof defaultLogger;

type LoggingConfig = {
    dataLoggingPath?: string;
    dataLoggingVerbose?: boolean;
};

type LoggingDependencies = {
    logger?: LoggerLike;
    config?: LoggingConfig;
    rawEventLogWriter?: Pick<RawEventLogWriter, 'writeRawEvent' | 'resolveLogFileName'>;
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
    rawEventLogWriter: Pick<RawEventLogWriter, 'writeRawEvent' | 'resolveLogFileName'>;

    constructor(dependencies: LoggingDependencies = {}) {
        this.logger = dependencies.logger ?? defaultLogger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'chat-file-logging');
        this.config = dependencies.config ?? {};
        this.dataLoggingPath = this.config.dataLoggingPath;
        this.rawEventLogWriter = dependencies.rawEventLogWriter ?? new RawEventLogWriter();
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
            const result = await this.rawEventLogWriter.writeRawEvent({
                dataLoggingPath: this.dataLoggingPath,
                platform,
                eventType,
                payload: data
            });

            if (platformConfig.dataLoggingVerbose) {
                this.logger.debug?.('Logged platform data to raw event file', 'ChatFileLoggingService', {
                    platform,
                    eventType,
                    fileName: result.fileName
                });
            }
        } catch (error) {
            this._handleLoggingError(`Error logging platform data for ${platform}: ${this.resolveErrorMessage(error)}`, error);
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
        return this.rawEventLogWriter.resolveLogFileName(platform, eventType);
    }

    resolveErrorMessage(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }

        return String(error);
    }
}

export { ChatFileLoggingService };
