const { safeSetTimeout: defaultSafeSetTimeout } = require('../../../utils/timeout-validator');
const { safeObjectStringify: defaultSafeObjectStringify } = require('../../../utils/logger-utils');
const { resolveTikTokTimestampISO } = require('../../../utils/tiktok-timestamp');
const {
    formatCoinAmount: defaultFormatCoinAmount,
    extractTikTokUserData: defaultExtractTikTokUserData
} = require('../../../utils/tiktok-data-extraction');

function createTikTokGiftAggregator(options = {}) {
    const {
        platform,
        safeSetTimeout = defaultSafeSetTimeout,
        clearTimeoutFn = clearTimeout,
        now = () => Date.now(),
        extractTikTokUserData = defaultExtractTikTokUserData,
        formatCoinAmount = defaultFormatCoinAmount,
        safeObjectStringify = defaultSafeObjectStringify
    } = options;

    if (!platform) {
        throw new Error('platform is required to create TikTok gift aggregator');
    }

    const cleanupGiftAggregation = () => {
        for (const key in platform.giftAggregation) {
            if (platform.giftAggregation[key].timer) {
                clearTimeoutFn(platform.giftAggregation[key].timer);
            }
        }
        platform.giftAggregation = {};
    };

    const handleStandardGift = async (identityKey, username, giftType, giftCount, unitAmount, currency, originalData) => {
        const key = `${identityKey}-${giftType}`;
        if (typeof currency !== 'string' || !currency.trim()) {
            throw new Error('TikTok gift aggregation requires currency');
        }
        if (!Number.isFinite(Number(giftCount)) || giftCount <= 0) {
            throw new Error('TikTok gift aggregation requires giftCount');
        }
        if (!Number.isFinite(Number(unitAmount))) {
            throw new Error('TikTok gift aggregation requires unitAmount');
        }
        const resolvedCurrency = currency.trim();

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
                username,
                totalCount: 0,
                timer: null,
                lastProcessed: nowMs,
                unitAmount
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

                const sanitizedOriginalData = originalData && typeof originalData === 'object'
                    ? { ...originalData }
                    : originalData;
                if (sanitizedOriginalData && typeof sanitizedOriginalData === 'object') {
                    delete sanitizedOriginalData.displayName;
                    delete sanitizedOriginalData.userId;
                    delete sanitizedOriginalData.uniqueId;
                    delete sanitizedOriginalData.nickname;
                }
                const extractedIdentity = extractTikTokUserData(sanitizedOriginalData);
                if (sanitizedOriginalData && typeof sanitizedOriginalData === 'object' && !sanitizedOriginalData.user) {
                    sanitizedOriginalData.user = {
                        userId: extractedIdentity.userId,
                        uniqueId: finalUsername
                    };
                }

                const enhancedGiftData = {
                    username: finalUsername,
                    userId: extractedIdentity.userId,
                    giftType,
                    giftCount: aggregatedCount,
                    amount: totalAmount,
                    currency: resolvedCurrency,
                    isAggregated: true,
                    isStreakCompleted: false,
                    originalData: sanitizedOriginalData
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
                    ...(sanitizedOriginalData || {}),
                    user: sanitizedOriginalData?.user,
                    repeatCount: aggregatedCount,
                    giftDetails: sanitizedOriginalData?.giftDetails || {
                        giftName: giftType,
                        diamondCount: Number.isFinite(Number(storedUnitAmount)) ? Number(storedUnitAmount) : 0
                    },
                    unitAmount: storedUnitAmount,
                    aggregatedCount,
                    giftType,
                    giftCount: aggregatedCount,
                    amount: totalAmount,
                    currency: resolvedCurrency,
                    timestamp: resolveTikTokTimestampISO(sanitizedOriginalData),
                    enhancedGiftData
                };

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
                    { key, originalData },
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
