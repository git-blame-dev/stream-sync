
const { createPlatformErrorHandler } = require('./platform-error-handler');

class GlobalCommandCooldownManager {
    constructor(logger) {
        this.logger = logger;
        this.commandTimestamps = new Map();
        this.stats = {
            totalChecks: 0,
            totalBlocks: 0,
            totalUpdates: 0
        };
        this.errorHandler = logger ? createPlatformErrorHandler(logger, 'global-cooldown') : null;
    }

    isCommandOnCooldown(commandName, cooldownMs) {
        try {
            this.stats.totalChecks++;

            // Allow execution for invalid parameters
            if (!commandName || typeof commandName !== 'string' || cooldownMs <= 0) {
                this.logger.debug(
                    `Allowing command execution due to invalid parameters: command="${commandName}", cooldown=${cooldownMs}`,
                    'global-cooldown'
                );
                return false;
            }

            const now = Date.now();
            const lastExecutionTime = this.commandTimestamps.get(commandName);

            // No previous execution - allow command
            if (!lastExecutionTime) {
                this.logger.debug(
                    `No previous execution found for command ${commandName} - allowing execution`,
                    'global-cooldown'
                );
                return false;
            }

            const timeSinceLastExecution = now - lastExecutionTime;

            // Check if cooldown period has passed
            if (timeSinceLastExecution < cooldownMs) {
                this.stats.totalBlocks++;
                this.logger.debug(
                    `Global cooldown active for command ${commandName}. Last used ${timeSinceLastExecution}ms ago, cooldown: ${cooldownMs}ms`,
                    'global-cooldown'
                );
                return true; // Block command
            }

            this.logger.debug(
                `Global cooldown expired for command ${commandName}. Last used ${timeSinceLastExecution}ms ago, cooldown: ${cooldownMs}ms`,
                'global-cooldown'
            );
            return false; // Allow command
        } catch (error) {
            // Fail-safe: allow command execution if there's an error
            this._handleCooldownError(
                `Error checking global cooldown for ${commandName}: ${error.message}`,
                error,
                { commandName, cooldownMs }
            );
            return false;
        }
    }

    updateCommandTimestamp(commandName) {
        if (!commandName || typeof commandName !== 'string') {
            this.logger.debug(
                `Skipping timestamp update for invalid command name: ${commandName}`,
                'global-cooldown'
            );
            return;
        }

        const now = Date.now();
        this.commandTimestamps.set(commandName, now);
        this.stats.totalUpdates++;

        this.logger.debug(
            `Updated global cooldown timestamp for command ${commandName}`,
            'global-cooldown'
        );
    }

    getStats() {
        const commandsOnCooldown = Array.from(this.commandTimestamps.values())
            .filter(timestamp => Date.now() - timestamp < 300000) // Count as "on cooldown" if within 5 minutes
            .length;

        const oldestTimestamp = this.commandTimestamps.size > 0 
            ? Math.min(...Array.from(this.commandTimestamps.values()))
            : 0;

        return {
            totalTrackedCommands: this.commandTimestamps.size,
            commandsOnCooldown: commandsOnCooldown,
            oldestCommandTimestamp: oldestTimestamp,
            totalChecks: this.stats.totalChecks,
            totalBlocks: this.stats.totalBlocks,
            totalUpdates: this.stats.totalUpdates,
            blockRate: this.stats.totalChecks > 0 ? (this.stats.totalBlocks / this.stats.totalChecks) : 0
        };
    }

    clearExpiredCooldowns(maxAgeMs = 300000) { // Default 5 minutes
        const now = Date.now();
        let removedCount = 0;

        for (const [commandName, timestamp] of this.commandTimestamps.entries()) {
            if (now - timestamp > maxAgeMs) {
                this.commandTimestamps.delete(commandName);
                removedCount++;
            }
        }

        if (removedCount > 0) {
            this.logger.debug(
                `Cleared ${removedCount} expired cooldowns (kept ${this.commandTimestamps.size} active)`,
                'global-cooldown'
            );
        }

        return removedCount;
    }

    getRemainingCooldown(commandName, cooldownMs) {
        if (!commandName || typeof commandName !== 'string' || cooldownMs <= 0) {
            return 0;
        }

        const lastExecutionTime = this.commandTimestamps.get(commandName);
        if (!lastExecutionTime) {
            return 0;
        }

        const timeSinceLastExecution = Date.now() - lastExecutionTime;
        const remainingTime = cooldownMs - timeSinceLastExecution;

        return Math.max(0, remainingTime);
    }

    resetAllCooldowns() {
        const clearedCount = this.commandTimestamps.size;
        this.commandTimestamps.clear();
        this.stats = {
            totalChecks: 0,
            totalBlocks: 0,
            totalUpdates: 0
        };

        this.logger.debug(
            `Reset all global cooldowns (cleared ${clearedCount} commands)`,
            'global-cooldown'
        );
    }
}

module.exports = {
    GlobalCommandCooldownManager
};

GlobalCommandCooldownManager.prototype._handleCooldownError = function(message, error, contextData = null) {
    if (!this.errorHandler && this.logger) {
        this.errorHandler = createPlatformErrorHandler(this.logger, 'global-cooldown');
    }

    if (this.errorHandler && error instanceof Error) {
        this.errorHandler.handleEventProcessingError(error, 'global-cooldown', contextData, message);
        return;
    }

    if (this.errorHandler) {
        this.errorHandler.logOperationalError(message, 'global-cooldown', contextData);
    }
};
