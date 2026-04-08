import { createRequire } from 'node:module';
import { YOUTUBE } from '../../../core/endpoints';

const nodeRequire = createRequire(__filename);
const { getFallbackUsername } = nodeRequire('../../../utils/validation');
const { normalizeYouTubeUsername } = nodeRequire('../youtube-username-normalizer');
const { InnertubeFactory } = nodeRequire('../../../factories/innertube-factory');

type UnknownRecord = Record<string, unknown>;

interface LoggerLike {
    debug: (...args: unknown[]) => void;
    info: (...args: unknown[]) => void;
    warn: (...args: unknown[]) => void;
}

interface YouTubePlatform {
    logger: LoggerLike;
    config: UnknownRecord;
    viewerService?: {
        setActiveStream?: (videoId: string) => Promise<void>;
    };
    setYouTubeConnectionReady: (videoId: string) => void;
    disconnectFromYouTubeStream: (videoId: string, reason: string) => void;
    handleChatMessage: (message: UnknownRecord) => void;
    logRawPlatformData: (channel: string, payload: unknown) => Promise<void>;
    _validateVideoForConnection: (videoId: string, info: unknown) => { shouldConnect: boolean; reason?: string };
    _handleProcessingError: (message: string, error: unknown, category: string, metadata?: UnknownRecord) => void;
    _extractMessagesFromChatItem: (chatItem: UnknownRecord) => UnknownRecord[];
    _shouldSkipMessage: (message: UnknownRecord) => boolean;
    _resolveChatItemAuthorName: (message: UnknownRecord) => string;
}

interface YouTubeConnectionFactoryOptions {
    platform?: YouTubePlatform;
    innertubeInstanceManager?: {
        getInstance: (options: { logger: LoggerLike }) => {
            getInstance: (key: string, factory: () => Promise<unknown>) => Promise<unknown>;
        };
    };
    withTimeout?: <T>(promise: Promise<T>, timeoutMs: number, operationName: string) => Promise<T>;
    innertubeCreationTimeoutMs?: number;
}

interface YouTubeConnection {
    on: (event: string, handler: (payload?: unknown) => void) => void;
    start: () => void;
    applyFilter?: (filterName: string) => void;
}

interface YouTubeInfo {
    getLiveChat: () => Promise<unknown>;
}

interface YouTubeClient {
    getInfo: (videoId: string, options: { client: string }) => Promise<YouTubeInfo>;
}

