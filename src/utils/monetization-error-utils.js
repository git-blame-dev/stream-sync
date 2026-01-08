const DEFAULT_PLACEHOLDER_USERNAME = 'Unknown';
const DEFAULT_USER_ID = 'unknown';
const DEFAULT_GIFT_TYPE = 'Unknown gift';
const DEFAULT_CURRENCY = 'unknown';
const DEFAULT_ID = 'unknown';

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
    const trimmed = String(value).trim();
    return trimmed ? trimmed : null;
}

function resolveNonNegativeNumber(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const num = Number(value);
    return Number.isFinite(num) && num >= 0 ? num : null;
}

function resolveTimestampValue(value) {
    if (typeof value === 'string') {
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
    }
    if (value && typeof value === 'object' && typeof value.toISOString === 'function') {
        const iso = value.toISOString();
        return iso ? iso : null;
    }
    if (typeof value === 'number' && Number.isFinite(value)) {
        const date = new Date(value);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }
    return null;
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
    if (!platform) {
        throw new Error('Monetization error payload requires platform');
    }

    const resolvedTimestamp = resolveTimestampValue(timestamp) || new Date().toISOString();
    const resolvedId = resolveIdValue(id) || DEFAULT_ID;
    const resolvedUsername = resolveNonEmptyString(username);
    const resolvedUserId = resolveIdValue(userId);

    const payload = {
        platform,
        username: resolvedUsername || DEFAULT_PLACEHOLDER_USERNAME,
        userId: resolvedUserId || DEFAULT_USER_ID,
        timestamp: resolvedTimestamp,
        id: resolvedId,
        isError: true
    };

    if (eventType) {
        payload.type = eventType;
    }

    switch (notificationType) {
        case 'gift': {
            const resolvedGiftType = resolveNonEmptyString(giftType) || DEFAULT_GIFT_TYPE;
            const resolvedGiftCount = resolveNonNegativeNumber(giftCount);
            const resolvedAmount = resolveNonNegativeNumber(amount);
            const resolvedCurrency = resolveNonEmptyString(currency) || DEFAULT_CURRENCY;
            return {
                ...payload,
                giftType: resolvedGiftType,
                giftCount: resolvedGiftCount ?? 0,
                amount: resolvedAmount ?? 0,
                currency: resolvedCurrency
            };
        }
        case 'giftpaypiggy': {
            const resolvedGiftCount = resolveNonNegativeNumber(giftCount);
            const resolvedTier = resolveNonEmptyString(tier);
            return {
                ...payload,
                giftCount: resolvedGiftCount ?? 0,
                ...(platform === 'twitch' ? { tier: resolvedTier || 'unknown' } : {})
            };
        }
        case 'paypiggy': {
            const resolvedMonths = resolveNonNegativeNumber(months);
            return {
                ...payload,
                months: resolvedMonths ?? 0
            };
        }
        case 'envelope': {
            const resolvedGiftType = resolveNonEmptyString(giftType) || DEFAULT_GIFT_TYPE;
            const resolvedGiftCount = resolveNonNegativeNumber(giftCount);
            const resolvedAmount = resolveNonNegativeNumber(amount);
            const resolvedCurrency = resolveNonEmptyString(currency) || DEFAULT_CURRENCY;
            return {
                ...payload,
                giftType: resolvedGiftType,
                giftCount: resolvedGiftCount ?? 0,
                amount: resolvedAmount ?? 0,
                currency: resolvedCurrency
            };
        }
        default:
            return payload;
    }
}

module.exports = {
    createMonetizationErrorPayload
};
