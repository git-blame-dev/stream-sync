const { logger: defaultLogger } = require('../core/logging');
const { safeSetInterval } = require('../utils/timeout-validator');
const { getSystemTimestampISO } = require('../utils/timestamp');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

const COOLDOWN_CONFIG_SECTION = 'cooldowns';
const CONFIG_CHANGE_EVENTS = ['config:changed', 'config:reloaded'];
const GLOBAL_COOLDOWN_EXPIRY_MS = 600000;

interface CooldownsSourceConfig {
    defaultCooldownMs: number;
    heavyCommandCooldownMs: number;
    heavyCommandThreshold: number;
    heavyCommandWindowMs: number;
    globalCmdCooldownMs: number;
    maxEntries: number;
}

interface CooldownConfig {
    defaultCooldown: number;
    heavyCommandCooldown: number;
    heavyCommandThreshold: number;
    heavyCommandWindow: number;
    globalCooldown: number;
    maxEntries: number;
}

interface ConfigChangePayload {
    section?: string;
    value?: Partial<CooldownConfig>;
}

interface EventBusLike {
    emit?: (eventName: string, payload: unknown) => void;
    subscribe?: (eventName: string, handler: (payload?: ConfigChangePayload) => void) => unknown;
}

interface LoggerLike {
    debug: (...args: unknown[]) => void;
}

interface ErrorHandlerLike {
    handleCleanupError: (error: Error, ...args: unknown[]) => void;
    handleEventProcessingError: (...args: unknown[]) => void;
    logOperationalError: (...args: unknown[]) => void;
}

interface CommandCooldownServiceOptions {
    eventBus?: EventBusLike | null;
    logger?: LoggerLike;
    config?: {
        cooldowns: CooldownsSourceConfig;
    };
}

function applyConfigChangePayload(
    payload: ConfigChangePayload | null | undefined,
    onConfigChange: (value: Partial<CooldownConfig> | null | undefined) => void
): void {
    const payloadWithDefault: ConfigChangePayload = payload || {};
    if (!payloadWithDefault.section || payloadWithDefault.section === COOLDOWN_CONFIG_SECTION) {
        onConfigChange(payloadWithDefault.value);
    }
}

class CommandCooldownService {
    eventBus: EventBusLike | null;
    logger: LoggerLike;
    errorHandler: ErrorHandlerLike;
    cooldownsConfig: CooldownsSourceConfig;
    configSubscriptions: unknown[];
    lastConfigRefresh: string | null;
    userLastCommand: Map<string, number>;
    userHeavyLimit: Map<string, boolean>;
    userCommandTimestamps: Map<string, number[]>;
    globalCommandCooldowns: Map<string, number>;
    cleanupInterval: ReturnType<typeof setInterval> | null;
    cooldownConfig!: CooldownConfig;

    constructor(options: CommandCooldownServiceOptions = {}) {
        this.eventBus = options.eventBus || null;
        this.logger = options.logger || defaultLogger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'command-cooldown');
        if (!options.config) {
            throw new Error('CommandCooldownService requires config');
        }
        this.cooldownsConfig = options.config.cooldowns;
        this.configSubscriptions = [];
        this.lastConfigRefresh = null;

        this.userLastCommand = new Map();
        this.userHeavyLimit = new Map();
        this.userCommandTimestamps = new Map();
        this.globalCommandCooldowns = new Map();

        this.loadCooldownConfig();
        this.registerConfigListeners();

        this.cleanupInterval = safeSetInterval(() => this.cleanupExpiredCooldowns(), 60000);

