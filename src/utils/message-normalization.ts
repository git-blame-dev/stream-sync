import { logger } from '../core/logging';
import { resolveTikTokTimestampMs, resolveTikTokTimestampISO, resolveYouTubeTimestampISO } from './platform-timestamp';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { normalizeBadgeImages } from './message-parts';
import { CheermoteProcessor } from './cheermote-processor';

const normalizationErrorHandler = createPlatformErrorHandler(logger, 'message-normalization');

type MessageRecord = Record<string, unknown>;
type MessagePart = Record<string, unknown> & { type: 'text' | 'emote'; text?: string; platform?: string; emoteId?: string; imageUrl?: string };
type NormalizedChatMessage = Record<string, unknown> & {
    platform: string;
    userId: string;
    username: string;
    avatarUrl?: string;
    message: { text: string; parts?: MessagePart[] };
    timestamp: string;
    metadata: Record<string, unknown>;
    badgeImages?: ReturnType<typeof normalizeBadgeImages>;
};

function isRecord(value: unknown): value is MessageRecord {
    return !!value && typeof value === 'object' && !Array.isArray(value);
}

function getRecord(value: MessageRecord, key: string): MessageRecord | null {
    if (!isRecord(value[key])) {
        return null;
    }
    return value[key];
}

function handleNormalizationError(message: string, error: unknown, eventType = 'normalization', eventData: unknown = null) {
    if (error instanceof Error) {
        normalizationErrorHandler.handleEventProcessingError(error, eventType, eventData, message);
        return;
    }

    normalizationErrorHandler.logOperationalError(message, 'normalization', {
        eventType,
        eventData,
        error
    });
}

function isValidTikTokEmoteEntry(entry: unknown): entry is { placeInComment: number; emote: { emoteId: string; image: { imageUrl: string } } } {
    if (!isRecord(entry)) {
        return false;
    }

    if (typeof entry.placeInComment !== 'number' || !Number.isInteger(entry.placeInComment) || entry.placeInComment < 0) {
        return false;
    }

    const emote = getRecord(entry, 'emote');
    if (!emote) {
        return false;
    }

    const emoteId = typeof emote.emoteId === 'string' ? emote.emoteId.trim() : '';
    const image = getRecord(emote, 'image');
    const imageUrl = typeof image?.imageUrl === 'string' ? image.imageUrl.trim() : '';

    return !!emoteId && !!imageUrl;
}

function buildTikTokMessageParts(rawComment: unknown, emotes: unknown[] = []): MessagePart[] {
    if (typeof rawComment !== 'string') {
        return [];
    }

    if (!Array.isArray(emotes) || emotes.length === 0) {
        return [];
    }

    const commentCodepoints = Array.from(rawComment);
    const sortedEmotes = emotes
        .flatMap((entry, index) => isValidTikTokEmoteEntry(entry) ? [{ entry, index }] : [])
        .sort((left, right) => {
            if (left.entry.placeInComment !== right.entry.placeInComment) {
                return left.entry.placeInComment - right.entry.placeInComment;
            }

            return left.index - right.index;
        });

    const parts: MessagePart[] = [];
    let cursor = 0;
    let insertedEmoteCount = 0;

    for (const { entry } of sortedEmotes) {
        const adjustedIndex = entry.placeInComment - insertedEmoteCount;
        const boundedIndex = Math.max(0, Math.min(adjustedIndex, commentCodepoints.length));

        if (boundedIndex > cursor) {
            const textSegment = commentCodepoints.slice(cursor, boundedIndex).join('');
            if (textSegment.trim().length > 0) {
                parts.push({
                    type: 'text',
                    text: textSegment
                });
            }
        }

        parts.push({
            type: 'emote',
            platform: 'tiktok',
            emoteId: entry.emote.emoteId.trim(),
            imageUrl: entry.emote.image.imageUrl.trim(),
            placeInComment: entry.placeInComment
        });

        cursor = Math.max(cursor, boundedIndex);
        insertedEmoteCount += 1;
    }

    if (cursor < commentCodepoints.length) {
        const trailingText = commentCodepoints.slice(cursor).join('');
        if (trailingText.trim().length > 0) {
            parts.push({
                type: 'text',
                text: trailingText
            });
        }
    }

    return parts;
}

const TWITCH_DEFAULT_EMOTE_IMAGE_URL = 'https://static-cdn.jtvnw.net/emoticons/v2/emotesv2_dcd06b30a5c24f6eb871e8f5edbd44f7/animated/dark/3.0';

