const { logger } = require('../core/logging');

class DisplayRenderer {
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

    async displayChatItem(item) {
        const username = this.extractUsername(item.data);
        const message = item.data.message;
        const platform = item.platform;
        if (!platform || !this.config[platform]) {
            throw new Error(`DisplayQueue requires configured platform for chat: ${platform || 'unknown'}`);
        }

        if (this.config[platform].messagesEnabled === false) {
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

    async displayNotificationItem(item) {
        const username = this.extractUsername(item.data);
        const platform = item.platform;
        if (!platform || !this.config[platform]) {
            throw new Error(`DisplayQueue requires configured platform for notification: ${platform || 'unknown'}`);
        }

        if (this.config[platform].notificationsEnabled === false) {
            logger.debug(`[Display Queue] Notifications for platform '${platform}' is disabled. Skipping notification for '${username}'.`, 'display-queue');
            return false;
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
            if (!item.data.displayMessage) {
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

    async displayLingeringChat(lastChatItem) {
        if (!lastChatItem) {
            logger.debug('[Lingering Chat] No chat message available for lingering display', 'display-queue');
            return;
        }

        if (!this.obsManager || !await this.obsManager.isReady()) {
            logger.debug('[DisplayQueue] Skipping lingering chat display - OBS not ready', 'display-queue');
            return;
        }

        const username = this.extractUsername(lastChatItem.data);
        logger.debug(`[Lingering Chat] Displaying lingering chat: ${username} - ${lastChatItem.data.message}`, 'display-queue');

        const { sourceName, sceneName, groupName, platformLogos } = this.config.chat;
        if (!this.validateDisplayConfig({ sourceName, sceneName, groupName }, 'chat')) {
            return;
        }

        await this.hideCurrentDisplay({ type: 'notification' });
        await this.delay(200);

        await this.sourcesManager.updateChatMsgText(this.config.chat.sourceName, username, lastChatItem.data.message);

        if (lastChatItem.platform && platformLogos) {
            await this.sourcesManager.setPlatformLogoVisibility(lastChatItem.platform, this.config.chat.platformLogos);
        }

        await this.sourcesManager.setGroupSourceVisibility(sourceName, groupName, true);
        await this.sourcesManager.setChatDisplayVisibility(true, sceneName, platformLogos);
    }

    async hideCurrentDisplay(item) {
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

module.exports = {
    DisplayRenderer
};
