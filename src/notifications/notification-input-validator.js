const MONETIZATION_TYPES = new Set([
    'platform:gift',
    'platform:paypiggy',
    'platform:giftpaypiggy',
    'platform:envelope'
]);

const SUPPORTED_PLATFORMS = new Set(['twitch', 'youtube', 'tiktok']);

class NotificationInputValidator {
    constructor(notificationConfigs = {}) {
        this.notificationConfigs = notificationConfigs;
    }

    validatePlatform(platform) {
        if (typeof platform !== 'string') {
            return { success: false, error: 'Invalid platform type', errorType: 'invalid-platform' };
        }

        const canonicalPlatform = platform.trim().toLowerCase();
        if (!canonicalPlatform || !SUPPORTED_PLATFORMS.has(canonicalPlatform)) {
            return { success: false, error: 'Unsupported platform', errorType: 'unsupported-platform' };
        }

        return {
            success: true,
            canonicalPlatform
        };
    }

    validateData(data) {
        if (!data || typeof data !== 'object') {
            return { success: false, error: 'Invalid notification data', errorType: 'invalid-data' };
        }
        return { success: true };
    }

    validateType(notificationType, data) {
        const config = this.notificationConfigs[notificationType];
        if (!config) {
            return { success: false, error: 'Unknown notification type', errorType: 'unknown-notification-type' };
        }

        const incomingType = data?.type;
        if (incomingType && incomingType !== notificationType) {
            return {
                success: false,
                error: 'Unknown notification type',
                errorType: 'incoming-type-mismatch',
                canonicalType: notificationType,
                incomingType
            };
        }

        return {
            success: true,
            canonicalType: notificationType,
            config,
            incomingType,
            isMonetizationType: MONETIZATION_TYPES.has(notificationType)
        };
    }
}

module.exports = {
    NotificationInputValidator
};
