import { promises as fs } from 'node:fs';
import path from 'node:path';
import { logger as defaultLogger } from '../core/logging';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { RawEventLogWriter } from './RawEventLogWriter';
import { classifyLogWriteError } from '../core/logger/log-write-error';
import type { AppLogger } from '../core/logger/types';

type LoggerLike = AppLogger;

type LoggingConfig = {
    dataLoggingPath?: string;
};

export type RawEventSink = Pick<RawEventLogWriter, 'writeRawEvent' | 'resolveLogFileName'>;

type LoggingDependencies = {
    logger?: LoggerLike;
    config?: LoggingConfig;
    rawEventLogWriter?: RawEventSink | undefined;
};

type PlatformLoggingConfig = {
    dataLoggingEnabled?: boolean;
};

type LogStatisticsResult = {
    size?: number;
    lastModified?: Date;
    path?: string;
    error?: string;
    exists?: boolean;
};

class RawPlatformDataLoggingService {
    logger: LoggerLike;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    config: LoggingConfig;
    dataLoggingPath?: string;
    rawEventLogWriter: Pick<RawEventLogWriter, 'writeRawEvent' | 'resolveLogFileName'>;

    constructor(dependencies: LoggingDependencies = {}) {
        this.logger = dependencies.logger ?? defaultLogger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'raw-platform-data-logging');
        this.config = dependencies.config ?? {};
        if (this.config.dataLoggingPath !== undefined) {
            this.dataLoggingPath = this.config.dataLoggingPath;
        }
        this.rawEventLogWriter = dependencies.rawEventLogWriter ?? new RawEventLogWriter({ directories: this.dataLoggingPath ? [this.dataLoggingPath] : [] });
    }

    async logRawPlatformData(platform: string, eventType: string, data: unknown, platformConfig: PlatformLoggingConfig = {}): Promise<void> {
        if (!platformConfig.dataLoggingEnabled) {
            return;
        }

        if (!this.dataLoggingPath) {
            this.errorHandler.handleRawCaptureError(platform, eventType, 'configuration');
            return;
        }

        try {
            await this.rawEventLogWriter.writeRawEvent({
                dataLoggingPath: this.dataLoggingPath,
                platform,
                eventType,
                payload: data
            });

        } catch (error) {
            const { failure, code } = classifyLogWriteError(error);
            this.errorHandler.handleRawCaptureError(platform, eventType, failure, code);
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
        } catch {
            return {
                error: 'Raw platform log statistics unavailable',
                exists: false
            };
        }
    }

    resolveLogFileName(platform: string, eventType: string): string {
        return this.rawEventLogWriter.resolveLogFileName(platform, eventType);
    }

}

export { RawPlatformDataLoggingService };