function resolveTwitchEmoteScale(scaleOptions: unknown[] = []): string {
    if (!Array.isArray(scaleOptions) || scaleOptions.length === 0) {
        return '3.0';
    }

    const normalizedScales = scaleOptions
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim())
        .filter((value) => /^\d+(?:\.\d+)?$/.test(value));

    if (normalizedScales.includes('3.0')) {
        return '3.0';
    }

    if (normalizedScales.length === 0) {
        return '3.0';
    }

    return normalizedScales
        .sort((left, right) => Number(right) - Number(left))[0] ?? '3.0';
}

function resolveTwitchEmoteImageUrl(emoteId: unknown, formatOptions: unknown[] = [], scaleOptions: unknown[] = []): string {
    const normalizedEmoteId = typeof emoteId === 'string' ? emoteId.trim() : '';
    if (!normalizedEmoteId) {
        return '';
    }

    if (!Array.isArray(formatOptions) || formatOptions.length === 0) {
        return '';
    }

    const normalizedFormats = formatOptions
        .filter((value) => typeof value === 'string')
        .map((value) => value.trim().toLowerCase())
        .filter(Boolean);

    const format = normalizedFormats.includes('animated')
        ? 'animated'
        : (normalizedFormats.includes('static') ? 'static' : '');
    if (!format) {
        return '';
    }

    const scale = resolveTwitchEmoteScale(scaleOptions);
    const resolvedUrl = new URL(TWITCH_DEFAULT_EMOTE_IMAGE_URL);
    resolvedUrl.pathname = `/emoticons/v2/${normalizedEmoteId}/${format}/dark/${scale}`;
    return resolvedUrl.toString();
}

function buildTwitchMessageParts(messageObj: unknown): MessagePart[] {
    if (!isRecord(messageObj)) {
        return [];
    }

    if (!Array.isArray(messageObj.fragments) || messageObj.fragments.length === 0) {
        return [];
    }

    return messageObj.fragments
        .map((fragment): MessagePart | null => {
            if (!isRecord(fragment)) {
                return null;
            }

            if (fragment.type === 'text') {
                const text = typeof fragment.text === 'string' ? fragment.text : '';
                if (!text) {
                    return null;
                }

                return {
                    type: 'text',
                    text
                };
            }

            if (fragment.type !== 'emote') {
                return null;
            }

            const emote = getRecord(fragment, 'emote');
            const emoteId = typeof emote?.id === 'string' ? emote.id.trim() : '';
            const imageUrl = resolveTwitchEmoteImageUrl(emoteId, Array.isArray(emote?.format) ? emote.format : [], Array.isArray(emote?.scale) ? emote.scale : []);

            if (!emoteId || !imageUrl) {
                return null;
            }

            return {
                type: 'emote',
                platform: 'twitch',
                emoteId,
                imageUrl
            };
        })
        .filter((part) => part !== null);
}

function resolveYouTubeEmojiImageUrl(images: unknown[] = []): string {
    if (!Array.isArray(images) || images.length === 0) {
        return '';
    }

    const normalizedImages = images
        .filter(isRecord)
        .map((image) => ({
            url: typeof image.url === 'string' ? image.url.trim() : '',
            width: Number(image.width)
        }))
        .filter((image) => image.url.length > 0);

    if (normalizedImages.length === 0) {
        return '';
    }

    const widthCandidates = normalizedImages.filter((image) => Number.isFinite(image.width));
    if (widthCandidates.length > 0) {
        return widthCandidates
            .sort((left, right) => right.width - left.width)[0]
            ?.url ?? '';
    }

    return normalizedImages[0]?.url ?? '';
}

function resolveLargestImageUrl(images: unknown[] = []): string {
    if (!Array.isArray(images) || images.length === 0) {
        return '';
    }

    const normalizedImages = images
        .filter(isRecord)
        .map((image) => ({
            url: typeof image.url === 'string' ? image.url.trim() : '',
            width: Number(image.width)
        }))
        .filter((image) => image.url.length > 0);

    if (normalizedImages.length === 0) {
        return '';
    }

    const widthCandidates = normalizedImages.filter((image) => Number.isFinite(image.width));
    if (widthCandidates.length > 0) {
        return widthCandidates.sort((left, right) => right.width - left.width)[0]?.url ?? '';
    }

    return normalizedImages[0]?.url ?? '';
}

