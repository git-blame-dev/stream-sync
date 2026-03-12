
const { logger } = require('../core/logging');
const { resolveTikTokTimestampMs, resolveTikTokTimestampISO, resolveYouTubeTimestampISO } = require('./platform-timestamp');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

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
        if (!normalizedMessage) {
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
            message: normalizedMessage,
            timestamp,
            isMod: author.is_moderator === true,
            isSubscriber: isMember,
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

        logger.debug(`Normalized YouTube message from ${normalized.username}`, 'message-normalization');
        return normalized;
    } catch (error) {
        handleNormalizationError(`Failed to normalize YouTube message: ${error.message}`, error, 'youtube', {
            author: chatItem?.item?.author?.name
        });
        throw error;
    }
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
            message,
            timestamp,
            isMod: !!data.isModerator,
            isSubscriber: !!data.isSubscriber,
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
        if (messageParts.length > 0) {
            normalized.metadata.messageParts = messageParts;
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
    const { logger } = require('../core/logging');
    
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
            const { CheermoteProcessor } = require('./cheermote-processor');
            const processedData = CheermoteProcessor.processEventSubFragments(messageObj.fragments);
            
            cheermoteInfo = {
                prefix: primaryCheermote.cheermote.prefix,
                text: primaryCheermote.text, // This contains "uni1", "Cheer100", etc.
                cleanPrefix: processedData.cleanPrimaryTypeOriginalCase || primaryCheermote.cheermote.prefix, // NEW: Clean prefix without numbers, preserving case
                textContent: processedData.textContent, // NEW: Clean text without cheermote patterns
                totalBits: processedData.totalBits,
                count: cheermoteFragments.length,
                types: processedData.types,
                isMixed: processedData.mixedTypes
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
    const { logger } = require('../core/logging');
    let result;
    if (typeof messageObj === 'string') {
        result = messageObj;
    } else if (!messageObj) {
        result = '';
    } else if (messageObj.text) {
        result = messageObj.text;
    } else if (Array.isArray(messageObj)) {
        result = messageObj
            .map(part => {
                if (part.emoji && Array.isArray(part.emoji.shortcuts) && part.emoji.shortcuts.length > 0) {
                    return part.emoji.shortcuts[0];
                }
                if (part.text) return part.text;
                return '';
            })
            .join('')
            .trim();
    } else if (typeof messageObj === 'object' && Array.isArray(messageObj.runs)) {
        result = messageObj.runs
            .map(run => {
                if (run.emoji && Array.isArray(run.emoji.shortcuts) && run.emoji.shortcuts.length > 0) {
                    return run.emoji.shortcuts[0];
                }
                return run.text || '';
            })
            .join('')
            .trim();
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
    const requiredFields = ['platform', 'userId', 'username', 'message', 'timestamp'];
    for (const field of requiredFields) {
        if (normalizedMessage[field] === undefined || normalizedMessage[field] === null) {
            issues.push(`Missing required field: ${field}`);
        } else if (typeof normalizedMessage[field] !== 'string') {
            issues.push(`${field} must be a string`);
        }
    }
    
    // Boolean fields
    const booleanFields = ['isMod', 'isSubscriber', 'isBroadcaster'];
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

module.exports = {
    normalizeYouTubeMessage,
    normalizeTikTokMessage,
    extractTwitchMessageData,
    extractYouTubeMessageText,
    validateNormalizedMessage
};
