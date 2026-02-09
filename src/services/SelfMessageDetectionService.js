
const { logger } = require('../core/logging');

class SelfMessageDetectionService {
    constructor(config) {
        this.config = config;
        this.logger = logger;
    }

    isFilteringEnabled(platform) {
        return !!this.config[platform].ignoreSelfMessages;
    }

    isSelfMessage(platform, messageData, platformConfig) {
        if (!messageData) {
            return false;
        }

        switch (platform.toLowerCase()) {
            case 'twitch':
                return this._isTwitchSelfMessage(messageData, platformConfig);
            case 'youtube':
                return this._isYouTubeSelfMessage(messageData, platformConfig);
            case 'tiktok':
                return this._isTikTokSelfMessage(messageData, platformConfig);
            default:
                this.logger.warn(`Unknown platform for self-message detection: ${platform}`, 'self-filter');
                return false;
        }
    }

    shouldFilterMessage(platform, messageData, platformConfig) {
        if (!this.isFilteringEnabled(platform)) {
            return false;
        }

        return this.isSelfMessage(platform, messageData, platformConfig);
    }

    _isTwitchSelfMessage(messageData, platformConfig) {
        if (messageData.self !== undefined) {
            return !!messageData.self;
        }

        if (messageData.username && platformConfig?.username) {
            return messageData.username.toLowerCase() === platformConfig.username.toLowerCase();
        }

        if (messageData.context?.username && platformConfig?.username) {
            return messageData.context.username.toLowerCase() === platformConfig.username.toLowerCase();
        }

        return false;
    }

    _isYouTubeSelfMessage(messageData, platformConfig) {
        if (messageData.username && platformConfig?.username) {
            return messageData.username.toLowerCase() === platformConfig.username.toLowerCase();
        }

        if (messageData.author?.isChatOwner || messageData.isBroadcaster) {
            return true;
        }

        if (messageData.badges) {
            const badges = Array.isArray(messageData.badges) ? messageData.badges : [];
            return badges.some(badge => 
                badge.toLowerCase().includes('owner') || 
                badge.toLowerCase().includes('broadcaster')
            );
        }

        return false;
    }

    _isTikTokSelfMessage(messageData, platformConfig) {
        if (messageData.username && platformConfig?.username) {
            return messageData.username.toLowerCase() === platformConfig.username.toLowerCase();
        }

        if (messageData.userId && platformConfig?.userId) {
            return messageData.userId === platformConfig.userId;
        }

        if (messageData.isBroadcaster) {
            return true;
        }

        return false;
    }
}

module.exports = SelfMessageDetectionService;