function extractYouTubeBadgeImages(author: MessageRecord = {}) {
    const badges = Array.isArray(author.badges) ? author.badges : [];
    return normalizeBadgeImages(
        badges.map((badge) => {
            if (!isRecord(badge)) {
                return null;
            }
            const imageUrl = resolveLargestImageUrl(Array.isArray(badge.custom_thumbnail) ? badge.custom_thumbnail : []);
            if (!imageUrl) {
                return null;
            }
            return {
                imageUrl,
                source: 'youtube',
                label: typeof badge.tooltip === 'string' ? badge.tooltip : ''
            };
        })
    );
}

function extractTikTokBadgeImages(data: MessageRecord = {}) {
    const userData = isRecord(data.user) ? data.user : {};
    const entries: Array<Record<string, string>> = [];

    const badgeImageList = Array.isArray(userData.badgeImageList) ? userData.badgeImageList : [];
    for (const badgeImage of badgeImageList) {
        if (!isRecord(badgeImage)) {
            continue;
        }
        const firstUrl = Array.isArray(badgeImage.url) && typeof badgeImage.url[0] === 'string'
            ? badgeImage.url[0].trim()
            : '';
        if (!firstUrl) {
            continue;
        }
        entries.push({ imageUrl: firstUrl, source: 'tiktok', label: '' });
    }

    const badges = Array.isArray(userData.badges) ? userData.badges : [];
    for (const badge of badges) {
        if (!isRecord(badge)) {
            continue;
        }
        const combine = getRecord(badge, 'combine');
        const icon = combine ? getRecord(combine, 'icon') : null;
        const text = getRecord(badge, 'text');
        const firstUrl = Array.isArray(icon?.url) && typeof icon.url[0] === 'string'
            ? icon.url[0].trim()
            : '';
        if (!firstUrl) {
            continue;
        }
        const label = typeof text?.defaultPattern === 'string' ? text.defaultPattern : '';
        entries.push({ imageUrl: firstUrl, source: 'tiktok', label });
    }

    return normalizeBadgeImages(entries);
}

function buildYouTubeMessageParts(messageObj: unknown): MessagePart[] {
    if (!isRecord(messageObj) || !Array.isArray(messageObj.runs)) {
        return [];
    }

    return messageObj.runs
        .map((run): MessagePart | null => {
            if (!isRecord(run)) {
                return null;
            }

            const emoji = getRecord(run, 'emoji');
            const emoteId = typeof emoji?.emoji_id === 'string' ? emoji.emoji_id.trim() : '';
            const imageUrl = resolveYouTubeEmojiImageUrl(Array.isArray(emoji?.image) ? emoji.image : []);
            const isCustomEmote = emoji?.is_custom === true || emoteId.includes('/');
            if (isCustomEmote && emoteId && imageUrl) {
                return {
                    type: 'emote',
                    platform: 'youtube',
                    emoteId,
                    imageUrl
                };
            }

            if (typeof run.text === 'string' && run.text.length > 0) {
                return {
                    type: 'text',
                    text: run.text
                };
            }

            return null;
        })
        .filter((part) => part !== null);
}


