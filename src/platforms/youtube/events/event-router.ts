import { getSystemTimestampISO } from '../../../utils/timestamp';
import { PlatformEvents } from '../../../interfaces/PlatformEvents';
import { createPlatformErrorHandler } from '../../../utils/platform-error-handler';
import { validateLoggerInterface } from '../../../utils/dependency-validator';
import type { UnknownRecord } from '../../../utils/record-contracts';

type MappedEventHandler = (chatItem: unknown) => unknown;

interface MappedEventHandlers {
handleSuperChat?: MappedEventHandler;
handleSuperSticker?: MappedEventHandler;
handleGiftMessageView?: MappedEventHandler;
handleMembership?: MappedEventHandler;
handleGiftMembershipPurchase?: MappedEventHandler;
handleChatTextMessage?: MappedEventHandler;
}

interface RouteablePlatform extends MappedEventHandlers {
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

const EVENT_HANDLER_MAP = new Map<string, keyof MappedEventHandlers>([
    ['LiveChatPaidMessage', 'handleSuperChat'],
    ['LiveChatPaidSticker', 'handleSuperSticker'],
    ['GiftMessageView', 'handleGiftMessageView'],
    ['LiveChatMembershipItem', 'handleMembership'],
    ['LiveChatSponsorshipsGiftPurchaseAnnouncement', 'handleGiftMembershipPurchase'],
    ['LiveChatTextMessage', 'handleChatTextMessage']
]);

const LOW_PRIORITY_EVENT_TYPES = new Set<string>([
    'LiveChatViewerEngagementMessage',
    'LiveChatAutoModMessage',
    'LiveChatModeChangeMessage',
    'LiveChatBannerPoll'
]);

function hasMessageProperty(value: unknown): value is { message: unknown } {
    if (!value || typeof value !== 'object') {
        return false;
    }

    return 'message' in value;
}

function toErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    if (hasMessageProperty(error)) {
        return String(error.message);
    }

    return String(error);
}

function asEventData(value: unknown): UnknownRecord | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return null;
    }

    return value as UnknownRecord;
}

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
        errorHandler.handleEventProcessingError(error, eventType, asEventData(chatItem), message, 'youtube-event-router');

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
            const emitErrorMessage = toErrorMessage(emitError);
            errorHandler.handleEventProcessingError(
                emitError,
                eventType,
                asEventData(chatItem),
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
            const lowPriorityHandler = platform.handleLowPriorityEvent;
            if (typeof lowPriorityHandler !== 'function') {
                emitMissingHandlerError(eventType, 'handleLowPriorityEvent', chatItem);
                return false;
            }
            await Promise.resolve(lowPriorityHandler.call(platform, chatItem, eventType));
            return true;
        }

        const handlerName = EVENT_HANDLER_MAP.get(eventType);
        if (!handlerName) {
            return false;
        }

        const mappedHandler = platform[handlerName];
        if (typeof mappedHandler !== 'function') {
            emitMissingHandlerError(eventType, handlerName, chatItem);
            return false;
        }

        await Promise.resolve(mappedHandler.call(platform, chatItem));
        return true;
    };

    return { routeEvent };
}

export { createYouTubeEventRouter };
