const fs = require('fs');
const { logger } = require('../core/logging');
const innertubeInstanceManager = require('../services/innertube-instance-manager');
const { InnertubeFactory } = require('../factories/innertube-factory');
const { createPlatformErrorHandler } = require('./platform-error-handler');
const {
    normalizeHandleForCache,
    normalizeChannelHandle,
    resolveChannelId
} = require('../services/youtube-channel-resolver');

const youtubeDataErrorHandler = createPlatformErrorHandler(logger, 'youtube-data');

function handleYouTubeDataError(message, error = null, eventType = 'youtube-data', eventData = null) {
    if (error instanceof Error) {
        youtubeDataErrorHandler.handleEventProcessingError(error, eventType, eventData, message);
    } else {
        const fallbackError = new Error(message);
        youtubeDataErrorHandler.handleEventProcessingError(fallbackError, eventType, eventData, message);
    }
}

const channelCacheConfig = {
    enabled: false,
    filePath: null
};

const channelIdCache = new Map();

// In-memory cache for ongoing requests to prevent race conditions
const ongoingRequests = new Map();

function configureChannelCache(options = {}) {
    const enabled = Boolean(options.enabled);
    const filePath = options.filePath;

    channelCacheConfig.enabled = enabled;
    channelCacheConfig.filePath = enabled ? filePath : null;

    if (enabled && !filePath) {
        throw new Error('YouTube channel cache requires filePath when enabled');
    }
}

function clearChannelCache() {
    channelIdCache.clear();
}

function isFileCacheEnabled() {
    return channelCacheConfig.enabled && channelCacheConfig.filePath;
}

function loadCache() {
    if (!isFileCacheEnabled()) {
        return {};
    }

    try {
        if (fs.existsSync(channelCacheConfig.filePath)) {
            const data = fs.readFileSync(channelCacheConfig.filePath, 'utf8');
            return JSON.parse(data);
        }
    } catch (error) {
        handleYouTubeDataError(`Error loading channel cache: ${error.message}`, error, 'cache-load');
    }
    return {};
}

function saveCache(cache) {
    if (!isFileCacheEnabled()) {
        return;
    }

    try {
        fs.writeFileSync(channelCacheConfig.filePath, JSON.stringify(cache, null, 2), 'utf8');
    } catch (error) {
        handleYouTubeDataError(`Error saving channel cache: ${error.message}`, error, 'cache-save');
    }
}

async function getChannelId(username) {
    const normalizedHandle = normalizeChannelHandle(username);
    if (!normalizedHandle) {
        handleYouTubeDataError('Cannot get Channel ID: No username provided.', new Error('Missing username'), 'channel-id');
        return null;
    }

    const cacheKey = normalizeHandleForCache(normalizedHandle);
    if (!cacheKey) {
        handleYouTubeDataError('Cannot get Channel ID: Invalid username provided.', new Error('Invalid username'), 'channel-id', {
            username: normalizedHandle
        });
        return null;
    }

    if (channelIdCache.has(cacheKey)) {
        const cachedId = channelIdCache.get(cacheKey);
        logger.info(`Found cached Channel ID (${cachedId}) for @${cacheKey}.`, 'YouTubeResolver');
        return cachedId;
    }

    const cache = loadCache();
    if (cache[cacheKey]) {
        channelIdCache.set(cacheKey, cache[cacheKey]);
        logger.info(`Found cached Channel ID (${cache[cacheKey]}) for @${cacheKey}.`, 'YouTubeResolver');
        return cache[cacheKey];
    }

    // Check for ongoing request to prevent duplicate calls
    if (ongoingRequests.has(cacheKey)) {
        logger.info(`Request already in progress for @${cacheKey}, waiting...`, 'YouTubeResolver');
        return await ongoingRequests.get(cacheKey);
    }

    logger.info(`Resolving YouTube channel: @${cacheKey} using youtubei.js`, 'YouTubeResolver');

    // Create and store the request promise to prevent duplicate calls
    const requestPromise = (async () => {
        try {
            const manager = innertubeInstanceManager.getInstance({ logger });
            const yt = await manager.getInstance('shared-youtube-instance', 
                () => InnertubeFactory.createWithTimeout(3000)
            );
            if (!yt) {
                throw new Error('YouTube instance unavailable');
            }

            const channelId = await resolveChannelId(yt, cacheKey, {
                timeout: 3000,
                logger,
                onError: handleYouTubeDataError
            });

            if (channelId) {
                logger.info(`Found Channel ID (${channelId}) for @${cacheKey} via youtubei.js resolveURL.`, 'YouTubeResolver');
                channelIdCache.set(cacheKey, channelId);
                cache[cacheKey] = channelId;
                saveCache(cache);
                return channelId;
            }

            return null;
        } catch (error) {
            handleYouTubeDataError(`Error resolving YouTube channel @${cacheKey}: ${error.message}`, error, 'channel-resolve', { username: cacheKey });
            return null;
        } finally {
            // Clean up the ongoing request
            ongoingRequests.delete(cacheKey);
        }
    })();

    // Store the promise and return it
    ongoingRequests.set(cacheKey, requestPromise);
    return await requestPromise;
}

