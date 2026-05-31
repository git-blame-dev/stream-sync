import { safeSetTimeout as defaultSafeSetTimeout } from '../../../utils/timeout-validator';
import { formatCoinAmount as defaultFormatCoinAmount } from '../../../utils/tiktok-data-extraction';

type TikTokGiftPayload = Record<string, unknown> & {
    platform?: unknown;
    userId?: unknown;
    username?: unknown;
    giftType?: unknown;
    giftCount?: unknown;
    repeatCount?: unknown;
    unitAmount?: unknown;
    amount?: unknown;
    currency?: unknown;
    id?: unknown;
    timestamp?: unknown;
    comboType?: unknown;
    repeatEnd?: unknown;
    groupId?: unknown;
    avatarUrl?: unknown;
    giftImageUrl?: unknown;
    sourceType?: unknown;
    rawData?: unknown;
};

type TikTokAggregatedGiftPayload = {
    platform: unknown;
    userId: string;
    username: string;
    avatarUrl: string;
    giftImageUrl: string;
    giftType: string;
    giftCount: number;
    repeatCount: number;
    unitAmount: number;
    amount: number;
    currency: string;
    id: string;
    timestamp: string;
    isAggregated: true;
    aggregatedCount: number;
    enhancedGiftData: {
        username: string;
        userId: string;
        giftType: string;
        giftCount: number;
        amount: number;
        currency: string;
        isAggregated: boolean;
        isStreakCompleted: boolean;
        originalData: unknown;
    };
    sourceType?: string;
};

type TikTokGiftAggregationState = {
    platform: unknown;
    userId: string;
    username: string;
    giftType: string;
    avatarUrl: string;
    giftImageUrl: string;
    currency: string;
    totalCount: number;
    timer: ReturnType<typeof setTimeout> | number | null;
    unitAmount: number;
    lastGift: TikTokGiftPayload;
    lastId: string;
    lastTimestamp: string;
    sourceType?: string;
    messageHighWaterCounts: Map<string, number>;
    comboGroupHighWaterCounts: Map<string, number>;
};

type TikTokGiftAggregatorPlatform = {
    giftAggregation: Record<string, TikTokGiftAggregationState>;
    giftAggregationDelay: number;
    logger: {
        debug: (message: string, category?: string, details?: unknown) => void;
        info: (message: string, category?: string, details?: unknown) => void;
        warn: (message: string, category?: string, details?: unknown) => void;
    };
    errorHandler: {
        handleEventProcessingError: (error: unknown, context: string, payload: unknown, message: string) => void;
    };
    _handleGift: (payload: TikTokAggregatedGiftPayload | TikTokGiftPayload) => Promise<unknown>;
};

type TikTokGiftAggregatorOptions = {
    platform?: TikTokGiftAggregatorPlatform;
    safeSetTimeout?: (handler: () => Promise<void>, delayMs: number) => ReturnType<typeof setTimeout> | number;
    clearTimeoutFn?: (timer: ReturnType<typeof setTimeout> | number) => void;
    formatCoinAmount?: (amount: number, currency?: string) => string;
};

