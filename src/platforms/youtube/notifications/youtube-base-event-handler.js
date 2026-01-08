class YouTubeBaseEventHandler {
    constructor(platform) {
        this.platform = platform;
        this.logger = platform.logger;
        this.errorHandler = platform.errorHandler;
    }

    async handleEvent(chatItem, eventConfig) {
        try {
            const dispatcher = this.platform?.notificationDispatcher;
            if (dispatcher && dispatcher[eventConfig.dispatchMethod]) {
                await dispatcher[eventConfig.dispatchMethod](chatItem, this.platform.handlers);
                this.logger.debug(`${eventConfig.eventType} processed via ${eventConfig.dispatchMethod}`, 'youtube');
            } else {
                this.logger.warn(`Notification dispatcher not available for ${eventConfig.eventType}`, 'youtube');
            }
        } catch (error) {
            if (this.errorHandler) {
                this.errorHandler.handleEventProcessingError(
                    error,
                    eventConfig.eventType,
                    chatItem,
                    `Error handling ${eventConfig.eventType}: ${error.message}`,
                    'youtube-notification-pipeline'
                );
            } else if (this.platform && typeof this.platform._handleProcessingError === 'function') {
                this.platform._handleProcessingError(
                    `Error handling ${eventConfig.eventType}: ${error.message}`,
                    error,
                    eventConfig.eventType,
                    chatItem
                );
            } else {
                const fallbackLogger = this.platform?.logger || this.logger;
                fallbackLogger?.error?.(`Error handling ${eventConfig.eventType}: ${error.message}`, 'youtube', error);
            }
        }
    }

    createHandler(eventConfig) {
        return (chatItem) => this.handleEvent(chatItem, eventConfig);
    }
}

module.exports = {
    YouTubeBaseEventHandler
};