function normalizeYouTubeMessage(chatItem: unknown, platformName = 'youtube') {
    try {
        if (!isRecord(chatItem)) {
            throw new Error('Missing YouTube chat item');
        }
        if (!isRecord(chatItem.item)) {
            throw new Error('Missing YouTube chat item payload');
        }
        const messageData = chatItem.item;
        const author = messageData.author;
        if (!isRecord(author)) {
            throw new Error('Missing YouTube author data');
        }
        const userId = typeof author.id === 'string' ? author.id.trim() : '';
        const rawUsername = typeof author.name === 'string' ? author.name.trim() : '';
        const username = rawUsername.startsWith('@') ? rawUsername.slice(1) : rawUsername;
        if (!userId) {
            throw new Error('Missing YouTube userId');
        }
        if (!username) {
            throw new Error('Missing YouTube username');
        }

        let message;
        if (messageData.superchat) {
            const superchat = getRecord(messageData, 'superchat');
            message = extractYouTubeMessageText(superchat?.message);
        } else {
            message = extractYouTubeMessageText(messageData.message);
        }

        const normalizedMessage = typeof message === 'string' ? message.trim() : '';
        const messageParts = buildYouTubeMessageParts(messageData.message);
        const hasRenderableEmote = messageParts.some((part) => part.type === 'emote');

        if (!normalizedMessage && !hasRenderableEmote) {
            throw new Error('Missing YouTube message text');
        }

        const timestamp = resolveYouTubeTimestampISO(chatItem);
        if (!timestamp || typeof timestamp !== 'string') {
            throw new Error('Missing YouTube timestamp');
        }

        const badges = Array.isArray(author.badges) ? author.badges.filter(isRecord) : [];
        const isBroadcaster = badges.some((badge) => badge.icon_type === 'OWNER');
        const isMember = badges.some((badge) =>
            typeof badge.tooltip === 'string' &&
            badge.tooltip.toLowerCase().includes('member')
        );
        const thumbnails = Array.isArray(author.thumbnails) ? author.thumbnails.filter(isRecord) : [];
        const avatarUrl = typeof thumbnails[0]?.url === 'string'
            ? thumbnails[0].url.trim()
            : '';

        const normalized: NormalizedChatMessage = {
            platform: String(platformName || 'youtube').toLowerCase(),
            userId,
            username,
            avatarUrl,
            message: {
                text: normalizedMessage
            },
            timestamp,
            isMod: author.is_moderator === true,
            isPaypiggy: isMember,
            isBroadcaster,
            metadata: {
                uniqueId: messageData.id || null,
                isSuperChat: !!messageData.superchat,
                isSuperSticker: !!messageData.supersticker,
                isMembership: !!messageData.isMembership,
                authorPhoto: thumbnails[0]?.url || null
            },
            rawData: { chatItem }
        };
        const badgeImages = extractYouTubeBadgeImages(author);
        if (badgeImages.length > 0) {
            normalized.badgeImages = badgeImages;
        }
        if (hasRenderableEmote) {
            normalized.message.parts = messageParts;
        }

        logger.debug(`Normalized YouTube message from ${normalized.username}`, 'message-normalization');
        return normalized;
    } catch (error) {
        const chatRecord = isRecord(chatItem) ? chatItem : {};
        const itemRecord = isRecord(chatRecord.item) ? chatRecord.item : {};
        const authorRecord = isRecord(itemRecord.author) ? itemRecord.author : {};
        handleNormalizationError(`Failed to normalize YouTube message: ${error instanceof Error ? error.message : String(error)}`, error, 'youtube', {
            author: authorRecord.name
        });
        throw error;
    }
}

function resolveTikTokChatIsPaypiggy(data: MessageRecord) {
    const userIdentity = getRecord(data, 'userIdentity');
    return userIdentity?.isSubscriberOfAnchor === true;
}

function normalizeTikTokMessage(data: unknown, platformName = 'tiktok') {
    let userData: MessageRecord | null = null;
    try {
        if (!isRecord(data)) {
            throw new Error('Missing TikTok message data');
        }

        userData = isRecord(data.user) ? data.user : null;

        if (!userData) {
            throw new Error('Missing TikTok userId (user data)');
        }

        const userId = typeof userData.uniqueId === 'string' ? userData.uniqueId.trim() : '';
        const username = typeof userData.nickname === 'string' ? userData.nickname.trim() : '';
        if (!userId) {
            throw new Error('Missing TikTok userId (uniqueId)');
        }
        if (!username) {
            throw new Error('Missing TikTok username (nickname)');
        }
        const rawComment = typeof data.comment === 'string' ? data.comment : '';
        const message = rawComment.trim();
        const messageParts = buildTikTokMessageParts(rawComment, Array.isArray(data.emotes) ? data.emotes : []);
        const hasRenderableEmote = messageParts.some((part) => part.type === 'emote');
        if (!message && !hasRenderableEmote) {
            throw new Error('Missing TikTok message text');
        }

        const timestamp = resolveTikTokTimestampISO(data);
        if (!timestamp || typeof timestamp !== 'string') {
            throw new Error('Missing TikTok timestamp');
        }

        const resolvedCreateTimeMs = resolveTikTokTimestampMs(data);
        const profilePicture = userData.profilePictureUrl
            || (isRecord(userData.profilePicture) && Array.isArray(userData.profilePicture.url) ? userData.profilePicture.url[0] : null)
            || null;

        const normalized: NormalizedChatMessage = {
            platform: platformName.toLowerCase(),
            userId,
            username,
            message: {
                text: message
            },
            timestamp,
            isMod: !!data.isModerator,
            isPaypiggy: resolveTikTokChatIsPaypiggy(data),
            isBroadcaster: !!data.isOwner,
            metadata: {
                profilePicture,
                followRole: userData.followRole ?? null,
                userBadges: Array.isArray(userData.userBadges) ? userData.userBadges : null,
                createTime: resolvedCreateTimeMs || null,
                numericId: typeof userData.userId === 'string' ? userData.userId.trim() : null
            },
            rawData: { data }
        };
        const badgeImages = extractTikTokBadgeImages(data);
        if (badgeImages.length > 0) {
            normalized.badgeImages = badgeImages;
        }
        if (messageParts.length > 0) {
            normalized.message.parts = messageParts;
        }

        logger.debug(`Normalized TikTok message from ${normalized.username}`, 'message-normalization');
        return normalized;
    } catch (error) {
        handleNormalizationError(`Failed to normalize TikTok message: ${error instanceof Error ? error.message : String(error)}`, error, 'tiktok', {
            userId: userData?.userId,
            platform: platformName
        });
        throw error;
    }
}

