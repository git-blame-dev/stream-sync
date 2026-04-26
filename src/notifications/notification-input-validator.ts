const MONETIZATION_TYPES = new Set([
    'platform:gift',
    'platform:paypiggy',
    'platform:giftpaypiggy',
    'platform:envelope'
]);

const SUPPORTED_PLATFORMS = new Set(['twitch', 'youtube', 'tiktok']);

type NotificationConfig = Record<string, unknown>;
type NotificationConfigs = Record<string, NotificationConfig>;

type PlatformValidationResult =
    | { success: true; canonicalPlatform: string }
    | { success: false; error: string; errorType: string };

type DataValidationResult =
    | { success: true }
    | { success: false; error: string; errorType: string };

type TypeValidationResult =
    | {
        success: true;
        canonicalType: string;
        config: NotificationConfig;
        incomingType: unknown;
        isMonetizationType: boolean;
    }
    | {
        success: false;
        error: string;
        errorType: string;
        canonicalType?: string;
        incomingType?: unknown;
    };

class NotificationInputValidator {
    notificationConfigs: NotificationConfigs;

    constructor(notificationConfigs: NotificationConfigs = {}) {
        this.notificationConfigs = notificationConfigs;
    }

    validatePlatform(platform: unknown): PlatformValidationResult {
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

    validateData(data: unknown): DataValidationResult {
        if (!data || typeof data !== 'object') {
            return { success: false, error: 'Invalid notification data', errorType: 'invalid-data' };
        }

        return { success: true };
    }

    validateType(notificationType: string, data: unknown): TypeValidationResult {
        const config = this.notificationConfigs[notificationType];
        if (!config) {
            return { success: false, error: 'Unknown notification type', errorType: 'unknown-notification-type' };
        }

        const incomingType = typeof data === 'object' && data !== null
            ? (data as { type?: unknown }).type
            : undefined;

        if (incomingType !== undefined && incomingType !== null && incomingType !== notificationType) {
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

export {
    NotificationInputValidator
};
