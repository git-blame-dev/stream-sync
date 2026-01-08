const { extractTwitchMessageData } = require('../../../utils/message-normalization');
const { PlatformEvents } = require('../../../interfaces/PlatformEvents');
const { validateLoggerInterface } = require('../../../utils/dependency-validator');
const { createPlatformErrorHandler } = require('../../../utils/platform-error-handler');

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
    const normalizeMonths = (value) => {
        const numericValue = Number(value);
        return Number.isFinite(numericValue) && numericValue > 0 ? numericValue : undefined;
    };

    const handleChatMessageEvent = (event) => {
        logRawIfEnabled('chat', event, 'chat-data-log', 'Error logging raw chat data');

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

            const rawTimestamp = event.message_timestamp ||
                event.sent_at ||
                event.message?.sent_at ||
                event.message?.timestamp ||
                event.timestamp;

            if (rawTimestamp) {
                context.timestamp = rawTimestamp;
                const parsedTs = Date.parse(rawTimestamp);
                if (!Number.isNaN(parsedTs)) {
                    context['tmi-sent-ts'] = String(parsedTs);
                }
            }

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

    const handleFollowEvent = (event) => {
        logRawIfEnabled('follow', event, 'follow-data-log', 'Error logging raw follow data');

        if (!event?.user_name || !event?.user_id || !event?.followed_at) {
            errorHandler.handleEventProcessingError(
                new Error('Follow event requires user_name, user_id, and followed_at'),
                'follow',
                event
            );
            return;
        }

        safeEmit('follow', {
            username: event.user_name,
            userId: event.user_id,
            timestamp: event.followed_at
        });
    };

    const handlePaypiggyEvent = (event) => {
        logRawIfEnabled('subscription', event, 'subscription-data-log', 'Error logging raw subscription data');

        if (event.is_gift === true) {
            safeLogger.debug(
                `[Twitch] Suppressing gifted user notification for ${event.user_name} (handled by channel.subscription.gift)`,
                'twitch-eventsub'
            );
            return;
        }

        if (!event?.user_name || !event?.user_id || !event?.tier || !event?.timestamp || typeof event?.is_gift !== 'boolean') {
            errorHandler.handleEventProcessingError(
                new Error('Subscription event requires user_name, user_id, tier, timestamp, and is_gift'),
                'paypiggy',
                event
            );
            return;
        }

        const months = normalizeMonths(event.cumulative_months);
        const payload = {
            type: 'paypiggy',
            username: event.user_name,
            userId: event.user_id,
            tier: event.tier,
            timestamp: event.timestamp
        };
        if (months !== undefined) {
            payload.months = months;
        }

        safeEmit('paypiggy', payload);
    };

    const handleRaidEvent = (event) => {
        logRawIfEnabled('raid', event, 'raid-data-log', 'Error logging raw raid data');

        if (!event?.from_broadcaster_user_name || !event?.from_broadcaster_user_id || typeof event?.viewers !== 'number' || !event?.timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Raid event requires from_broadcaster_user_name, from_broadcaster_user_id, viewers, and timestamp'),
                'raid',
                event
            );
            return;
        }

        safeEmit('raid', {
            platform: 'twitch',
            username: event.from_broadcaster_user_name,
            userId: event.from_broadcaster_user_id,
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

    const handleBitsUseEvent = (event) => {
        logRawIfEnabled('bits_use', event, 'bits-data-log', 'Error logging raw bits use data');

        if (!event?.id || !event?.user_name || !event?.user_id || typeof event?.bits !== 'number' || !event?.timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Bits use event requires id, user_name, user_id, bits, and timestamp'),
                'gift',
                event
            );
            return;
        }

        const messageData = extractTwitchMessageData(event.message);
        if (!messageData.cheermoteInfo) {
            errorHandler.handleEventProcessingError(
                new Error('Bits use event requires cheermoteInfo'),
                'gift',
                event
            );
            return;
        }

        const giftType = resolveBitsGiftType(messageData.cheermoteInfo);

        safeEmit('gift', {
            platform: 'twitch',
            username: event.user_name,
            userId: event.user_id,
            bits: event.bits,
            giftType,
            giftCount: 1,
            amount: event.bits,
            currency: 'bits',
            message: messageData.textContent,
            cheermoteInfo: messageData.cheermoteInfo,
            id: event.id,
            repeatCount: 1,
            timestamp: event.timestamp,
            isAnonymous: event.is_anonymous
        });
    };

    const handlePaypiggyGiftEvent = (event) => {
        logRawIfEnabled('subscription_gift', event, 'sub-gift-data-log', 'Error logging raw subscription gift data');

        if (!event?.user_name || !event?.user_id || !event?.tier || typeof event?.total !== 'number' || !event?.timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Subscription gift event requires user_name, user_id, tier, total, and timestamp'),
                'giftpaypiggy',
                event
            );
            return;
        }

        safeEmit('paypiggyGift', {
            username: event.user_name,
            userId: event.user_id,
            tier: event.tier,
            giftCount: event.total,
            timestamp: event.timestamp,
            isAnonymous: event.is_anonymous,
            cumulativeTotal: event.cumulative_total
        });
    };

    const handlePaypiggyMessageEvent = (event) => {
        logRawIfEnabled('subscription_message', event, 'sub-message-data-log', 'Error logging raw subscription message data');

        safeLogger.debug(
            `[Resub] ${event.user_name} resubbed on twitch (${event.cumulative_months} months, Tier: ${event.tier})`,
            'twitch'
        );

        if (!event?.user_name || !event?.user_id || !event?.tier || !event?.timestamp) {
            errorHandler.handleEventProcessingError(
                new Error('Subscription message event requires user_name, user_id, tier, and timestamp'),
                'paypiggy-message',
                event
            );
            return;
        }

        const months = normalizeMonths(event.cumulative_months);
        const payload = {
            type: 'paypiggy',
            username: event.user_name,
            userId: event.user_id,
            tier: event.tier,
            message: typeof event.message?.text === 'string' ? event.message.text : undefined,
            timestamp: event.timestamp
        };
        if (months !== undefined) {
            payload.months = months;
        }

        safeEmit('paypiggyMessage', payload);
    };

    const handleStreamOnlineEvent = (event) => {
        logRawIfEnabled('stream_online', event, 'stream-online-log', 'Error logging raw stream online data');

        safeLogger.info('Stream went online, starting viewer count polling', 'twitch');
        safeEmit('streamOnline', {
            platform: 'twitch',
            streamId: event.id,
            startedAt: event.started_at
        });
    };

    const handleStreamOfflineEvent = (event) => {
        logRawIfEnabled('stream_offline', event, 'stream-offline-log', 'Error logging raw stream offline data');

        safeLogger.info('Stream went offline, stopping viewer count polling', 'twitch');
        safeEmit('streamOffline', {
            platform: 'twitch',
            streamId: event.id
        });
    };

    const handleNotificationEvent = (subscriptionType, event) => {
        safeLogger.debug(`EventSub notification received: ${subscriptionType}`, 'twitch', event);

        switch (subscriptionType) {
            case 'channel.chat.message':
                handleChatMessageEvent(event);
                break;
            case 'channel.follow':
                handleFollowEvent(event);
                break;
            case 'channel.subscribe':
                handlePaypiggyEvent(event);
                break;
            case 'channel.raid':
                handleRaidEvent(event);
                break;
            case 'channel.bits.use':
                handleBitsUseEvent(event);
                break;
            case 'channel.subscription.gift':
                handlePaypiggyGiftEvent(event);
                break;
            case 'channel.subscription.message':
                handlePaypiggyMessageEvent(event);
                break;
            case 'stream.online':
                handleStreamOnlineEvent(event);
                break;
            case 'stream.offline':
                handleStreamOfflineEvent(event);
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
