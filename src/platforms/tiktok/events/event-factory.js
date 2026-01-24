const { PlatformEvents } = require('../../../interfaces/PlatformEvents');
const { normalizeTikTokMessage } = require('../../../utils/message-normalization');
const { extractTikTokUserData } = require('../../../utils/tiktok-data-extraction');
const { getSystemTimestampISO } = require('../../../utils/validation');

function createTikTokEventFactory(options = {}) {
    const platformName = options.platformName || 'tiktok';
    const getTimestamp = options.getTimestamp || ((data) => data.timestamp);
    const normalizeUserData = options.normalizeUserData || ((data) => data);
    const getPlatformMessageId = options.getPlatformMessageId || ((data) => data?.id ?? data?.msgId);
    const generateCorrelationId = options.generateCorrelationId || (() => PlatformEvents._generateCorrelationId());
    const buildEventMetadata = options.buildEventMetadata || ((additionalMetadata = {}) => ({
        platform: platformName,
        correlationId: generateCorrelationId(),
        ...additionalMetadata
    }));
    const normalizeChatEvent = options.normalizeChatEvent || ((data) => normalizeTikTokMessage(data, platformName, options.timestampService));

    const normalizeIdentityFromPayload = (data) => normalizeUserData(extractTikTokUserData(data));
    const normalizeIdentityFromCanonical = (data) => normalizeUserData({
        userId: data.userId,
        username: data.username
    });

    return {
        createChatMessage: (data = {}, eventOptions = {}) => {
            const normalized = eventOptions.normalizedData || normalizeChatEvent(data);
            const identity = normalizeUserData({
                userId: normalized?.userId,
                username: normalized?.username
            });

            if (!normalized?.message) {
                throw new Error('Missing TikTok message text');
            }
            if (!normalized?.timestamp) {
                throw new Error('Missing TikTok message timestamp');
            }

            return {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                message: {
                    text: normalized.message
                },
                timestamp: normalized.timestamp,
                metadata: buildEventMetadata(normalized?.metadata)
            };
        },
        createGift: (data = {}) => {
            const identity = normalizeIdentityFromCanonical(data);
            const hasEnhancedGiftData = data.enhancedGiftData && typeof data.enhancedGiftData === 'object';

            if (typeof data.giftType !== 'string' || !data.giftType.trim()) {
                throw new Error('TikTok gift requires giftType');
            }
            if (typeof data.giftCount !== 'number' || !Number.isFinite(data.giftCount) || data.giftCount <= 0) {
                throw new Error('TikTok gift requires giftCount');
            }
            if (typeof data.amount !== 'number' || !Number.isFinite(data.amount) || data.amount <= 0) {
                throw new Error('TikTok gift requires amount');
            }
            if (typeof data.currency !== 'string' || !data.currency.trim()) {
                throw new Error('TikTok gift requires currency');
            }
            if (data.timestamp === undefined || data.timestamp === null) {
                throw new Error('TikTok gift requires timestamp');
            }
            const giftType = data.giftType.trim();
            const giftCount = data.giftCount;
            const repeatCount = Number.isFinite(Number(data.repeatCount))
                ? Number(data.repeatCount)
                : undefined;
            const unitAmountRaw = data.unitAmount;
            if (typeof unitAmountRaw !== 'number' || !Number.isFinite(unitAmountRaw)) {
                throw new Error('TikTok gift requires unitAmount');
            }
            const resolvedAmount = data.amount;
            const currency = data.currency.trim();
            const platformMessageId = data.id || getPlatformMessageId(data);
            if (!platformMessageId) {
                throw new Error('TikTok gift requires msgId');
            }

            const isAggregated = data.isAggregated === true
                || (Number.isFinite(Number(data.aggregatedCount)) && Number(data.aggregatedCount) > 0);
            const aggregatedCountValue = Number.isFinite(Number(data.aggregatedCount))
                ? Number(data.aggregatedCount)
                : (hasEnhancedGiftData && Number.isFinite(Number(data.enhancedGiftData.giftCount))
                    ? Number(data.enhancedGiftData.giftCount)
                    : (isAggregated ? giftCount : undefined));

            const result = {
                type: PlatformEvents.GIFT,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                giftType,
                giftCount,
                amount: resolvedAmount,
                currency,
                ...(repeatCount !== undefined ? { repeatCount } : {}),
                id: platformMessageId,
                timestamp: data.timestamp,
                isAggregated
            };
            if (isAggregated && Number.isFinite(Number(aggregatedCountValue))) {
                result.aggregatedCount = Number(aggregatedCountValue);
            }
            if (hasEnhancedGiftData) {
                result.enhancedGiftData = data.enhancedGiftData;
            }
            if (typeof data.sourceType === 'string') {
                result.sourceType = data.sourceType;
            }
            return result;
        },
        createFollow: (params = {}) => {
            const identity = normalizeUserData({
                userId: params.userId,
                username: params.username
            });

            return {
                type: PlatformEvents.FOLLOW,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                timestamp: params.timestamp,
                metadata: buildEventMetadata(params.metadata)
            };
        },
        createShare: (params = {}) => {
            const identity = normalizeUserData({
                userId: params.userId,
                username: params.username
            });

            return {
                type: PlatformEvents.SHARE,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                timestamp: params.timestamp,
                metadata: buildEventMetadata({
                    interactionType: 'share',
                    ...(params.metadata || {})
                })
            };
        },
        createEnvelope: (data = {}) => {
            const identity = normalizeIdentityFromPayload(data);
            const messageId = getPlatformMessageId(data);
            if (!messageId) {
                throw new Error('Missing TikTok envelope message id');
            }

            const amount = Number(data?.giftCoins ?? data?.amount);
            if (!Number.isFinite(amount)) {
                throw new Error('Missing TikTok envelope gift amount');
            }
            const currency = typeof data?.currency === 'string' ? data.currency.trim() : '';
            if (!currency) {
                throw new Error('TikTok envelope requires currency');
            }

            return {
                type: PlatformEvents.ENVELOPE,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                giftType: 'Treasure Chest',
                giftCount: 1,
                repeatCount: 1,
                amount,
                currency,
                id: messageId,
                timestamp: getTimestamp(data)
            };
        },
        createSubscription: (data = {}) => {
            const identity = normalizeIdentityFromPayload(data);
            const tier = typeof data?.tier === 'string' ? data.tier.trim() : '';
            const message = typeof data?.message === 'string' ? data.message.trim() : '';
            const months = Number(data?.months);

            const payload = {
                type: PlatformEvents.PAYPIGGY,
                platform: platformName,
                ...identity,
                timestamp: getTimestamp(data)
            };
            if (tier) {
                payload.tier = tier;
            }
            if (Number.isFinite(months) && months > 0) {
                payload.months = months;
            }
            if (message) {
                payload.message = message;
            }
            return payload;
        },
        createSuperfan: (data = {}) => {
            const identity = normalizeIdentityFromPayload(data);
            const message = typeof data?.message === 'string' ? data.message.trim() : '';
            const months = Number(data?.months);

            const payload = {
                type: PlatformEvents.PAYPIGGY,
                platform: platformName,
                ...identity,
                tier: 'superfan',
                timestamp: getTimestamp(data)
            };
            if (Number.isFinite(months) && months > 0) {
                payload.months = months;
            }
            if (message) {
                payload.message = message;
            }
            return payload;
        },
        createConnection: (connectionId = PlatformEvents._generateCorrelationId()) => {
            const correlationId = generateCorrelationId();
            const timestamp = getSystemTimestampISO();

            return {
                type: PlatformEvents.CHAT_CONNECTED,
                platform: platformName,
                connectionId,
                timestamp,
                metadata: {
                    platform: platformName,
                    correlationId
                }
            };
        },
        createDisconnection: (reason, willReconnect) => {
            const correlationId = generateCorrelationId();
            const timestamp = getSystemTimestampISO();

            return {
                type: PlatformEvents.CHAT_DISCONNECTED,
                platform: platformName,
                reason,
                willReconnect,
                timestamp,
                metadata: {
                    platform: platformName,
                    correlationId
                }
            };
        },
        createError: (error, context) => {
            const correlationId = generateCorrelationId();
            const timestamp = getSystemTimestampISO();
            return {
                type: PlatformEvents.ERROR,
                platform: platformName,
                error: {
                    message: error.message,
                    name: error.name
                },
                context: {
                    ...(context || {}),
                    correlationId
                },
                recoverable: context?.recoverable !== undefined ? context.recoverable : true,
                timestamp,
                metadata: {
                    platform: platformName,
                    correlationId
                }
            };
        }
    };
}

module.exports = {
    createTikTokEventFactory
};
