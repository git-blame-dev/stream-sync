const { validateNormalizedMessage } = require('../../../utils/message-normalization');
const { normalizeTikTokChatEvent } = require('./event-normalizer');
const { PlatformEvents } = require('../../../interfaces/PlatformEvents');

function cleanupTikTokEventListeners(platform) {
    if (!platform?.connection) {
        return;
    }

    const removeAllListeners = platform.connection.removeAllListeners;
    if (typeof removeAllListeners !== 'function') {
        platform.listenersConfigured = false;
        return;
    }

    if (platform.WebcastEvent) {
        const eventTypes = [
            platform.WebcastEvent.CHAT,
            platform.WebcastEvent.GIFT,
            platform.WebcastEvent.FOLLOW,
            platform.WebcastEvent.ROOM_USER,
            platform.WebcastEvent.ENVELOPE,
            platform.WebcastEvent.SUBSCRIBE,
            platform.WebcastEvent.SUPER_FAN,
            platform.WebcastEvent.SOCIAL,
            platform.WebcastEvent.ERROR,
            platform.WebcastEvent.DISCONNECT,
            platform.WebcastEvent.STREAM_END
        ];

        eventTypes.forEach((eventType) => {
            if (!eventType) {
                return;
            }

            try {
                removeAllListeners.call(platform.connection, eventType);
            } catch (error) {
                platform.errorHandler?.handleCleanupError(error, 'tiktok event listener cleanup');
            }
        });
    }

    const connectedEvent = platform.ControlEvent?.CONNECTED || 'connected';
    const disconnectedEvent = platform.ControlEvent?.DISCONNECTED || 'disconnected';
    const errorEvent = platform.ControlEvent?.ERROR || 'error';

    [connectedEvent, disconnectedEvent, errorEvent].forEach((eventType) => {
        if (!eventType) {
            return;
        }

        try {
            removeAllListeners.call(platform.connection, eventType);
        } catch (error) {
            platform.errorHandler?.handleCleanupError(error, 'tiktok event listener cleanup');
        }
    });

    platform.listenersConfigured = false;
}

