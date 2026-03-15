const { safeSetTimeout: defaultSafeSetTimeout } = require('../../../utils/timeout-validator');
const { safeObjectStringify: defaultSafeObjectStringify } = require('../../../utils/logger-utils');
const { formatCoinAmount: defaultFormatCoinAmount } = require('../../../utils/tiktok-data-extraction');

function createTikTokGiftAggregator(options = {}) {
    const {
        platform,
        safeSetTimeout = defaultSafeSetTimeout,
        clearTimeoutFn = clearTimeout,
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
        const comboType = Number(gift.comboType);
        const repeatEnd = gift.repeatEnd === true;
        const isComboCompletion = comboType === 1 && repeatEnd === true;
        let groupId = null;
        if (isComboCompletion) {
            try {
                groupId = normalizeRequiredString(gift.groupId, 'groupId');
            } catch {
                throw new Error('TikTok combo completion requires groupId');
            }
        }
        const resolvedCurrency = currency.trim();
        const resolvedAvatarUrl = typeof gift.avatarUrl === 'string' ? gift.avatarUrl.trim() : '';

        const key = `${userId}-${giftType}`;
        const existingAggregation = platform.giftAggregation[key];
        if (existingAggregation) {
            platform.logger.debug(
                `[TikTok Gift] Existing aggregation found for ${key}: count=${existingAggregation.totalCount}, hasTimer=${!!existingAggregation.timer}`,
                'tiktok'
            );
        }

        if (!platform.giftAggregation[key]) {
            platform.giftAggregation[key] = {
                platform: gift.platform || 'tiktok',
                userId,
                username,
                giftType,
                avatarUrl: resolvedAvatarUrl,
                currency: resolvedCurrency,
                totalCount: 0,
                timer: null,
                unitAmount,
                lastGift: gift,
                lastId: giftId,
                lastTimestamp: timestamp,
                sourceType: typeof gift.sourceType === 'string' ? gift.sourceType : undefined,
                messageHighWaterCounts: new Map(),
                comboGroupHighWaterCounts: new Map()
            };
        }

        const aggregationState = platform.giftAggregation[key];

        let highWaterMap = aggregationState.messageHighWaterCounts;
        let identityValue = giftId;

        if (isComboCompletion) {
            highWaterMap = aggregationState.comboGroupHighWaterCounts;
            identityValue = groupId;
        }

        const previousCount = Number(highWaterMap.get(identityValue) || 0);
        const deltaCount = giftCount > previousCount ? giftCount - previousCount : 0;

        if (deltaCount <= 0) {
            platform.logger.debug(
                `[TikTok Gift] Ignoring duplicate gift event for ${key}: identity=${identityValue}, count=${giftCount}, previous=${previousCount}`,
                'tiktok'
            );
            return;
        }

        highWaterMap.set(identityValue, giftCount);

        aggregationState.totalCount += deltaCount;
        aggregationState.unitAmount = unitAmount;
        aggregationState.lastGift = gift;
        aggregationState.lastId = giftId;
        aggregationState.lastTimestamp = timestamp;
        aggregationState.sourceType = typeof gift.sourceType === 'string' ? gift.sourceType : undefined;
        if (resolvedAvatarUrl) {
            aggregationState.avatarUrl = resolvedAvatarUrl;
        }

        platform.logger.debug(
            `[TikTok Gift] Updated standard gift aggregation for ${key}: totalCount=${aggregationState.totalCount}, delta=${deltaCount}, unitAmount=${unitAmount}`,
            'tiktok'
        );

        if (aggregationState.timer) {
            platform.logger.debug(`[TikTok Gift] Clearing existing timer for ${key}`, 'tiktok');
            clearTimeoutFn(aggregationState.timer);
            aggregationState.timer = null;
        }

        aggregationState.timer = safeSetTimeout(async () => {
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
                    avatarUrl: aggregationData.avatarUrl,
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
