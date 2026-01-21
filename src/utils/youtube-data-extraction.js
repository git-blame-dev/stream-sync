const fs = require('fs');
const defaultInnertubeInstanceManager = require('../services/innertube-instance-manager');
const { InnertubeFactory: DefaultInnertubeFactory } = require('../factories/innertube-factory');
const { createPlatformErrorHandler } = require('./platform-error-handler');
const {
    normalizeHandleForCache,
    normalizeChannelHandle,
    resolveChannelId
} = require('../services/youtube-channel-resolver');

class YouTubeChannelResolver {
    constructor({
        fileSystem,
        logger,
        innertubeInstanceManager,
        innertubeFactory,
        channelResolver
    }) {
        if (!logger) throw new Error('YouTubeChannelResolver requires logger');

        this.fs = fileSystem || fs;
        this.logger = logger;
        this.innertubeInstanceManager = innertubeInstanceManager || defaultInnertubeInstanceManager;
        this.innertubeFactory = innertubeFactory || DefaultInnertubeFactory;
        this.channelResolver = channelResolver || { normalizeHandleForCache, normalizeChannelHandle, resolveChannelId };

        this.errorHandler = createPlatformErrorHandler(this.logger, 'youtube-data');
        this.cacheConfig = { enabled: false, filePath: null };
        this.channelIdCache = new Map();
        this.ongoingRequests = new Map();
    }

    handleError(message, error = null, eventType = 'youtube-data', eventData = null) {
        const err = error instanceof Error ? error : new Error(message);
        this.errorHandler.handleEventProcessingError(err, eventType, eventData, message);
    }

    configureChannelCache(options = {}) {
        const enabled = Boolean(options.enabled);
        const filePath = options.filePath;

        this.cacheConfig.enabled = enabled;
        this.cacheConfig.filePath = enabled ? filePath : null;

        if (enabled && !filePath) {
            throw new Error('YouTube channel cache requires filePath when enabled');
        }
    }

    clearChannelCache() {
        this.channelIdCache.clear();
    }

    isFileCacheEnabled() {
        return this.cacheConfig.enabled && this.cacheConfig.filePath;
    }

    loadCache() {
        if (!this.isFileCacheEnabled()) {
            return {};
        }

        try {
            if (this.fs.existsSync(this.cacheConfig.filePath)) {
                const data = this.fs.readFileSync(this.cacheConfig.filePath, 'utf8');
                return JSON.parse(data);
            }
        } catch (error) {
            this.handleError(`Error loading channel cache: ${error.message}`, error, 'cache-load');
        }
        return {};
    }

    saveCache(cache) {
        if (!this.isFileCacheEnabled()) {
            return;
        }

        try {
            this.fs.writeFileSync(this.cacheConfig.filePath, JSON.stringify(cache, null, 2), 'utf8');
        } catch (error) {
            this.handleError(`Error saving channel cache: ${error.message}`, error, 'cache-save');
        }
    }

    async getChannelId(username) {
        const normalizedHandle = this.channelResolver.normalizeChannelHandle(username);
        if (!normalizedHandle) {
            this.handleError('Cannot get Channel ID: No username provided.', new Error('Missing username'), 'channel-id');
            return null;
        }

        const cacheKey = this.channelResolver.normalizeHandleForCache(normalizedHandle);
        if (!cacheKey) {
            this.handleError('Cannot get Channel ID: Invalid username provided.', new Error('Invalid username'), 'channel-id', {
                username: normalizedHandle
            });
            return null;
        }

        if (this.channelIdCache.has(cacheKey)) {
            const cachedId = this.channelIdCache.get(cacheKey);
            this.logger.info(`Found cached Channel ID (${cachedId}) for @${cacheKey}.`, 'YouTubeResolver');
            return cachedId;
        }

        const cache = this.loadCache();
        if (cache[cacheKey]) {
            this.channelIdCache.set(cacheKey, cache[cacheKey]);
            this.logger.info(`Found cached Channel ID (${cache[cacheKey]}) for @${cacheKey}.`, 'YouTubeResolver');
            return cache[cacheKey];
        }

        if (this.ongoingRequests.has(cacheKey)) {
            this.logger.info(`Request already in progress for @${cacheKey}, waiting...`, 'YouTubeResolver');
            return await this.ongoingRequests.get(cacheKey);
        }

        this.logger.info(`Resolving YouTube channel: @${cacheKey} using youtubei.js`, 'YouTubeResolver');

        const requestPromise = (async () => {
            try {
                const manager = this.innertubeInstanceManager.getInstance({ logger: this.logger });
                const yt = await manager.getInstance('shared-youtube-instance',
                    () => this.innertubeFactory.createWithTimeout(3000)
                );
                if (!yt) {
                    throw new Error('YouTube instance unavailable');
                }

                const channelId = await this.channelResolver.resolveChannelId(yt, cacheKey, {
                    timeout: 3000,
                    logger: this.logger,
                    onError: (msg, err, type, data) => this.handleError(msg, err, type, data)
                });

                if (channelId) {
                    this.logger.info(`Found Channel ID (${channelId}) for @${cacheKey} via youtubei.js resolveURL.`, 'YouTubeResolver');
                    this.channelIdCache.set(cacheKey, channelId);
                    cache[cacheKey] = channelId;
                    this.saveCache(cache);
                    return channelId;
                }

                return null;
            } catch (error) {
                this.handleError(`Error resolving YouTube channel @${cacheKey}: ${error.message}`, error, 'channel-resolve', { username: cacheKey });
                return null;
            } finally {
                this.ongoingRequests.delete(cacheKey);
            }
        })();

        this.ongoingRequests.set(cacheKey, requestPromise);
        return await requestPromise;
    }
}

module.exports = {
    YouTubeChannelResolver
};
