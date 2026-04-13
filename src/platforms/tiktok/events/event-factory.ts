import crypto from 'node:crypto';
import { normalizeTikTokMessage } from '../../../utils/message-normalization';
import { extractTikTokUserData } from '../../../utils/tiktok-data-extraction';
import { getSystemTimestampISO } from '../../../utils/timestamp';
import { DEFAULT_AVATAR_URL } from '../../../constants/avatar';
import { UNKNOWN_CHAT_MESSAGE, UNKNOWN_CHAT_USERNAME } from '../../../constants/degraded-chat';
import { getValidMessageParts, normalizeBadgeImages } from '../../../utils/message-parts';
import { getMissingFields, mergeMissingFieldsMetadata } from '../../../utils/missing-fields';

const PlatformEvents = {
    CHAT_MESSAGE: 'platform:chat-message',
    GIFT: 'platform:gift',
    FOLLOW: 'platform:follow',
    SHARE: 'platform:share',
    ENVELOPE: 'platform:envelope',
    PAYPIGGY: 'platform:paypiggy',
    CHAT_CONNECTED: 'platform:chat-connected',
    CHAT_DISCONNECTED: 'platform:chat-disconnected',
    ERROR: 'platform:error',
    _generateCorrelationId: () => crypto.randomUUID()
} as const;

type EventFactoryMetadata = Record<string, unknown>;

type NormalizedIdentity = {
    userId: string;
    username: string;
};

type EventFactoryOptions = {
    platformName?: string;
    timestampService?: unknown;
    getTimestamp?: (data: Record<string, unknown>) => string | null | undefined;
    normalizeUserData?: (data: NormalizedIdentity) => NormalizedIdentity;
    getPlatformMessageId?: (data: Record<string, unknown>) => string | number | null | undefined;
    generateCorrelationId?: () => string;
    buildEventMetadata?: (additionalMetadata?: EventFactoryMetadata) => EventFactoryMetadata;
    normalizeChatEvent?: (data: Record<string, unknown>) => Record<string, unknown>;
};

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, unknown>;
}