function createTikTokGiftAggregator(options: TikTokGiftAggregatorOptions = {}) {
    const {
    platform,
    safeSetTimeout = defaultSafeSetTimeout,
    clearTimeoutFn = clearTimeout,
    formatCoinAmount = defaultFormatCoinAmount
} = options;

    if (!platform) {
        throw new Error('platform is required to create TikTok gift aggregator');
    }

const normalizeRequiredString = (value: unknown, label: string): string => {
        const normalized = typeof value === 'string'
            ? value.trim()
            : (typeof value === 'number' ? String(value).trim() : '');
        if (!normalized) {
            throw new Error(`TikTok gift aggregation requires ${label}`);
        }
        return normalized;
    };

const normalizeRequiredPositive = (value: unknown, label: string): number => {
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric <= 0) {
            throw new Error(`TikTok gift aggregation requires ${label}`);
        }
        return numeric;
    };

    const flushGiftAggregation = async (key: string): Promise<void> => {
        const aggregationData = platform.giftAggregation[key];
        if (!aggregationData) {
            platform.logger.warn(`Gift aggregation data missing for key ${key}`, 'tiktok');
            return;
        }

        if (aggregationData.timer !== null) {
            clearTimeoutFn(aggregationData.timer);
            aggregationData.timer = null;
        }

        delete platform.giftAggregation[key];

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
        const giftType = aggregationData.giftType;
        const resolvedCurrency = aggregationData.currency;

        if (typeof finalUsername !== 'string' || !finalUsername.trim()) {
            platform.logger.warn('Gift aggregation missing username', 'tiktok', {
                hasAggregationData: true,
                hasUserId: typeof aggregationData.userId === 'string' && aggregationData.userId.length > 0,
                hasOriginalData: aggregationData.lastGift?.rawData !== undefined,
                giftType,
                giftCount: aggregatedCount
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
            platform.logger.warn('Invalid enhanced gift data', 'tiktok', {
                hasEnhancedGiftData: true,
                hasGiftType: typeof enhancedGiftData.giftType === 'string' && enhancedGiftData.giftType.length > 0,
                hasOriginalData: enhancedGiftData.originalData !== undefined,
                aggregatedCount,
                totalAmount,
                originalGiftType: giftType,
                originalGiftCount: aggregatedCount
            });
            return;
        }

        const giftPayload: TikTokAggregatedGiftPayload = {
            platform: aggregationData.platform,
            userId: aggregationData.userId,
            username: finalUsername,
            avatarUrl: aggregationData.avatarUrl,
            giftImageUrl: aggregationData.giftImageUrl,
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
                'Error handling gift notification'
            );
            platform.logger.warn(
                'Gift data unavailable after notification handling error',
                'tiktok',
                {
                    aggregatedCount,
                    totalAmount,
                    hasEnhancedGiftData: true,
                    hasOriginalData: enhancedGiftData.originalData !== undefined
                }
            );
        }
    };

    const cleanupGiftAggregation = async (): Promise<void> => {
        const keys = Object.keys(platform.giftAggregation);
        for (const key of keys) {
            try {
                await flushGiftAggregation(key);
            } catch (error) {
                platform.errorHandler.handleEventProcessingError(
                    error,
                    'gift-aggregation-cleanup',
                    { key },
                    'Error flushing gift aggregation during cleanup'
                );
                delete platform.giftAggregation[key];
            }
        }
    };

const handleStandardGift = async (gift: TikTokGiftPayload): Promise<void> => {
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
        let groupId: string | null = null;
        if (isComboCompletion) {
            try {
                groupId = normalizeRequiredString(gift.groupId, 'groupId');
            } catch {
                throw new Error('TikTok combo completion requires groupId');
            }
        }
        const resolvedCurrency = currency.trim();
        const resolvedAvatarUrl = typeof gift.avatarUrl === 'string' ? gift.avatarUrl.trim() : '';
        const resolvedGiftImageUrl = typeof gift.giftImageUrl === 'string' ? gift.giftImageUrl.trim() : '';

        const key = `${userId}-${giftType}`;
        const existingAggregation = platform.giftAggregation[key];
        if (existingAggregation) {
            platform.logger.debug(
                `[TikTok Gift] Existing aggregation found for ${key}: count=${existingAggregation.totalCount}, hasTimer=${!!existingAggregation.timer}`,
                'tiktok'
            );
        }

        if (!platform.giftAggregation[key]) {
            const initialState: TikTokGiftAggregationState = {
                platform: gift.platform || 'tiktok',
                userId,
                username,
                giftType,
                avatarUrl: resolvedAvatarUrl,
                giftImageUrl: resolvedGiftImageUrl,
                currency: resolvedCurrency,
                totalCount: 0,
                timer: null,
                unitAmount,
                lastGift: gift,
                lastId: giftId,
                lastTimestamp: timestamp,
                messageHighWaterCounts: new Map(),
                comboGroupHighWaterCounts: new Map()
            };
            if (typeof gift.sourceType === 'string') {
                initialState.sourceType = gift.sourceType;
            }
            platform.giftAggregation[key] = initialState;
        }

        const aggregationState = platform.giftAggregation[key];
        if (!aggregationState) {
            throw new Error('TikTok gift aggregation state was not initialized');
        }

        let highWaterMap = aggregationState.messageHighWaterCounts;
        let identityValue = giftId;

        if (isComboCompletion) {
            highWaterMap = aggregationState.comboGroupHighWaterCounts;
            identityValue = groupId || giftId;
        }

        const previousCount = Number(highWaterMap.get(identityValue) ?? 0);
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
        if (typeof gift.sourceType === 'string') {
            aggregationState.sourceType = gift.sourceType;
        } else {
            delete aggregationState.sourceType;
        }
        if (resolvedAvatarUrl) {
            aggregationState.avatarUrl = resolvedAvatarUrl;
        }
        if (resolvedGiftImageUrl) {
            aggregationState.giftImageUrl = resolvedGiftImageUrl;
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
                await flushGiftAggregation(key);
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

export { createTikTokGiftAggregator };
