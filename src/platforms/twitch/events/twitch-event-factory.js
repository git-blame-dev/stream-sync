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
                isGift: data.isGift,
                isRenewal,
                timestamp: getTimestamp(data),
                metadata: buildEventMetadata()
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
                isGift: data.isGift,
                isRenewal,
                timestamp: getTimestamp(data),
                metadata: buildEventMetadata()
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
                isGift: true,
                isAnonymous: data.isAnonymous,
                timestamp: getTimestamp(data),
                metadata: buildEventMetadata()
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

        createCheerEvent: (data) => {
            const identity = normalizeIdentity(data);
            const repeatCount = normalizePositiveInteger(data.repeatCount);
            if (repeatCount === undefined) {
                throw new Error('Twitch cheer payload requires repeatCount');
            }
            if (typeof data.bits !== 'number' || !Number.isFinite(data.bits)) {
                throw new Error('Twitch cheer payload requires numeric bits');
            }
            if (!data.id) {
                throw new Error('Twitch cheer payload requires id');
            }
            if (!data.cheermoteInfo || typeof data.cheermoteInfo !== 'object') {
                throw new Error('Twitch cheer payload requires cheermoteInfo');
            }
            return {
                type: PlatformEvents.CHEER,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                bits: data.bits,
                message: typeof data.message === 'string' ? data.message : undefined,
                id: data.id,
                repeatCount,
                timestamp: getTimestamp(data),
                metadata: buildEventMetadata({
                    cheermoteInfo: data.cheermoteInfo
                })
            };
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
