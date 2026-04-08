const { PlatformEvents } = require('../../../interfaces/PlatformEvents');
const { isIsoTimestamp } = require('../../../utils/timestamp');
const { DEFAULT_AVATAR_URL } = require('../../../constants/avatar');
const { UNKNOWN_CHAT_MESSAGE, UNKNOWN_CHAT_USERNAME } = require('../../../constants/degraded-chat');
const { getValidMessageParts, normalizeBadgeImages } = require('../../../utils/message-parts');
const { getMissingFields, mergeMissingFieldsMetadata } = require('../../../utils/missing-fields');

type UnknownRecord = Record<string, unknown>;

type ValidMessagePart =
    | { type: 'text'; text: string }
    | { type: 'emote'; platform?: string; emoteId: string; imageUrl: string };

interface YouTubeEventFactoryOptions {
    platformName?: string;
    generateCorrelationId?: () => string;
}

function createYouTubeEventFactory(options: YouTubeEventFactoryOptions = {}) {
    const platformName = options.platformName || 'youtube';
    const generateCorrelationId = options.generateCorrelationId || (() => PlatformEvents._generateCorrelationId());

    const ensureIsoTimestamp = (value: unknown, errorMessage: string): string => {
        if (!value) {
            throw new Error(errorMessage);
        }
        if (typeof value !== 'string' || !isIsoTimestamp(value)) {
            throw new Error(`${errorMessage} (ISO required)`);
        }
        return value;
    };

    const normalizeIdentity = (data: UnknownRecord, { allowMissing }: { allowMissing?: boolean } = {}) => {
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

    const normalizePositiveNumber = (value: unknown) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : undefined;
    };

    const normalizeNonNegativeNumber = (value: unknown) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) && numericValue >= 0 ? numericValue : undefined;
    };

    const normalizeText = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

    const resolveMessageText = (data: UnknownRecord = {}) => {
        if (typeof data.message === 'string') {
            return data.message;
        }

        if (data.message && typeof data.message === 'object' && typeof (data.message as UnknownRecord).text === 'string') {
            return (data.message as UnknownRecord).text as string;
        }

        return '';
    };

    const resolveMessageParts = (data: UnknownRecord = {}) => {
        return getValidMessageParts({ message: data?.message }, { allowWhitespaceText: true })
            .map((part: ValidMessagePart) => {
                if (part.type === 'text') {
                    return {
                        type: 'text',
                        text: part.text
                    };
                }

                return {
                    type: 'emote',
                    platform: normalizeText(part.platform) || platformName,
                    emoteId: part.emoteId.trim(),
                    imageUrl: part.imageUrl.trim()
                };
            });
    };

    const getTimestamp = (data: UnknownRecord, errorMessage: string) => ensureIsoTimestamp(data.timestamp, errorMessage);
    const resolveAvatarUrl = (data: UnknownRecord) => {
        const avatarUrl = normalizeText(data.avatarUrl);
        if (avatarUrl) {
            return avatarUrl;
        }
        return DEFAULT_AVATAR_URL;
    };

    const buildEventMetadata = (additionalMetadata: UnknownRecord = {}): UnknownRecord => ({
        platform: platformName,
        ...additionalMetadata,
        correlationId: generateCorrelationId()
    });

    const normalizeContext = (context: unknown): UnknownRecord => {
        if (!context || typeof context !== 'object' || Array.isArray(context)) {
            return {};
        }

        return context as UnknownRecord;
    };

    const normalizeRecoverable = (recoverable: unknown): boolean => (typeof recoverable === 'boolean' ? recoverable : true);

    return {
        createChatConnectedEvent: (data: UnknownRecord = {}) => {
            const timestamp = getTimestamp(data, 'YouTube chat connected event requires timestamp');
            return {
                type: PlatformEvents.CHAT_CONNECTED,
                platform: platformName,
                videoId: data.videoId,
                connectionId: data.connectionId,
                timestamp
            };
        },

        createChatMessageEvent: (data: UnknownRecord = {}) => {
            const dataMetadata = data?.metadata && typeof data.metadata === 'object'
                ? data.metadata
                : {};
            const missingFields = getMissingFields(dataMetadata);
            const isMissingField = (fieldName: string) => missingFields.includes(fieldName);
            const rawTimestamp = normalizeText(data.timestamp);
            const timestamp = rawTimestamp && isIsoTimestamp(rawTimestamp)
                ? rawTimestamp
                : undefined;
            if (!timestamp && !isMissingField('timestamp')) {
                throw new Error('YouTube chat message event requires timestamp');
            }

            const identity = normalizeIdentity(data, { allowMissing: true });
            if (!identity.username && !isMissingField('username')) {
                throw new Error('YouTube event payload requires userId and username');
            }
            if (!identity.userId && !isMissingField('userId')) {
                throw new Error('YouTube event payload requires userId and username');
            }

            const avatarUrl = resolveAvatarUrl(data);
            const messageText = normalizeText(resolveMessageText(data));
            const messageParts = resolveMessageParts(data);
            if (!messageText && messageParts.length === 0 && !isMissingField('message')) {
                throw new Error('YouTube chat message event requires message text');
            }
            const badgeImages = normalizeBadgeImages(data.badgeImages);
            const message: UnknownRecord = {
                text: messageText || (isMissingField('message') ? UNKNOWN_CHAT_MESSAGE : '')
            };
            if (messageParts.length > 0) {
                message.parts = messageParts;
            }

            const metadata = mergeMissingFieldsMetadata(buildEventMetadata({
                videoId: data.videoId,
                isMod: data.isMod || false,
                isOwner: data.isOwner || false,
                isVerified: data.isVerified || false
            }), missingFields, {
                ...(missingFields.length > 0 && timestamp ? { sourceTimestamp: timestamp } : {})
            });

            const eventData: UnknownRecord = {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: platformName,
                username: identity.username || UNKNOWN_CHAT_USERNAME,
                ...(identity.userId ? { userId: identity.userId } : {}),
                avatarUrl,
                message,
                ...(timestamp ? { timestamp } : {}),
                isMod: !!data.isMod,
                isPaypiggy: data.isPaypiggy === true,
                isBroadcaster: !!data.isBroadcaster,
                metadata
            };

            if (badgeImages.length > 0) {
                eventData.badgeImages = badgeImages;
            }

            return eventData;
        },

        createViewerCountEvent: (data: UnknownRecord = {}) => {
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

        createGiftEvent: (data: UnknownRecord = {}) => {
            const isError = data.isError === true;
            const identity = normalizeIdentity(data, { allowMissing: isError });
            const avatarUrl = resolveAvatarUrl(data);
            const giftType = normalizeText(data.giftType);
            const giftCount = isError
                ? normalizeNonNegativeNumber(data.giftCount)
                : normalizePositiveNumber(data.giftCount);
            const amount = isError
                ? normalizeNonNegativeNumber(data.amount)
                : normalizePositiveNumber(data.amount);
            const currency = normalizeText(data.currency);
            const message = typeof data.message === 'string' ? data.message : undefined;
            const giftImageUrl = normalizeText(data.giftImageUrl);

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

            const result: UnknownRecord = {
                type: PlatformEvents.GIFT,
                platform: platformName,
                ...(identity.username ? { username: identity.username } : {}),
                ...(identity.userId ? { userId: identity.userId } : {}),
                ...(avatarUrl ? { avatarUrl } : {}),
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
            if (giftImageUrl) {
                result.giftImageUrl = giftImageUrl;
            }
            if (isError) {
                result.isError = true;
            }
            return result;
        },

        createGiftPaypiggyEvent: (data: UnknownRecord = {}) => {
            const isError = data.isError === true;
            const identity = normalizeIdentity(data, { allowMissing: isError });
            const avatarUrl = resolveAvatarUrl(data);
            const giftCount = isError
                ? normalizeNonNegativeNumber(data.giftCount)
                : normalizePositiveNumber(data.giftCount);
            const id = data.id === undefined || data.id === null ? '' : String(data.id).trim();

            if (!isError && giftCount === undefined) {
                throw new Error('YouTube giftpaypiggy payload requires giftCount');
            }

            const result: UnknownRecord = {
                type: PlatformEvents.GIFTPAYPIGGY,
                platform: platformName,
                ...(identity.username ? { username: identity.username } : {}),
                ...(identity.userId ? { userId: identity.userId } : {}),
                ...(avatarUrl ? { avatarUrl } : {}),
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

        createPaypiggyEvent: (data: UnknownRecord = {}) => {
            const isError = data.isError === true;
            const identity = normalizeIdentity(data, { allowMissing: isError });
            const avatarUrl = resolveAvatarUrl(data);
            const months = normalizePositiveNumber(data.months);
            const message = typeof data.message === 'string' ? data.message : undefined;
            const membershipLevel = normalizeText(data.membershipLevel);
            const id = data.id === undefined || data.id === null ? '' : String(data.id).trim();

            const result: UnknownRecord = {
                type: PlatformEvents.PAYPIGGY,
                platform: platformName,
                ...(identity.username ? { username: identity.username } : {}),
                ...(identity.userId ? { userId: identity.userId } : {}),
                ...(avatarUrl ? { avatarUrl } : {}),
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

        createErrorEvent: (data: UnknownRecord = {}) => {
            const timestamp = getTimestamp(data, 'YouTube error event requires timestamp');
            const error = data.error && typeof data.error === 'object' ? data.error as UnknownRecord : {};
            return {
                type: PlatformEvents.ERROR,
                platform: platformName,
                error: {
                    message: typeof error.message === 'string' ? error.message : undefined,
                    name: typeof error.name === 'string' ? error.name : undefined
                },
                context: normalizeContext(data.context),
                recoverable: normalizeRecoverable(data.recoverable),
                timestamp,
                metadata: buildEventMetadata({
                    videoId: data.videoId
                })
            };
        }
    };
}

export { createYouTubeEventFactory };
