
const { logger } = require('../core/logging');
const { safeSetInterval } = require('../utils/timeout-validator');
const { getSystemTimestampISO } = require('../utils/timestamp');

const COOLDOWN_CONFIG_SECTION = 'cooldowns';
const CONFIG_CHANGE_EVENTS = ['config:changed', 'config:reloaded'];
const GLOBAL_COOLDOWN_EXPIRY_MS = 600000;

class CommandCooldownService {
    constructor(options = {}) {
        this.eventBus = options.eventBus || null;
        this.logger = options.logger || logger;
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

    checkUserCooldown(userId, platformCooldownMs, heavyCooldownMs) {
        if (!userId || typeof userId !== 'string') {
            this.logger.warn('Invalid userId provided to checkUserCooldown', 'CommandCooldownService');
            return false;
        }
        if (platformCooldownMs < 0 || heavyCooldownMs < 0) {
            this.logger.warn('Negative cooldown values provided', 'CommandCooldownService');
            return false;
        }

        const now = Date.now();
        const lastCommandTime = this.userLastCommand.get(userId) || 0;

        if (this.userHeavyLimit.get(userId)) {
            const remainingTime = heavyCooldownMs - (now - lastCommandTime);
            if (remainingTime > 0) {
                this.logger.debug(`User ${userId} is under heavy command limit (${Math.ceil(remainingTime / 1000)}s remaining)`, 'CommandCooldownService');

                if (this.eventBus) {
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

            if (this.eventBus) {
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

    checkGlobalCooldown(commandName, globalCooldownMs) {
        const now = Date.now();
        const lastExecutionTime = this.globalCommandCooldowns.get(commandName) || 0;
        const remainingTime = globalCooldownMs - (now - lastExecutionTime);

        if (remainingTime > 0) {
            this.logger.debug(`Command ${commandName} is on global cooldown (${Math.ceil(remainingTime / 1000)}s remaining)`, 'CommandCooldownService');

            if (this.eventBus) {
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

    updateUserCooldown(userId) {
        if (!userId || typeof userId !== 'string') {
            this.logger.warn('Invalid userId provided to updateUserCooldown', 'CommandCooldownService');
            return;
        }

        const now = Date.now();
        this.userLastCommand.set(userId, now);

        this.updateCommandTimestamps(userId);

        if (this.eventBus) {
            this.eventBus.emit('cooldown:updated', {
                userId,
                timestamp: getSystemTimestampISO(),
                expiresAt: new Date(now + this.cooldownConfig.defaultCooldown).toISOString()
            });
        }
    }

    updateGlobalCooldown(commandName) {
        const now = Date.now();
        this.globalCommandCooldowns.set(commandName, now);

        this.logger.debug(`Global cooldown started for command ${commandName}`, 'CommandCooldownService');
    }

    updateCommandTimestamps(userId) {
        const now = Date.now();

        if (!this.userCommandTimestamps.has(userId)) {
            this.userCommandTimestamps.set(userId, []);
        }

        const timestamps = this.userCommandTimestamps.get(userId);
        timestamps.push(now);

        const windowStart = now - this.cooldownConfig.heavyCommandWindow;
        const filteredTimestamps = timestamps.filter(t => t >= windowStart);
        this.userCommandTimestamps.set(userId, filteredTimestamps);

        if (filteredTimestamps.length >= this.cooldownConfig.heavyCommandThreshold) {
            this.userHeavyLimit.set(userId, true);
            this.logger.debug(`User ${userId} is now under heavy command limit (${filteredTimestamps.length} commands in ${this.cooldownConfig.heavyCommandWindow}ms)`, 'CommandCooldownService');

            if (this.eventBus) {
                this.eventBus.emit('cooldown:heavy-detected', {
                    userId,
                    commandCount: filteredTimestamps.length,
                    windowMs: this.cooldownConfig.heavyCommandWindow,
                    timestamp: getSystemTimestampISO()
                });
            }
        }
    }

    cleanupExpiredCooldowns() {
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

    getCooldownStatus(userId) {
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

    resetUserCooldown(userId) {
        this.userLastCommand.delete(userId);
        this.userHeavyLimit.delete(userId);
        this.userCommandTimestamps.delete(userId);

        this.logger.debug(`Reset all cooldowns for user ${userId}`, 'CommandCooldownService');

        if (this.eventBus) {
            this.eventBus.emit('cooldown:reset', {
                userId,
                timestamp: getSystemTimestampISO()
            });
        }
    }

    dispose() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }

        this.configSubscriptions.forEach((unsubscribe) => {
            if (typeof unsubscribe === 'function') {
                try {
                    unsubscribe();
                } catch (error) {
                    this.logger.warn(`Error unsubscribing config listener: ${error.message}`, 'CommandCooldownService');
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

    loadCooldownConfig(overrides = null) {
        const defaults = {
            defaultCooldown: this.cooldownsConfig.defaultCooldownMs,
            heavyCommandCooldown: this.cooldownsConfig.heavyCommandCooldownMs,
            heavyCommandThreshold: this.cooldownsConfig.heavyCommandThreshold,
            heavyCommandWindow: this.cooldownsConfig.heavyCommandWindowMs,
            globalCooldown: this.cooldownsConfig.globalCmdCooldownMs,
            maxEntries: this.cooldownsConfig.maxEntries
        };

        const source = overrides || this.getCooldownOverridesFromConfig();

        const normalizedConfig = { ...defaults };
        if (source) {
            if (source.defaultCooldown !== undefined) {
                normalizedConfig.defaultCooldown = this.normalizeDuration(source.defaultCooldown, defaults.defaultCooldown);
            }
            if (source.heavyCommandCooldown !== undefined) {
                normalizedConfig.heavyCommandCooldown = this.normalizeDuration(source.heavyCommandCooldown, defaults.heavyCommandCooldown);
            }
            if (source.heavyCommandThreshold !== undefined) {
                normalizedConfig.heavyCommandThreshold = this.normalizeNumber(source.heavyCommandThreshold, defaults.heavyCommandThreshold);
            }
            if (source.heavyCommandWindow !== undefined) {
                normalizedConfig.heavyCommandWindow = this.normalizeDuration(source.heavyCommandWindow, defaults.heavyCommandWindow);
            }
            if (source.globalCooldown !== undefined) {
                normalizedConfig.globalCooldown = this.normalizeDuration(source.globalCooldown, defaults.globalCooldown);
            }
            if (source.maxEntries !== undefined) {
                normalizedConfig.maxEntries = this.normalizeNumber(source.maxEntries, defaults.maxEntries);
            }
        }

        this.cooldownConfig = normalizedConfig;
        this.lastConfigRefresh = new Date();
        this.logger.debug('Cooldown configuration loaded', 'CommandCooldownService', normalizedConfig);
    }

    normalizeDuration(value, fallback) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return fallback;
        }

        return numeric * 1000;
    }

    normalizeNumber(value, fallback) {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            return fallback;
        }
        return numeric;
    }

    getCooldownOverridesFromConfig() {
        return null;
    }

    registerConfigListeners() {
        if (!this.eventBus || typeof this.eventBus.subscribe !== 'function') {
            return;
        }

        CONFIG_CHANGE_EVENTS.forEach((eventName) => {
            const unsubscribe = this.eventBus.subscribe(eventName, (payload = {}) => {
                if (!payload.section || payload.section === COOLDOWN_CONFIG_SECTION) {
                    this.loadCooldownConfig(payload.value);
                }
            });
            this.configSubscriptions.push(unsubscribe);
        });
    }

    getStatus() {
        const heavyLimitUsers = Array.from(this.userHeavyLimit.values()).filter(Boolean).length;

        return {
            config: { ...this.cooldownConfig },
            activeUsers: this.userLastCommand.size,
            heavyLimitUsers,
            globalCommandsTracked: this.globalCommandCooldowns.size,
            lastConfigRefresh: this.lastConfigRefresh ? this.lastConfigRefresh.toISOString() : null
        };
    }
}

module.exports = CommandCooldownService;
