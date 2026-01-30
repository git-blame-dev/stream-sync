
class PlatformErrorHandler {
    constructor(logger, platformName) {
        if (!logger || typeof logger.error !== 'function') {
            const noop = () => {};
            this.logger = {
                debug: noop,
                info: noop,
                warn: noop,
                error: noop
            };
        } else {
            this.logger = logger;
        }
        this.platformName = platformName;
    }

    handleInitializationError(error, context = 'initialization') {
        this.logger.error(`Failed to initialize ${this.platformName} platform during ${context}`, this.platformName, error);
        throw error; // Re-throw to trigger retry logic
    }

    handleEventProcessingError(error, eventType, eventData = null, message = null, logContext = null) {
        const logMessage = message || `Error processing ${eventType} event`;
        const contextName = logContext || this.platformName;
        const metadata = {
            error: error.message,
            eventType,
            eventData: eventData || null
        };
        if (eventData && typeof eventData === 'object') {
            Object.assign(metadata, eventData);
        }
        this.logger.error(logMessage, contextName, metadata);
        // Don't re-throw to prevent chat processing pipeline from stopping
    }

    handleConnectionError(error, action = 'connection', message = null) {
        const logMessage = message || `${this.platformName} ${action} failed: ${error.message}`;
        this.logger.error(logMessage, this.platformName, error);
    }

    handleServiceUnavailableError(serviceName, error) {
        this.logger.warn(`${serviceName} service unavailable, using fallback behavior`, this.platformName, error);
    }

    handleMessageSendError(error, context = 'message sending', message = null) {
        const logMessage = message || `Failed to send message via ${this.platformName} during ${context}`;
        this.logger.error(logMessage, this.platformName, error);
    }

    logOperationalError(message, context = this.platformName, payload = null) {
        if (!this.logger || typeof this.logger.error !== 'function') {
            return;
        }

        if (payload !== null && payload !== undefined) {
            this.logger.error(message, context, payload);
        } else if (context !== undefined) {
            this.logger.error(message, context);
        } else {
            this.logger.error(message);
        }
    }

    handleAuthenticationError(reason) {
        this.logger.error(`Cannot proceed - ${this.platformName} authentication ${reason}`, this.platformName);
    }

    handleCleanupError(error, resource, message = null) {
        const logMessage = message || `Failed to cleanup ${resource} during ${this.platformName} shutdown`;
        this.logger.warn(logMessage, this.platformName, {
            error: error.message,
            resource
        });
    }

    handleDataLoggingError(error, dataType, message = null) {
        const logMessage = message || `Error logging ${dataType} data: ${error.message}`;
        this.logger.error(logMessage, `${this.platformName}-platform`);
    }
}

function createPlatformErrorHandler(logger, platformName) {
    return new PlatformErrorHandler(logger, platformName);
}

module.exports = {
    PlatformErrorHandler,
    createPlatformErrorHandler
};
