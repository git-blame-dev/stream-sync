import { logger } from '../core/logging';

type DisplaySourceManager = {
    updateChatMsgText: (sourceName: string, username: string, message: string) => Promise<void>;
    setPlatformLogoVisibility: (platform: string, platformLogos: Record<string, unknown>) => Promise<void>;
    setGroupSourceVisibility: (sourceName: string, groupName: string | null | undefined, visible: boolean) => Promise<void>;
    setChatDisplayVisibility: (visible: boolean, sceneName: string, platformLogos: Record<string, unknown>) => Promise<void>;
    updateTextSource: (sourceName: string, text: string) => Promise<void>;
    setNotificationPlatformLogoVisibility: (platform: string, platformLogos: Record<string, unknown>) => Promise<void>;
    setNotificationDisplayVisibility: (visible: boolean, sceneName: string, platformLogos: Record<string, unknown>) => Promise<void>;
};

type DisplayRendererConfig = {
    chat: {
        sourceName: string;
        sceneName: string;
        groupName?: string | null;
        platformLogos: Record<string, unknown>;
    };
    notification: {
        sourceName: string;
        sceneName: string;
        groupName?: string | null;
        platformLogos: Record<string, unknown>;
    };
    timing: {
        transitionDelay: number;
        notificationClearDelay: number;
    };
    [platform: string]: unknown;
};

function resolveChatMessageText(message: unknown) {
    if (typeof message === 'string') {
        return message;
    }

    if (message && typeof message === 'object') {
        const messageObject = message as { text?: unknown; parts?: unknown };

        if (typeof messageObject.text === 'string') {
            return messageObject.text;
        }

        if (Array.isArray(messageObject.parts)) {
            return messageObject.parts
                .map((part: unknown) => (part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : ''))
                .join('');
        }
    }

    return '';
}

class DisplayRenderer {
    obsManager: { isReady: () => Promise<boolean> } | null;
    sourcesManager: DisplaySourceManager;
    config: DisplayRendererConfig;
    delay: (ms: number) => Promise<void>;
    handleDisplayQueueError: (message: string, error: unknown, payload?: Record<string, unknown>) => void;
    extractUsername: (data: unknown) => string;
    validateDisplayConfig: (config: { sourceName?: unknown; sceneName?: unknown; groupName?: unknown }, type: string) => boolean;
    isNotificationType: (type: string) => boolean;
    isChatType: (type: string) => boolean;

    constructor({
        obsManager,
        sourcesManager,
        config,
        delay,
        handleDisplayQueueError,
        extractUsername,
        validateDisplayConfig,
        isNotificationType,
        isChatType
    }: {
        obsManager: { isReady: () => Promise<boolean> } | null;
        sourcesManager: DisplaySourceManager;
        config: DisplayRendererConfig;
        delay: (ms: number) => Promise<void>;
        handleDisplayQueueError: (message: string, error: unknown, payload?: Record<string, unknown>) => void;
        extractUsername: (data: unknown) => string;
        validateDisplayConfig: (config: { sourceName?: unknown; sceneName?: unknown; groupName?: unknown }, type: string) => boolean;
        isNotificationType: (type: string) => boolean;
        isChatType: (type: string) => boolean;
    }) {
        this.obsManager = obsManager;
        this.sourcesManager = sourcesManager;
        this.config = config;
        this.delay = delay;
        this.handleDisplayQueueError = handleDisplayQueueError;
        this.extractUsername = extractUsername;
        this.validateDisplayConfig = validateDisplayConfig;
        this.isNotificationType = isNotificationType;
        this.isChatType = isChatType;
    }

    async displayChatItem(item: { data: { message?: unknown }; platform: string; type: string }) {
        const username = this.extractUsername(item.data);
        const message = resolveChatMessageText(item.data.message);
        const platform = item.platform;
        const platformConfig = this.config[platform] as { messagesEnabled?: boolean } | undefined;
        if (!platform || !platformConfig) {
            throw new Error(`DisplayQueue requires configured platform for chat: ${platform || 'unknown'}`);
        }

        if (platformConfig.messagesEnabled === false) {
            logger.debug(`[Display Queue] Chat for platform '${platform}' is disabled. Skipping message from '${username}'.`, 'display-queue');
            return false;
        }

        if (!this.obsManager || !await this.obsManager.isReady()) {
            logger.debug('[DisplayQueue] Skipping chat display - OBS not ready', 'display-queue');
            return false;
        }

        const { sourceName, sceneName, groupName, platformLogos } = this.config.chat;
        if (!this.validateDisplayConfig({ sourceName, sceneName, groupName }, 'chat')) {
            return false;
        }

        await this.hideCurrentDisplay({ type: 'notification' });
        await this.hideCurrentDisplay({ type: 'chat' });
        await this.delay(this.config.timing.transitionDelay);

        try {
            await this.sourcesManager.updateChatMsgText(this.config.chat.sourceName, username, message);
        } catch (error) {
            this.handleDisplayQueueError('[DisplayQueue] Error updating chat text source', error, { platform, username });
            return false;
        }

        if (platform) {
            await this.sourcesManager.setPlatformLogoVisibility(platform, this.config.chat.platformLogos);
        }

        await this.sourcesManager.setGroupSourceVisibility(sourceName, groupName, true);
        await this.sourcesManager.setChatDisplayVisibility(true, sceneName, platformLogos);
        return true;
    }

