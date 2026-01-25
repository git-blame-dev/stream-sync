
const fs = require('fs').promises;
const path = require('path');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

class ChatFileLoggingService {
    constructor(dependencies = {}) {
        this.logger = dependencies.logger || require('../core/logging').logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'chat-file-logging');
        this.config = dependencies.config || {};
        this.dataLoggingPath = this.config.dataLoggingPath;
    }

    async logRawPlatformData(platform, eventType, data, platformConfig = {}) {
        // Check if data logging is enabled for this platform
        if (!platformConfig.dataLoggingEnabled) {
            return;
        }

        try {
            const ingestTimestamp = new Date().toISOString();
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
                this.logger.debug(`Logged ${eventType} data for ${platform} to ${logFilePath}`, 'ChatFileLoggingService');
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
                this.logger.debug(`Created directory: ${dirPath}`, 'ChatFileLoggingService');
            }
        }
    }

    async getLogStatistics(platform, platformConfig = {}) {
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
            this.errorHandler.handleDataLoggingError(error, dataType, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'ChatFileLoggingService', {
                dataType,
                error: error?.message || error
            });
        }
    }
}

module.exports = ChatFileLoggingService;