function extractTwitchMessageData(messageObj: unknown) {
    if (!isRecord(messageObj)) {
        return { textContent: '', cheermoteInfo: null };
    }
    
    // Require EventSub fragments for cheermote extraction
    if (!Array.isArray(messageObj.fragments) || messageObj.fragments.length === 0) {
        return { textContent: '', cheermoteInfo: null };
    }
    
    // Extract text from fragments, excluding cheermotes
    const fragments = messageObj.fragments.filter(isRecord);
    const textParts = fragments
        .filter((fragment) => fragment.type === 'text')
        .map((fragment) => typeof fragment.text === 'string' ? fragment.text : '')
        .join('');
    
    // Extract cheermote information (get the first/primary cheermote)
    const cheermoteFragments = fragments.filter((fragment) => fragment.type === 'cheermote');
    let cheermoteInfo: (Record<string, unknown> & { totalBits?: unknown }) | null = null;
    
    if (cheermoteFragments.length > 0) {
        const primaryCheermote = cheermoteFragments[0];
        if (isRecord(primaryCheermote) && isRecord(primaryCheermote.cheermote) && primaryCheermote.text) {
            // Use unified cheermote processor for consistent processing
            const processedData = CheermoteProcessor.processEventSubFragments(messageObj.fragments);
            const parsedTier = Number(primaryCheermote.cheermote.tier);
            const tier = Number.isFinite(parsedTier) && parsedTier > 0
                ? parsedTier
                : undefined;
            
            cheermoteInfo = {
                prefix: primaryCheermote.cheermote.prefix,
                text: primaryCheermote.text, // This contains "uni1", "Cheer100", etc.
                cleanPrefix: ('cleanPrimaryTypeOriginalCase' in processedData && typeof processedData.cleanPrimaryTypeOriginalCase === 'string'
                    ? processedData.cleanPrimaryTypeOriginalCase
                    : primaryCheermote.cheermote.prefix), // NEW: Clean prefix without numbers, preserving case
                textContent: processedData.textContent, // NEW: Clean text without cheermote patterns
                totalBits: processedData.totalBits,
                count: cheermoteFragments.length,
                types: processedData.types,
                isMixed: processedData.mixedTypes,
                ...(tier !== undefined ? { tier } : {})
            };
        }
    }
    
    const result = {
        textContent: textParts.trim(),
        cheermoteInfo: cheermoteInfo
    };
    
    const inputText = typeof messageObj.text === 'string' ? messageObj.text : '';
    logger.debug(`[extractTwitchMessageData] Input: "${inputText}" | Output: text="${result.textContent}", bits=${result.cheermoteInfo?.totalBits || 0}`, 'message-normalization');
    return result;
}

