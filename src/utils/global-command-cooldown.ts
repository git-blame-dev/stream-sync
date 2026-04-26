import { createPlatformErrorHandler } from './platform-error-handler';

type CooldownLogger = {
    debug: (message: string, source?: string) => void;
};

class GlobalCommandCooldownManager {
    logger: CooldownLogger;
    commandTimestamps: Map<string, number>;
    stats: {
        totalChecks: number;
        totalBlocks: number;
        totalUpdates: number;
    };
    errorHandler: ReturnType<typeof createPlatformErrorHandler> | null;

    constructor(logger: CooldownLogger) {
        this.logger = logger;
        this.commandTimestamps = new Map();
        this.stats = {
            totalChecks: 0,
            totalBlocks: 0,
            totalUpdates: 0
        };
        this.errorHandler = logger ? createPlatformErrorHandler(logger, 'global-cooldown') : null;
    }

    isCommandOnCooldown(commandName: unknown, cooldownMs: unknown): boolean {
        try {
            this.stats.totalChecks++;

            if (typeof commandName !== 'string' || commandName.length === 0 || typeof cooldownMs !== 'number' || cooldownMs <= 0) {
                this.logger.debug(
                    `Allowing command execution due to invalid parameters: command="${String(commandName)}", cooldown=${String(cooldownMs)}`,
                    'global-cooldown'
                );
                return false;
            }

            const now = Date.now();
            const lastExecutionTime = this.commandTimestamps.get(commandName);

            if (!lastExecutionTime) {
                this.logger.debug(
                    `No previous execution found for command ${commandName} - allowing execution`,
                    'global-cooldown'
                );
                return false;
            }

            const timeSinceLastExecution = now - lastExecutionTime;

            if (timeSinceLastExecution < cooldownMs) {
                this.stats.totalBlocks++;
                this.logger.debug(
                    `Global cooldown active for command ${commandName}. Last used ${timeSinceLastExecution}ms ago, cooldown: ${cooldownMs}ms`,
                    'global-cooldown'
                );
                return true;
            }

            this.logger.debug(
                `Global cooldown expired for command ${commandName}. Last used ${timeSinceLastExecution}ms ago, cooldown: ${cooldownMs}ms`,
                'global-cooldown'
            );
            return false;
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            this.handleCooldownError(
                `Error checking global cooldown for ${String(commandName)}: ${errorMessage}`,
                error,
                { commandName, cooldownMs }
            );
            return false;
        }
    }

    updateCommandTimestamp(commandName: unknown): void {
        if (typeof commandName !== 'string' || commandName.length === 0) {
            this.logger.debug(
                `Skipping timestamp update for invalid command name: ${String(commandName)}`,
                'global-cooldown'
            );
            return;
        }

        this.commandTimestamps.set(commandName, Date.now());
        this.stats.totalUpdates++;

        this.logger.debug(
            `Updated global cooldown timestamp for command ${commandName}`,
            'global-cooldown'
        );
    }

    getStats() {
        const commandsOnCooldown = Array.from(this.commandTimestamps.values())
            .filter((timestamp) => Date.now() - timestamp < 300000)
            .length;

        const oldestTimestamp = this.commandTimestamps.size > 0
            ? Math.min(...Array.from(this.commandTimestamps.values()))
            : 0;

        return {
            totalTrackedCommands: this.commandTimestamps.size,
            commandsOnCooldown,
            oldestCommandTimestamp: oldestTimestamp,
            totalChecks: this.stats.totalChecks,
            totalBlocks: this.stats.totalBlocks,
            totalUpdates: this.stats.totalUpdates,
            blockRate: this.stats.totalChecks > 0 ? (this.stats.totalBlocks / this.stats.totalChecks) : 0
        };
    }

    clearExpiredCooldowns(maxAgeMs = 300000): number {
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

    getRemainingCooldown(commandName: unknown, cooldownMs: unknown): number {
        if (typeof commandName !== 'string' || commandName.length === 0 || typeof cooldownMs !== 'number' || cooldownMs <= 0) {
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

    resetAllCooldowns(): void {
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

    private handleCooldownError(message: string, error: unknown, contextData: Record<string, unknown> | null = null): void {
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
    }
}

let globalCooldownManager: GlobalCommandCooldownManager | null = null;

function getGlobalCooldownManager(): GlobalCommandCooldownManager {
    if (!globalCooldownManager) {
        const { logger } = require('../core/logging') as { logger: CooldownLogger };
        globalCooldownManager = new GlobalCommandCooldownManager(logger);
    }
    return globalCooldownManager;
}

function checkGlobalCommandCooldown(commandName: string, globalCooldownMs = 60000): boolean {
    return getGlobalCooldownManager().isCommandOnCooldown(commandName, globalCooldownMs);
}

function updateGlobalCommandCooldown(commandName: string): void {
    getGlobalCooldownManager().updateCommandTimestamp(commandName);
}

function clearExpiredGlobalCooldowns(maxAgeMs = 300000): number {
    return getGlobalCooldownManager().clearExpiredCooldowns(maxAgeMs);
}

export {
    GlobalCommandCooldownManager,
    checkGlobalCommandCooldown,
    updateGlobalCommandCooldown,
    clearExpiredGlobalCooldowns
};
