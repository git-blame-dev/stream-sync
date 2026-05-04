import { logger as defaultLogger } from '../core/logging';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';

type PlatformConfig = {
ignoreSelfMessages?: unknown;
username?: string;
userId?: string;
};

type MessageData = {
self?: unknown;
username?: string;
context?: { username?: string } | null;
author?: { isChatOwner?: unknown } | null;
isBroadcaster?: unknown;
badges?: unknown;
userId?: string;
};

class SelfMessageDetectionService {
config: Record<string, PlatformConfig>;
logger: typeof defaultLogger;
errorHandler: ReturnType<typeof createPlatformErrorHandler>;

constructor(config: Record<string, PlatformConfig>, dependencies: { logger?: typeof defaultLogger } = {}) {
this.config = config;
this.logger = dependencies.logger || defaultLogger;
this.errorHandler = createPlatformErrorHandler(this.logger, 'self-message-detection');
}

isFilteringEnabled(platform: string): boolean {
const platformConfig = this.config[platform];
return !!platformConfig?.ignoreSelfMessages;
}

isSelfMessage(platform: string, messageData: MessageData | null | undefined, platformConfig?: PlatformConfig): boolean {
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
                this._handleDetectionError(`Unknown platform for self-message detection: ${platform}`);
                return false;
}
}

shouldFilterMessage(platform: string, messageData: MessageData | null | undefined, platformConfig?: PlatformConfig): boolean {
if (!this.isFilteringEnabled(platform)) {
return false;
}

return this.isSelfMessage(platform, messageData, platformConfig);
}

_isTwitchSelfMessage(messageData: MessageData, platformConfig?: PlatformConfig): boolean {
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

_isYouTubeSelfMessage(messageData: MessageData, platformConfig?: PlatformConfig): boolean {
if (messageData.username && platformConfig?.username) {
return messageData.username.toLowerCase() === platformConfig.username.toLowerCase();
}

        if (messageData.author?.isChatOwner || messageData.isBroadcaster) {
            return true;
        }

        if (messageData.badges) {
            const badges = Array.isArray(messageData.badges) ? messageData.badges : [];
            return badges.some((badge): boolean =>
                typeof badge === 'string'
                && (badge.toLowerCase().includes('owner') || badge.toLowerCase().includes('broadcaster'))
            );
        }

return false;
}

_isTikTokSelfMessage(messageData: MessageData, platformConfig?: PlatformConfig): boolean {
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

_handleDetectionError(message: string, error: unknown = null): void {
if (this.errorHandler && error instanceof Error) {
this.errorHandler.handleEventProcessingError(error, 'self-message-detection', null, message);
} else {
            this.errorHandler?.logOperationalError(message, 'self-message-detection');
        }
    }
}

export { SelfMessageDetectionService };
