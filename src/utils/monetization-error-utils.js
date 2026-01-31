
function resolveNonEmptyString(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    return trimmed ? trimmed : null;
}

function resolveIdValue(value) {
    if (value === undefined || value === null) {
        return null;
    }
    if (typeof value === 'object') {
        return null;
    }
    const trimmed = String(value).trim();
    return trimmed ? trimmed : null;
}

function resolvePositiveNumber(value) {
    if (value === undefined || value === null || typeof value === 'boolean') {
        return null;
    }
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
}

const { isIsoTimestamp } = require('./timestamp');

function resolveTimestampValue(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const trimmed = value.trim();
    if (!trimmed) {
        return null;
    }
    return isIsoTimestamp(trimmed) ? trimmed : null;
}

function createMonetizationErrorPayload(options = {}) {
    const {
        notificationType,
        platform,
        timestamp,
        id,
        eventType,
        username,
        userId,
        giftType,
        giftCount,
        amount,
        currency,
        tier,
        months
    } = options;

    if (!notificationType) {
        throw new Error('Monetization error payload requires notificationType');
    }
    const trimmedPlatform = typeof platform === 'string' ? platform.trim() : '';
    if (!trimmedPlatform) {
        throw new Error('Monetization error payload requires platform');
    }

    const resolvedTimestamp = resolveTimestampValue(timestamp);
    if (!resolvedTimestamp) {
        throw new Error('Monetization error payload requires ISO timestamp');
    }

    const normalizedType = notificationType.toLowerCase();
    const normalizedPlatform = trimmedPlatform.toLowerCase();

    const resolvedId = resolveIdValue(id);
    const resolvedUsername = resolveNonEmptyString(username);
    const resolvedUserId = resolveIdValue(userId);
    const resolvedEventType = resolveNonEmptyString(eventType);

    const payload = {
        type: notificationType,
        platform: trimmedPlatform,
        isError: true,
        timestamp: resolvedTimestamp,
        ...(resolvedId ? { id: resolvedId } : {}),
        ...(resolvedUsername ? { username: resolvedUsername } : {}),
        ...(resolvedUserId ? { userId: resolvedUserId } : {}),
        eventType: resolvedEventType || notificationType
    };

    switch (normalizedType) {
        case 'platform:gift': {
            const resolvedGiftType = resolveNonEmptyString(giftType);
            const resolvedGiftCount = resolvePositiveNumber(giftCount);
            const resolvedAmount = resolvePositiveNumber(amount);
            const resolvedCurrency = resolveNonEmptyString(currency);
            const result = { ...payload };
            if (resolvedGiftType) {
                result.giftType = resolvedGiftType;
            }
            if (resolvedGiftCount !== null) {
                result.giftCount = resolvedGiftCount;
            }
            if (resolvedAmount !== null) {
                result.amount = resolvedAmount;
            }
            if (resolvedCurrency) {
                result.currency = resolvedCurrency;
            }
            return result;
        }
        case 'platform:giftpaypiggy': {
            const resolvedGiftCount = resolvePositiveNumber(giftCount);
            const resolvedTier = resolveNonEmptyString(tier);
            const result = { ...payload };
            if (resolvedGiftCount !== null) {
                result.giftCount = resolvedGiftCount;
            }
            if (normalizedPlatform === 'twitch' && resolvedTier) {
                result.tier = resolvedTier;
            }
            return result;
        }
        case 'platform:paypiggy': {
            const resolvedMonths = resolvePositiveNumber(months);
            const result = { ...payload };
            if (resolvedMonths !== null) {
                result.months = resolvedMonths;
            }
            return result;
        }
        case 'platform:envelope': {
            const resolvedGiftType = resolveNonEmptyString(giftType);
            const resolvedGiftCount = resolvePositiveNumber(giftCount);
            const resolvedAmount = resolvePositiveNumber(amount);
            const resolvedCurrency = resolveNonEmptyString(currency);
            const result = { ...payload };
            if (resolvedGiftType) {
                result.giftType = resolvedGiftType;
            }
            if (resolvedGiftCount !== null) {
                result.giftCount = resolvedGiftCount;
            }
            if (resolvedAmount !== null) {
                result.amount = resolvedAmount;
            }
            if (resolvedCurrency) {
                result.currency = resolvedCurrency;
            }
            return result;
        }
        default:
            return payload;
    }
}

module.exports = {
    createMonetizationErrorPayload
};
