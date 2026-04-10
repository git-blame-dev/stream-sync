import { logger } from '../core/logging';
import { createRequire } from 'node:module';
import { resolveTikTokTimestampMs, resolveTikTokTimestampISO, resolveYouTubeTimestampISO } from './platform-timestamp';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { normalizeBadgeImages } from './message-parts';

const nodeRequire = createRequire(import.meta.url);
const { CheermoteProcessor } = nodeRequire('./cheermote-processor');

const normalizationErrorHandler = createPlatformErrorHandler(logger, 'message-normalization');

function handleNormalizationError(message, error, eventType = 'normalization', eventData = null) {
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

function isValidTikTokEmoteEntry(entry) {
    if (!entry || typeof entry !== 'object') {
        return false;
    }

    if (!Number.isInteger(entry.placeInComment) || entry.placeInComment < 0) {
        return false;
    }

    const emote = entry.emote;
    if (!emote || typeof emote !== 'object') {
        return false;
    }

    const emoteId = typeof emote.emoteId === 'string' ? emote.emoteId.trim() : '';
    const imageUrl = typeof emote?.image?.imageUrl === 'string' ? emote.image.imageUrl.trim() : '';

    return !!emoteId && !!imageUrl;
}

function buildTikTokMessageParts(rawComment, emotes = []) {
    if (typeof rawComment !== 'string') {
        return [];
    }

    if (!Array.isArray(emotes) || emotes.length === 0) {
        return [];
    }

    const commentCodepoints = Array.from(rawComment);
    const sortedEmotes = emotes
        .map((entry, index) => ({ entry, index }))
        .filter(({ entry }) => isValidTikTokEmoteEntry(entry))
        .sort((left, right) => {
            if (left.entry.placeInComment !== right.entry.placeInComment) {
                return left.entry.placeInComment - right.entry.placeInComment;
            }

            return left.index - right.index;
        });

    const parts = [];
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

function resolveTwitchEmoteScale(scaleOptions = []) {
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
        .sort((left, right) => Number(right) - Number(left))[0];
}

function resolveTwitchEmoteImageUrl(emoteId, formatOptions = [], scaleOptions = []) {
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

function buildTwitchMessageParts(messageObj) {
    if (!messageObj || typeof messageObj !== 'object') {
        return [];
    }

    if (!Array.isArray(messageObj.fragments) || messageObj.fragments.length === 0) {
        return [];
    }

    return messageObj.fragments
        .map((fragment) => {
            if (!fragment || typeof fragment !== 'object') {
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

            const emote = fragment.emote;
            const emoteId = typeof emote?.id === 'string' ? emote.id.trim() : '';
            const imageUrl = resolveTwitchEmoteImageUrl(emoteId, emote?.format, emote?.scale);

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

function resolveYouTubeEmojiImageUrl(images = []) {
    if (!Array.isArray(images) || images.length === 0) {
        return '';
    }

    const normalizedImages = images
        .filter((image) => image && typeof image === 'object')
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
            .url;
    }

    return normalizedImages[0].url;
}

function resolveLargestImageUrl(images = []) {
    if (!Array.isArray(images) || images.length === 0) {
        return '';
    }

    const normalizedImages = images
        .filter((image) => image && typeof image === 'object')
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
        return widthCandidates.sort((left, right) => right.width - left.width)[0].url;
    }

    return normalizedImages[0].url;
}

function extractYouTubeBadgeImages(author = {}) {
    const badges = Array.isArray(author.badges) ? author.badges : [];
    return normalizeBadgeImages(
        badges.map((badge) => {
            const imageUrl = resolveLargestImageUrl(badge?.custom_thumbnail);
            if (!imageUrl) {
                return null;
            }
            return {
                imageUrl,
                source: 'youtube',
                label: typeof badge?.tooltip === 'string' ? badge.tooltip : ''
            };
        })
    );
}

function extractTikTokBadgeImages(data = {}) {
    const userData = data?.user && typeof data.user === 'object' ? data.user : {};
    const entries = [];

    const badgeImageList = Array.isArray(userData.badgeImageList) ? userData.badgeImageList : [];
    for (const badgeImage of badgeImageList) {
        const firstUrl = Array.isArray(badgeImage?.url) && typeof badgeImage.url[0] === 'string'
            ? badgeImage.url[0].trim()
            : '';
        if (!firstUrl) {
            continue;
        }
        entries.push({ imageUrl: firstUrl, source: 'tiktok', label: '' });
    }

    const badges = Array.isArray(userData.badges) ? userData.badges : [];
    for (const badge of badges) {
        const firstUrl = Array.isArray(badge?.combine?.icon?.url) && typeof badge.combine.icon.url[0] === 'string'
            ? badge.combine.icon.url[0].trim()
            : '';
        if (!firstUrl) {
            continue;
        }
        const label = typeof badge?.text?.defaultPattern === 'string' ? badge.text.defaultPattern : '';
        entries.push({ imageUrl: firstUrl, source: 'tiktok', label });
    }

    return normalizeBadgeImages(entries);
}

function buildYouTubeMessageParts(messageObj) {
    if (!messageObj || typeof messageObj !== 'object' || !Array.isArray(messageObj.runs)) {
        return [];
    }

    return messageObj.runs
        .map((run) => {
            if (!run || typeof run !== 'object') {
                return null;
            }

            const emoteId = typeof run?.emoji?.emoji_id === 'string' ? run.emoji.emoji_id.trim() : '';
            const imageUrl = resolveYouTubeEmojiImageUrl(run?.emoji?.image);
            const isCustomEmote = run?.emoji?.is_custom === true || emoteId.includes('/');
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


function normalizeYouTubeMessage(chatItem, platformName = 'youtube') {
    try {
        if (!chatItem || typeof chatItem !== 'object') {
            throw new Error('Missing YouTube chat item');
        }
        if (!chatItem.item || typeof chatItem.item !== 'object') {
            throw new Error('Missing YouTube chat item payload');
        }
        const messageData = chatItem.item;
        const author = messageData.author;
        if (!author || typeof author !== 'object') {
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
            message = extractYouTubeMessageText(messageData.superchat.message);
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

        const badges = Array.isArray(author.badges) ? author.badges : [];
        const isBroadcaster = badges.some(badge => badge && badge.icon_type === 'OWNER');
        const isMember = badges.some(badge =>
            badge && typeof badge.tooltip === 'string' &&
            badge.tooltip.toLowerCase().includes('member')
        );
        const avatarUrl = typeof author?.thumbnails?.[0]?.url === 'string'
            ? author.thumbnails[0].url.trim()
            : '';

        const normalized = {
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
                authorPhoto: author?.thumbnails?.[0]?.url || null
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
        handleNormalizationError(`Failed to normalize YouTube message: ${error.message}`, error, 'youtube', {
            author: chatItem?.item?.author?.name
        });
        throw error;
    }
}

function resolveTikTokChatIsPaypiggy(data) {
    return data?.userIdentity?.isSubscriberOfAnchor === true;
}

function normalizeTikTokMessage(data, platformName = 'tiktok') {
    let userData = null;
    try {
        if (!data || typeof data !== 'object') {
            throw new Error('Missing TikTok message data');
        }

        userData = (data.user && typeof data.user === 'object') ? data.user : null;

        const userId = typeof userData?.uniqueId === 'string' ? userData.uniqueId.trim() : '';
        const username = typeof userData?.nickname === 'string' ? userData.nickname.trim() : '';
        if (!userId) {
            throw new Error('Missing TikTok userId (uniqueId)');
        }
        if (!username) {
            throw new Error('Missing TikTok username (nickname)');
        }
        const rawComment = typeof data.comment === 'string' ? data.comment : '';
        const message = rawComment.trim();
        const messageParts = buildTikTokMessageParts(rawComment, data.emotes);
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
            || (Array.isArray(userData.profilePicture?.url) ? userData.profilePicture.url[0] : null)
            || null;

        const normalized = {
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
        handleNormalizationError(`Failed to normalize TikTok message: ${error.message}`, error, 'tiktok', {
            userId: userData?.userId,
            platform: platformName
        });
        throw error;
    }
}

function extractTwitchMessageData(messageObj) {
    if (!messageObj || typeof messageObj !== 'object') {
        return { textContent: '', cheermoteInfo: null };
    }
    
    // Require EventSub fragments for cheermote extraction
    if (!Array.isArray(messageObj.fragments) || messageObj.fragments.length === 0) {
        return { textContent: '', cheermoteInfo: null };
    }
    
    // Extract text from fragments, excluding cheermotes
    const textParts = messageObj.fragments
        .filter(fragment => fragment.type === 'text')
        .map(fragment => fragment.text || '')
        .join('');
    
    // Extract cheermote information (get the first/primary cheermote)
    const cheermoteFragments = messageObj.fragments.filter(fragment => fragment.type === 'cheermote');
    let cheermoteInfo = null;
    
    if (cheermoteFragments.length > 0) {
        const primaryCheermote = cheermoteFragments[0];
        if (primaryCheermote.cheermote && primaryCheermote.text) {
            // Use unified cheermote processor for consistent processing
            const processedData = CheermoteProcessor.processEventSubFragments(messageObj.fragments);
            const parsedTier = Number(primaryCheermote.cheermote.tier);
            const tier = Number.isFinite(parsedTier) && parsedTier > 0
                ? parsedTier
                : undefined;
            
            cheermoteInfo = {
                prefix: primaryCheermote.cheermote.prefix,
                text: primaryCheermote.text, // This contains "uni1", "Cheer100", etc.
                cleanPrefix: processedData.cleanPrimaryTypeOriginalCase || primaryCheermote.cheermote.prefix, // NEW: Clean prefix without numbers, preserving case
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

function extractYouTubeMessageText(messageObj) {
    const resolveEmojiIdGlyph = (emojiId) => {
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

    const resolveEmojiRunText = (emoji) => {
        if (!emoji || typeof emoji !== 'object') {
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

    const resolveRunText = (run) => {
        if (!run || typeof run !== 'object') {
            return '';
        }

        const runEmojiId = typeof run.emoji?.emoji_id === 'string' ? run.emoji.emoji_id : '';
        const isCustomEmojiRun = run.emoji?.is_custom === true || runEmojiId.includes('/');
        const runText = typeof run.text === 'string' ? run.text : '';

        if (isCustomEmojiRun
            && Array.isArray(run.emoji.shortcuts)
            && run.emoji.shortcuts.length > 0
            && typeof run.emoji.shortcuts[0] === 'string') {
            return run.emoji.shortcuts[0];
        }

        if (runText.length > 0) {
            return runText;
        }

        return resolveEmojiRunText(run.emoji);
    };

    let result;
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
    } else if (typeof messageObj === 'object' && Array.isArray(messageObj.runs)) {
        const runsText = messageObj.runs
            .map((run) => resolveRunText(run))
            .join('')
            .trim();
        result = runsText || (typeof messageObj.text === 'string' ? messageObj.text.trim() : '');
    } else if (typeof messageObj === 'object' && messageObj.text) {
        result = messageObj.text.trim();
    } else if (typeof messageObj === 'object' && messageObj.simpleText) {
        result = messageObj.simpleText.trim();
    } else {
        result = '';
    }
    logger.debug(`[extractYouTubeMessageText] Input type: ${typeof messageObj} | Output: "${result}" (${result.length} chars)`, 'message-normalization');
    return result;
}

function validateNormalizedMessage(normalizedMessage) {
    const issues = [];
    
    if (!normalizedMessage || typeof normalizedMessage !== 'object') {
        issues.push('Message is not an object');
        return { isValid: false, errors: issues };
    }
    
    // Required fields
    const requiredFields = ['platform', 'userId', 'username', 'timestamp'];
    for (const field of requiredFields) {
        if (normalizedMessage[field] === undefined || normalizedMessage[field] === null) {
            issues.push(`Missing required field: ${field}`);
        } else if (typeof normalizedMessage[field] !== 'string') {
            issues.push(`${field} must be a string`);
        }
    }

    const messagePayload = normalizedMessage.message;
    if (typeof messagePayload !== 'string') {
        if (!messagePayload || typeof messagePayload !== 'object' || typeof messagePayload.text !== 'string') {
            issues.push('message must be a string or an object with string text');
        }
    }
    
    // Boolean fields
    const booleanFields = ['isMod', 'isPaypiggy', 'isBroadcaster'];
    for (const field of booleanFields) {
        if (normalizedMessage[field] === undefined || normalizedMessage[field] === null) {
            issues.push(`Missing required field: ${field}`);
        } else if (typeof normalizedMessage[field] !== 'boolean') {
            issues.push(`${field} must be a boolean`);
        }
    }
    
    // Validate platform names
    const validPlatforms = ['twitch', 'youtube', 'tiktok', 'tiktok-gift'];
    if (normalizedMessage.platform && !validPlatforms.includes(normalizedMessage.platform.toLowerCase())) {
        issues.push(`Invalid platform: ${normalizedMessage.platform}`);
    }
    
    // Metadata should be an object
    if (!normalizedMessage.metadata || typeof normalizedMessage.metadata !== 'object') {
        issues.push('Missing or invalid metadata field');
    }
    
    // Timestamp should be valid ISO string
    if (normalizedMessage.timestamp && isNaN(Date.parse(normalizedMessage.timestamp))) {
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
