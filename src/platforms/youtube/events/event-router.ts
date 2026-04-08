import { createRequire } from 'node:module';
import { getSystemTimestampISO } from '../../../utils/timestamp';

const nodeRequire = createRequire(__filename);
const { createPlatformErrorHandler } = nodeRequire('../../../utils/platform-error-handler');
const { PlatformEvents } = nodeRequire('../../../interfaces/PlatformEvents');
const { validateLoggerInterface } = nodeRequire('../../../utils/dependency-validator');

type UnknownRecord = Record<string, unknown>;

interface RouteablePlatform {
    logger: unknown;
    eventFactory?: {
        createErrorEvent: (options: {
            error: Error;
            context: UnknownRecord;
            recoverable: boolean;
            timestamp: string;
        }) => unknown;
    };
    _emitPlatformEvent?: (eventType: string, payload: unknown) => void;
    handleLowPriorityEvent?: (chatItem: unknown, eventType: string) => unknown;
    [key: string]: unknown;
}

interface CreateYouTubeEventRouterOptions {
    platform?: RouteablePlatform;
}

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

function createYouTubeEventRouter(options: CreateYouTubeEventRouterOptions = {}) {
    const { platform } = options;
    if (!platform) {
        throw new Error('YouTube event router requires platform');
    }
    if (!platform.logger) {
        throw new Error('YouTube event router requires logger dependency');
    }
    validateLoggerInterface(platform.logger);

    const errorHandler = createPlatformErrorHandler(platform.logger, 'youtube-event-router');

    const emitMissingHandlerError = (eventType: string, handlerName: string, chatItem: unknown): void => {
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
        } catch (emitError: unknown) {
            const emitErrorMessage = emitError && typeof emitError === 'object' && 'message' in emitError
                ? String((emitError as { message?: unknown }).message)
                : String(emitError);
            errorHandler.handleEventProcessingError(
                emitError,
                eventType,
                chatItem,
                `Error emitting platform error event: ${emitErrorMessage}`,
                'youtube-event-router'
            );
        }
    };

    const routeEvent = async (chatItem: unknown, eventType: unknown): Promise<boolean> => {
        if (!eventType || typeof eventType !== 'string') {
            return false;
        }

        if (LOW_PRIORITY_EVENT_TYPES.has(eventType)) {
            const handler = platform.handleLowPriorityEvent as ((item: unknown, type: string) => unknown) | undefined;
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

        const handler = platform[handlerName] as ((item: unknown) => unknown) | undefined;
        if (typeof handler !== 'function') {
            emitMissingHandlerError(eventType, handlerName, chatItem);
            return false;
        }

        await Promise.resolve(handler.call(platform, chatItem));
        return true;
    };

    return { routeEvent };
}

export { createYouTubeEventRouter };
