const { YOUTUBE } = require('../../../core/endpoints');
const { getFallbackUsername } = require('../../../utils/validation');
const { normalizeYouTubeUsername } = require('../youtube-username-normalizer');

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

    const applyConfiguredChatMode = (connection, videoId, startData) => {
        const chatMode = platform.config.chatMode;
        const isTopChatMode = chatMode === 'top';
        const filterName = isTopChatMode ? 'TOP_CHAT' : 'LIVE_CHAT';

        platform.logger.debug(`Configured YouTube chat mode for ${videoId}: ${chatMode}`, 'youtube');

        if (typeof connection.applyFilter !== 'function') {
            platform.logger.warn(
                `Cannot apply YouTube chat mode for ${videoId}: applyFilter unavailable`,
                'youtube'
            );
            return;
        }

        const menuItems = startData?.header?.view_selector?.sub_menu_items;
        if (!Array.isArray(menuItems) || menuItems.length === 0) {
            platform.logger.warn(
                `Cannot apply YouTube chat mode for ${videoId}: selector unavailable`,
                'youtube'
            );
            return;
        }

        const modeIndex = isTopChatMode ? 0 : 1;
        const targetModeItem = menuItems[modeIndex];
        if (!targetModeItem) {
            platform.logger.warn(
                `Cannot apply YouTube chat mode for ${videoId}: missing ${chatMode} selector item`,
                'youtube'
            );
            return;
        }

        if (targetModeItem.selected) {
            platform.logger.debug(`YouTube chat mode already active for ${videoId}: ${chatMode}`, 'youtube');
            return;
        }

        if (!targetModeItem.continuation) {
            platform.logger.warn(
                `Cannot apply YouTube chat mode for ${videoId}: missing ${chatMode} continuation`,
                'youtube'
            );
            return;
        }

        try {
            connection.applyFilter(filterName);
            platform.logger.info(`Applied YouTube chat mode for ${videoId}: ${chatMode}`, 'youtube');
        } catch (error) {
            platform._handleProcessingError(
                `Failed to apply YouTube chat mode for ${videoId}: ${error.message}`,
                error,
                'chat-mode',
                { videoId, chatMode }
            );
        }
    };

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
            throw new Error(`Stream validation failed: ${validationResult.reason}`);
        }

        return await withTimeout(
            info.getLiveChat(),
            timeoutMs,
            'YouTube getLiveChat call'
        );
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
            applyConfiguredChatMode(connection, videoId, data);

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

            const errorMessage = error instanceof Error && typeof error.message === 'string'
                ? error.message
                : String(error);
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
            if (platform.config.dataLoggingEnabled && chatItem !== undefined) {
                platform.logRawPlatformData('chat', chatItem).catch((logError) => {
                    platform._handleProcessingError(
                        `Error logging raw chat data: ${logError.message}`,
                        logError,
                        'data-logging'
                    );
                });
            }

            if (!chatItem || typeof chatItem !== 'object') {
                platform.logger.debug(`Received invalid chat-update for ${videoId}: null or non-object`, 'youtube');
                return;
            }

            if (chatItem.author && chatItem.text) {
                const rawAuthorName = typeof chatItem.author === 'object' && typeof chatItem.author.name === 'string'
                    ? chatItem.author.name
                    : (typeof chatItem.author === 'string' ? chatItem.author : '');
                const authorName = normalizeYouTubeUsername(rawAuthorName);
                const authorId = typeof chatItem.author === 'object' && typeof chatItem.author.id === 'string'
                    ? chatItem.author.id.trim()
                    : '';

                if (!authorName || !authorId) {
                    platform.logger.debug(
                        `Skipping chat-update for ${videoId}: missing author`,
                        'youtube',
                        {
                            eventType: typeof chatItem.type === 'string' ? chatItem.type : null,
                            author: authorName || getFallbackUsername()
                        }
                    );
                    return;
                }

                const messageText = typeof chatItem.text === 'string' ? chatItem.text.trim() : '';
                if (!messageText) {
                    platform.logger.debug(
                        `Skipping chat-update for ${videoId}: missing message`,
                        'youtube',
                        { author: authorName }
                    );
                    return;
                }

                const rawUsec = chatItem.timestamp_usec;
                const rawTimestamp = rawUsec !== undefined && rawUsec !== null
                    ? rawUsec
                    : chatItem.timestamp;
                const timestampField = rawUsec !== undefined && rawUsec !== null
                    ? { timestamp_usec: rawUsec }
                    : (rawTimestamp !== undefined && rawTimestamp !== null ? { timestamp: rawTimestamp } : {});
                const normalizedChatItem = {
                    item: {
                        type: 'LiveChatTextMessage',
                        ...(chatItem.id ? { id: chatItem.id } : {}),
                        ...timestampField,
                        author: {
                            id: authorId,
                            name: rawAuthorName.trim()
                        },
                        message: {
                            text: messageText
                        }
                    },
                    videoId
                };

                platform.logger.debug(
                    `Direct YouTube.js message for ${videoId}: ${authorName} - ${messageText}`,
                    'youtube'
                );
                platform.handleChatMessage(normalizedChatItem);
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

                const authorName = platform._resolveChatItemAuthorName(enhancedMessage);
                const eventType = enhancedMessage && enhancedMessage.item
                    ? enhancedMessage.item.type || null
                    : (enhancedMessage && enhancedMessage.type ? enhancedMessage.type : null);
                const shouldAllowMissingAuthor = eventType === 'LiveChatSponsorshipsGiftPurchaseAnnouncement';
                if (!authorName && !shouldAllowMissingAuthor) {
                    platform.logger.debug(
                        `Skipping chat-update for ${videoId}: missing author`,
                        'youtube',
                        {
                            eventType,
                            author: getFallbackUsername()
                        }
                    );
                    continue;
                }
                const messageText = enhancedMessage && enhancedMessage.item && enhancedMessage.item.message
                    ? enhancedMessage.item.message.text || 'No text'
                    : 'No text';

                platform.logger.debug(
                    `Single chat-update event received for ${videoId}: ${authorName || getFallbackUsername()} - ${messageText}`,
                    'youtube'
                );

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
        platform.logger.debug(`Stream URL: ${YOUTUBE.BASE}/watch?v=${videoId}`, 'youtube');

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
