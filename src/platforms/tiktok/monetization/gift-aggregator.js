const { safeSetTimeout: defaultSafeSetTimeout } = require('../../../utils/timeout-validator');
const { safeObjectStringify: defaultSafeObjectStringify } = require('../../../utils/logger-utils');
const { formatCoinAmount: defaultFormatCoinAmount } = require('../../../utils/tiktok-data-extraction');

function createTikTokGiftAggregator(options = {}) {
    const {
        platform,
        safeSetTimeout = defaultSafeSetTimeout,
        clearTimeoutFn = clearTimeout,
        now = () => Date.now(),
        formatCoinAmount = defaultFormatCoinAmount,
        safeObjectStringify = defaultSafeObjectStringify
    } = options;

    if (!platform) {
        throw new Error('platform is required to create TikTok gift aggregator');
    }

    const normalizeRequiredString = (value, label) => {
        const normalized = typeof value === 'string'
            ? value.trim()
            : (typeof value === 'number' ? String(value).trim() : '');
        if (!normalized) {
            throw new Error(`TikTok gift aggregation requires ${label}`);
        }
        return normalized;
    };

    const normalizeRequiredPositive = (value, label) => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            throw new Error(`TikTok gift aggregation requires ${label}`);
        }
        return numeric;
    };

    const cleanupGiftAggregation = () => {
        for (const key in platform.giftAggregation) {
            if (platform.giftAggregation[key].timer) {
                clearTimeoutFn(platform.giftAggregation[key].timer);
            }
        }
        platform.giftAggregation = {};
    };

    const handleStandardGift = async (gift) => {
        if (!gift || typeof gift !== 'object') {
            throw new Error('TikTok gift aggregation requires gift payload');
        }

        const userId = normalizeRequiredString(gift.userId, 'userId');
        const username = normalizeRequiredString(gift.username, 'username');
        const giftType = normalizeRequiredString(gift.giftType, 'giftType');
        const giftCount = normalizeRequiredPositive(gift.giftCount, 'giftCount');
        const unitAmount = normalizeRequiredPositive(gift.unitAmount, 'unitAmount');
        const currency = normalizeRequiredString(gift.currency, 'currency');
        const giftId = normalizeRequiredString(gift.id, 'msgId');
        const timestamp = normalizeRequiredString(gift.timestamp, 'timestamp');
        const resolvedCurrency = currency.trim();

        const key = `${userId}-${giftType}`;
        const existingAggregation = platform.giftAggregation[key];
        if (existingAggregation) {
            platform.logger.debug(
                `[TikTok Gift] Existing aggregation found for ${key}: count=${existingAggregation.totalCount}, hasTimer=${!!existingAggregation.timer}`,
                'tiktok'
            );
        }

        const nowMs = now();

        if (!platform.giftAggregation[key]) {
            platform.giftAggregation[key] = {
                platform: gift.platform || 'tiktok',
                userId,
                username,
                giftType,
                currency: resolvedCurrency,
                totalCount: 0,
                timer: null,
                lastProcessed: nowMs,
                unitAmount,
                lastGift: gift,
                lastId: giftId,
                lastTimestamp: timestamp,
                sourceType: typeof gift.sourceType === 'string' ? gift.sourceType : undefined
            };
        }

        const timeSinceLastEvent = nowMs - platform.giftAggregation[key].lastProcessed;
        const isDuplicate = platform.giftAggregation[key].totalCount === giftCount && timeSinceLastEvent < 1000;

        if (isDuplicate) {
            platform.logger.debug(
                `[TikTok Gift] Ignoring duplicate gift event for ${key}: count=${giftCount}, timeSince=${timeSinceLastEvent}ms`,
                'tiktok'
            );
            return;
        }

        platform.giftAggregation[key].totalCount = giftCount;
        platform.giftAggregation[key].lastProcessed = nowMs;
        platform.giftAggregation[key].unitAmount = unitAmount;
        platform.giftAggregation[key].lastGift = gift;
        platform.giftAggregation[key].lastId = giftId;
        platform.giftAggregation[key].lastTimestamp = timestamp;
        platform.giftAggregation[key].sourceType = typeof gift.sourceType === 'string' ? gift.sourceType : undefined;

        platform.logger.debug(
            `[TikTok Gift] Updated standard gift aggregation for ${key}: totalCount=${giftCount}, unitAmount=${unitAmount}`,
            'tiktok'
        );

        if (platform.giftAggregation[key].timer) {
            platform.logger.debug(`[TikTok Gift] Clearing existing timer for ${key}`, 'tiktok');
            clearTimeoutFn(platform.giftAggregation[key].timer);
            platform.giftAggregation[key].timer = null;
        }

        platform.giftAggregation[key].timer = safeSetTimeout(async () => {
            try {
                const aggregationData = platform.giftAggregation[key];
                if (!aggregationData) {
                    platform.logger.warn(`Gift aggregation data missing for key ${key}`, 'tiktok');
                    return;
                }

                const aggregatedCount = aggregationData.totalCount;
                const storedUnitAmount = aggregationData.unitAmount;
                if (!Number.isFinite(Number(aggregatedCount)) || aggregatedCount <= 0) {
                    throw new Error('Aggregated gift requires totalCount');
                }
                if (!Number.isFinite(Number(storedUnitAmount))) {
                    throw new Error('Aggregated gift requires unitAmount');
                }
                const totalAmount = Number(storedUnitAmount) * aggregatedCount;
                const finalUsername = aggregationData.username;

                if (typeof finalUsername !== 'string' || !finalUsername.trim()) {
                    platform.logger.warn(`Gift aggregation missing username for key ${key}`, 'tiktok', {
                        aggregationData,
                        giftType,
                        giftCount
                    });
                    return;
                }

                let giftMessage = `${finalUsername} sent ${aggregatedCount}x ${giftType}`;
                giftMessage += formatCoinAmount(totalAmount, resolvedCurrency);

                platform.logger.info(`[Gift] ${giftMessage}`, 'tiktok');

                const enhancedGiftData = {
                    username: finalUsername,
                    userId: aggregationData.userId,
                    giftType,
                    giftCount: aggregatedCount,
                    amount: totalAmount,
                    currency: resolvedCurrency,
                    isAggregated: true,
                    isStreakCompleted: false,
                    originalData: aggregationData.lastGift?.rawData
                };

                if (!enhancedGiftData.giftType || !enhancedGiftData.giftCount || enhancedGiftData.giftCount <= 0) {
                    platform.logger.warn(`Invalid enhanced gift data for ${finalUsername}`, 'tiktok', {
                        enhancedGiftData,
                        aggregatedCount,
                        totalAmount,
                        originalGiftType: giftType,
                        originalGiftCount: giftCount
                    });
                    return;
                }

                const giftPayload = {
                    platform: aggregationData.platform,
                    userId: aggregationData.userId,
                    username: finalUsername,
                    giftType,
                    giftCount: aggregatedCount,
                    repeatCount: aggregatedCount,
                    unitAmount: storedUnitAmount,
                    amount: totalAmount,
                    currency: resolvedCurrency,
                    id: aggregationData.lastId,
                    timestamp: aggregationData.lastTimestamp,
                    isAggregated: true,
                    aggregatedCount,
                    enhancedGiftData
                };

                if (aggregationData.sourceType) {
                    giftPayload.sourceType = aggregationData.sourceType;
                }

                try {
                    await platform._handleGift(giftPayload);
                } catch (error) {
                    platform.errorHandler.handleEventProcessingError(
                        error,
                        'gift-notification',
                        enhancedGiftData,
                        `Error handling gift notification for ${finalUsername}`
                    );
                    platform.logger.warn(
                        `Gift data when error occurred: ${safeObjectStringify({ enhancedGiftData, aggregatedCount, totalAmount })}`,
                        'tiktok'
                    );
                }

                delete platform.giftAggregation[key];
            } catch (error) {
                platform.errorHandler.handleEventProcessingError(
                    error,
                    'gift-aggregation',
                    { key, gift },
                    'Error in gift aggregation timer'
                );
                delete platform.giftAggregation[key];
            }
        }, platform.giftAggregationDelay);
    };

    return {
        cleanupGiftAggregation,
        handleStandardGift
    };
}

module.exports = {
    createTikTokGiftAggregator
};
