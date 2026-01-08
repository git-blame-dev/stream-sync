
const { NOTIFICATION_CONFIGS } = require('../core/constants');

// Performance optimization: precompute common type sets
let notificationTypeSet = null;
const CHAT_TYPE = 'chat';

function isNotificationType(type) {
    if (!type || typeof type !== 'string') {
        return false;
    }
    
    // Lazy initialize cache for O(1) lookup performance
    if (!notificationTypeSet) {
        notificationTypeSet = new Set(Object.keys(NOTIFICATION_CONFIGS));
    }
    
    return notificationTypeSet.has(type);
}

function isChatType(type) {
    return type === CHAT_TYPE;
}

function getNotificationConfig(type) {
    if (!isNotificationType(type)) {
        return null;
    }
    
    return NOTIFICATION_CONFIGS[type];
}

function getAllNotificationTypes() {
    return Object.keys(NOTIFICATION_CONFIGS);
}

function isValidDisplayItemType(type) {
    return isChatType(type) || isNotificationType(type);
}

function getNotificationDuration(type) {
    // Display timing is TTS-driven; duration fields are no longer used
    return 0;
}

function clearCache() {
    notificationTypeSet = null;
}

module.exports = {
    // Type checking functions
    isNotificationType,
    isChatType,
    isValidDisplayItemType,
    
    // Configuration access functions
    getNotificationConfig,
    getAllNotificationTypes,
    getNotificationDuration,
    
    // Utility functions
    clearCache
};
