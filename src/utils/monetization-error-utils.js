
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

    const resolvedTimestamp = resolveTimestampValue(timestamp);
    const resolvedUsername = resolveNonEmptyString(username);
    const resolvedUserId = resolveIdValue(userId);
    const resolvedId = resolveIdValue(id);

    const payload = {
        platform,
        isError: true
    };

    if (resolvedUsername) {
        payload.username = resolvedUsername;
    }
    if (resolvedUserId) {
        payload.userId = resolvedUserId;
    }
    if (resolvedTimestamp) {
        payload.timestamp = resolvedTimestamp;
    }

    if (eventType) {
        payload.type = eventType;
    }
    if (resolvedId) {
        payload.id = resolvedId;
    }

    switch (notificationType) {
        case 'gift': {
            const resolvedGiftType = resolveNonEmptyString(giftType);
            const resolvedGiftCount = resolveNonNegativeNumber(giftCount);
            const resolvedAmount = resolveNonNegativeNumber(amount);
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
        case 'giftpaypiggy': {
            const resolvedGiftCount = resolveNonNegativeNumber(giftCount);
            const resolvedTier = resolveNonEmptyString(tier);
            const result = { ...payload };
            if (resolvedGiftCount !== null) {
                result.giftCount = resolvedGiftCount;
            }
            if (platform === 'twitch' && resolvedTier) {
                result.tier = resolvedTier;
            }
            return result;
        }
        case 'paypiggy': {
            const resolvedMonths = resolveNonNegativeNumber(months);
            const result = { ...payload };
            if (resolvedMonths !== null) {
                result.months = resolvedMonths;
            }
            return result;
        }
        case 'envelope': {
            const resolvedGiftType = resolveNonEmptyString(giftType);
            const resolvedGiftCount = resolveNonNegativeNumber(giftCount);
            const resolvedAmount = resolveNonNegativeNumber(amount);
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
