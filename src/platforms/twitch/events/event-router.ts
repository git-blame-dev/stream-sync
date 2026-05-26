import { extractTwitchMessageData } from '../../../utils/message-normalization';
import { validateLoggerInterface } from '../../../utils/dependency-validator';
import { createPlatformErrorHandler } from '../../../utils/platform-error-handler';
import {
    applyNotificationMetadataFallback,
    normalizeMonths,
    normalizeUserIdentity
} from './event-normalizer';

type EventRouterOptions = {
    config?: Record<string, unknown>;
    logger?: unknown;
    emit?: (eventName: string, payload: unknown) => void;
    logRawPlatformData?: (eventType: string, event: unknown) => Promise<void> | void;
    logError?: (message: string, error?: unknown, failureStage?: string) => void;
};

type RouterLogger = {
    debug: (message: string, scope?: string, payload?: unknown) => void;
    info: (message: string, scope?: string, payload?: unknown) => void;
    warn: (message: string, scope?: string, payload?: unknown) => void;
};

type TwitchEventPayload = Record<string, unknown>;

const getErrorMessage = (error: unknown): string => error instanceof Error ? error.message : String(error);

const getString = (event: TwitchEventPayload | null | undefined, key: string): string | null => {
    const value = event?.[key];
    return typeof value === 'string' && value.trim() ? value : null;
};

const getNumber = (event: TwitchEventPayload | null | undefined, key: string): number | null => {
    const value = event?.[key];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
};

const getObject = (value: unknown): Record<string, unknown> | null =>
    value && typeof value === 'object' ? value as Record<string, unknown> : null;

function createTwitchEventSubEventRouter(options: EventRouterOptions = {}) {
    const {
        config = {},
        logger,
        emit,
        logRawPlatformData,
        logError
    } = options;

    const safeLogger = (() => {
        if (!logger) {
            throw new Error('TwitchEventSub event router requires a logger dependency');
        }
        validateLoggerInterface(logger);
        return logger as RouterLogger;
    })();
    const safeEmit = typeof emit === 'function' ? emit : () => {};
    const safeLogError = typeof logError === 'function' ? logError : () => {};
    const safeLogRaw = typeof logRawPlatformData === 'function' ? logRawPlatformData : async () => {};
    const errorHandler = createPlatformErrorHandler(safeLogger, 'twitch-eventsub-router');

const logRawIfEnabled = (
  eventType: string,
  event: unknown,
  failureStage: string,
  failureMessagePrefix: string
): void => {
        if (!config.dataLoggingEnabled) {
            return;
        }
        Promise.resolve(safeLogRaw(eventType, event)).catch((err) => {
            const message = err instanceof Error ? err.message : String(err);
            safeLogError(`${failureMessagePrefix}: ${message}`, err, failureStage);
        });
    };

    const handleChatMessageEvent = (event: TwitchEventPayload | null | undefined, rawEvent: unknown = event) => {
        logRawIfEnabled('chat', rawEvent, 'chat-data-log', 'Error logging raw chat data');

        try {
            if (!getString(event, 'timestamp')) {
                safeLogger.warn('[Twitch EventSub] Skipping chat message without timestamp after fallback resolution', 'twitch-eventsub');
                errorHandler.handleEventProcessingError(
                    new Error('Chat message requires timestamp'),
                    'chat',
                    event
                );
                return;
            }

            safeEmit('chatMessage', event);
        } catch (error) {
            safeLogError(`Error processing EventSub chat message: ${getErrorMessage(error)}`, error, 'eventsub-chat-message');
        }
    };

    const handleFollowEvent = (event: TwitchEventPayload | null | undefined, rawEvent: unknown = event) => {
        logRawIfEnabled('follow', rawEvent, 'follow-data-log', 'Error logging raw follow data');

        const username = getString(event, 'user_name');
        const userId = getString(event, 'user_id');
        const timestamp = getString(event, 'timestamp');
        if (!username || !userId || !getString(event, 'followed_at') || !timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Follow event requires user_name, user_id, followed_at, and a valid timestamp'),
                'follow',
                event
            );
            return;
        }

        const identity = normalizeUserIdentity(username, userId);
        safeEmit('follow', {
            ...identity,
            timestamp
        });
    };

    const handlePaypiggyEvent = (event: TwitchEventPayload | null | undefined, rawEvent: unknown = event) => {
        logRawIfEnabled('subscription', rawEvent, 'subscription-data-log', 'Error logging raw subscription data');

        if (event?.is_gift === true) {
            safeLogger.debug(
                `[Twitch] Suppressing gifted user notification for ${event.user_name} (handled by channel.subscription.gift)`,
                'twitch-eventsub'
            );
            return;
        }

        const username = getString(event, 'user_name');
        const userId = getString(event, 'user_id');
        const tier = getString(event, 'tier');
        const timestamp = getString(event, 'timestamp');
        if (!username || !userId || !tier || typeof event?.is_gift !== 'boolean' || !timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Subscription event requires user_name, user_id, tier, timestamp, and is_gift'),
                'paypiggy',
                event
            );
            return;
        }

        const months = normalizeMonths(event.cumulative_months);
        const identity = normalizeUserIdentity(username, userId);
        const payload: Record<string, unknown> = {
            type: 'paypiggy',
            ...identity,
            tier,
            timestamp
        };
        if (months !== undefined) {
            payload.months = months;
        }

        safeEmit('paypiggy', payload);
    };

    const handleRaidEvent = (event: TwitchEventPayload | null | undefined, rawEvent: unknown = event) => {
        logRawIfEnabled('raid', rawEvent, 'raid-data-log', 'Error logging raw raid data');

        const username = getString(event, 'from_broadcaster_user_name');
        const userId = getString(event, 'from_broadcaster_user_id');
        const viewers = getNumber(event, 'viewers');
        const timestamp = getString(event, 'timestamp');
        if (!username || !userId || viewers === null || !timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Raid event requires from_broadcaster_user_name, from_broadcaster_user_id, viewers, and timestamp'),
                'raid',
                event
            );
            return;
        }

        const identity = normalizeUserIdentity(username, userId);
        safeEmit('raid', {
            platform: 'twitch',
            ...identity,
            viewerCount: viewers,
            timestamp
        });
    };

