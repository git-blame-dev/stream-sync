const { extractTwitchMessageData } = require('../../../utils/message-normalization');
const { validateLoggerInterface } = require('../../../utils/dependency-validator');
const { createPlatformErrorHandler } = require('../../../utils/platform-error-handler');
const {
    applyTimestampFallback,
    normalizeMonths,
    normalizeUserIdentity
} = require('./event-normalizer');
const { getSystemTimestampISO } = require('../../../utils/validation');

function createTwitchEventSubEventRouter(options = {}) {
    const {
        config = {},
        logger,
        emit,
        logRawPlatformData,
        logError
    } = options;

    const safeLogger = (() => {
        const resolvedLogger = logger || global.__TEST_LOGGER__;
        if (!resolvedLogger) {
            throw new Error('TwitchEventSub event router requires a logger dependency');
        }
        validateLoggerInterface(resolvedLogger);
        return resolvedLogger;
    })();
    const safeEmit = typeof emit === 'function' ? emit : () => {};
    const safeLogError = typeof logError === 'function' ? logError : () => {};
    const safeLogRaw = typeof logRawPlatformData === 'function' ? logRawPlatformData : async () => {};
    const errorHandler = createPlatformErrorHandler(safeLogger, 'twitch-eventsub-router');

    const logRawIfEnabled = (eventType, event, failureStage, failureMessagePrefix) => {
        if (!config.dataLoggingEnabled) {
            return;
        }
        Promise.resolve(safeLogRaw(eventType, event)).catch((err) => {
            safeLogError(`${failureMessagePrefix}: ${err.message}`, err, failureStage);
        });
    };

    const resolveMonetizationTimestamp = (event, eventType) => {
        if (event?.timestamp) {
            return event.timestamp;
        }
        const fallbackTimestamp = getSystemTimestampISO();
        errorHandler.handleEventProcessingError(
            new Error(`Missing ${eventType} timestamp`),
            eventType,
            event,
            `Missing ${eventType} timestamp, using fallback`
        );
        return fallbackTimestamp;
    };

    const handleChatMessageEvent = (event, rawEvent = event) => {
        logRawIfEnabled('chat', rawEvent, 'chat-data-log', 'Error logging raw chat data');

        try {
            const context = {
                'user-id': event.chatter_user_id,
                'username': event.chatter_user_name,
                'display-name': event.chatter_user_name,
                'mod': event.badges?.moderator === '1',
                'subscriber': !!event.badges?.subscriber,
                'badges': event.badges || {},
                'color': null,
                'emotes': {},
                'room-id': event.broadcaster_user_id
            };

            if (!event?.timestamp) {
                errorHandler.handleEventProcessingError(
                    new Error('Chat message requires timestamp'),
                    'chat',
                    event
                );
                return;
            }

            context.timestamp = event.timestamp;

            const messageData = {
                channel: `#${config.channel || 'unknown'}`,
                context: context,
                message: event.message.text,
                self: event.broadcaster_user_id === event.chatter_user_id
            };

            safeEmit('message', messageData);
        } catch (error) {
            safeLogError(`Error processing EventSub chat message: ${error.message}`, error, 'eventsub-chat-message');
        }
    };

    const handleFollowEvent = (event, rawEvent = event) => {
        logRawIfEnabled('follow', rawEvent, 'follow-data-log', 'Error logging raw follow data');

        if (!event?.user_name || !event?.user_id || !event?.followed_at) {
            errorHandler.handleEventProcessingError(
                new Error('Follow event requires user_name, user_id, and followed_at'),
                'follow',
                event
            );
            return;
        }

        const identity = normalizeUserIdentity(event.user_name, event.user_id);
        safeEmit('follow', {
            ...identity,
            timestamp: event.followed_at
        });
    };

    const handlePaypiggyEvent = (event, rawEvent = event) => {
        logRawIfEnabled('subscription', rawEvent, 'subscription-data-log', 'Error logging raw subscription data');

        if (event.is_gift === true) {
            safeLogger.debug(
                `[Twitch] Suppressing gifted user notification for ${event.user_name} (handled by channel.subscription.gift)`,
                'twitch-eventsub'
            );
            return;
        }

        if (!event?.user_name || !event?.user_id || !event?.tier || typeof event?.is_gift !== 'boolean') {
            errorHandler.handleEventProcessingError(
                new Error('Subscription event requires user_name, user_id, tier, timestamp, and is_gift'),
                'paypiggy',
                event
            );
            return;
        }

        const months = normalizeMonths(event.cumulative_months);
        const identity = normalizeUserIdentity(event.user_name, event.user_id);
        const timestamp = resolveMonetizationTimestamp(event, 'paypiggy');
        const payload = {
            type: 'paypiggy',
            ...identity,
            tier: event.tier,
            timestamp
        };
        if (months !== undefined) {
            payload.months = months;
        }

        safeEmit('paypiggy', payload);
    };

    const handleRaidEvent = (event, rawEvent = event) => {
        logRawIfEnabled('raid', rawEvent, 'raid-data-log', 'Error logging raw raid data');

        if (!event?.from_broadcaster_user_name || !event?.from_broadcaster_user_id || typeof event?.viewers !== 'number' || !event?.timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Raid event requires from_broadcaster_user_name, from_broadcaster_user_id, viewers, and timestamp'),
                'raid',
                event
            );
            return;
        }

        const identity = normalizeUserIdentity(event.from_broadcaster_user_name, event.from_broadcaster_user_id);
        safeEmit('raid', {
            platform: 'twitch',
            ...identity,
            viewerCount: event.viewers,
            timestamp: event.timestamp
        });
    };

    const resolveBitsGiftType = (cheermoteInfo = {}) => {
        if (cheermoteInfo.isMixed) {
            return 'mixed bits';
        }
        return 'bits';
    };

    const handleBitsUseEvent = (event, rawEvent = event) => {
        logRawIfEnabled('bits_use', rawEvent, 'bits-data-log', 'Error logging raw bits use data');

        const eventId = event?.message_id || event?.id;
        const isAnonymous = event?.is_anonymous === true;
        const rawUsername = typeof event?.user_name === 'string' ? event.user_name.trim() : '';
        const rawUserId = typeof event?.user_id === 'string' ? event.user_id.trim() : '';
        const hasIdentity = rawUsername && rawUserId;
        const hasPartialIdentity = (rawUsername && !rawUserId) || (!rawUsername && rawUserId);

        if (!eventId || typeof event?.bits !== 'number' || (!isAnonymous && !hasIdentity) || hasPartialIdentity) {
            errorHandler.handleEventProcessingError(
                new Error('Bits use event requires id/message_id, bits, and identity unless anonymous'),
                'gift',
                event
            );
            return;
        }

        const messageData = extractTwitchMessageData(event.message);
        const fallbackText = typeof event?.message?.text === 'string' ? event.message.text.trim() : '';
        const messageText = messageData.textContent || fallbackText;
        const giftType = resolveBitsGiftType(messageData.cheermoteInfo || {});

        const identity = hasIdentity ? normalizeUserIdentity(event.user_name, event.user_id) : {};
        const timestamp = resolveMonetizationTimestamp(event, 'gift');
        safeEmit('gift', {
            platform: 'twitch',
            ...identity,
            bits: event.bits,
            giftType,
            giftCount: 1,
            amount: event.bits,
            currency: 'bits',
            message: messageText,
            cheermoteInfo: messageData.cheermoteInfo,
            id: eventId,
            repeatCount: 1,
            timestamp,
            isAnonymous
        });
    };

    const handlePaypiggyGiftEvent = (event, rawEvent = event) => {
        logRawIfEnabled('subscription_gift', rawEvent, 'sub-gift-data-log', 'Error logging raw subscription gift data');

        const isAnonymous = event?.is_anonymous === true;
        const rawUsername = typeof event?.user_name === 'string' ? event.user_name.trim() : '';
        const rawUserId = typeof event?.user_id === 'string' ? event.user_id.trim() : '';
        const hasIdentity = rawUsername && rawUserId;
        const hasPartialIdentity = (rawUsername && !rawUserId) || (!rawUsername && rawUserId);

        if (!event?.tier || typeof event?.total !== 'number' || (!isAnonymous && !hasIdentity) || hasPartialIdentity) {
            errorHandler.handleEventProcessingError(
                new Error('Subscription gift event requires tier, total, and identity unless anonymous'),
                'giftpaypiggy',
                event
            );
            return;
        }

        const identity = hasIdentity ? normalizeUserIdentity(event.user_name, event.user_id) : {};
        const timestamp = resolveMonetizationTimestamp(event, 'paypiggy-gift');
        safeEmit('paypiggyGift', {
            ...identity,
            tier: event.tier,
            giftCount: event.total,
            timestamp,
            isAnonymous,
            cumulativeTotal: event.cumulative_total
        });
    };

    const handlePaypiggyMessageEvent = (event, rawEvent = event) => {
        logRawIfEnabled('subscription_message', rawEvent, 'sub-message-data-log', 'Error logging raw subscription message data');

        safeLogger.debug(
            `[Resub] ${event.user_name} resubbed on twitch (${event.cumulative_months} months, Tier: ${event.tier})`,
            'twitch'
        );

        if (!event?.user_name || !event?.user_id || !event?.tier) {
            errorHandler.handleEventProcessingError(
                new Error('Subscription message event requires user_name, user_id, tier, and timestamp'),
                'paypiggy-message',
                event
            );
            return;
        }

        const months = normalizeMonths(event.cumulative_months);
        const identity = normalizeUserIdentity(event.user_name, event.user_id);
        const timestamp = resolveMonetizationTimestamp(event, 'paypiggy-message');
        const payload = {
            type: 'paypiggy',
            ...identity,
            tier: event.tier,
            message: typeof event.message?.text === 'string' ? event.message.text : undefined,
            timestamp
        };
        if (months !== undefined) {
            payload.months = months;
        }

        safeEmit('paypiggyMessage', payload);
    };

    const handleStreamOnlineEvent = (event, rawEvent = event) => {
        logRawIfEnabled('stream_online', rawEvent, 'stream-online-log', 'Error logging raw stream online data');

        safeLogger.info('Stream went online, starting viewer count polling', 'twitch');
        if (!event?.started_at) {
            errorHandler.handleEventProcessingError(
                new Error('Stream online event requires started_at'),
                'stream-online',
                event
            );
            return;
        }

        safeEmit('streamOnline', {
            platform: 'twitch',
            streamId: event.id,
            startedAt: event.started_at,
            timestamp: event.started_at
        });
    };

    const handleStreamOfflineEvent = (event, rawEvent = event) => {
        logRawIfEnabled('stream_offline', rawEvent, 'stream-offline-log', 'Error logging raw stream offline data');

        safeLogger.info('Stream went offline, stopping viewer count polling', 'twitch');
        if (!event?.timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Stream offline event requires timestamp'),
                'stream-offline',
                event
            );
            return;
        }

        safeEmit('streamOffline', {
            platform: 'twitch',
            streamId: event.id,
            timestamp: event.timestamp
        });
    };

    const handleNotificationEvent = (subscriptionType, event, metadata) => {
        safeLogger.debug(`EventSub notification received: ${subscriptionType}`, 'twitch', event);
        const normalizedEvent = applyTimestampFallback(event, metadata, subscriptionType);

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
                safeLogger.debug(`Unknown EventSub notification type: ${subscriptionType}`, 'twitch', event);
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

module.exports = {
    createTwitchEventSubEventRouter
};
