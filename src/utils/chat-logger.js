
const { logger: defaultLogger } = require('../core/logging');

function logChatMessage(platform, normalizedData, options = {}, deps = {}) {
    const logger = deps.logger || defaultLogger;
    const {
        includeUserId = false,
        truncateMessage = true,
        maxMessageLength = 200
    } = options;

    if (!platform || !normalizedData) {
        logger.warn('Invalid parameters provided to logChatMessage', 'chat-logger');
        return;
    }
    
    const username = typeof normalizedData.username === 'string' ? normalizedData.username.trim() : '';
    const userId = typeof normalizedData.userId === 'string' ? normalizedData.userId.trim() : '';
    if (!username || !userId) {
        logger.warn('Chat message missing canonical identity; skipping log entry', 'chat-logger', {
            platform,
            username: normalizedData.username,
            userId: normalizedData.userId
        });
        return;
    }
    
    // Truncate message if needed
    let message = typeof normalizedData.message === 'string' ? normalizedData.message : '';
    if (truncateMessage && message.length > maxMessageLength) {
        message = message.substring(0, maxMessageLength - 3) + '...';
    }
    
    // Format log entry
    let logEntry;
    if (includeUserId) {
        logEntry = `[${platform}] ${username} (${userId}): ${message}`;
    } else {
        logEntry = `[${platform}] ${username}: ${message}`;
    }
    
    // Log to console
    logger.console(logEntry, 'chat-logger');
    
    // Debug logging with additional context
    logger.debug(`Chat message logged from ${platform}`, 'chat-logger', {
        platform,
        username,
        userId,
        messageLength: normalizedData.message?.length || 0,
        timestamp: normalizedData.timestamp
    });
}

function logChatMessageDebug(platform, normalizedData, context = '', deps = {}) {
    const logger = deps.logger || defaultLogger;
    if (!platform || !normalizedData) {
        return;
    }

    const username = typeof normalizedData.username === 'string' ? normalizedData.username.trim() : '';
    const userId = typeof normalizedData.userId === 'string' ? normalizedData.userId.trim() : '';
    if (!username || !userId) {
        return;
    }
    const message = normalizedData.message || '';

    const debugMessage = context
        ? `[${platform} Debug] ${context}: ${username} (${userId}) - ${message}`
        : `[${platform} Debug] ${username} (${userId}) - ${message}`;

    logger.debug(debugMessage, 'chat-logger');
}

function logChatMessageSkipped(platform, normalizedData, reason, deps = {}) {
    const logger = deps.logger || defaultLogger;
    if (!platform || !normalizedData || !reason) {
        return;
    }

    const username = typeof normalizedData.username === 'string' ? normalizedData.username.trim() : '';
    const userId = typeof normalizedData.userId === 'string' ? normalizedData.userId.trim() : '';
    if (!username || !userId) {
        return;
    }

    logger.debug(`[${platform}] Skipping message from ${username} (${userId}): ${reason}`, 'chat-logger');
}

function logChatMessageStats(platform, stats, deps = {}) {
    const logger = deps.logger || defaultLogger;
    if (!platform || !stats) {
        return;
    }

    logger.info(`[${platform}] Chat Stats - Total: ${stats.total}, Processed: ${stats.processed}, Skipped: ${stats.skipped}, Commands: ${stats.commands}`, 'chat-logger');
}

function getChatLogLevel(config, platform) {
    if (!config) return 'debug';
    
    // Check if chat logging is enabled globally
    if (config.general?.logChatMessages === false) {
        return 'debug'; // Still log to debug even if console logging is disabled
    }
    
    // Check platform-specific chat logging settings
    const platformConfig = config[platform];
    if (platformConfig?.logChatMessages === false) {
        return 'debug';
    }
    
    return 'console';
}

function logChatMessageWithConfig(platform, normalizedData, config, options = {}, deps = {}) {
    const logLevel = getChatLogLevel(config, platform);

    if (logLevel === 'console') {
        logChatMessage(platform, normalizedData, options, deps);
    } else {
        logChatMessageDebug(platform, normalizedData, 'console logging disabled', deps);
    }
}

module.exports = {
    logChatMessage,
    logChatMessageDebug,
    logChatMessageSkipped,
    logChatMessageStats,
    getChatLogLevel,
    logChatMessageWithConfig
};