const resolveBitsGiftType = (cheermoteInfo: Record<string, unknown> = {}): string => {
        if (cheermoteInfo.isMixed) {
            return 'mixed bits';
        }
        return 'bits';
    };

    const handleBitsUseEvent = (event: TwitchEventPayload | null | undefined, rawEvent: unknown = event) => {
        logRawIfEnabled('bits_use', rawEvent, 'bits-data-log', 'Error logging raw bits use data');

        const eventId = getString(event, 'id');
        const isAnonymous = event?.is_anonymous === true;
        const rawUsername = getString(event, 'user_name') || '';
        const rawUserId = getString(event, 'user_id') || '';
        const hasIdentity = rawUsername && rawUserId;
        const hasPartialIdentity = (rawUsername && !rawUserId) || (!rawUsername && rawUserId);
        const bits = getNumber(event, 'bits');
        const timestamp = getString(event, 'timestamp');

        if (!eventId || bits === null || (!isAnonymous && !hasIdentity) || hasPartialIdentity || !timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Bits use event requires id, bits, timestamp, and identity unless anonymous'),
                'gift',
                event
            );
            return;
        }

        const message = getObject(event?.message);
        const messageData = extractTwitchMessageData(message);
        const fallbackText = typeof message?.text === 'string' ? message.text.trim() : '';
        const messageText = messageData.textContent || fallbackText;
        const giftType = resolveBitsGiftType(messageData.cheermoteInfo || {});

        const identity = hasIdentity ? normalizeUserIdentity(rawUsername, rawUserId) : {};
        safeEmit('gift', {
            platform: 'twitch',
            ...identity,
            bits,
            giftType,
            giftCount: 1,
            amount: bits,
            currency: 'bits',
            message: messageText,
            cheermoteInfo: messageData.cheermoteInfo,
            id: eventId,
            repeatCount: 1,
            timestamp,
            isAnonymous
        });
    };

    const handlePaypiggyGiftEvent = (event: TwitchEventPayload | null | undefined, rawEvent: unknown = event) => {
        logRawIfEnabled('subscription_gift', rawEvent, 'sub-gift-data-log', 'Error logging raw subscription gift data');

        const isAnonymous = event?.is_anonymous === true;
        const rawUsername = getString(event, 'user_name') || '';
        const rawUserId = getString(event, 'user_id') || '';
        const hasIdentity = rawUsername && rawUserId;
        const hasPartialIdentity = (rawUsername && !rawUserId) || (!rawUsername && rawUserId);
        const tier = getString(event, 'tier');
        const total = getNumber(event, 'total');
        const timestamp = getString(event, 'timestamp');

        if (!tier || total === null || (!isAnonymous && !hasIdentity) || hasPartialIdentity || !timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Subscription gift event requires tier, total, timestamp, and identity unless anonymous'),
                'giftpaypiggy',
                event
            );
            return;
        }

        const identity = hasIdentity ? normalizeUserIdentity(rawUsername, rawUserId) : {};
        safeEmit('paypiggyGift', {
            ...identity,
            tier,
            giftCount: total,
            timestamp,
            isAnonymous,
            cumulativeTotal: event?.cumulative_total
        });
    };

    const handlePaypiggyMessageEvent = (event: TwitchEventPayload | null | undefined, rawEvent: unknown = event) => {
        logRawIfEnabled('subscription_message', rawEvent, 'sub-message-data-log', 'Error logging raw subscription message data');

        safeLogger.debug(
            `[Resub] ${String(event?.user_name ?? 'unknown')} resubbed on twitch (${String(event?.cumulative_months ?? 'unknown')} months, Tier: ${String(event?.tier ?? 'unknown')})`,
            'twitch'
        );

        const username = getString(event, 'user_name');
        const userId = getString(event, 'user_id');
        const tier = getString(event, 'tier');
        const timestamp = getString(event, 'timestamp');
        if (!username || !userId || !tier || !timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Subscription message event requires user_name, user_id, tier, and timestamp'),
                'paypiggy-message',
                event
            );
            return;
        }

        const months = normalizeMonths(event?.cumulative_months);
        const identity = normalizeUserIdentity(username, userId);
        const message = getObject(event?.message);
        const payload: Record<string, unknown> = {
            type: 'paypiggy',
            ...identity,
            tier,
            message: typeof message?.text === 'string' ? message.text : undefined,
            timestamp
        };
        if (months !== undefined) {
            payload.months = months;
        }

        safeEmit('paypiggyMessage', payload);
    };

    const handleStreamOnlineEvent = (event: TwitchEventPayload | null | undefined, rawEvent: unknown = event) => {
        logRawIfEnabled('stream_online', rawEvent, 'stream-online-log', 'Error logging raw stream online data');

        safeLogger.info('Stream went online, starting viewer count polling', 'twitch');
        const startedAt = getString(event, 'started_at');
        const timestamp = getString(event, 'timestamp');
        if (!startedAt || !timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Stream online event requires started_at and a valid timestamp'),
                'stream-online',
                event
            );
            return;
        }

        safeEmit('streamOnline', {
            platform: 'twitch',
            streamId: event?.id,
            startedAt,
            timestamp
        });
    };

    const handleStreamOfflineEvent = (event: TwitchEventPayload | null | undefined, rawEvent: unknown = event) => {
        logRawIfEnabled('stream_offline', rawEvent, 'stream-offline-log', 'Error logging raw stream offline data');

        safeLogger.info('Stream went offline, stopping viewer count polling', 'twitch');
        const timestamp = getString(event, 'timestamp');
        if (!timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Stream offline event requires timestamp'),
                'stream-offline',
                event
            );
            return;
        }

        safeEmit('streamOffline', {
            platform: 'twitch',
            streamId: event?.id,
            timestamp
        });
    };

    const handleNotificationEvent = (
        subscriptionType: string,
        event: Record<string, unknown> | null | undefined,
        metadata: Record<string, unknown> | null | undefined
) => {
        safeLogger.debug('EventSub notification received', 'twitch', {
            subscriptionType,
            eventKeys: event && typeof event === 'object' ? Object.keys(event).sort() : [],
            hasEvent: !!event
        });
        const normalizedEvent = applyNotificationMetadataFallback(event, metadata, subscriptionType);

        switch (subscriptionType) {
            case 'channel.chat.message':
                handleChatMessageEvent(normalizedEvent, event);
                break;
            case 'channel.follow':
                handleFollowEvent(normalizedEvent, event);
                break;
            case 'channel.subscribe':
                handlePaypiggyEvent(normalizedEvent, event);
                break;
            case 'channel.raid':
                handleRaidEvent(normalizedEvent, event);
                break;
            case 'channel.bits.use':
                handleBitsUseEvent(normalizedEvent, event);
                break;
            case 'channel.subscription.gift':
                handlePaypiggyGiftEvent(normalizedEvent, event);
                break;
            case 'channel.subscription.message':
                handlePaypiggyMessageEvent(normalizedEvent, event);
                break;
            case 'stream.online':
                handleStreamOnlineEvent(normalizedEvent, event);
                break;
            case 'stream.offline':
                handleStreamOfflineEvent(normalizedEvent, event);
                break;
            default:
                safeLogger.debug('Unknown EventSub notification type', 'twitch', {
                    subscriptionType,
                    eventKeys: event && typeof event === 'object' ? Object.keys(event).sort() : [],
                    hasEvent: !!event
                });
        }
    };

    return {
        handleNotificationEvent,
        handleChatMessageEvent,
        handleFollowEvent,
        handlePaypiggyEvent,
        handleRaidEvent,
        handleBitsUseEvent,
        handlePaypiggyGiftEvent,
        handlePaypiggyMessageEvent,
        handleStreamOnlineEvent,
        handleStreamOfflineEvent
    };
}

export { createTwitchEventSubEventRouter };
