
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

function resolvePositiveNumber(value) {
    if (value === undefined || value === null) {
        return null;
    }
    const num = Number(value);
    return Number.isFinite(num) && num > 0 ? num : null;
}

const { isIsoTimestamp } = require('./validation');

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
    if (!platform) {
        throw new Error('Monetization error payload requires platform');
    }

    const resolvedTimestamp = resolveTimestampValue(timestamp);
    if (!resolvedTimestamp) {
        throw new Error('Monetization error payload requires ISO timestamp');
    }

    const payload = {
        type: notificationType,
        platform,
        isError: true,
        timestamp: resolvedTimestamp,
        ...(id ? { id: resolveIdValue(id) } : {}),
        ...(username ? { username: resolveNonEmptyString(username) } : {}),
        ...(userId ? { userId: resolveIdValue(userId) } : {}),
        ...(eventType ? { eventType: resolveNonEmptyString(eventType) } : { eventType: notificationType })
    };

    switch (notificationType) {
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
            if (platform === 'twitch' && resolvedTier) {
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
