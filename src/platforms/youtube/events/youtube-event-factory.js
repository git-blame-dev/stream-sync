const { PlatformEvents } = require('../../../interfaces/PlatformEvents');
const { isIsoTimestamp } = require('../../../utils/validation');

function createYouTubeEventFactory(options = {}) {
    const platformName = options.platformName || 'youtube';
    const generateCorrelationId = options.generateCorrelationId || (() => PlatformEvents._generateCorrelationId());

    const ensureIsoTimestamp = (value, errorMessage) => {
        if (!value) {
            throw new Error(errorMessage);
        }
        if (!isIsoTimestamp(value)) {
            throw new Error(`${errorMessage} (ISO required)`);
        }
        return value;
    };

    const buildEventMetadata = (additionalMetadata = {}) => ({
        platform: platformName,
        ...additionalMetadata,
        correlationId: generateCorrelationId()
    });

    return {
        createChatConnectedEvent: (data = {}) => {
            const timestamp = ensureIsoTimestamp(data.timestamp, 'YouTube chat connected event requires timestamp');
            return {
                type: PlatformEvents.CHAT_CONNECTED,
                platform: platformName,
                videoId: data.videoId,
                connectionId: data.connectionId,
                timestamp
            };
        },

        createChatMessageEvent: (data = {}) => {
            const timestamp = ensureIsoTimestamp(data.timestamp, 'YouTube chat message event requires timestamp');
            return {
                type: PlatformEvents.CHAT_MESSAGE,
                platform: platformName,
                username: data.username,
                userId: data.userId,
                message: {
                    text: data.message
                },
                timestamp,
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
            const timestamp = ensureIsoTimestamp(data.timestamp, 'YouTube viewer count event requires timestamp');
            return {
                type: PlatformEvents.VIEWER_COUNT,
                platform: platformName,
                count: data.count,
                streamId: data.streamId,
                streamViewerCount: data.streamViewerCount,
                timestamp,
                metadata: buildEventMetadata()
            };
        },

        createErrorEvent: (data = {}) => {
            const timestamp = ensureIsoTimestamp(data.timestamp, 'YouTube error event requires timestamp');
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
                    timestamp
                })
            };
        }
    };
}

module.exports = {
    createYouTubeEventFactory
};
