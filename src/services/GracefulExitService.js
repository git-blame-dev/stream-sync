
const { logger } = require('../core/logging');
const { safeSetTimeout } = require('../utils/timeout-validator');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

const gracefulExitErrorHandler = createPlatformErrorHandler(logger, 'graceful-exit');
const systemErrorHandler = createPlatformErrorHandler(logger, 'system');

function handleGracefulExitError(message, error, eventType = 'graceful-exit', target = 'graceful-exit') {
    const handler = target === 'system' ? systemErrorHandler : gracefulExitErrorHandler;
    if (error instanceof Error) {
        handler.handleEventProcessingError(error, eventType, null, message);
    } else {
        handler.logOperationalError(message, target, error);
    }
}

class GracefulExitService {
    constructor(runtime, targetMessageCount, config = {}) {
        this.runtime = runtime;
        this.targetMessageCount = targetMessageCount;
        this.processedMessageCount = 0;
        this.isShuttingDown = false;

        // Configuration with defaults
        this.config = {
            progressEventInterval: config.progressEventInterval || 5,
            forceExitTimeoutMs: config.forceExitTimeoutMs || 10000,
            nearCompletionThreshold: config.nearCompletionThreshold || 0.9
        };

        // Statistics
        this.stats = {
            startTime: Date.now(),
            lastMessageTime: null
        };

        // Log initialization
        if (this.isEnabled()) {
            logger.debug(`[GracefulExitService] Initialized with target: ${targetMessageCount} messages`, 'graceful-exit');
        }

    }

    isEnabled() {
        return this.targetMessageCount !== null && this.targetMessageCount > 0;
    }

    getTargetMessageCount() {
        return this.targetMessageCount;
    }

    getProcessedMessageCount() {
        return this.processedMessageCount;
    }

    incrementMessageCount() {
        if (!this.isEnabled() || this.isShuttingDown) {
            return false;
        }

        this.processedMessageCount++;
        this.stats.lastMessageTime = Date.now();

        logger.debug(
            `[Message Counter] Processed message ${this.processedMessageCount}/${this.targetMessageCount}`,
            'graceful-exit'
        );

        // Check if target reached
        if (this.processedMessageCount >= this.targetMessageCount) {
            logger.debug(
                `[Message Counter] Target message count reached (${this.targetMessageCount}). Triggering graceful exit...`,
                'graceful-exit'
            );

            return true;
        }

        return false;
    }

    async triggerExit() {
        if (this.isShuttingDown) {
            logger.warn('[GracefulExitService] Shutdown already in progress', 'graceful-exit');
            return;
        }

        this.isShuttingDown = true;

        try {
            // Log exit reason and summary
            const exitMessage = `Graceful exit after processing ${this.processedMessageCount} actual messages (target: ${this.targetMessageCount})`;
            logger.console(`\n[GRACEFUL EXIT] ${exitMessage}`, 'graceful-exit');
            logger.info(exitMessage, 'system');

            // Gather detailed summary
            const summary = this._buildExitSummary();

            // Log detailed summary
            logger.info('Exit summary:', 'system', summary);
            logger.console(`[GRACEFUL EXIT] Summary: Processed ${this.processedMessageCount}/${this.targetMessageCount} messages`, 'graceful-exit');
            logger.console(`[GRACEFUL EXIT] Platforms: ${summary.platforms.join(', ')}`, 'graceful-exit');
            logger.console(`[GRACEFUL EXIT] Starting graceful shutdown...`, 'graceful-exit');

            // Set force exit timeout
            const forceExitTimeout = safeSetTimeout(() => {
                handleGracefulExitError('[GRACEFUL EXIT] Forcing exit due to shutdown timeout', null, 'shutdown-timeout');
                process.exit(1);
            }, this.config.forceExitTimeoutMs);

            // Perform graceful shutdown
            await this.runtime.shutdown();

            // Clear timeout if shutdown succeeded
            clearTimeout(forceExitTimeout);

        } catch (error) {
            handleGracefulExitError(`Error during graceful exit: ${error.message}`, error, 'shutdown', 'system');
            handleGracefulExitError(`[GRACEFUL EXIT] Error during graceful exit: ${error.message}`, error, 'shutdown');

            // Set force exit timeout
            safeSetTimeout(() => {
                handleGracefulExitError('[GRACEFUL EXIT] Forcing exit due to shutdown error', null, 'shutdown-error');
                process.exit(1);
            }, this.config.forceExitTimeoutMs);

            // Still try to shutdown gracefully
            try {
                await this.runtime.shutdown();
            } catch (shutdownError) {
                handleGracefulExitError(`Shutdown failed: ${shutdownError.message}`, shutdownError, 'shutdown', 'system');
            }
        }
    }

    getStats() {
        const percentage = this.isEnabled()
            ? Math.round((this.processedMessageCount / this.targetMessageCount) * 100)
            : 0;

        return {
            enabled: this.isEnabled(),
            processed: this.processedMessageCount,
            target: this.targetMessageCount,
            remaining: this.isEnabled() ? this.targetMessageCount - this.processedMessageCount : 0,
            percentage: percentage,
            isNearingCompletion: percentage >= (this.config.nearCompletionThreshold * 100),
            startTime: this.stats.startTime,
            lastMessageTime: this.stats.lastMessageTime
        };
    }

    stop() {
        logger.debug('[GracefulExitService] Stopping service', 'graceful-exit');
        this.isShuttingDown = true;
    }

    _buildExitSummary() {
        const platformSnapshot = this.runtime.getPlatforms ?
            this.runtime.getPlatforms() :
            null;
        const platforms = platformSnapshot ? Object.keys(platformSnapshot) : [];

        return {
            processedMessages: this.processedMessageCount,
            targetMessages: this.targetMessageCount,
            exitReason: 'Message count target reached',
            timestamp: new Date().toISOString(),
            platforms: platforms,
            uptime: Date.now() - this.stats.startTime
        };
    }
}

function createGracefulExitService(runtime, targetMessageCount, config = {}) {
    return new GracefulExitService(runtime, targetMessageCount, config);
}

module.exports = {
    GracefulExitService,
    createGracefulExitService
};
