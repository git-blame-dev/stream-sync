const { createPlatformErrorHandler } = require('../../../utils/platform-error-handler');
const { PlatformEvents } = require('../../../interfaces/PlatformEvents');
const { getSystemTimestampISO } = require('../../../utils/validation');
const { validateLoggerInterface } = require('../../../utils/dependency-validator');

const EVENT_HANDLER_MAP = new Map([
    ['LiveChatPaidMessage', 'handleSuperChat'],
    ['LiveChatPaidSticker', 'handleSuperSticker'],
    ['LiveChatMembershipItem', 'handleMembership'],
    ['LiveChatSponsorshipsGiftPurchaseAnnouncement', 'handleGiftMembershipPurchase'],
    ['LiveChatTextMessage', 'handleChatTextMessage']
]);

const LOW_PRIORITY_EVENT_TYPES = new Set([
    'LiveChatViewerEngagementMessage',
    'LiveChatAutoModMessage',
    'LiveChatModeChangeMessage',
    'LiveChatBannerPoll'
]);

function createYouTubeEventRouter(options = {}) {
    const { platform } = options;
    if (!platform) {
        throw new Error('YouTube event router requires platform');
    }
    if (!platform.logger) {
        throw new Error('YouTube event router requires logger dependency');
    }
    validateLoggerInterface(platform.logger);

    const errorHandler = createPlatformErrorHandler(platform.logger, 'youtube-event-router');

    const emitMissingHandlerError = (eventType, handlerName, chatItem) => {
        const message = `Missing YouTube handler for ${eventType}`;
        const error = new Error(message);
        errorHandler.handleEventProcessingError(error, eventType, chatItem, message, 'youtube-event-router');

        if (!platform.eventFactory || typeof platform._emitPlatformEvent !== 'function') {
            return;
        }

        try {
            const payload = platform.eventFactory.createErrorEvent({
                error,
                context: {
                    eventType,
                    handlerName,
                    reason: 'missing_handler'
                },
                recoverable: true,
                timestamp: getSystemTimestampISO()
            });
            platform._emitPlatformEvent(PlatformEvents.ERROR, payload);
        } catch (emitError) {
            errorHandler.handleEventProcessingError(
                emitError,
                eventType,
                chatItem,
                `Error emitting platform error event: ${emitError.message}`,
                'youtube-event-router'
            );
        }
    };

    const routeEvent = async (chatItem, eventType) => {
        if (!eventType || typeof eventType !== 'string') {
            return false;
        }

        if (LOW_PRIORITY_EVENT_TYPES.has(eventType)) {
            const handler = platform.handleLowPriorityEvent;
            if (typeof handler !== 'function') {
                emitMissingHandlerError(eventType, 'handleLowPriorityEvent', chatItem);
                return false;
            }
            await Promise.resolve(handler.call(platform, chatItem, eventType));
            return true;
        }

        const handlerName = EVENT_HANDLER_MAP.get(eventType);
        if (!handlerName) {
            return false;
        }

        const handler = platform[handlerName];
        if (typeof handler !== 'function') {
            emitMissingHandlerError(eventType, handlerName, chatItem);
            return false;
        }

        await Promise.resolve(handler.call(platform, chatItem));
        return true;
    };

    return { routeEvent };
}

module.exports = {
    createYouTubeEventRouter
};
