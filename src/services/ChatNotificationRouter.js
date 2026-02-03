
const { logChatMessageWithConfig, logChatMessageSkipped } = require('../utils/chat-logger');
const NotificationBuilder = require('../utils/notification-builder');
const { validateNormalizedMessage } = require('../utils/message-normalization');
const { checkGlobalCommandCooldown, updateGlobalCommandCooldown } = require('../utils/command-parser');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { sanitizeForDisplay } = require('../utils/validation');

class ChatNotificationRouter {
    constructor({ runtime, logger, config }) {
        this.runtime = runtime;
        this.logger = logger;
        if (!config) {
            throw new Error('ChatNotificationRouter requires config');
        }
        this.maxMessageLength = config.general.maxMessageLength;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'chat-router');
    }

    async handleChatMessage(platform, normalizedData = {}) {
        try {
            this.logger.debug(`Chat message via router from ${platform}: ${normalizedData.username} - ${normalizedData.message}`, 'chat-router');

            const validation = validateNormalizedMessage(normalizedData) || { isValid: true };
            if (!validation.isValid) {
                this.logger.warn(`Invalid normalized message from ${platform}`, 'chat-router', {
                    issues: validation.issues,
                    data: normalizedData
                });
            }

            normalizedData.platform = platform;
            const userId = normalizedData.userId;

            if (!this.hasMessageContent(normalizedData)) {
                logChatMessageSkipped(platform, normalizedData, 'empty message');
                return;
            }

            if (!this.isChatEnabled(platform)) {
                logChatMessageSkipped(platform, normalizedData, 'messages disabled');
                return;
            }

            if (this.shouldSkipForConnection(platform, normalizedData.timestamp)) {
                logChatMessageSkipped(platform, normalizedData, 'old message (sent before connection)');
                return;
            }

            if (await this.enforceGracefulExitThreshold()) {
                return;
            }

            const sanitizedMessage = this.sanitizeChatContent(normalizedData.message);
            if (!sanitizedMessage.hasContent) {
                logChatMessageSkipped(platform, normalizedData, 'empty after sanitization');
                return;
            }

            const logSafeData = { ...normalizedData, message: sanitizedMessage.message };

            logChatMessageWithConfig(platform, logSafeData, this.runtime.config, {
                includeUserId: false,
                truncateMessage: true,
                maxMessageLength: 200
            });

            const isFirstMessage = this.isFirstMessage(normalizedData, platform);
            const greetingsEnabled = this.isGreetingEnabled(platform);

            this.enqueueChatMessage(platform, normalizedData, sanitizedMessage.message);

            const commandConfig = await this.detectCommand(normalizedData);
            if (commandConfig) {
                await this.processCommand(platform, normalizedData, commandConfig, {
                    isFirstMessage,
                    greetingsEnabled
                });
                return;
            }

            if (isFirstMessage && greetingsEnabled) {
                await this.queueGreeting(platform, normalizedData.username, { userId });
            }
        } catch (error) {
            const errorDetails = error instanceof Error ? error.message : String(error);
            this._handleRouterError(`Error routing chat message: ${errorDetails}`, error, 'chat-routing');
        }
    }

    hasMessageContent(normalizedData) {
        const message = normalizedData?.message;
        return typeof message === 'string' && message.trim().length > 0;
    }

    shouldSkipForConnection(platform, timestamp) {
        if (!this.runtime.platformLifecycleService) {
            return false;
        }
        const filterOldMessages = this.runtime.config?.general?.filterOldMessages ?? true;
        if (!filterOldMessages) {
            return false;
        }

        const connectionTime = this.runtime.platformLifecycleService.getPlatformConnectionTime(platform);
        if (!connectionTime) {
            return false;
        }
        const messageTime = new Date(timestamp).getTime();
        return !Number.isNaN(messageTime) && messageTime < connectionTime;
    }

    async enforceGracefulExitThreshold() {
        if (this.runtime.gracefulExitService?.isEnabled()) {
            const shouldExit = this.runtime.gracefulExitService.incrementMessageCount();
            if (shouldExit) {
                await this.runtime.gracefulExitService.triggerExit();
                return true;
            }
        }
        return false;
    }

    async detectCommand(normalizedData) {
        const message = typeof normalizedData?.message === 'string' ? normalizedData.message : '';
        const trimmedMessage = message.trim();
        const commandTrigger = trimmedMessage ? trimmedMessage.split(/\s+/)[0] : trimmedMessage;

        if (this.runtime.vfxCommandService?.selectVFXCommand) {
            return this.runtime.vfxCommandService.selectVFXCommand(commandTrigger, message);
        }
        if (this.runtime.commandParser) {
            return this.runtime.commandParser.getVFXConfig(commandTrigger, message);
        }
        return null;
    }

    isFirstMessage(normalizedData, platform) {
        const context = {
            username: normalizedData.username,
            platform
        };

        if (typeof this.runtime.isFirstMessage === 'function') {
            return this.runtime.isFirstMessage(normalizedData.userId, context);
        }

        if (this.runtime.userTrackingService?.isFirstMessage) {
            return this.runtime.userTrackingService.isFirstMessage(normalizedData.userId, context);
        }

        return false;
    }

    isGreetingEnabled(platform) {
        const platformConfig = this.runtime.config?.[platform];
        return !!platformConfig?.greetingsEnabled;
    }

    isChatEnabled(platform) {
        const platformSettings = this.runtime.config?.[platform] || {};
        if (typeof platformSettings.messagesEnabled === 'boolean') {
            return platformSettings.messagesEnabled;
        }
        const generalSettings = this.runtime.config?.general || {};
        if (typeof generalSettings.messagesEnabled === 'boolean') {
            return generalSettings.messagesEnabled;
        }
        return true;
    }

    enqueueChatMessage(platform, normalizedData, sanitizedMessage) {
        if (!this.runtime.displayQueue) {
            return;
        }

        const baseChatData = {
            type: 'chat',
            platform,
            username: normalizedData.username,
            userId: normalizedData.userId,
            message: sanitizedMessage
        };

        const chatData = NotificationBuilder.build(baseChatData) || baseChatData;

        this.runtime.displayQueue.addItem({
            type: 'chat',
            data: chatData,
            platform
        });
    }

    async processCommand(platform, normalizedData, commandConfig, options = {}) {
        if (!this.runtime.commandCooldownService) {
            this.logger.warn('CommandCooldownService not available; cannot process command', 'chat-router');
            return;
        }

        const { isFirstMessage, greetingsEnabled } = options;
        const { perUserCooldown, heavyCooldown, globalCooldown } = this.getCooldownSettings(platform);

        const userAllowed = this.runtime.commandCooldownService.checkUserCooldown(
            normalizedData.userId,
            perUserCooldown,
            heavyCooldown
        );

        if (!userAllowed) {
            this.logger.warn(`${normalizedData.username} tried to use ${commandConfig.command} but is on per-user cooldown`, platform);
            return;
        }

        const globalAllowed = this.checkGlobalCooldown(commandConfig.command, globalCooldown);
        if (!globalAllowed) {
            this.logger.warn(`${normalizedData.username} tried to use ${commandConfig.command} but is on global cooldown`, platform);
            return;
        }

        this.runtime.commandCooldownService.updateUserCooldown(normalizedData.userId);
        this.updateGlobalCooldown(commandConfig.command);

        if (isFirstMessage && greetingsEnabled) {
            await this.queueGreeting(platform, normalizedData.username, { priority: 6, userId: normalizedData.userId });
        }

        await this.queueCommand(platform, normalizedData, commandConfig);
    }

    getCooldownSettings(platform) {
        const platformConfig = this.runtime.config?.[platform] || {};
        const generalConfig = this.runtime.config?.general || {};
        return {
            perUserCooldown: platformConfig.cmdCoolDownMs || generalConfig.cmdCoolDownMs || 60000,
            heavyCooldown: platformConfig.heavyCommandCooldownMs || generalConfig.heavyCommandCooldownMs || 300000,
            globalCooldown: platformConfig.globalCmdCooldownMs || generalConfig.globalCmdCooldownMs || 60000
        };
    }

    checkGlobalCooldown(commandName, globalCooldownMs) {
        if (typeof this.runtime.commandCooldownService?.checkGlobalCooldown === 'function') {
            return this.runtime.commandCooldownService.checkGlobalCooldown(commandName, globalCooldownMs);
        }

        return !checkGlobalCommandCooldown(commandName, globalCooldownMs);
    }

    updateGlobalCooldown(commandName) {
        if (typeof this.runtime.commandCooldownService?.updateGlobalCooldown === 'function') {
            this.runtime.commandCooldownService.updateGlobalCooldown(commandName);
            return;
        }

        updateGlobalCommandCooldown(commandName);
    }

    async queueCommand(platform, normalizedData, commandConfig) {
        if (!this.runtime.displayQueue) {
            return;
        }

        const commandData = NotificationBuilder.build({
            type: 'command',
            platform,
            username: normalizedData.username,
            userId: normalizedData.userId,
            command: commandConfig.command.startsWith('!') ? commandConfig.command : `!${commandConfig.command}`,
            commandName: commandConfig.command.replace(/^!/, '')
        });

        this.runtime.displayQueue.addItem({
            type: 'command',
            data: commandData,
            vfxConfig: this.buildVFXConfig(commandConfig),
            platform
        });
    }

    buildVFXConfig(commandConfig = {}) {
        return {
            filename: commandConfig.filename,
            mediaSource: commandConfig.mediaSource,
            vfxFilePath: commandConfig.vfxFilePath,
            commandKey: commandConfig.commandKey,
            command: commandConfig.command,
            // Preserve the original trigger so VFXCommandService can resolve the correct config
            triggerWord: commandConfig.command
        };
    }

    async queueGreeting(platform, username, options = {}) {
        if (!this.runtime.displayQueue) {
            return;
        }

        const greetingData = NotificationBuilder.build({
            type: 'greeting',
            platform,
            username: username,
            userId: options.userId
        });

        const queueItem = {
            type: 'greeting',
            data: greetingData,
            vfxConfig: await this.resolveGreetingVFX(),
            platform
        };

        if (typeof options.priority !== 'undefined') {
            queueItem.priority = options.priority;
        }

        this.runtime.displayQueue.addItem(queueItem);
    }

    async resolveGreetingVFX() {
        if (!this.runtime.vfxCommandService?.getVFXConfig) {
            return null;
        }

        try {
            const vfxResult = await this.runtime.vfxCommandService.getVFXConfig('greetings', null);
            if (vfxResult) {
                if (!vfxResult.commandKey || !vfxResult.filename || !vfxResult.mediaSource || !vfxResult.vfxFilePath || !vfxResult.command || !Number.isFinite(vfxResult.duration)) {
                    throw new Error('Greeting VFX config requires commandKey, filename, mediaSource, vfxFilePath, command, and duration');
                }
                return {
                    commandKey: vfxResult.commandKey,
                    filename: vfxResult.filename,
                    mediaSource: vfxResult.mediaSource,
                    vfxFilePath: vfxResult.vfxFilePath,
                    duration: vfxResult.duration,
                    command: vfxResult.command,
                    triggerWord: vfxResult.command
                };
            }
        } catch (error) {
            this._handleRouterError(`Error getting greeting VFX config: ${error.message}`, error, 'greeting-vfx');
        }

        return null;
    }

    sanitizeChatContent(rawMessage) {
        const safeMessage = typeof rawMessage === 'string' ? rawMessage : '';
        const withoutZeroWidth = safeMessage.replace(/[\u200B-\u200D\uFEFF]/g, ' ');
        const messageWithSpacing = withoutZeroWidth.replace(/<[^>]+>/g, ' ');
        const sanitized = sanitizeForDisplay(messageWithSpacing, this.maxMessageLength);

        return {
            hasContent: sanitized.trim().length > 0,
            message: sanitized
        };
    }

    _handleRouterError(message, error, eventType) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'chat-router', error);
        }
    }
}

module.exports = ChatNotificationRouter;
