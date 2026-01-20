class YouTubeBaseEventHandler {
    constructor(platform) {
        this.platform = platform;
        this.logger = platform.logger;
        this.errorHandler = platform.errorHandler;
    }

    async handleEvent(chatItem, eventConfig) {
        try {
            const dispatcher = this.platform.notificationDispatcher;
            if (dispatcher && typeof dispatcher[eventConfig.dispatchMethod] === 'function') {
                await dispatcher[eventConfig.dispatchMethod](chatItem, this.platform.handlers);
                this.logger.debug(`${eventConfig.eventType} processed via ${eventConfig.dispatchMethod}`, 'youtube');
            } else {
                this.logger.warn(`Notification dispatcher not available for ${eventConfig.eventType}`, 'youtube');
            }
        } catch (error) {
            this.errorHandler.handleEventProcessingError(
                error,
                eventConfig.eventType,
                chatItem,
                `Error handling ${eventConfig.eventType}: ${error.message}`,
                'youtube-notification-pipeline'
            );
        }
    }

    createHandler(eventConfig) {
        return (chatItem) => this.handleEvent(chatItem, eventConfig);
    }
}

module.exports = {
    YouTubeBaseEventHandler
};