    async displayNotificationItem(item: { data: { displayMessage?: unknown }; platform: string; type: string }) {
        const platform = item.platform;
        const platformConfig = this.config[platform];
        if (!platform || !platformConfig) {
            throw new Error(`DisplayQueue requires configured platform for notification: ${platform || 'unknown'}`);
        }

        if (!this.obsManager || !await this.obsManager.isReady()) {
            logger.debug('[DisplayQueue] Skipping notification display - OBS not ready', 'display-queue');
            return false;
        }

        const { sourceName, sceneName, groupName, platformLogos } = this.config.notification;
        if (!this.validateDisplayConfig({ sourceName, sceneName, groupName }, 'notification')) {
            return false;
        }

        await this.sourcesManager.setChatDisplayVisibility(false, this.config.chat.sceneName, this.config.chat.platformLogos);
        await this.delay(this.config.timing.notificationClearDelay);

        try {
            if (typeof item.data.displayMessage !== 'string' || item.data.displayMessage.length === 0) {
                throw new Error('Notification display requires displayMessage');
            }
            await this.sourcesManager.updateTextSource(sourceName, item.data.displayMessage);
        } catch (error) {
            this.handleDisplayQueueError('[DisplayQueue] Error updating notification text source', error, { platform, itemType: item.type });
            return false;
        }

        if (platform && platformLogos && platformLogos[platform]) {
            await this.sourcesManager.setNotificationPlatformLogoVisibility(platform, this.config.notification.platformLogos);
        }

        const { sourceName: notificationSourceName, groupName: notificationGroupName } = this.config.notification;
        await this.sourcesManager.setGroupSourceVisibility(notificationSourceName, notificationGroupName, true);
        await this.sourcesManager.setNotificationDisplayVisibility(true, this.config.notification.sceneName, this.config.notification.platformLogos);
        return true;
    }

    async displayLingeringChat(lastChatItem: { data: { message?: unknown }; platform?: string } | null) {
        if (!lastChatItem) {
            logger.debug('[Lingering Chat] No chat message available for lingering display', 'display-queue');
            return;
        }

        if (!this.obsManager || !await this.obsManager.isReady()) {
            logger.debug('[DisplayQueue] Skipping lingering chat display - OBS not ready', 'display-queue');
            return;
        }

        const username = this.extractUsername(lastChatItem.data);
        const message = resolveChatMessageText(lastChatItem.data.message);
        logger.debug(`[Lingering Chat] Displaying lingering chat: ${username} - ${message}`, 'display-queue');

        const { sourceName, sceneName, groupName, platformLogos } = this.config.chat;
        if (!this.validateDisplayConfig({ sourceName, sceneName, groupName }, 'chat')) {
            return;
        }

        await this.hideCurrentDisplay({ type: 'notification' });
        await this.delay(200);

        await this.sourcesManager.updateChatMsgText(this.config.chat.sourceName, username, message);

        if (lastChatItem.platform && platformLogos) {
            await this.sourcesManager.setPlatformLogoVisibility(lastChatItem.platform, this.config.chat.platformLogos);
        }

        await this.sourcesManager.setGroupSourceVisibility(sourceName, groupName, true);
        await this.sourcesManager.setChatDisplayVisibility(true, sceneName, platformLogos);
    }

    async hideCurrentDisplay(item: { type?: string } | null) {
        if (!item || !item.type) return;

        if (!this.obsManager || !await this.obsManager.isReady()) {
            logger.debug('[DisplayQueue] Skipping hide display - OBS not ready', 'display-queue');
            return;
        }

        if (this.isChatType(item.type)) {
            const { sceneName, platformLogos } = this.config.chat;
            if (sceneName) {
                await this.sourcesManager.setChatDisplayVisibility(false, sceneName, platformLogos);
            }
        } else if (this.isNotificationType(item.type)) {
            const { sceneName, platformLogos } = this.config.notification;
            if (sceneName) {
                await this.sourcesManager.setNotificationDisplayVisibility(false, sceneName, platformLogos);
            }
        }
    }
}

export {
    DisplayRenderer
};
