const { createPlatformErrorHandler } = require('../../../utils/platform-error-handler');
const { PlatformEvents } = require('../../../interfaces/PlatformEvents');
const { getSystemTimestampISO } = require('../../../utils/validation');

class YouTubeBaseEventHandler {
    constructor(platform) {
        this.platform = platform;
        this.errorHandler = createPlatformErrorHandler(platform.logger, 'youtube-notification-pipeline');
        this.logger = this.errorHandler.logger;
    }

    async handleEvent(chatItem, eventConfig = {}) {
        const config = eventConfig && typeof eventConfig === 'object' ? eventConfig : {};
        const dispatcher = this.platform?.notificationDispatcher;
        const dispatchMethod = config.dispatchMethod;
        const eventType = typeof config.eventType === 'string' ? config.eventType : 'unknown';

        if (!dispatchMethod || !dispatcher || typeof dispatcher[dispatchMethod] !== 'function') {
            this._handleMissingDispatcher(eventType, dispatchMethod, chatItem);
            return;
        }

        try {
            const handled = await dispatcher[dispatchMethod](chatItem, this.platform.handlers);
            if (handled) {
                this.logger.debug(`${eventType} processed via ${dispatchMethod}`, 'youtube');
            }
        } catch (error) {
            this.errorHandler.handleEventProcessingError(
                error,
                eventType,
                chatItem,
                `Error handling ${eventType}: ${error.message}`,
                'youtube-notification-pipeline'
            );
            this._emitPlatformError(error, eventType, { dispatchMethod });
        }
    }

    _handleMissingDispatcher(eventType, dispatchMethod, chatItem) {
        const message = `Notification dispatcher not available for ${eventType}`;
        this.logger.warn(message, 'youtube');
        const error = new Error(message);
        this._emitPlatformError(error, eventType, {
            dispatchMethod,
            reason: dispatchMethod ? 'missing_dispatcher_method' : 'missing_dispatch_method'
        }, chatItem);
    }

    _emitPlatformError(error, eventType, context = {}, chatItem = null) {
        if (!this.platform || typeof this.platform._emitPlatformEvent !== 'function' || !this.platform.eventFactory) {
            return;
        }

        const details = {
            eventType,
            ...(context.dispatchMethod ? { dispatchMethod: context.dispatchMethod } : {}),
            ...(context.reason ? { reason: context.reason } : {}),
            source: 'youtube-base-event-handler'
        };

        try {
            const payload = this.platform.eventFactory.createErrorEvent({
                error,
                context: details,
                recoverable: true,
                timestamp: getSystemTimestampISO()
            });
            this.platform._emitPlatformEvent(PlatformEvents.ERROR, payload);
        } catch (emitError) {
            this.errorHandler.handleEventProcessingError(
                emitError,
                eventType,
                chatItem,
                `Error emitting platform error event: ${emitError.message}`,
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