function createTikTokEventFactory(options: EventFactoryOptions = {}) {
    const platformName = options.platformName || 'tiktok';
    const getTimestamp = options.getTimestamp || ((data: Record<string, unknown>) => data.timestamp as string | undefined);
    const normalizeUserData = options.normalizeUserData || ((data: NormalizedIdentity) => data);
    const getPlatformMessageId = options.getPlatformMessageId || ((data: Record<string, unknown>) => data.id ?? data.msgId);
    const generateCorrelationId = options.generateCorrelationId || (() => PlatformEvents._generateCorrelationId());
    const buildEventMetadata = options.buildEventMetadata || ((additionalMetadata: EventFactoryMetadata = {}) => ({
        platform: platformName,
        correlationId: generateCorrelationId(),
        ...additionalMetadata
    }));

    const normalizeContext = (context: unknown): EventFactoryMetadata => {
        if (!context || typeof context !== 'object' || Array.isArray(context)) {
            return {};
        }

        return context as EventFactoryMetadata;
    };

    const normalizeRecoverable = (recoverable: unknown) => (typeof recoverable === 'boolean' ? recoverable : true);
    const normalizeChatEvent = options.normalizeChatEvent
        || ((data: Record<string, unknown>) => normalizeTikTokMessage(data, platformName, options.timestampService) as Record<string, unknown>);

    const normalizeIdentityFromPayload = (data: Record<string, unknown>) => normalizeUserData(extractTikTokUserData(data));
    const normalizeIdentityFromCanonical = (data: Record<string, unknown>) => normalizeUserData({
        userId: typeof data.userId === 'string' ? data.userId : String(data.userId ?? ''),
        username: typeof data.username === 'string' ? data.username : String(data.username ?? '')
    });
    const resolveAvatarUrl = (data: Record<string, unknown> = {}, fallbackData: Record<string, unknown> = {}) => {
        const avatarFromData = typeof data.avatarUrl === 'string' ? data.avatarUrl.trim() : '';
        if (avatarFromData) {
            return avatarFromData;
        }

        const avatarFromFallback = typeof fallbackData.avatarUrl === 'string' ? fallbackData.avatarUrl.trim() : '';
        if (avatarFromFallback) {
            return avatarFromFallback;
        }

        const metadata = asRecord(fallbackData.metadata);
        const profilePicture = metadata?.profilePicture;
        if (typeof profilePicture === 'string' && profilePicture.trim()) {
            return profilePicture.trim();
        }

        return DEFAULT_AVATAR_URL;
    };

    const resolveMessageParts = (normalized: Record<string, unknown> = {}) => {
        const normalizedMessage = asRecord(normalized.message);
        const sourceParts = Array.isArray(normalizedMessage?.parts)
            ? normalizedMessage.parts
            : [];

        return getValidMessageParts({ message: { parts: sourceParts } })
            .map((part) => {
                if (part.type === 'emote') {
                    const normalizedPart = {
                        type: 'emote',
                        platform: typeof part.platform === 'string' ? part.platform : 'tiktok',
                        emoteId: typeof part.emoteId === 'string' ? part.emoteId : '',
                        imageUrl: part.imageUrl.trim()
                    };

                    if (Number.isInteger(part.placeInComment) && part.placeInComment >= 0) {
                        normalizedPart.placeInComment = part.placeInComment;
                    }

                    return normalizedPart;
                }

                return {
                    type: 'text',
                    text: part.text
                };
            });
    };

    const resolveMessageText = (normalized: Record<string, unknown> = {}) => {
        const normalizedMessage = normalized.message;
        if (typeof normalizedMessage === 'string') {
            return normalizedMessage.trim();
        }

        const normalizedMessageRecord = asRecord(normalizedMessage);
        if (typeof normalizedMessageRecord?.text === 'string') {
            return normalizedMessageRecord.text.trim();
        }

        return '';
    };

    return {
        createChatMessage: (data = {}, eventOptions = {}) => {
            const normalized = eventOptions.normalizedData || normalizeChatEvent(data);
            const normalizedMetadata = normalized?.metadata && typeof normalized.metadata === 'object'
                ? { ...normalized.metadata }
                : {};
            delete normalizedMetadata.messageParts;

            const missingFields = getMissingFields(normalizedMetadata);
            const isMissingField = (fieldName) => missingFields.includes(fieldName);

            const rawTimestamp = typeof normalized?.timestamp === 'string' ? normalized.timestamp.trim() : '';
            const timestamp = rawTimestamp || undefined;
            if (!timestamp && !isMissingField('timestamp')) {
                throw new Error('Missing TikTok message timestamp');
            }

            const normalizedUserId = normalized?.userId === undefined || normalized?.userId === null
                ? ''
                : String(normalized.userId).trim();
            const normalizedUsername = normalized?.username === undefined || normalized?.username === null
                ? ''
                : String(normalized.username).trim();

            let identity = {
                userId: normalizedUserId || undefined,
                username: normalizedUsername || undefined
            };

            if (normalizedUserId && normalizedUsername) {
                identity = normalizeUserData({
                    userId: normalizedUserId,
                    username: normalizedUsername
                });
            }

            if (!identity.userId && !isMissingField('userId')) {
                throw new Error('Missing TikTok userId (uniqueId)');
            }
            if (!identity.username && !isMissingField('username')) {
                throw new Error('Missing TikTok username (nickname)');
            }

            const avatarUrl = resolveAvatarUrl(data, normalized || {});
            const messageText = resolveMessageText(normalized);
            const messageParts = resolveMessageParts(normalized);
            const badgeImages = normalizeBadgeImages(normalized?.badgeImages);

            if (!messageText && messageParts.length === 0 && !isMissingField('message')) {
                throw new Error('Missing TikTok message text');
            }
            const eventMetadata = mergeMissingFieldsMetadata(buildEventMetadata(normalizedMetadata), missingFields, {
                ...(missingFields.length > 0 && timestamp ? { sourceTimestamp: timestamp } : {})
            });

            const messagePayload = {
                text: messageText || (isMissingField('message') ? UNKNOWN_CHAT_MESSAGE : '')
            };

            if (messageParts.length > 0) {
                messagePayload.parts = messageParts;
            }

            const eventData = {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: platformName,
                username: identity.username || UNKNOWN_CHAT_USERNAME,
                ...(identity.userId ? { userId: identity.userId } : {}),
                avatarUrl,
                message: messagePayload,
                ...(timestamp ? { timestamp } : {}),
                isMod: !!normalized.isMod,
                isPaypiggy: normalized.isPaypiggy === true,
                isBroadcaster: !!normalized.isBroadcaster,
                metadata: eventMetadata
            };

            if (badgeImages.length > 0) {
                eventData.badgeImages = badgeImages;
            }

            return eventData;
        },
        createGift: (data = {}) => {
            const identity = normalizeIdentityFromCanonical(data);
            const avatarUrl = resolveAvatarUrl(data);
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
            const giftImageUrl = typeof data.giftImageUrl === 'string' ? data.giftImageUrl.trim() : '';
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
                avatarUrl,
                giftType,
                ...(giftImageUrl ? { giftImageUrl } : {}),
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
            const avatarUrl = resolveAvatarUrl(params);

            return {
                type: PlatformEvents.FOLLOW,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                avatarUrl,
                timestamp: params.timestamp,
                metadata: buildEventMetadata(params.metadata)
            };
        },
        createShare: (params = {}) => {
            const identity = normalizeUserData({
                userId: params.userId,
                username: params.username
            });
            const avatarUrl = resolveAvatarUrl(params);

            return {
                type: PlatformEvents.SHARE,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                avatarUrl,
                timestamp: params.timestamp,
                metadata: buildEventMetadata({
                    interactionType: 'share',
                    ...(params.metadata || {})
                })
            };
        },
        createEnvelope: (data = {}) => {
            const identity = normalizeIdentityFromPayload(data);
            const avatarUrl = resolveAvatarUrl(data);
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
                avatarUrl,
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
            const avatarUrl = resolveAvatarUrl(data);
            const tier = typeof data?.tier === 'string' ? data.tier.trim() : '';
            const message = typeof data?.message === 'string' ? data.message.trim() : '';
            const months = Number(data?.months);

            const payload = {
                type: PlatformEvents.PAYPIGGY,
                platform: platformName,
                ...identity,
                avatarUrl,
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
            const avatarUrl = resolveAvatarUrl(data);
            const message = typeof data?.message === 'string' ? data.message.trim() : '';
            const months = Number(data?.months);

            const payload = {
                type: PlatformEvents.PAYPIGGY,
                platform: platformName,
                ...identity,
                avatarUrl,
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
            const normalizedContext = normalizeContext(context);
            return {
                type: PlatformEvents.ERROR,
                platform: platformName,
                error: {
                    message: error.message,
                    name: error.name
                },
                context: {
                    ...normalizedContext,
                    correlationId
                },
                recoverable: normalizeRecoverable(normalizedContext.recoverable),
                timestamp,
                metadata: {
                    platform: platformName,
                    correlationId
                }
            };
        }
    };
}

export { createTikTokEventFactory };
