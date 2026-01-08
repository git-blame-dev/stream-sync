function createYouTubeConnectionFactory(options = {}) {
    const {
        platform,
        innertubeInstanceManager,
        withTimeout,
        innertubeCreationTimeoutMs
    } = options;

    if (!platform) {
        throw new Error('YouTube connection factory requires platform instance');
    }

    if (!innertubeInstanceManager) {
        throw new Error('YouTube connection factory requires innertubeInstanceManager');
    }

    if (typeof withTimeout !== 'function') {
        throw new Error('YouTube connection factory requires withTimeout function');
    }

    const timeoutMs = Number(innertubeCreationTimeoutMs);
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
        throw new Error('YouTube connection factory requires positive innertubeCreationTimeoutMs');
    }

    const createConnection = async (videoId) => {
        const manager = innertubeInstanceManager.getInstance({ logger: platform.logger || platform.logger });

        const { InnertubeFactory } = require('../../../factories/innertube-factory');

        const yt = await manager.getInstance('shared-youtube-instance',
            () => InnertubeFactory.createWithTimeout(timeoutMs)
        );

        const info = await withTimeout(
            yt.getInfo(videoId, { client: 'WEB' }),
            timeoutMs,
            'YouTube getInfo stream info call'
        );

        const validationResult = platform._validateVideoForConnection(videoId, info);
        if (!validationResult.shouldConnect) {
            let liveChat = null;
            try {
                liveChat = await withTimeout(
                    info.getLiveChat(),
                    timeoutMs,
                    'YouTube getLiveChat call'
                );
            } catch (error) {
                const errorMessage = error?.message || String(error);
                platform.logger.debug(
                    `Live chat probe failed for ${videoId}: ${errorMessage}`,
                    'youtube'
                );
            }

            if (liveChat) {
                platform.logger.warn(
                    `Live chat available despite validation failure for ${videoId}; bypassing live validation.`,
                    'youtube'
                );
                return liveChat;
            }

            throw new Error(`Stream validation failed: ${validationResult.reason}`);
        }

        return await info.getLiveChat();
    };

    const setupConnectionEventListeners = async (connection, videoId) => {
        if (!connection || typeof connection.on !== 'function') {
            throw new Error('YouTube connection missing event emitter interface (on/removeAllListeners)');
        }

        connection.on('start', (data) => {
            platform.logger.debug(`LiveChat 'start' event for: ${videoId}`, 'youtube');
            platform.logger.info(`Chat listener started for stream: ${videoId}`, 'youtube');
            platform.setYouTubeConnectionReady(videoId);
            platform.logger.info(
                'Viewer engagement message: Welcome to live chat! Remember to guard your privacy and abide by our community guidelines.',
                'youtube'
            );

            if (data && typeof data === 'object' && data.actions && Array.isArray(data.actions)) {
                platform.logger.debug(
                    `Initial batch from 'start' event for ${videoId}: ${data.actions.length} actions - skipping all initial messages`,
                    'youtube'
                );
                platform.logger.debug(`Skipped ${data.actions.length} initial messages from stream ${videoId}`, 'youtube');
            }
        });

        connection.on('error', (error) => {
            platform.logger.debug(
                `LiveChat 'error' event for: ${videoId} - ${error && error.message ? error.message : error}`,
                'youtube'
            );

            const errorMessage = error?.message || String(error);
            const isTemporaryError = errorMessage.includes('ECONNRESET') ||
                errorMessage.includes('ETIMEDOUT') ||
                errorMessage.includes('503') ||
                errorMessage.includes('502');

            if (isTemporaryError) {
                platform.logger.warn(`Temporary error for ${videoId}, not disconnecting`, 'youtube');
                return;
            }

            const isApiError = errorMessage.includes('400') || errorMessage.includes('403') || errorMessage.includes('429');
            if (isApiError) {
                platform.logger.warn(`YouTube API error for stream ${videoId}: ${errorMessage}`, 'youtube');
                platform.disconnectFromYouTubeStream(videoId, `API error: ${errorMessage}`);
                return;
            }

            platform._handleProcessingError(`Stream ${videoId} error: ${errorMessage}`, error, 'stream-error', { videoId });
            platform.disconnectFromYouTubeStream(videoId, `Error: ${errorMessage}`);
        });

        connection.on('chat-update', (chatItem) => {
            if (!chatItem || typeof chatItem !== 'object') {
                platform.logger.debug(`Received invalid chat-update for ${videoId}: null or non-object`, 'youtube');
                return;
            }

            if (chatItem.author && chatItem.text) {
                const authorName = typeof chatItem.author?.name === 'string'
                    ? chatItem.author.name
                    : (typeof chatItem.author === 'string' ? chatItem.author : null);
                if (!authorName || !authorName.trim()) {
                    platform.logger.debug(
                        `Skipping chat-update for ${videoId}: missing author`,
                        'youtube',
                        { eventType: chatItem.item?.type || chatItem.type || null }
                    );
                    return;
                }
                const messageText = chatItem.text || 'No text';

                platform.logger.debug(`Direct YouTube.js message for ${videoId}: ${authorName} - ${messageText}`, 'youtube');

                const normalizedData = {
                    platform: 'youtube',
                    username: authorName,
                    userId: chatItem.author.id || null,
                    message: messageText,
                    timestamp: new Date().toISOString(),
                    videoId
                };

                platform._processRegularChatMessage(normalizedData, authorName);
                return;
            }

            platform.logger.debug(`Processing complex chatItem structure for ${videoId}`, 'youtube');

            const messages = platform._extractMessagesFromChatItem(chatItem);

            for (const message of messages) {
                if (platform._shouldSkipMessage(message)) {
                    platform.logger.debug(`Skipping filtered event for ${videoId}: ${message.type}`, 'youtube');
                    continue;
                }

                const enhancedMessage = {
                    ...message,
                    videoId
                };

                const authorName = typeof enhancedMessage?.item?.author?.name === 'string'
                    ? enhancedMessage.item.author.name
                    : (typeof enhancedMessage?.author?.name === 'string' ? enhancedMessage.author.name : null);
                if (!authorName || !authorName.trim()) {
                    platform.logger.debug(
                        `Skipping chat-update for ${videoId}: missing author`,
                        'youtube',
                        { eventType: enhancedMessage?.item?.type || enhancedMessage?.type || null }
                    );
                    continue;
                }
                const messageText = enhancedMessage?.message?.text ||
                    enhancedMessage?.item?.message?.text ||
                    enhancedMessage?.text ||
                    'No text';

                platform.logger.debug(
                    `Single chat-update event received for ${videoId}: ${authorName} - ${messageText}`,
                    'youtube'
                );

                if (platform.config.dataLoggingEnabled) {
                    platform.logRawPlatformData('chat', { ...enhancedMessage, videoId }).catch((logError) => {
                        platform._handleProcessingError(
                            `Error logging raw chat data: ${logError.message}`,
                            logError,
                            'data-logging'
                        );
                    });
                }

                platform.handleChatMessage(enhancedMessage);
            }
        });

        connection.on('end', () => {
            platform.logger.debug(`LiveChat 'end' event for: ${videoId}`, 'youtube');
            platform.logger.info(`Stream ended: ${videoId}`, 'youtube');
            platform.disconnectFromYouTubeStream(videoId, 'stream ended');
        });

        platform.logger.debug(`About to call connection.start() for: ${videoId}`, 'youtube');
        connection.start();
        platform.logger.debug('connection.start() called successfully', 'youtube');

        platform.logger.debug(`Successfully initiated connection to stream: ${videoId}`, 'youtube');
        platform.logger.debug(`Stream URL: https://www.youtube.com/watch?v=${videoId}`, 'youtube');

        if (platform.viewerService && typeof platform.viewerService.setActiveStream === 'function') {
            try {
                await platform.viewerService.setActiveStream(videoId);
                platform.logger.debug(`Set active stream in viewer service: ${videoId}`, 'youtube');
            } catch (serviceError) {
                platform.logger.warn(`Failed to set active stream in viewer service: ${serviceError.message}`, 'youtube');
            }
        }
    };

    return {
        createConnection,
        setupConnectionEventListeners
    };
}

module.exports = {
    createYouTubeConnectionFactory
};