function createYouTubeConnectionFactory(options: YouTubeConnectionFactoryOptions = {}) {
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

    const applyConfiguredChatMode = (connection: YouTubeConnection, videoId: string, startData: unknown) => {
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

        const startDataRecord = startData && typeof startData === 'object' ? startData as UnknownRecord : null;
        const header = startDataRecord?.header && typeof startDataRecord.header === 'object'
            ? startDataRecord.header as UnknownRecord
            : null;
        const viewSelector = header?.view_selector && typeof header.view_selector === 'object'
            ? header.view_selector as UnknownRecord
            : null;
        const menuItems = Array.isArray(viewSelector?.sub_menu_items)
            ? viewSelector.sub_menu_items
            : null;
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
        } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            platform._handleProcessingError(
                `Failed to apply YouTube chat mode for ${videoId}: ${errorMessage}`,
                error,
                'chat-mode',
                { videoId, chatMode }
            );
        }
    };

    const createConnection = async (videoId: string) => {
        const manager = innertubeInstanceManager.getInstance({ logger: platform.logger });

        const yt = await manager.getInstance('shared-youtube-instance',
            () => InnertubeFactory.createWithTimeout(timeoutMs)
        ) as YouTubeClient;

        const info = await withTimeout(
            yt.getInfo(videoId, { client: 'WEB' }),
            timeoutMs,
            'YouTube getInfo stream info call'
        ) as YouTubeInfo;

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

    const setupConnectionEventListeners = async (connection: YouTubeConnection, videoId: string) => {
        if (!connection || typeof connection.on !== 'function') {
            throw new Error('YouTube connection missing event emitter interface (on/removeAllListeners)');
        }

        connection.on('start', (data: unknown) => {
            platform.logger.debug(`LiveChat 'start' event for: ${videoId}`, 'youtube');
            platform.logger.info(`Chat listener started for stream: ${videoId}`, 'youtube');
            platform.setYouTubeConnectionReady(videoId);
            platform.logger.info(
                'Viewer engagement message: Welcome to live chat! Remember to guard your privacy and abide by our community guidelines.',
                'youtube'
            );
            applyConfiguredChatMode(connection, videoId, data);

            const dataRecord = data && typeof data === 'object' ? data as UnknownRecord : null;
            if (dataRecord && Array.isArray(dataRecord.actions)) {
                platform.logger.debug(
                    `Initial batch from 'start' event for ${videoId}: ${dataRecord.actions.length} actions - skipping all initial messages`,
                    'youtube'
                );
                platform.logger.debug(`Skipped ${dataRecord.actions.length} initial messages from stream ${videoId}`, 'youtube');
            }
        });

        connection.on('error', (error: unknown) => {
            const debugErrorMessage = error instanceof Error ? error.message : String(error);
            platform.logger.debug(
                `LiveChat 'error' event for: ${videoId} - ${debugErrorMessage}`,
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

        connection.on('chat-update', (chatItem: unknown) => {
            if (platform.config.dataLoggingEnabled && chatItem !== undefined) {
                platform.logRawPlatformData('chat', chatItem).catch((logError: unknown) => {
                    const logErrorMessage = logError instanceof Error ? logError.message : String(logError);
                    platform._handleProcessingError(
                        `Error logging raw chat data: ${logErrorMessage}`,
                        logError,
                        'data-logging'
                    );
                });
            }

            if (!chatItem || typeof chatItem !== 'object') {
                platform.logger.debug(`Received invalid chat-update for ${videoId}: null or non-object`, 'youtube');
                return;
            }

            const chatItemRecord = chatItem as UnknownRecord;

            if (chatItemRecord.author && chatItemRecord.text) {
                const authorRecord = chatItemRecord.author && typeof chatItemRecord.author === 'object'
                    ? chatItemRecord.author as UnknownRecord
                    : null;
                const rawAuthorName = authorRecord && typeof authorRecord.name === 'string'
                    ? authorRecord.name
                    : (typeof chatItemRecord.author === 'string' ? chatItemRecord.author : '');
                const authorName = normalizeYouTubeUsername(rawAuthorName);
                const authorId = authorRecord && typeof authorRecord.id === 'string'
                    ? authorRecord.id.trim()
                    : '';

                if (!authorName || !authorId) {
                    platform.logger.debug(
                        `Skipping chat-update for ${videoId}: missing author`,
                        'youtube',
                        {
                            eventType: typeof chatItemRecord.type === 'string' ? chatItemRecord.type : null,
                            author: authorName || getFallbackUsername()
                        }
                    );
                    return;
                }

                const messageText = typeof chatItemRecord.text === 'string' ? chatItemRecord.text.trim() : '';
                if (!messageText) {
                    platform.logger.debug(
                        `Skipping chat-update for ${videoId}: missing message`,
                        'youtube',
                        { author: authorName }
                    );
                    return;
                }

                const rawUsec = chatItemRecord.timestamp_usec;
                const rawTimestamp = rawUsec !== undefined && rawUsec !== null
                    ? rawUsec
                    : chatItemRecord.timestamp;
                const timestampField = rawUsec !== undefined && rawUsec !== null
                    ? { timestamp_usec: rawUsec }
                    : (rawTimestamp !== undefined && rawTimestamp !== null ? { timestamp: rawTimestamp } : {});
                const normalizedChatItem = {
                    item: {
                        type: 'LiveChatTextMessage',
                        ...(chatItemRecord.id ? { id: chatItemRecord.id } : {}),
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

            const messages = platform._extractMessagesFromChatItem(chatItemRecord);

            for (const message of messages) {
                if (platform._shouldSkipMessage(message)) {
                    platform.logger.debug(`Skipping filtered event for ${videoId}: ${message.type}`, 'youtube');
                    continue;
                }

                const enhancedMessage: UnknownRecord = {
                    ...message,
                    videoId
                };

                const authorName = platform._resolveChatItemAuthorName(enhancedMessage);
                const enhancedItem = enhancedMessage.item && typeof enhancedMessage.item === 'object'
                    ? enhancedMessage.item as UnknownRecord
                    : null;
                const eventType = enhancedItem
                    ? enhancedItem.type || null
                    : (enhancedMessage.type || null);
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
                const itemMessage = enhancedItem && enhancedItem.message && typeof enhancedItem.message === 'object'
                    ? enhancedItem.message as UnknownRecord
                    : null;
                const messageText = itemMessage && typeof itemMessage.text === 'string'
                    ? itemMessage.text
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
            } catch (serviceError: unknown) {
                const serviceErrorMessage = serviceError instanceof Error ? serviceError.message : String(serviceError);
                platform.logger.warn(`Failed to set active stream in viewer service: ${serviceErrorMessage}`, 'youtube');
            }
        }
    };

    return {
        createConnection,
        setupConnectionEventListeners
    };
}

export { createYouTubeConnectionFactory };
