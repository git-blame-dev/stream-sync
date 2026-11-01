import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { AppLogger } from '../core/logger/types';
import { logger as defaultLogger } from '../core/logging';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { RawEventLogWriter } from './RawEventLogWriter';

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
    errorHandler: {
        handleDataLoggingError?: (error: Error, dataType: string, message: string, context?: { platform: string; eventType: string }) => void;
        logOperationalError?: (message: string, source: string, context?: unknown) => void;
    };
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
            this._handleLoggingError('Data logging path is not configured', new Error('Data logging path is not configured'), 'platform-data', { platform, eventType });
            return;
        }

        try {
            await this.rawEventLogWriter.writeRawEvent({
                dataLoggingPath: this.dataLoggingPath,
                platform,
                eventType,
                payload: data
            });

        } catch {
            this._handleLoggingError('Raw platform data capture failed', new Error('Raw platform data capture failed'), 'platform-data', { platform, eventType });
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

    _handleLoggingError(message: string, error: unknown, dataType = 'platform-data', context?: { platform: string; eventType: string }): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleDataLoggingError?.(error, dataType, message, context ? {
                platform: /^(?:twitch|youtube|tiktok|streamelements)$/.test(context.platform) ? context.platform : 'unknown',
                eventType: /^[a-z][a-z0-9:_-]{0,63}$/i.test(context.eventType) ? context.eventType : 'unknown',
            } : undefined);
        } else {
            this.errorHandler?.logOperationalError?.(message, 'raw-platform-data-logging', {
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

export { RawPlatformDataLoggingService };
