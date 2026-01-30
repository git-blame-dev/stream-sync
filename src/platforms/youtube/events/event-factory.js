const { PlatformEvents } = require('../../../interfaces/PlatformEvents');
const { isIsoTimestamp } = require('../../../utils/validation');

function createYouTubeEventFactory(options = {}) {
    const platformName = options.platformName || 'youtube';
    const generateCorrelationId = options.generateCorrelationId || (() => PlatformEvents._generateCorrelationId());

    const ensureIsoTimestamp = (value, errorMessage) => {
        if (!value) {
            throw new Error(errorMessage);
        }
        if (!isIsoTimestamp(value)) {
            throw new Error(`${errorMessage} (ISO required)`);
        }
        return value;
    };

    const normalizeIdentity = (data, { allowMissing } = {}) => {
        const username = typeof data.username === 'string' ? data.username.trim() : '';
        const userId = data.userId === undefined || data.userId === null ? '' : String(data.userId).trim();

        if (!allowMissing && (!username || !userId)) {
            throw new Error('YouTube event payload requires userId and username');
        }

        return {
            username: username || undefined,
            userId: userId || undefined
        };
    };

    const normalizePositiveNumber = (value) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : undefined;
    };

    const normalizeNonNegativeNumber = (value) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : undefined;
    };

    const normalizeText = (value) => (typeof value === 'string' ? value.trim() : '');

    const getTimestamp = (data, errorMessage) => ensureIsoTimestamp(data.timestamp, errorMessage);

    const buildEventMetadata = (additionalMetadata = {}) => ({
        platform: platformName,
        ...additionalMetadata,
        correlationId: generateCorrelationId()
    });

    return {
        createChatConnectedEvent: (data = {}) => {
            const timestamp = getTimestamp(data, 'YouTube chat connected event requires timestamp');
            return {
                type: PlatformEvents.CHAT_CONNECTED,
                platform: platformName,
                videoId: data.videoId,
                connectionId: data.connectionId,
                timestamp
            };
        },

        createChatMessageEvent: (data = {}) => {
            const timestamp = getTimestamp(data, 'YouTube chat message event requires timestamp');
            return {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: platformName,
                username: data.username,
                userId: data.userId,
                message: {
                    text: data.message
                },
                timestamp,
                isMod: !!data.isMod,
                isSubscriber: !!data.isSubscriber,
                isBroadcaster: !!data.isBroadcaster,
                metadata: buildEventMetadata({
                    videoId: data.videoId,
                    isMod: data.isMod || false,
                    isOwner: data.isOwner || false,
                    isVerified: data.isVerified || false
                })
            };
        },

        createViewerCountEvent: (data = {}) => {
            const timestamp = getTimestamp(data, 'YouTube viewer count event requires timestamp');
            const count = Number(data.count);
            if (!Number.isFinite(count)) {
                throw new Error('YouTube viewer count event requires numeric count');
            }
            return {
                type: PlatformEvents.VIEWER_COUNT,
                platform: platformName,
                count,
                streamId: data.streamId,
                streamViewerCount: data.streamViewerCount,
                timestamp,
                metadata: buildEventMetadata()
            };
        },

        createGiftEvent: (data = {}) => {
            const isError = data.isError === true;
            const identity = normalizeIdentity(data, { allowMissing: isError });
            const giftType = normalizeText(data.giftType);
            const giftCount = isError
                ? normalizeNonNegativeNumber(data.giftCount)
                : normalizePositiveNumber(data.giftCount);
            const amount = isError
                ? normalizeNonNegativeNumber(data.amount)
                : normalizePositiveNumber(data.amount);
            const currency = normalizeText(data.currency);
            const message = typeof data.message === 'string' ? data.message : undefined;

            if (!isError) {
                if (!giftType) {
                    throw new Error('YouTube gift payload requires giftType');
                }
                if (giftCount === undefined) {
                    throw new Error('YouTube gift payload requires giftCount');
                }
                if (amount === undefined) {
                    throw new Error('YouTube gift payload requires amount');
                }
                if (!currency) {
                    throw new Error('YouTube gift payload requires currency');
                }
                if (!data.id) {
                    throw new Error('YouTube gift payload requires id');
                }
            }

            const result = {
                type: PlatformEvents.GIFT,
                platform: platformName,
                ...(identity.username ? { username: identity.username } : {}),
                ...(identity.userId ? { userId: identity.userId } : {}),
                ...(data.id ? { id: data.id } : {}),
                ...(giftType ? { giftType } : {}),
                ...(giftCount !== undefined ? { giftCount } : {}),
                ...(amount !== undefined ? { amount } : {}),
                ...(currency ? { currency } : {}),
                timestamp: getTimestamp(data, 'YouTube gift payload requires timestamp')
            };

            if (message) {
                result.message = message;
            }
            if (isError) {
                result.isError = true;
            }
            return result;
        },

        createGiftPaypiggyEvent: (data = {}) => {
            const isError = data.isError === true;
            const identity = normalizeIdentity(data, { allowMissing: isError });
            const giftCount = isError
                ? normalizeNonNegativeNumber(data.giftCount)
                : normalizePositiveNumber(data.giftCount);
            const id = data.id === undefined || data.id === null ? '' : String(data.id).trim();

            if (!isError && giftCount === undefined) {
                throw new Error('YouTube giftpaypiggy payload requires giftCount');
            }

            const result = {
                type: PlatformEvents.GIFTPAYPIGGY,
                platform: platformName,
                ...(identity.username ? { username: identity.username } : {}),
                ...(identity.userId ? { userId: identity.userId } : {}),
                ...(giftCount !== undefined ? { giftCount } : {}),
                ...(id ? { id } : {}),
                timestamp: getTimestamp(data, 'YouTube giftpaypiggy payload requires timestamp')
            };

            if (typeof data.tier === 'string' && data.tier.trim()) {
                result.tier = data.tier.trim();
            }
            if (typeof data.isAnonymous === 'boolean') {
                result.isAnonymous = data.isAnonymous;
            }
            if (Number.isFinite(Number(data.cumulativeTotal))) {
                result.cumulativeTotal = Number(data.cumulativeTotal);
            }
            if (isError) {
                result.isError = true;
            }
            return result;
        },

        createPaypiggyEvent: (data = {}) => {
            const isError = data.isError === true;
            const identity = normalizeIdentity(data, { allowMissing: isError });
            const months = normalizePositiveNumber(data.months);
            const message = typeof data.message === 'string' ? data.message : undefined;
            const membershipLevel = normalizeText(data.membershipLevel);
            const id = data.id === undefined || data.id === null ? '' : String(data.id).trim();

            const result = {
                type: PlatformEvents.PAYPIGGY,
                platform: platformName,
                ...(identity.username ? { username: identity.username } : {}),
                ...(identity.userId ? { userId: identity.userId } : {}),
                ...(id ? { id } : {}),
                timestamp: getTimestamp(data, 'YouTube paypiggy payload requires timestamp')
            };

            if (typeof data.tier === 'string' && data.tier.trim()) {
                result.tier = data.tier.trim();
            }
            if (months !== undefined) {
                result.months = months;
            }
            if (message) {
                result.message = message;
            }
            if (membershipLevel) {
                result.membershipLevel = membershipLevel;
            }
            if (isError) {
                result.isError = true;
            }
            return result;
        },

        createErrorEvent: (data = {}) => {
            const timestamp = getTimestamp(data, 'YouTube error event requires timestamp');
            const error = data.error && typeof data.error === 'object' ? data.error : {};
            return {
                type: PlatformEvents.ERROR,
                platform: platformName,
                error: {
                    message: typeof error.message === 'string' ? error.message : undefined,
                    name: typeof error.name === 'string' ? error.name : undefined
                },
                context: data.context || {},
                recoverable: data.recoverable ?? true,
                timestamp,
                metadata: buildEventMetadata({
                    videoId: data.videoId
                })
            };
        }
    };
}

module.exports = {
    createYouTubeEventFactory
};
