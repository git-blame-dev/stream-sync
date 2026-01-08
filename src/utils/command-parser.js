
const { logger } = require('../core/logging');
const { GlobalCommandCooldownManager } = require('./global-command-cooldown');

// Singleton instance for global cooldown management
let globalCooldownManager = null;

function getGlobalCooldownManager() {
    if (!globalCooldownManager) {
        globalCooldownManager = new GlobalCommandCooldownManager(logger);
        logger.debug('Created global cooldown manager singleton', 'command-parser');
    }
    return globalCooldownManager;
}

// Custom debugLog function removed - use logger.debug directly

function updateUserCommandTimestamps(userCommandTimestamps, userHeavyLimit, userId) {
    const now = Date.now();
    if (!userCommandTimestamps[userId]) userCommandTimestamps[userId] = [];
    userCommandTimestamps[userId].push(now);
    userCommandTimestamps[userId] = userCommandTimestamps[userId].filter(t => now - t < 360000);
    if (userCommandTimestamps[userId].length >= 4) {
        userHeavyLimit[userId] = true;
        logger.debug(`User ${userId} is now under heavy command limit.`, 'command-parser');
    }
}

function checkCommandCooldown(userId, currentPlatformCmdCoolDownMs, currentPlatformHeavyCmdCoolDownMs, userCommandTimestamps, userHeavyLimit) {
    const now = Date.now();
    
    // Check if user is under heavy limit
    if (userHeavyLimit[userId]) {
        const lastCommandTime = userCommandTimestamps[userId]?.[userCommandTimestamps[userId].length - 1] || 0;
        if (now - lastCommandTime < currentPlatformHeavyCmdCoolDownMs) {
            return true; // Block command
        }
        // Reset heavy limit if enough time has passed
        userHeavyLimit[userId] = false;
    }
    
    // Check regular cooldown
    const lastCommandTime = userCommandTimestamps[userId]?.[userCommandTimestamps[userId].length - 1] || 0;
    if (now - lastCommandTime < currentPlatformCmdCoolDownMs) {
        return true; // Block command
    }
    
    return false; // Allow command
}

function checkGlobalCommandCooldown(commandName, globalCooldownMs = 60000) {
    const manager = getGlobalCooldownManager();
    return manager.isCommandOnCooldown(commandName, globalCooldownMs);
}

function updateGlobalCommandCooldown(commandName) {
    const manager = getGlobalCooldownManager();
    manager.updateCommandTimestamp(commandName);
}

function getGlobalCooldownStats() {
    const manager = getGlobalCooldownManager();
    return manager.getStats();
}

function getRemainingGlobalCooldown(commandName, globalCooldownMs = 60000) {
    const manager = getGlobalCooldownManager();
    return manager.getRemainingCooldown(commandName, globalCooldownMs);
}

function clearExpiredGlobalCooldowns(maxAgeMs = 300000) {
    const manager = getGlobalCooldownManager();
    return manager.clearExpiredCooldowns(maxAgeMs);
}

module.exports = {
    updateUserCommandTimestamps,
    checkCommandCooldown,
    checkGlobalCommandCooldown,
    updateGlobalCommandCooldown,
    getGlobalCooldownStats,
    getRemainingGlobalCooldown,
    clearExpiredGlobalCooldowns
}; 
