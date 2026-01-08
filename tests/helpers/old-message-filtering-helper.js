const {
    normalizeTikTokMessage,
    normalizeYouTubeMessage,
    normalizeTwitchMessage
} = require('../../src/utils/message-normalization');

async function processIncomingMessage(platform, rawMessageData, timestampService, platformLifecycleService) {
    try {
        if (!timestampService) {
            throw new Error('TimestampExtractionService dependency required');
        }
        if (!platformLifecycleService || typeof platformLifecycleService.getPlatformConnectionTime !== 'function') {
            throw new Error('PlatformLifecycleService dependency required');
        }

        let normalizedData;
        if (platform === 'tiktok') {
            normalizedData = normalizeTikTokMessage(rawMessageData, platform, timestampService);
        } else if (platform === 'youtube') {
            normalizedData = normalizeYouTubeMessage(rawMessageData, platform, timestampService);
        } else if (platform === 'twitch') {
            if (!rawMessageData || typeof rawMessageData !== 'object' || !rawMessageData.user || rawMessageData.message === undefined || !rawMessageData.context) {
                throw new Error('Twitch message requires user, message, and context');
            }
            normalizedData = normalizeTwitchMessage(
                rawMessageData.user,
                rawMessageData.message,
                rawMessageData.context,
                platform,
                timestampService
            );
        } else {
            throw new Error(`Unsupported platform: ${platform}`);
        }

        const connectionTime = platformLifecycleService.getPlatformConnectionTime(platform);
        let wasFiltered = false;
        let reason = '';
        const messageTime = new Date(normalizedData.timestamp).getTime();

        if (connectionTime && !isNaN(messageTime)) {
            if (messageTime < connectionTime) {
                wasFiltered = true;
                reason = 'old message (sent before connection)';
            }
        }

        const wouldProcess = !wasFiltered;

        return {
            wasFiltered,
            reason,
            wouldProcess,
            wasProcessed: !wasFiltered,
            normalizedData,
            connectionTime,
            messageTime,
            platform,
            userMessage: wasFiltered ? null : `${normalizedData.username}: ${normalizedData.message}`,
            processingMetrics: {
                timestampExtractionTime: 1
            },
            userExperienced: {
                ttsGenerated: !wasFiltered,
                notificationShown: !wasFiltered
            },
            errorHandledGracefully: true
        };
    } catch (error) {
        return {
            wasFiltered: false,
            reason: '',
            wouldProcess: false,
            wasProcessed: false,
            platform,
            userMessage: null,
            processingMetrics: {
                timestampExtractionTime: 0
            },
            userExperienced: {
                ttsGenerated: false,
                notificationShown: false
            },
            error: error.message,
            errorHandledGracefully: true
        };
    }
}

module.exports = {
    processIncomingMessage
};
