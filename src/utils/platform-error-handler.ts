type LoggerLike = {
    [method: string]: (...args: unknown[]) => unknown;
    error: (...args: unknown[]) => unknown;
};

function resolveErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

class PlatformErrorHandler {
    logger: LoggerLike;
    platformName: string;

    constructor(logger: unknown, platformName: string) {
        if (!logger || typeof logger !== 'object' || typeof (logger as { error?: unknown }).error !== 'function') {
            const noop = () => {};
            this.logger = {
                debug: noop,
                info: noop,
                warn: noop,
                error: noop
            };
        } else {
            this.logger = logger as LoggerLike;
        }
        this.platformName = platformName;
    }

    handleInitializationError(error: unknown, context = 'initialization'): never {
        this.logger.error(`Failed to initialize ${this.platformName} platform during ${context}`, this.platformName, error);
        throw error;
    }

    handleEventProcessingError(
        error: unknown,
        eventType: string,
        eventData: Record<string, unknown> | null = null,
        message: string | null = null,
        logContext: string | null = null
    ): void {
        const logMessage = message || `Error processing ${eventType} event`;
        const contextName = logContext || this.platformName;
        const metadata: Record<string, unknown> = {
            error: resolveErrorMessage(error),
            eventType,
            eventData: eventData || null
        };
        if (eventData && typeof eventData === 'object') {
            Object.assign(metadata, eventData);
        }
        this.logger.error(logMessage, contextName, metadata);
    }

    handleConnectionError(error: unknown, action = 'connection', message: string | null = null): void {
        const logMessage = message || `${this.platformName} ${action} failed: ${resolveErrorMessage(error)}`;
        this.logger.error(logMessage, this.platformName, error);
    }

    handleServiceUnavailableError(serviceName: string, error: unknown): void {
        this.logger.warn(`${serviceName} service unavailable, using fallback behavior`, this.platformName, error);
    }

    handleMessageSendError(error: unknown, context = 'message sending', message: string | null = null): void {
        const logMessage = message || `Failed to send message via ${this.platformName} during ${context}`;
        this.logger.error(logMessage, this.platformName, error);
    }

    logOperationalError(message: string, context = this.platformName, payload: unknown = null): void {
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

    handleAuthenticationError(reason: string): void {
        this.logger.error(`Cannot proceed - ${this.platformName} authentication ${reason}`, this.platformName);
    }

    handleCleanupError(error: unknown, resource: string, message: string | null = null): void {
        const logMessage = message || `Failed to cleanup ${resource} during ${this.platformName} shutdown`;
        this.logger.warn(logMessage, this.platformName, {
            error: resolveErrorMessage(error),
            resource
        });
    }

    handleDataLoggingError(error: unknown, dataType: string, message: string | null = null): void {
        const logMessage = message || `Error logging ${dataType} data: ${resolveErrorMessage(error)}`;
        this.logger.error(logMessage, `${this.platformName}-platform`);
    }
}

function createPlatformErrorHandler(logger: unknown, platformName: string): PlatformErrorHandler {
    return new PlatformErrorHandler(logger, platformName);
}

export {
    PlatformErrorHandler,
    createPlatformErrorHandler
};
