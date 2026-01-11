const { createTextProcessingManager } = require('../../../utils/text-processing');
const { shouldSuppressYouTubeNotification } = require('../../../utils/youtube-message-extractor');

class UnifiedNotificationProcessor {
    constructor(platform) {
        this.platform = platform;
        this.notificationDispatcher = platform.notificationDispatcher;
        this.AuthorExtractor = platform.AuthorExtractor;
        this.logger = platform.logger;
        this.errorHandler = platform.errorHandler;
        this.textProcessing = platform.textProcessing || createTextProcessingManager({ logger: this.logger });
        this.messageExtractor = {
            extractMessage: (chatItem) => this.textProcessing.extractMessageText(
                chatItem?.item?.message || chatItem?.message || ''
            )
        };
        this.shouldSuppressNotification = shouldSuppressYouTubeNotification;
    }

    async processNotification(chatItem, eventType, eventData = {}) {
        try {
            const author = this.AuthorExtractor.extractAuthor(chatItem);
            const monetizationTypes = new Set(['gift', 'paypiggy', 'giftpaypiggy', 'envelope']);

            if (this.shouldSuppressNotification(author)) {
                this.logger.debug(`Suppressed ${eventType} notification for anonymous/junk user`, 'youtube', { author });
                return;
            }

            const handlerName = `on${eventType.charAt(0).toUpperCase() + eventType.slice(1)}`;
            const handler = this.platform.handlers?.[handlerName];

            if (!author) {
                this.logger.warn(`Suppressed ${eventType} notification: missing author`, 'youtube');
                if (monetizationTypes.has(eventType) && this.notificationDispatcher) {
                    await this.notificationDispatcher.dispatchErrorNotification(chatItem, eventType, handler, handlerName);
                }
                return;
            }

            const extractedMessage = this.messageExtractor.extractMessage(chatItem);

            const username = author?.name || null;
            const userId = author?.id || null;
            if (!userId) {
                this.logger.warn(`Suppressed ${eventType} notification: missing userId`, 'youtube');
                if (monetizationTypes.has(eventType) && this.notificationDispatcher) {
                    await this.notificationDispatcher.dispatchErrorNotification(chatItem, eventType, handler, handlerName);
                }
                return;
            }
            const timestamp = extractYouTubeTimestamp(chatItem);
            if (!timestamp) {
                this.logger.warn(`Suppressed ${eventType} notification: missing timestamp`, 'youtube');
                if (monetizationTypes.has(eventType) && this.notificationDispatcher) {
                    await this.notificationDispatcher.dispatchErrorNotification(chatItem, eventType, handler, handlerName);
                }
                return;
            }
            const id = extractYouTubeNotificationId(chatItem);

            const notification = {
                platform: 'youtube',
                type: eventType,
                username,
                userId,
                message: extractedMessage,
                timestamp,
                ...(id ? { id } : {}),
                ...eventData
            };

            if (handler) {
                handler(notification);
            }

            this.logger.debug(`${eventType} notification processed via unified method`, 'youtube');
            return notification;
        } catch (error) {
            if (this.errorHandler) {
                this.errorHandler.handleEventProcessingError(
                    error,
                    eventType,
                    chatItem,
                    `Error processing ${eventType} notification: ${error.message}`,
                    'youtube-notification-pipeline'
                );
            } else if (this.platform && typeof this.platform._handleProcessingError === 'function') {
                this.platform._handleProcessingError(
                    `Error processing ${eventType} notification: ${error.message}`,
                    error,
                    eventType,
                    chatItem
                );
            } else {
                const fallbackLogger = this.platform?.logger || this.logger;
                fallbackLogger?.error?.(`Error processing ${eventType} notification: ${error.message}`, 'youtube', error);
            }
        }
    }
}

function extractYouTubeNotificationId(chatItem) {
    const item = chatItem?.item && typeof chatItem.item === 'object' ? chatItem.item : chatItem;
    const rawId = item?.id;
    if (rawId === undefined || rawId === null) {
        return null;
    }
    const id = String(rawId).trim();
    return id ? id : null;
}

function extractYouTubeTimestamp(chatItem) {
    const item = chatItem?.item && typeof chatItem.item === 'object' ? chatItem.item : chatItem;
    const rawTimestamp = item?.timestampUsec;
    if (rawTimestamp === undefined || rawTimestamp === null) {
        return null;
    }
    const numericTimestamp = typeof rawTimestamp === 'number' ? rawTimestamp : Number(rawTimestamp);
    if (!Number.isFinite(numericTimestamp)) {
        return null;
    }
    const adjustedTimestamp = numericTimestamp > 10000000000000
        ? Math.floor(numericTimestamp / 1000)
        : numericTimestamp;
    const parsed = new Date(adjustedTimestamp);
    if (Number.isNaN(parsed.getTime())) {
        return null;
    }
    return parsed.toISOString();
}

module.exports = {
    shouldSuppressYouTubeNotification,
    UnifiedNotificationProcessor
};
