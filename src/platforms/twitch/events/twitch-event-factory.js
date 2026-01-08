const { PlatformEvents } = require('../../../interfaces/PlatformEvents');

function normalizeIdentity(data) {
    if (!data || typeof data !== 'object') {
        throw new Error('Twitch event payload requires identity data');
    }
    if (!data.userId || !data.username) {
        throw new Error('Twitch event payload requires userId and username');
    }
    return {
        userId: data.userId,
        username: data.username
    };
}

function normalizePositiveInteger(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return undefined;
    }

    if (numericValue > 0) {
        return numericValue;
    }

    return undefined;
}

function normalizeNonNegativeNumber(value) {
    const numericValue = Number(value);
    if (!Number.isFinite(numericValue)) {
        return undefined;
    }

    if (numericValue >= 0) {
        return numericValue;
    }

    return undefined;
}

function createTwitchEventFactory(options = {}) {
    const platformName = options.platformName || 'twitch';
    const nowIso = options.nowIso || (() => new Date().toISOString());
    const generateCorrelationId = options.generateCorrelationId || (() => PlatformEvents._generateCorrelationId());

    const getTimestamp = (data) => {
        if (!data || data.timestamp === undefined || data.timestamp === null) {
            throw new Error('Twitch event payload requires timestamp');
        }
        return data.timestamp;
    };
    const buildEventMetadata = (additionalMetadata = {}) => ({
        platform: platformName,
        correlationId: generateCorrelationId(),
        ...additionalMetadata
    });

    return {
        createFollowEvent: (data) => {
            const identity = normalizeIdentity(data);
            return {
            type: PlatformEvents.FOLLOW,
            platform: platformName,
            username: identity.username,
            userId: identity.userId,
            timestamp: getTimestamp(data),
            metadata: buildEventMetadata()
        };
        },

        createPaypiggyEvent: (data) => {
            const identity = normalizeIdentity(data);
            const months = normalizePositiveInteger(data.months);
            const isRenewal = data.isRenewal === true ||
                (months !== undefined && months > 1);

            const result = {
                type: PlatformEvents.PAYPIGGY,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                tier: data.tier,
                isRenewal,
                timestamp: getTimestamp(data)
            };
            if (typeof data.message === 'string') {
                result.message = data.message;
            }
            if (months !== undefined) {
                result.months = months;
            }
            return result;
        },

        createPaypiggyMessageEvent: (data) => {
            const identity = normalizeIdentity(data);
            const months = normalizePositiveInteger(data.months);
            const isRenewal = data.isRenewal === true ||
                (months !== undefined && months > 1);

            const result = {
                type: PlatformEvents.PAYPIGGY,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                tier: data.tier,
                isRenewal,
                timestamp: getTimestamp(data)
            };
            if (typeof data.message === 'string') {
                result.message = data.message;
            }
            if (months !== undefined) {
                result.months = months;
            }
            return result;
        },

        createGiftPaypiggyEvent: (data) => {
            const identity = normalizeIdentity(data);
            const giftCount = normalizePositiveInteger(data.giftCount);
            if (giftCount === undefined) {
                throw new Error('Twitch giftpaypiggy payload requires giftCount');
            }
            const cumulativeTotal = normalizePositiveInteger(data.cumulativeTotal);

            const result = {
                type: PlatformEvents.GIFTPAYPIGGY,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                giftCount,
                tier: data.tier,
                isAnonymous: data.isAnonymous,
                timestamp: getTimestamp(data)
            };
            if (cumulativeTotal !== undefined) {
                result.cumulativeTotal = cumulativeTotal;
            }
            return result;
        },

        createRaidEvent: (data) => {
            const identity = normalizeIdentity(data);
            if (typeof data.viewerCount !== 'number' || !Number.isFinite(data.viewerCount)) {
                throw new Error('Twitch raid payload requires numeric viewerCount');
            }
            return {
                type: PlatformEvents.RAID,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                viewerCount: data.viewerCount,
                timestamp: getTimestamp(data),
                metadata: buildEventMetadata()
            };
        },

        createGiftEvent: (data) => {
            const identity = normalizeIdentity(data);
            const isError = data.isError === true;
            const giftType = typeof data.giftType === 'string' ? data.giftType.trim() : '';
            const giftCount = isError
                ? normalizeNonNegativeNumber(data.giftCount)
                : normalizePositiveInteger(data.giftCount);
            const amount = isError
                ? normalizeNonNegativeNumber(data.amount)
                : normalizePositiveInteger(data.amount);
            const currency = typeof data.currency === 'string' ? data.currency.trim() : '';
            const repeatCount = normalizePositiveInteger(data.repeatCount);
            if (!giftType) {
                throw new Error('Twitch gift payload requires giftType');
            }
            if (giftCount === undefined) {
                throw new Error('Twitch gift payload requires giftCount');
            }
            if (amount === undefined) {
                throw new Error('Twitch gift payload requires amount');
            }
            if (!currency) {
                throw new Error('Twitch gift payload requires currency');
            }
            if (!data.id) {
                throw new Error('Twitch gift payload requires id');
            }
            const result = {
                type: PlatformEvents.GIFT,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                id: data.id,
                giftType,
                giftCount,
                amount,
                currency,
                timestamp: getTimestamp(data)
            };
            if (typeof data.message === 'string') {
                result.message = data.message;
            }
            if (repeatCount !== undefined) {
                result.repeatCount = repeatCount;
            }
            if (data.cheermoteInfo && typeof data.cheermoteInfo === 'object') {
                result.cheermoteInfo = data.cheermoteInfo;
            }
            if (isError) {
                result.isError = true;
            }
            if (typeof data.isAggregated === 'boolean') {
                result.isAggregated = data.isAggregated;
            }
            if (Number.isFinite(Number(data.aggregatedCount))) {
                result.aggregatedCount = Number(data.aggregatedCount);
            }
            if (data.enhancedGiftData && typeof data.enhancedGiftData === 'object') {
                result.enhancedGiftData = data.enhancedGiftData;
            }
            if (typeof data.sourceType === 'string') {
                result.sourceType = data.sourceType;
            }
            return result;
        },

        createStreamOnlineEvent: (data) => ({
            type: PlatformEvents.STREAM_STATUS,
            platform: platformName,
            isLive: true,
            timestamp: getTimestamp(data),
            metadata: buildEventMetadata()
        }),

        createStreamOfflineEvent: (data) => ({
            type: PlatformEvents.STREAM_STATUS,
            platform: platformName,
            isLive: false,
            timestamp: getTimestamp(data),
            metadata: buildEventMetadata()
        })
    };
}

module.exports = {
    createTwitchEventFactory
};
