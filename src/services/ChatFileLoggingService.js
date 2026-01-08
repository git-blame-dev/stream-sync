
const fs = require('fs').promises;
const path = require('path');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

class ChatFileLoggingService {
    constructor(dependencies = {}) {
        this.logger = dependencies.logger || require('../core/logging').logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'chat-file-logging');
        this.config = dependencies.config || {};
    }

    async logRawPlatformData(platform, eventType, data, platformConfig = {}) {
        // Check if data logging is enabled for this platform
        if (!platformConfig.dataLoggingEnabled) {
            return;
        }

        try {
            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                eventType,
                data
            };

            // Get log file path - use platform config or default
            const logDir = this._resolveLogDirectory(platform, platformConfig);
            if (!logDir) {
                return;
            }
            const logFileName = `${platform}-data-log.txt`;
            const logFilePath = path.join(logDir, logFileName);

            // Ensure log directory exists
            await this.ensureDirectoryExists(logDir);

            // Append to log file
            const logLine = JSON.stringify(logEntry) + '\n';
            await fs.appendFile(logFilePath, logLine, 'utf8');

            if (platformConfig.dataLoggingVerbose) {
                this.logger.debug(`Logged ${eventType} data for ${platform} to ${logFilePath}`, 'ChatFileLoggingService');
            }
        } catch (error) {
            // Log error but don't throw - we don't want logging failures to break the platform
            this._handleLoggingError(`Error logging platform data for ${platform}: ${error.message}`, error);
        }
    }

    async logUnknownEvent(platform, eventType, data, platformConfig = {}) {
        if (!platformConfig.dataLoggingEnabled) {
            return;
        }

        try {
            const timestamp = new Date().toISOString();
            const logEntry = {
                timestamp,
                eventType,
                data,
                metadata: {
                    logged: 'unknown_event',
                    platform
                }
            };

            const logDir = this._resolveLogDirectory(platform, platformConfig);
            if (!logDir) {
                return;
            }
            const logFileName = `${platform}-unknown-events.txt`;
            const logFilePath = path.join(logDir, logFileName);

            await this.ensureDirectoryExists(logDir);

            const logLine = JSON.stringify(logEntry) + '\n';
            await fs.appendFile(logFilePath, logLine, 'utf8');

            if (platformConfig.dataLoggingVerbose) {
                this.logger.debug(`Logged unknown event type '${eventType}' for ${platform}`, 'ChatFileLoggingService');
            }
        } catch (error) {
            this._handleLoggingError(`Error logging unknown event for ${platform}: ${error.message}`, error, 'unknown-event');
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
            const logDir = platformConfig.dataLoggingPath;
            if (!logDir) {
                return {
                    error: 'Data logging path not configured',
                    exists: false
                };
            }
            const logFileName = `${platform}-data-log.txt`;
            const logFilePath = path.join(logDir, logFileName);

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

    _resolveLogDirectory(platform, platformConfig) {
        const logDir = platformConfig.dataLoggingPath;
        if (!logDir) {
            const error = new Error('dataLoggingPath is required when dataLoggingEnabled is true');
            this._handleLoggingError(
                `Data logging enabled but dataLoggingPath not configured for ${platform}`,
                error
            );
            return null;
        }
        return logDir;
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