function extractYouTubeMessageText(messageObj: unknown): string {
    const resolveEmojiIdGlyph = (emojiId: unknown): string => {
        if (typeof emojiId !== 'string') {
            return '';
        }

        const normalized = emojiId.trim();
        if (!normalized) {
            return '';
        }

        const codePointTokens = (normalized.match(/U\+[0-9A-Fa-f]{2,6}/g) || [])
            .map((token) => Number.parseInt(token.slice(2), 16))
            .filter((value) => Number.isInteger(value) && value > 0);

        if (codePointTokens.length === 0) {
            return '';
        }

        try {
            return String.fromCodePoint(...codePointTokens);
        } catch {
            return '';
        }
    };

    const resolveEmojiRunText = (emoji: unknown): string => {
        if (!isRecord(emoji)) {
            return '';
        }

        const emojiIdGlyph = resolveEmojiIdGlyph(emoji.emoji_id);
        if (emojiIdGlyph) {
            return emojiIdGlyph;
        }

        if (Array.isArray(emoji.shortcuts) && emoji.shortcuts.length > 0 && typeof emoji.shortcuts[0] === 'string') {
            return emoji.shortcuts[0];
        }

        return '';
    };

    const resolveRunText = (run: unknown): string => {
        if (!isRecord(run)) {
            return '';
        }

        const emoji = getRecord(run, 'emoji');
        const runEmojiId = typeof emoji?.emoji_id === 'string' ? emoji.emoji_id : '';
        const isCustomEmojiRun = emoji?.is_custom === true || runEmojiId.includes('/');
        const runText = typeof run.text === 'string' ? run.text : '';

        if (isCustomEmojiRun
            && Array.isArray(emoji?.shortcuts)
            && emoji.shortcuts.length > 0
            && typeof emoji.shortcuts[0] === 'string') {
            return emoji.shortcuts[0];
        }

        if (runText.length > 0) {
            return runText;
        }

        return resolveEmojiRunText(emoji);
    };

    let result: string;
    if (typeof messageObj === 'string') {
        result = messageObj;
    } else if (!messageObj) {
        result = '';
    } else if (Array.isArray(messageObj)) {
        result = messageObj
            .map((part) => {
                return resolveRunText(part);
            })
            .join('')
            .trim();
    } else if (isRecord(messageObj) && Array.isArray(messageObj.runs)) {
        const runsText = messageObj.runs
            .map((run) => resolveRunText(run))
            .join('')
            .trim();
        result = runsText || (typeof messageObj.text === 'string' ? messageObj.text.trim() : '');
    } else if (isRecord(messageObj) && typeof messageObj.text === 'string') {
        result = messageObj.text.trim();
    } else if (isRecord(messageObj) && typeof messageObj.simpleText === 'string') {
        result = messageObj.simpleText.trim();
    } else {
        result = '';
    }
    logger.debug(`[extractYouTubeMessageText] Input type: ${typeof messageObj} | Output: "${result}" (${result.length} chars)`, 'message-normalization');
    return result;
}

function validateNormalizedMessage(normalizedMessage: unknown) {
    const issues: string[] = [];
    
    if (!normalizedMessage || typeof normalizedMessage !== 'object') {
        issues.push('Message is not an object');
        return { isValid: false, errors: issues };
    }
    
    const messageRecord = normalizedMessage as MessageRecord;

    // Required fields
    const requiredFields = ['platform', 'userId', 'username', 'timestamp'];
    for (const field of requiredFields) {
        if (messageRecord[field] === undefined || messageRecord[field] === null) {
            issues.push(`Missing required field: ${field}`);
        } else if (typeof messageRecord[field] !== 'string') {
            issues.push(`${field} must be a string`);
        }
    }

    const messagePayload = messageRecord.message;
    if (typeof messagePayload !== 'string') {
        if (!isRecord(messagePayload) || typeof messagePayload.text !== 'string') {
            issues.push('message must be a string or an object with string text');
        }
    }
    
    // Boolean fields
    const booleanFields = ['isMod', 'isPaypiggy', 'isBroadcaster'];
    for (const field of booleanFields) {
        if (messageRecord[field] === undefined || messageRecord[field] === null) {
            issues.push(`Missing required field: ${field}`);
        } else if (typeof messageRecord[field] !== 'boolean') {
            issues.push(`${field} must be a boolean`);
        }
    }
    
    // Validate platform names
    const validPlatforms = ['twitch', 'youtube', 'tiktok', 'tiktok-gift'];
    const platform = typeof messageRecord.platform === 'string' ? messageRecord.platform : '';
    if (platform && !validPlatforms.includes(platform.toLowerCase())) {
        issues.push(`Invalid platform: ${platform}`);
    }
    
    // Metadata should be an object
    if (!isRecord(messageRecord.metadata)) {
        issues.push('Missing or invalid metadata field');
    }
    
    // Timestamp should be valid ISO string
    const timestamp = typeof messageRecord.timestamp === 'string' ? messageRecord.timestamp : '';
    if (timestamp && isNaN(Date.parse(timestamp))) {
        issues.push('Invalid timestamp format');
    }
    
    return {
        isValid: issues.length === 0,
        errors: issues
    };
}

export {
    normalizeYouTubeMessage,
    normalizeTikTokMessage,
    buildTwitchMessageParts,
    extractTwitchMessageData,
    extractYouTubeMessageText,
    validateNormalizedMessage,
    extractYouTubeBadgeImages,
    extractTikTokBadgeImages
};