function extractSuperChatData(chatItem) {
    if (chatItem.superchat) {
        if (chatItem.superchat.amount === undefined || chatItem.superchat.amount === null) {
            throw new Error('YouTube SuperChat requires amount');
        }
        if (!chatItem.superchat.currency) {
            throw new Error('YouTube SuperChat requires currency');
        }
        if (!chatItem.author || typeof chatItem.author !== 'object') {
            throw new Error('YouTube SuperChat requires author');
        }
        return {
            amount: chatItem.superchat.amount,
            currency: chatItem.superchat.currency,
            type: 'gift',
            giftType: 'Super Chat',
            giftCount: 1,
            message: typeof chatItem.message === 'string' ? chatItem.message : undefined,
            author: chatItem.author
        };
    }
    
    if (chatItem.supersticker) {
        if (chatItem.supersticker.amount === undefined || chatItem.supersticker.amount === null) {
            throw new Error('YouTube SuperSticker requires amount');
        }
        if (!chatItem.supersticker.currency) {
            throw new Error('YouTube SuperSticker requires currency');
        }
        if (!chatItem.author || typeof chatItem.author !== 'object') {
            throw new Error('YouTube SuperSticker requires author');
        }
        return {
            amount: chatItem.supersticker.amount,
            currency: chatItem.supersticker.currency,
            type: 'gift',
            giftType: 'Super Sticker',
            giftCount: 1,
            message: typeof chatItem.message === 'string' ? chatItem.message : undefined,
            author: chatItem.author
        };
    }
    
    return null;
}

function extractMembershipData(chatItem) {
    if (chatItem.isMembership) {
        if (chatItem.timestamp === undefined || chatItem.timestamp === null) {
            throw new Error('YouTube membership payload requires timestamp');
        }
        if (!chatItem.author || typeof chatItem.author !== 'object') {
            throw new Error('YouTube membership payload requires author');
        }
        return {
            isMembership: true,
            author: chatItem.author,
            message: typeof chatItem.message === 'string' ? chatItem.message : undefined,
            timestamp: chatItem.timestamp
        };
    }
    
    return null;
}

function extractYouTubeUserData(chatItem) {
    const author = chatItem.author;
    if (!author || typeof author.channelId !== 'string' || !author.channelId.trim()) {
        return null;
    }
    if (typeof author.name !== 'string' || !author.name.trim()) {
        return null;
    }

    return {
        userId: author.channelId,
        username: author.name,
        isOwner: !!author.isOwner,
        isModerator: !!author.isModerator,
        isVerified: !!author.isVerified
    };
}

function formatSuperChatAmount(amount, currency) {
    if (!currency || typeof currency !== 'string') {
        throw new Error('SuperChat formatting requires currency');
    }
    const numericAmount = Number(amount);
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
        return '';
    }
    
    if (currency === 'USD') {
        return ` ($${numericAmount.toFixed(2)})`;
    }
    
    return ` (${numericAmount.toFixed(2)} ${currency})`;
}

module.exports = { 
    configureChannelCache,
    clearChannelCache,
    getChannelId,
    extractSuperChatData,
    extractMembershipData,
    extractYouTubeUserData,
    formatSuperChatAmount
}; 
