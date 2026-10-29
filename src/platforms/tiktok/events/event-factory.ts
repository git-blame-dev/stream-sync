import crypto from 'node:crypto';
import { normalizeTikTokMessage } from '../../../utils/message-normalization';
import { extractTikTokUserData, extractTikTokAvatarUrl, normalizeTikTokHttpUrl, normalizeTikTokMessageId } from '../../../utils/tiktok-data-extraction';
import { getSystemTimestampISO, parseTimestampISO } from '../../../utils/timestamp';
import { parseNotificationCount } from '../../../utils/notification-count';
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

type NormalizedMessagePayload = {
    text: string;
    parts?: Array<Record<string, unknown>>;
};

type ChatEventPayload = Record<string, unknown> & {
    message: NormalizedMessagePayload;
};

type GiftEventPayload = Record<string, unknown> & {
    type: string;
    platform: string;
    username: string;
    userId: string;
    avatarUrl: string;
    giftType: string;
    giftImageUrl?: string;
    giftCount: number;
    amount: number;
    currency: string;
    repeatCount?: number;
    id: string | number;
    timestamp: unknown;
    isAggregated: boolean;
    aggregatedCount?: number;
    enhancedGiftData?: Record<string, unknown>;
    sourceType?: string;
};

type PaypiggyEventPayload = Record<string, unknown> & {
    type: string;
    platform: string;
    userId: string;
    username: string;
    avatarUrl: string;
    timestamp: unknown;
    tier?: string;
    months?: number;
    message?: string;
};

type EventFactoryOptions = {
platformName?: string;
timestampService?: unknown;
getTimestamp?: (data: Record<string, unknown>) => unknown;
    normalizeUserData?: (data: NormalizedIdentity) => NormalizedIdentity;
    getPlatformMessageId?: (data: Record<string, unknown>) => string | number | null | undefined;
    generateCorrelationId?: () => string;
    buildEventMetadata?: (additionalMetadata?: EventFactoryMetadata) => EventFactoryMetadata;
    normalizeChatEvent?: (data: Record<string, unknown>) => Record<string, unknown>;
};

type EventFactoryPayload = Record<string, unknown>;
type EventFactoryChatOptions = { normalizedData?: EventFactoryPayload };

function asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as Record<string, unknown>;
}

function requirePositiveGiftCount(value: unknown, field: string): number {
    const count = parseNotificationCount(value);
    if (count === null || count === 0) throw new Error(`TikTok gift requires ${field}`);
    return count;
}

function optionalPositiveGiftCount(value: unknown, field: string): number | undefined {
    return value === undefined || value === null ? undefined : requirePositiveGiftCount(value, field);
}

