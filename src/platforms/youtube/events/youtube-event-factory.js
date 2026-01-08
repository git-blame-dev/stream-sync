const { PlatformEvents } = require('../../../interfaces/PlatformEvents');

function createYouTubeEventFactory(options = {}) {
    const platformName = options.platformName || 'youtube';
    const nowIso = options.nowIso || (() => new Date().toISOString());
    const generateCorrelationId = options.generateCorrelationId || (() => PlatformEvents._generateCorrelationId());

    const buildEventMetadata = (additionalMetadata = {}) => ({
        platform: platformName,
        ...additionalMetadata,
        correlationId: generateCorrelationId()
    });

    return {
        createChatConnectedEvent: (data = {}) => {
            if (!data.timestamp) {
                throw new Error('YouTube chat connected event requires timestamp');
            }
            return {
                type: PlatformEvents.CHAT_CONNECTED,
                platform: platformName,
                videoId: data.videoId,
                connectionId: data.connectionId,
                timestamp: data.timestamp
            };
        },

        createChatMessageEvent: (data = {}) => {
            if (!data.timestamp) {
                throw new Error('YouTube chat message event requires timestamp');
            }
            return {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: platformName,
                username: data.username,
                userId: data.userId,
                message: {
                    text: data.message
                },
                timestamp: data.timestamp,
                isMod: Boolean(data.isMod),
                isSubscriber: Boolean(data.isSubscriber),
                isBroadcaster: Boolean(data.isBroadcaster),
                metadata: buildEventMetadata({
                    videoId: data.videoId,
                    isMod: data.isMod || false,
                    isOwner: data.isOwner || false,
                    isVerified: data.isVerified || false
                })
            };
        },

        createViewerCountEvent: (data = {}) => {
            if (!data.timestamp) {
                throw new Error('YouTube viewer count event requires timestamp');
            }
            return {
                type: PlatformEvents.VIEWER_COUNT,
                platform: platformName,
                count: data.count,
                streamId: data.streamId,
                streamViewerCount: data.streamViewerCount,
                timestamp: data.timestamp,
                metadata: buildEventMetadata()
            };
        },

        createErrorEvent: (data = {}) => {
            if (!data.timestamp) {
                throw new Error('YouTube error event requires timestamp');
            }
            return {
                type: PlatformEvents.ERROR,
                platform: platformName,
                error: {
                    message: data.error?.message,
                    name: data.error?.name
                },
                context: data.context || {},
                recoverable: data.recoverable ?? true,
                metadata: buildEventMetadata({
                    videoId: data.videoId,
                    timestamp: data.timestamp
                })
            };
        }
    };
}

module.exports = {
    createYouTubeEventFactory
};