function setupTikTokEventListeners(platform) {
    if (platform.listenersConfigured) {
        return;
    }

    if (!platform.connection) {
        const error = new Error('TikTok connection missing connection object');
        platform.errorHandler?.handleConnectionError(error, 'connection', error.message);
        throw error;
    }

    if (typeof platform.connection.on !== 'function') {
        const error = new Error('TikTok connection missing event emitter interface (on/removeAllListeners)');
        platform.errorHandler?.handleConnectionError(
            error,
            'connection',
            'TikTok connection is missing required event emitter methods'
        );
        throw error;
    }

    cleanupTikTokEventListeners(platform);

    platform.connection.on(platform.WebcastEvent.CHAT, async (data) => {
        await platform._logIncomingEvent('chat', data);

        try {
            if (!data || typeof data !== 'object') {
                platform.logger.warn('Received invalid chat data:', 'tiktok', { dataType: typeof data, data });
                return;
            }

            if (!data.comment || typeof data.comment !== 'string') {
                platform.logger.warn('Received chat data with invalid comment:', 'tiktok', {
                    comment: data.comment,
                    commentType: typeof data.comment,
                    data
                });
                return;
            }

            const resolveEventTimestampMs = platform?.constructor?.resolveEventTimestampMs;
            const eventTimestampMs = (typeof resolveEventTimestampMs === 'function')
                ? resolveEventTimestampMs(data)
                : null;

            if (platform.connectionTime > 0 && eventTimestampMs !== null && eventTimestampMs < platform.connectionTime) {
                platform.logger.debug(`Filtering historical message (pre-connection): "${data.comment}"`, 'tiktok', {
                    eventTimestamp: eventTimestampMs,
                    connectionRecordedAt: platform.connectionTime
                });
                return;
            }

            const normalizedData = normalizeTikTokChatEvent(data, {
                platformName: platform.platformName,
                timestampService: platform.timestampService
            });
            const validation = validateNormalizedMessage(normalizedData);

            if (!validation.isValid) {
                platform.logger.warn('Message normalization validation failed', 'tiktok', {
                    issues: validation.issues,
                    originalData: data
                });
            }

            if (platform.selfMessageDetectionService) {
                const messageData = {
                    username: normalizedData.username,
                    userId: normalizedData.userId,
                    isBroadcaster: normalizedData.isBroadcaster
                };

                if (platform.selfMessageDetectionService.shouldFilterMessage('tiktok', messageData, platform.config)) {
                    platform.logger.debug(`Filtering self-message from ${messageData.username}`, 'tiktok');
                    return;
                }
            }

            if (!normalizedData.message || normalizedData.message.trim() === '') {
                platform.logger.debug('Skipping empty message after normalization', 'tiktok', {
                    originalComment: data.comment,
                    normalizedMessage: normalizedData.message
                });
                return;
            }

            await platform._handleChatMessage(data, normalizedData);
        } catch (error) {
            platform.errorHandler.handleEventProcessingError(
                error,
                'chat-message',
                data,
                `Error processing chat message: ${error?.message || error}`
            );
        }
    });

    platform.connection.on(platform.WebcastEvent.GIFT, async (data) => {
        await platform._logIncomingEvent('gift', data);

        try {
            await platform.handleTikTokGift(data);
        } catch (error) {
            platform.errorHandler.handleEventProcessingError(error, 'gift', data, 'Error processing gift');
        }
    });

    platform.connection.on(platform.WebcastEvent.FOLLOW, async (data) => {
        await platform._logIncomingEvent('follow', data);

        try {
            await platform.handleTikTokFollow(data);
        } catch (error) {
            platform.errorHandler.handleEventProcessingError(
                error,
                'follow',
                data,
                `Error processing follow: ${error?.message || error}`
            );
        }
    });

    if (typeof platform.WebcastEvent.ENVELOPE !== 'undefined') {
        platform.connection.on(platform.WebcastEvent.ENVELOPE, async (data) => {
            try {
                await platform._logIncomingEvent('envelope', data);
                await platform._handleStandardEvent('envelope', data, {
                    factoryMethod: 'createEnvelope',
                    emitType: PlatformEvents.ENVELOPE
                });
            } catch (error) {
                platform.errorHandler.handleEventProcessingError(error, 'envelope', data, 'Error in handleEnvelopeNotification');
            }
        });
    }

    if (typeof platform.WebcastEvent.SUBSCRIBE !== 'undefined') {
        platform.connection.on(platform.WebcastEvent.SUBSCRIBE, async (data) => {
            await platform._logIncomingEvent('subscribe', data);

            try {
                await platform._handleStandardEvent('paypiggy', data, {
                    factoryMethod: 'createSubscription',
                    emitType: PlatformEvents.PAYPIGGY
                });
            } catch (error) {
                platform.errorHandler.handleEventProcessingError(error, 'subscribe', data, 'Error in handleSubscriptionNotification');
            }
        });
    }

    if (typeof platform.WebcastEvent.SUPER_FAN !== 'undefined') {
        platform.connection.on(platform.WebcastEvent.SUPER_FAN, async (data) => {
            await platform._logIncomingEvent('superfan', data);

            try {
                await platform._handleStandardEvent('paypiggy', data, {
                    factoryMethod: 'createSuperfan',
                    emitType: PlatformEvents.PAYPIGGY
                });
            } catch (error) {
                platform.errorHandler.handleEventProcessingError(error, 'superfan', data, 'Error in handleSuperfanNotification');
            }
        });
    }

    if (typeof platform.WebcastEvent.SOCIAL !== 'undefined') {
        platform.connection.on(platform.WebcastEvent.SOCIAL, async (data) => {
            await platform._logIncomingEvent('social', data);

            try {
                await platform.handleTikTokSocial(data);
            } catch (error) {
                platform.errorHandler.handleEventProcessingError(error, 'social', data, 'Error processing social event');
            }
        });
    }

    platform.connection.on(platform.WebcastEvent.ROOM_USER, (data) => {
        platform._logIncomingEvent('roomUser', data);
        platform.cachedViewerCount = data.viewerCount;

        const timestamp = typeof platform._getTimestamp === 'function'
            ? platform._getTimestamp(data)
            : null;
        if (!timestamp) {
            platform.logger.warn('[TikTok Viewer Count] Missing timestamp in room user payload', 'tiktok', { data });
            return;
        }

        platform._emitPlatformEvent(PlatformEvents.VIEWER_COUNT, {
            platform: 'tiktok',
            count: data.viewerCount,
            timestamp
        });
    });

    const disconnectedEvent = platform.ControlEvent?.DISCONNECTED || 'disconnected';
    const errorEvent = platform.ControlEvent?.ERROR || 'error';

    platform.connection.on(disconnectedEvent, (reason) => {
        platform._logIncomingEvent('disconnected', reason);
        platform.handleConnectionIssue(reason, false);
    });

    platform.connection.on(errorEvent, (err) => {
        platform._logIncomingEvent('control-error', err);
        platform.handleConnectionError(err);
    });

    platform.connection.on(platform.WebcastEvent.ERROR, (err) => {
        platform._logIncomingEvent('error', err);
        platform.errorHandler.handleConnectionError(
            err,
            'webcast connection',
            `Webcast Connection Error: ${err.message}`
        );

        if (platform.connectionActive) {
            platform.handleRetry(err);
        }
    });

    platform.connection.on(platform.WebcastEvent.DISCONNECT, () => {
        platform._logIncomingEvent('disconnect', {});
        platform.logger.info('Disconnected from webcast', 'tiktok');
        platform.connectionActive = false;
    });

    if (typeof platform.WebcastEvent.STREAM_END !== 'undefined') {
        platform.connection.on(platform.WebcastEvent.STREAM_END, async (data) => {
            await platform._logIncomingEvent('streamEnd', data);
            await platform._handleStreamEnd();
        });
    }

    platform.connection.on('rawData', async (payload) => {
        const eventType = payload?.type || 'unknown';
        await platform._logIncomingEvent(eventType, payload);
    });

    platform.listenersConfigured = true;
}

module.exports = {
    cleanupTikTokEventListeners,
    setupTikTokEventListeners
};