        this.logger.debug('CommandCooldownService initialized', 'CommandCooldownService');
    }

    checkUserCooldown(userId: string | null, platformCooldownMs: number, heavyCooldownMs: number): boolean {
        if (!userId || typeof userId !== 'string') {
            this._handleCooldownError('Invalid userId provided to checkUserCooldown');
            return false;
        }
        if (platformCooldownMs < 0 || heavyCooldownMs < 0) {
            this._handleCooldownError('Negative cooldown values provided');
            return false;
        }

        const now = Date.now();
        const lastCommandTime = this.userLastCommand.get(userId) || 0;

        if (this.userHeavyLimit.get(userId)) {
            const remainingTime = heavyCooldownMs - (now - lastCommandTime);
            if (remainingTime > 0) {
                this.logger.debug(`User ${userId} is under heavy command limit (${Math.ceil(remainingTime / 1000)}s remaining)`, 'CommandCooldownService');

                if (this.eventBus?.emit) {
                    this.eventBus.emit('cooldown:blocked', {
                        userId,
                        type: 'heavy',
                        remainingMs: remainingTime,
                        timestamp: getSystemTimestampISO()
                    });
                }

                return false;
            }

            this.userHeavyLimit.set(userId, false);
            this.logger.debug(`Reset heavy command limit for user ${userId}`, 'CommandCooldownService');
        }

        const remainingCooldown = platformCooldownMs - (now - lastCommandTime);
        if (remainingCooldown > 0) {
            this.logger.debug(`User ${userId} is on regular cooldown (${Math.ceil(remainingCooldown / 1000)}s remaining)`, 'CommandCooldownService');

            if (this.eventBus?.emit) {
                this.eventBus.emit('cooldown:blocked', {
                    userId,
                    type: 'regular',
                    remainingMs: remainingCooldown,
                    timestamp: getSystemTimestampISO()
                });
            }

            return false;
        }

        return true;
    }

    checkGlobalCooldown(commandName: string, globalCooldownMs: number): boolean {
        const now = Date.now();
        const lastExecutionTime = this.globalCommandCooldowns.get(commandName) || 0;
        const remainingTime = globalCooldownMs - (now - lastExecutionTime);

        if (remainingTime > 0) {
            this.logger.debug(`Command ${commandName} is on global cooldown (${Math.ceil(remainingTime / 1000)}s remaining)`, 'CommandCooldownService');

            if (this.eventBus?.emit) {
                this.eventBus.emit('cooldown:global-blocked', {
                    commandName,
                    remainingMs: remainingTime,
                    timestamp: getSystemTimestampISO()
                });
            }

            return false;
        }

        return true;
    }

    updateUserCooldown(userId: string | null): void {
        if (!userId || typeof userId !== 'string') {
            this._handleCooldownError('Invalid userId provided to updateUserCooldown');
            return;
        }

        const now = Date.now();
        this.userLastCommand.set(userId, now);

        this.updateCommandTimestamps(userId);

        if (this.eventBus?.emit) {
            this.eventBus.emit('cooldown:updated', {
                userId,
                timestamp: getSystemTimestampISO(),
                expiresAt: new Date(now + this.cooldownConfig.defaultCooldown).toISOString()
            });
        }
    }

    updateGlobalCooldown(commandName: string): void {
        const now = Date.now();
        this.globalCommandCooldowns.set(commandName, now);

        this.logger.debug(`Global cooldown started for command ${commandName}`, 'CommandCooldownService');
    }

    updateCommandTimestamps(userId: string): void {
        const now = Date.now();

        if (!this.userCommandTimestamps.has(userId)) {
            this.userCommandTimestamps.set(userId, []);
        }

        const timestamps = this.userCommandTimestamps.get(userId) || [];
        timestamps.push(now);

        const windowStart = now - this.cooldownConfig.heavyCommandWindow;
        const filteredTimestamps = timestamps.filter(t => t >= windowStart);
        this.userCommandTimestamps.set(userId, filteredTimestamps);

        if (filteredTimestamps.length >= this.cooldownConfig.heavyCommandThreshold) {
            this.userHeavyLimit.set(userId, true);
            this.logger.debug(`User ${userId} is now under heavy command limit (${filteredTimestamps.length} commands in ${this.cooldownConfig.heavyCommandWindow}ms)`, 'CommandCooldownService');

            if (this.eventBus?.emit) {
                this.eventBus.emit('cooldown:heavy-detected', {
                    userId,
                    commandCount: filteredTimestamps.length,
                    windowMs: this.cooldownConfig.heavyCommandWindow,
                    timestamp: getSystemTimestampISO()
                });
            }
        }
    }

    cleanupExpiredCooldowns(): void {
        const now = Date.now();
        let cleanedCount = 0;

        if (this.userCommandTimestamps.size > this.cooldownConfig.maxEntries) {
            const entriesToDelete = Array.from(this.userCommandTimestamps.keys())
                .slice(0, Math.floor(this.cooldownConfig.maxEntries / 2));

            entriesToDelete.forEach(userId => {
                this.userCommandTimestamps.delete(userId);
                this.userLastCommand.delete(userId);
                this.userHeavyLimit.delete(userId);
                cleanedCount++;
            });

            this.logger.debug(`Cleaned up ${cleanedCount} old cooldown entries`, 'CommandCooldownService');
        }

        for (const [commandName, timestamp] of this.globalCommandCooldowns.entries()) {
            if (now - timestamp > GLOBAL_COOLDOWN_EXPIRY_MS) {
                this.globalCommandCooldowns.delete(commandName);
            }
        }
    }

    getCooldownStatus(userId: string) {
        const now = Date.now();
        const lastCommandTime = this.userLastCommand.get(userId) || 0;
        const isHeavyLimit = this.userHeavyLimit.get(userId) || false;
        const commandHistory = this.userCommandTimestamps.get(userId) || [];

        return {
            userId,
            lastCommandTime,
            isHeavyLimit,
            commandCount: commandHistory.length,
            timeSinceLastCommand: now - lastCommandTime
        };
    }

    resetUserCooldown(userId: string): void {
        this.userLastCommand.delete(userId);
        this.userHeavyLimit.delete(userId);
        this.userCommandTimestamps.delete(userId);

        this.logger.debug(`Reset all cooldowns for user ${userId}`, 'CommandCooldownService');

        if (this.eventBus?.emit) {
            this.eventBus.emit('cooldown:reset', {
                userId,
                timestamp: getSystemTimestampISO()
            });
        }
    }

    dispose(): void {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        this.configSubscriptions.forEach((unsubscribe) => {
            if (typeof unsubscribe === 'function') {
                try {
                    unsubscribe();
                } catch (error) {
                    const unsubscribeError = error instanceof Error ? error : new Error(String(error));
                    this.errorHandler.handleCleanupError(unsubscribeError, 'config-listener', `Error unsubscribing config listener: ${unsubscribeError.message}`);
                }
            }
        });
        this.configSubscriptions = [];

        this.userLastCommand.clear();
        this.userHeavyLimit.clear();
        this.userCommandTimestamps.clear();
        this.globalCommandCooldowns.clear();

        this.logger.debug('CommandCooldownService disposed', 'CommandCooldownService');
    }

    loadCooldownConfig(overrides: Partial<CooldownConfig> | null = null): void {
        const defaults: CooldownConfig = {
            defaultCooldown: this.cooldownsConfig.defaultCooldownMs,
            heavyCommandCooldown: this.cooldownsConfig.heavyCommandCooldownMs,
            heavyCommandThreshold: this.cooldownsConfig.heavyCommandThreshold,
            heavyCommandWindow: this.cooldownsConfig.heavyCommandWindowMs,
            globalCooldown: this.cooldownsConfig.globalCmdCooldownMs,
            maxEntries: this.cooldownsConfig.maxEntries
        };

        const normalizedConfig: CooldownConfig = { ...defaults };
        if (overrides) {
            if (overrides.defaultCooldown !== undefined) {
                normalizedConfig.defaultCooldown = this.normalizeDuration(overrides.defaultCooldown, defaults.defaultCooldown);
            }
            if (overrides.heavyCommandCooldown !== undefined) {
                normalizedConfig.heavyCommandCooldown = this.normalizeDuration(overrides.heavyCommandCooldown, defaults.heavyCommandCooldown);
            }
            if (overrides.heavyCommandThreshold !== undefined) {
                normalizedConfig.heavyCommandThreshold = this.normalizeNumber(overrides.heavyCommandThreshold, defaults.heavyCommandThreshold);
            }
            if (overrides.heavyCommandWindow !== undefined) {
                normalizedConfig.heavyCommandWindow = this.normalizeDuration(overrides.heavyCommandWindow, defaults.heavyCommandWindow);
            }
            if (overrides.globalCooldown !== undefined) {
                normalizedConfig.globalCooldown = this.normalizeDuration(overrides.globalCooldown, defaults.globalCooldown);
            }
            if (overrides.maxEntries !== undefined) {
                normalizedConfig.maxEntries = this.normalizeNumber(overrides.maxEntries, defaults.maxEntries);
            }
        }

        this.cooldownConfig = normalizedConfig;
        this.lastConfigRefresh = getSystemTimestampISO();
        this.logger.debug('Cooldown configuration loaded', 'CommandCooldownService', normalizedConfig);
    }

    normalizeDuration(value: unknown, fallback: number): number {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return fallback;
        }

        return numeric * 1000;
    }

    normalizeNumber(value: unknown, fallback: number): number {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return fallback;
        }
        return numeric;
    }

    registerConfigListeners(): void {
        if (!this.eventBus || typeof this.eventBus.subscribe !== 'function') {
            return;
        }

        for (const eventName of CONFIG_CHANGE_EVENTS) {
            const unsubscribe = this.eventBus.subscribe(eventName, (payload) => {
                applyConfigChangePayload(payload, (value) => {
                    this.loadCooldownConfig(value || null);
                });
            });
            this.configSubscriptions.push(unsubscribe);
        }
    }

    getStatus() {
        const heavyLimitUsers = Array.from(this.userHeavyLimit.values()).filter(Boolean).length;

        return {
            config: { ...this.cooldownConfig },
            activeUsers: this.userLastCommand.size,
            heavyLimitUsers,
            globalCommandsTracked: this.globalCommandCooldowns.size,
            lastConfigRefresh: this.lastConfigRefresh
        };
    }

    _handleCooldownError(message: string, error: Error | null = null): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'cooldown-validation', null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'command-cooldown');
        }
    }
}

module.exports = CommandCooldownService;