function createTikTokEventFactory(options: EventFactoryOptions = {}) {
    const platformName = options.platformName || 'tiktok';
const getTimestamp = options.getTimestamp || ((data: Record<string, unknown>) => data.timestamp);
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

const normalizeRecoverable = (recoverable: unknown): boolean => (typeof recoverable === 'boolean' ? recoverable : true);
    const normalizeChatEvent = options.normalizeChatEvent
        || ((data: Record<string, unknown>) => normalizeTikTokMessage(data, platformName) as Record<string, unknown>);

    const normalizeIdentityFromPayload = (data: Record<string, unknown>) => normalizeUserData(extractTikTokUserData(data));
    const normalizeIdentityFromCanonical = (data: Record<string, unknown>) => {
        if (typeof data.userId !== 'string' || !data.userId.trim()) throw new Error('TikTok gift requires userId');
        if (typeof data.username !== 'string' || !data.username.trim()) throw new Error('TikTok gift requires username');
        const identity = normalizeUserData({ userId: data.userId.trim(), username: data.username.trim() });
        if (typeof identity.userId !== 'string' || !identity.userId.trim()
            || typeof identity.username !== 'string' || !identity.username.trim()) {
            throw new Error('TikTok gift requires non-empty identity');
        }
        return { userId: identity.userId.trim(), username: identity.username.trim() };
    };
    const resolveAvatarUrl = (data: Record<string, unknown> = {}, fallbackData: Record<string, unknown> = {}) => {
        const avatarFromData = normalizeTikTokHttpUrl(data.avatarUrl);
        if (avatarFromData) {
            return avatarFromData;
        }

        const extractedAvatarFromData = extractTikTokAvatarUrl(data);
        if (extractedAvatarFromData) {
            return extractedAvatarFromData;
        }

        const avatarFromFallback = normalizeTikTokHttpUrl(fallbackData.avatarUrl);
        if (avatarFromFallback) {
            return avatarFromFallback;
        }

        const extractedAvatarFromFallback = extractTikTokAvatarUrl(fallbackData);
        if (extractedAvatarFromFallback) {
            return extractedAvatarFromFallback;
        }

        const metadata = asRecord(fallbackData.metadata);
        const profilePicture = metadata?.profilePicture;
        const metadataAvatar = normalizeTikTokHttpUrl(profilePicture);
        if (metadataAvatar) {
            return metadataAvatar;
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
                    const normalizedPart: Record<string, unknown> = {
                        type: 'emote',
                        platform: typeof part.platform === 'string' ? part.platform : 'tiktok',
                        emoteId: typeof part.emoteId === 'string' ? part.emoteId : '',
                        imageUrl: part.imageUrl.trim()
                    };

                    const partRecord = asRecord(part);
                    const placeInComment = partRecord?.placeInComment;
                    if (Number.isInteger(placeInComment) && typeof placeInComment === 'number' && placeInComment >= 0) {
                        normalizedPart.placeInComment = placeInComment;
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
        createChatMessage: (data: EventFactoryPayload = {}, eventOptions: EventFactoryChatOptions = {}) => {
            const normalized = eventOptions.normalizedData || normalizeChatEvent(data);
            const normalizedMetadata: EventFactoryMetadata = normalized?.metadata && typeof normalized.metadata === 'object'
                ? { ...normalized.metadata }
                : {};
            delete normalizedMetadata.messageParts;

            const missingFields = getMissingFields(normalizedMetadata);
const isMissingField = (fieldName: string): boolean => missingFields.includes(fieldName);

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

            const messagePayload: NormalizedMessagePayload = {
                text: messageText || (isMissingField('message') ? UNKNOWN_CHAT_MESSAGE : '')
            };

            if (messageParts.length > 0) {
                messagePayload.parts = messageParts;
            }

            const eventData: ChatEventPayload = {
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
        createGift: (data: EventFactoryPayload = {}) => {
            const identity = normalizeIdentityFromCanonical(data);
            const avatarUrl = resolveAvatarUrl(data);
            const enhancedGiftData = asRecord(data.enhancedGiftData);
            const hasEnhancedGiftData = enhancedGiftData !== null;

            if (typeof data.giftType !== 'string' || !data.giftType.trim()) {
                throw new Error('TikTok gift requires giftType');
            }
            const giftCount = requirePositiveGiftCount(data.giftCount, 'giftCount');
            const resolvedAmount = requirePositiveGiftCount(data.amount, 'amount');
            if (typeof data.currency !== 'string' || !data.currency.trim()) {
                throw new Error('TikTok gift requires currency');
            }
            const timestamp = parseTimestampISO(data.timestamp ?? getTimestamp(data), { allowDateString: true, requirePositive: true });
            if (!timestamp) {
                throw new Error('TikTok gift requires valid timestamp');
            }
            const giftType = data.giftType.trim();
            const giftImageUrl = normalizeTikTokHttpUrl(data.giftImageUrl);
            const repeatCount = optionalPositiveGiftCount(data.repeatCount, 'repeatCount');
            requirePositiveGiftCount(data.unitAmount, 'unitAmount');
            const currency = data.currency.trim();
            const platformMessageId = normalizeTikTokMessageId(getPlatformMessageId(data))
                ?? normalizeTikTokMessageId(data.id)
                ?? normalizeTikTokMessageId(data.msgId)
                ?? normalizeTikTokMessageId(asRecord(data.common)?.msgId);
            if (!platformMessageId) {
                throw new Error('TikTok gift requires msgId');
            }

            const directAggregatedCount = optionalPositiveGiftCount(data.aggregatedCount, 'aggregatedCount');
            const enhancedAggregatedCount = optionalPositiveGiftCount(enhancedGiftData?.giftCount, 'enhancedGiftData.giftCount');
            const isAggregated = data.isAggregated === true || directAggregatedCount !== undefined;
            const aggregatedCountValue = directAggregatedCount ?? enhancedAggregatedCount ?? (isAggregated ? giftCount : undefined);

            const result: GiftEventPayload = {
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
                timestamp,
                isAggregated
            };
            if (isAggregated && aggregatedCountValue !== undefined) {
                result.aggregatedCount = aggregatedCountValue;
            }
            if (hasEnhancedGiftData) {
                result.enhancedGiftData = enhancedGiftData;
            }
            if (typeof data.sourceType === 'string' && data.sourceType.trim()) {
                result.sourceType = data.sourceType.trim();
            }
            return result;
        },
        createFollow: (params: EventFactoryPayload = {}) => {
            const identity = normalizeUserData({
                userId: String(params.userId ?? ''),
                username: String(params.username ?? '')
            });
            const avatarUrl = resolveAvatarUrl(params);

            return {
                type: PlatformEvents.FOLLOW,
                platform: platformName,
                username: identity.username,
                userId: identity.userId,
                avatarUrl,
                timestamp: params.timestamp,
                metadata: buildEventMetadata(asRecord(params.metadata) || undefined)
            };
        },
        createShare: (params: EventFactoryPayload = {}) => {
            const identity = normalizeUserData({
                userId: String(params.userId ?? ''),
                username: String(params.username ?? '')
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
                    ...(asRecord(params.metadata) || {})
                })
            };
        },
        createEnvelope: (data: EventFactoryPayload = {}) => {
            if (asRecord(data.envelopeInfo)) {
                // v3 has no handle or established contribution unit/eligibility contract.
                // Keep provider observations descriptive, outside priced contribution fields.
                const envelope = asRecord(asRecord(data.metadata)?.envelope) || {};
                const senderName = typeof envelope.senderName === 'string' ? envelope.senderName : '';
                return {
                    type: PlatformEvents.ENVELOPE,
                    platform: platformName,
                    isError: true,
                    ...(senderName ? { username: senderName } : {}),
                    avatarUrl: resolveAvatarUrl(data),
                    giftType: envelope.isSuperFanBox === true ? 'Super Fan Box' : 'Envelope',
                    id: getPlatformMessageId(data),
                    timestamp: getTimestamp(data),
                    metadata: buildEventMetadata({
                        envelope,
                        missingFields: [...(senderName ? [] : ['username']), 'userId', 'amount', 'currency'],
                        degradationReason: 'Envelope identity, unit and contribution eligibility unavailable'
                    })
                };
            }
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
        createSubscription: (data: EventFactoryPayload = {}) => {
            const identity = normalizeIdentityFromPayload(data);
            const avatarUrl = resolveAvatarUrl(data);
            const tier = typeof data?.tier === 'string' ? data.tier.trim() : '';
            const message = typeof data?.message === 'string' ? data.message.trim() : '';
            const months = Number(data?.months);

            const payload: PaypiggyEventPayload = {
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
        createSuperfan: (data: EventFactoryPayload = {}) => {
            const identity = normalizeIdentityFromPayload(data);
            const avatarUrl = resolveAvatarUrl(data);
            const message = typeof data?.message === 'string' ? data.message.trim() : '';
            const months = Number(data?.months);

            const payload: PaypiggyEventPayload = {
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
        createConnection: (connectionId: string = PlatformEvents._generateCorrelationId()) => {
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
        createDisconnection: (reason: string, willReconnect: boolean) => {
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
        createError: (error: Error, context?: unknown) => {
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
