import { allowsYouTubeJewelsMissingUserId } from '../utils/missing-fields';
import { isIsoTimestamp } from '../utils/timestamp';

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

type NotificationRecord = Record<string, unknown>;

type PayloadValidationOptions = {
    notificationType: string;
    platform: string;
    requireTimestamp?: boolean;
};

type PayloadValidationResult =
    | { success: true; payload: NotificationRecord }
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

    validateNotificationPayload(data: unknown, options: PayloadValidationOptions): PayloadValidationResult {
        const dataValidation = this.validateData(data);
        if (!dataValidation.success) {
            return dataValidation;
        }

        const platformValidation = this.validatePlatform(options.platform);
        if (!platformValidation.success) {
            return platformValidation;
        }

        const notificationType = options.notificationType;
        const platform = platformValidation.canonicalPlatform;
        const requireTimestamp = options.requireTimestamp !== false;
        const sanitized: NotificationRecord = { ...(data as NotificationRecord) };

        delete sanitized.type;
        delete sanitized.platform;
        delete sanitized.user;
        delete sanitized.displayName;

        if (!notificationType) {
            return { success: false, error: 'Notification payload requires type', errorType: 'missing-type' };
        }

        const isErrorPayload = sanitized.isError === true;
        if (requireTimestamp || sanitized.timestamp !== undefined) {
            if (!sanitized.timestamp || !isIsoTimestamp(String(sanitized.timestamp))) {
                return { success: false, error: 'Notification payload requires ISO timestamp', errorType: 'missing-timestamp' };
            }
        }

        const normalizedUserIdValue = sanitized.userId === undefined || sanitized.userId === null
            ? ''
            : String(sanitized.userId).trim();
        const normalizedUserId = normalizedUserIdValue || undefined;
        const normalizedUsername = typeof sanitized.username === 'string' ? sanitized.username.trim() : '';
        const metadata = sanitized.metadata && typeof sanitized.metadata === 'object'
            ? sanitized.metadata as NotificationRecord
            : null;
        const allowsMissingUserId = allowsYouTubeJewelsMissingUserId({
            type: notificationType,
            platform,
            currency: sanitized.currency,
            metadata
        });
        const allowsAnonymous = sanitized.isAnonymous === true &&
            (notificationType === 'platform:gift' || notificationType === 'platform:giftpaypiggy');

        if (!isErrorPayload) {
            if (!allowsAnonymous) {
                if (!normalizedUsername) {
                    return { success: false, error: 'Notification payload requires username', errorType: 'missing-username' };
                }
                if (!normalizedUserId && !allowsMissingUserId) {
                    return { success: false, error: 'Notification payload requires userId', errorType: 'missing-user-id' };
                }
            } else if ((normalizedUsername && !normalizedUserId) || (!normalizedUsername && normalizedUserId)) {
                return { success: false, error: 'Notification payload requires username and userId when identity is provided', errorType: 'partial-anonymous-identity' };
            }
        }

        if (!isErrorPayload) {
            if (notificationType === 'platform:gift' || notificationType === 'platform:envelope') {
                const giftType = typeof sanitized.giftType === 'string' ? sanitized.giftType.trim() : '';
                const giftCount = sanitized.giftCount;
                const amount = sanitized.amount;
                const currency = typeof sanitized.currency === 'string' ? sanitized.currency.trim() : '';
                const id = sanitized.id;
                if (!id || !giftType || giftCount === undefined || amount === undefined || !currency) {
                    return {
                        success: false,
                        error: 'Notification payload requires id, giftType, giftCount, amount, and currency',
                        errorType: 'missing-monetization-fields'
                    };
                }
            }
            if (notificationType === 'platform:giftpaypiggy' && sanitized.giftCount === undefined) {
                return { success: false, error: 'Notification payload requires giftCount', errorType: 'missing-gift-count' };
            }
        }

        const payload: NotificationRecord = {
            ...sanitized,
            platform,
            sourceType: notificationType,
            type: notificationType
        };
        if (normalizedUsername) {
            payload.username = normalizedUsername;
        }
        if (normalizedUserId !== undefined) {
            payload.userId = normalizedUserId;
        }
        return { success: true, payload };
    }
}

export {
    NotificationInputValidator
};
