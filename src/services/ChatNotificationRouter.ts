import { NotificationBuilder } from '../utils/notification-builder';
import { validateNormalizedMessage } from '../utils/message-normalization';
import { checkGlobalCommandCooldown, updateGlobalCommandCooldown } from '../utils/global-command-cooldown';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { sanitizeForDisplay } from '../utils/validation';
import { getValidMessageParts, normalizeBadgeImages } from '../utils/message-parts';
import { normalizeGreetingIdentityKey } from '../utils/greeting-identity-key-normalizer';

const LOG_TRUNCATION_LENGTH = 200;

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

class ChatNotificationRouter {
    runtime;
    logger;
    maxMessageLength;
    errorHandler;

    constructor({ runtime, logger, config }) {
        this.runtime = runtime;
        this.logger = logger;
        if (!config) {
            throw new Error('ChatNotificationRouter requires config');
        }
        this.maxMessageLength = config.general.maxMessageLength;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'chat-router');
    }

    async handleChatMessage(platform, normalizedData) {
        const safeNormalizedData = normalizedData || {};
        try {
            const messageText = this.getMessageText(safeNormalizedData);
            this.logger.debug(`Chat message via router from ${platform}: ${safeNormalizedData.username} - ${messageText}`, 'chat-router');

            const validation = validateNormalizedMessage(safeNormalizedData) || { isValid: true };
            if (!validation.isValid) {
                this.logger.warn(`Invalid normalized message from ${platform}`, 'chat-router', {
                    issues: validation.errors,
                    data: safeNormalizedData
                });
            }

            safeNormalizedData.platform = platform;
            const userId = safeNormalizedData.userId;

            if (!this.hasMessageContent(safeNormalizedData)) {
                this._logSkipped(platform, safeNormalizedData.username, 'empty message');
                return;
            }

            const chatEnabled = this.isChatEnabled(platform);
            if (!chatEnabled) {
                this._logSkipped(platform, safeNormalizedData.username, 'messages disabled (chat row only)');
            }

            if (this.shouldSkipForConnection(platform, safeNormalizedData.timestamp)) {
                this._logSkipped(platform, safeNormalizedData.username, 'old message (sent before connection)');
                return;
            }

            if (await this.enforceGracefulExitThreshold()) {
                return;
            }

            const sanitizedMessage = this.sanitizeChatContent(messageText);
            const messageParts = this.getCanonicalMessageParts(safeNormalizedData);
            const hasRenderableParts = messageParts.length > 0;
            if (!sanitizedMessage.hasContent && !hasRenderableParts) {
                this._logSkipped(platform, safeNormalizedData.username, 'empty after sanitization');
                return;
            }

            const logSafeData = { ...safeNormalizedData, message: sanitizedMessage.message };
            const level = this.runtime.config.general.logChatMessages ? 'console' : 'debug';
            this.logger[level](this._formatChatMessage(platform, logSafeData), 'chat-router');

            const greetingIdentity = platform === 'tiktok'
                ? safeNormalizedData.userId
                : safeNormalizedData.username;
            const greetingProfile = this.resolveGreetingProfile(platform, greetingIdentity);
            const firstMessageTrackingId = greetingProfile
                ? `greeting-profile:${greetingProfile.profileId}`
                : safeNormalizedData.userId;
            const isFirstMessage = this.isFirstMessage(safeNormalizedData, platform, firstMessageTrackingId);
            const greetingsEnabled = this.isGreetingEnabled(platform);

            if (chatEnabled) {
                this.enqueueChatMessage(platform, safeNormalizedData, sanitizedMessage.message, messageParts);
            }

            const farewellTrigger = this.detectFarewell(sanitizedMessage.message);
            if (farewellTrigger) {
                const handledFarewell = await this.processFarewell(platform, safeNormalizedData, farewellTrigger);
                if (handledFarewell) {
                    return;
                }
            }

            const commandConfig = await this.detectCommand(sanitizedMessage.message);
            if (commandConfig) {
                await this.processCommand(platform, safeNormalizedData, commandConfig, {
                    isFirstMessage,
                    greetingsEnabled,
                    greetingProfile
                });
                return;
            }

            if (isFirstMessage && greetingsEnabled) {
                await this.queueGreeting(platform, safeNormalizedData.username, {
                    userId,
                    greetingProfile
                });
            }
        } catch (error) {
            const errorDetails = getErrorMessage(error);
            this._handleRouterError(`Error routing chat message: ${errorDetails}`, error, 'chat-routing');
        }
    }

    hasMessageContent(normalizedData) {
        const messageText = this.getMessageText(normalizedData);
        if (typeof messageText === 'string' && messageText.trim().length > 0) {
            return true;
        }
        return this.getCanonicalMessageParts(normalizedData).length > 0;
    }

    getMessageText(normalizedData) {
        const safeNormalizedData = normalizedData || {};
        if (typeof safeNormalizedData?.message === 'string') {
            return safeNormalizedData.message;
        }

        if (safeNormalizedData?.message && typeof safeNormalizedData.message === 'object' && typeof safeNormalizedData.message.text === 'string') {
            return safeNormalizedData.message.text;
        }

        return '';
    }

    getCanonicalMessageParts(normalizedData) {
        const safeNormalizedData = normalizedData || {};
        return getValidMessageParts({ message: safeNormalizedData?.message })
            .map((part) => {
                if (part.type === 'emote') {
                    return {
                        type: 'emote',
                        platform: typeof part.platform === 'string' ? part.platform : undefined,
                        emoteId: part.emoteId.trim(),
                        imageUrl: part.imageUrl.trim()
                    };
                }

                return {
                    type: 'text',
                    text: part.text
                };
            });
    }

    shouldSkipForConnection(platform, timestamp) {
        if (!this.runtime.platformLifecycleService) {
            return false;
        }
        const filterOldMessages = this.runtime.config.general.filterOldMessages;
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

    async detectCommand(messageText) {
        const message = typeof messageText === 'string' ? messageText : '';
        const commandTrigger = this.extractCommandTrigger(message);
        if (!commandTrigger) {
            return null;
        }

        if (this.runtime.vfxCommandService?.selectVFXCommand) {
            return this.runtime.vfxCommandService.selectVFXCommand(commandTrigger, message);
        }
        return null;
    }

    detectFarewell(messageText) {
        if (typeof this.runtime.vfxCommandService?.matchFarewell !== 'function') {
            return null;
        }

        const message = typeof messageText === 'string' ? messageText : '';
        const commandTrigger = this.extractCommandTrigger(message);
        if (!commandTrigger) {
            return null;
        }

        const farewellMatch = this.runtime.vfxCommandService.matchFarewell(message, commandTrigger);
        if (typeof farewellMatch !== 'string' || farewellMatch.trim().length === 0) {
            return null;
        }

        return farewellMatch;
    }

    extractCommandTrigger(messageText) {
        if (typeof messageText !== 'string') {
            return '';
        }

        const trimmedMessage = messageText.trim();
        if (!trimmedMessage) {
            return '';
        }

        const firstToken = trimmedMessage.split(/\s+/)[0];
        return this.normalizeTriggerToken(firstToken);
    }

    normalizeTriggerToken(token) {
        if (typeof token !== 'string') {
            return '';
        }

        const withoutZeroWidth = token.replace(/[\u200B-\u200D\uFEFF]/g, '');
        const trimmedToken = withoutZeroWidth.trim();
        if (!trimmedToken) {
            return '';
        }

        return trimmedToken.replace(/[!?.,;:]+$/g, '');
    }

    isFirstMessage(normalizedData, platform, trackingUserId = normalizedData.userId) {
        const context = {
            username: normalizedData.username,
            platform
        };

        if (typeof this.runtime.isFirstMessage === 'function') {
            return this.runtime.isFirstMessage(trackingUserId, context);
        }

        if (this.runtime.userTrackingService?.isFirstMessage) {
            return this.runtime.userTrackingService.isFirstMessage(trackingUserId, context);
        }

        return false;
    }

    isGreetingEnabled(platform) {
        const value = this.runtime.config[platform].greetingsEnabled;
        if (value === undefined) {
            throw new Error(`Config missing ${platform}.greetingsEnabled`);
        }
        return !!value;
    }

    isChatEnabled(platform) {
        const value = this.runtime.config[platform].messagesEnabled;
        if (value === undefined) {
            throw new Error(`Config missing ${platform}.messagesEnabled`);
        }
        return !!value;
    }

    isFarewellEnabled(platform) {
        const value = this.runtime.config[platform].farewellsEnabled;
        if (value === undefined) {
            throw new Error(`Config missing ${platform}.farewellsEnabled`);
        }
        return !!value;
    }

    enqueueChatMessage(platform, normalizedData, sanitizedMessage, messageParts: Array<Record<string, unknown>> = []) {
        if (!this.runtime.displayQueue) {
            return;
        }

        const baseChatData = {
            type: 'chat',
            platform,
            username: normalizedData.username,
            userId: normalizedData.userId,
            avatarUrl: normalizedData.avatarUrl,
            timestamp: normalizedData.timestamp,
            message: sanitizedMessage,
            isPaypiggy: normalizedData.isPaypiggy === true
        };

        const builtChatData = NotificationBuilder.build(baseChatData);
        const chatData: Record<string, unknown> =
            builtChatData && typeof builtChatData === 'object'
                ? { ...builtChatData }
                : { ...baseChatData };
        chatData.timestamp = normalizedData.timestamp;
        const messagePayload: {
            text: string;
            parts?: Array<Record<string, unknown>>;
        } = {
            text: sanitizedMessage
        };
        if (Array.isArray(messageParts) && messageParts.length > 0) {
            messagePayload.parts = messageParts;
        }
        chatData.message = messagePayload;
        const badgeImages = normalizeBadgeImages(normalizedData.badgeImages);
        if (badgeImages.length > 0) {
            chatData.badgeImages = badgeImages;
        }

        this.runtime.displayQueue.addItem({
            type: 'chat',
            data: chatData,
            platform
        });
    }

    async processCommand(platform, normalizedData, commandConfig, options) {
        const safeOptions = options || {};
        if (!this.runtime.commandCooldownService) {
            this.logger.warn('CommandCooldownService not available; cannot process command', 'chat-router');
            return;
        }

        const { isFirstMessage, greetingsEnabled, greetingProfile } = safeOptions;
        const { perUserCooldown, heavyCooldown, globalCooldown } = this.getCooldownSettings();

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

        if (isFirstMessage && greetingsEnabled) {
            await this.queueGreeting(platform, normalizedData.username, {
                priority: 6,
                userId: normalizedData.userId,
                greetingProfile
            });
        }

        await this.queueCommand(platform, normalizedData, commandConfig);
        this.runtime.commandCooldownService.updateUserCooldown(normalizedData.userId);
        this.updateGlobalCooldown(commandConfig.command);
    }

    async processFarewell(platform, normalizedData, farewellTrigger) {
        if (!this.isFarewellEnabled(platform)) {
            this._logSkipped(platform, normalizedData.username, 'farewells disabled');
            return false;
        }

        if (typeof this.runtime.handleFarewellNotification !== 'function') {
            throw new Error('Runtime missing handleFarewellNotification');
        }

        const farewellCooldownMs = this.getFarewellCooldownMs();
        const farewellCooldownKey = `farewell:${platform}`;
        const globalAllowed = this.checkGlobalCooldown(farewellCooldownKey, farewellCooldownMs);
        if (!globalAllowed) {
            this._logSkipped(platform, normalizedData.username, 'farewell timeout active');
            return true;
        }

        try {
            const result = await this.runtime.handleFarewellNotification(platform, normalizedData.username, {
                command: farewellTrigger,
                trigger: farewellTrigger,
                userId: normalizedData.userId,
                timestamp: normalizedData.timestamp
            });

            if (result && typeof result === 'object' && result.success === true) {
                this.updateGlobalCooldown(farewellCooldownKey);
                return true;
            }

            this._logSkipped(platform, normalizedData.username, 'farewell notification not enqueued');
            return false;
        } catch (error) {
            this._handleRouterError(`Error handling farewell notification: ${getErrorMessage(error)}`, error, 'farewell-routing');
            return false;
        }
    }

    getCooldownSettings() {
        const cooldownConfig = this.runtime.config.cooldowns;
        return {
            perUserCooldown: cooldownConfig.cmdCooldownMs,
            heavyCooldown: cooldownConfig.heavyCommandCooldownMs,
            globalCooldown: cooldownConfig.globalCmdCooldownMs
        };
    }

    getFarewellCooldownMs() {
        return this.runtime.config.farewell.timeout * 1000;
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

    buildVFXConfig(commandConfig) {
        const safeCommandConfig = commandConfig || {};
        return {
            filename: safeCommandConfig.filename,
            mediaSource: safeCommandConfig.mediaSource,
            vfxFilePath: safeCommandConfig.vfxFilePath,
            commandKey: safeCommandConfig.commandKey,
            command: safeCommandConfig.command,
            triggerWord: safeCommandConfig.command
        };
    }

    shapeVfxConfig(vfxResult, errorPrefix) {
        if (!vfxResult || typeof vfxResult !== 'object') {
            return null;
        }

        if (!vfxResult.commandKey || !vfxResult.filename || !vfxResult.mediaSource || !vfxResult.vfxFilePath || !vfxResult.command || !Number.isFinite(vfxResult.duration)) {
            throw new Error(`${errorPrefix} requires commandKey, filename, mediaSource, vfxFilePath, command, and duration`);
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

    resolveGreetingProfile(platform, identityValue) {
        const profiles = this.runtime?.config?.greetings?.customVfxProfiles;
        if (!profiles || typeof profiles !== 'object') {
            return null;
        }

        const normalizedIdentity = normalizeGreetingIdentityKey(platform, identityValue);
        if (!normalizedIdentity) {
            return null;
        }

        const identityKey = `${platform}:${normalizedIdentity}`;
        return profiles[identityKey] || null;
    }

    async queueGreeting(platform, username, options) {
        const safeOptions = options || {};
        if (!this.runtime.displayQueue) {
            return;
        }

        const greetingData = NotificationBuilder.build({
            type: 'greeting',
            platform,
            username: username,
            userId: safeOptions.userId
        });

        const queueItem: Record<string, unknown> = {
            type: 'greeting',
            data: greetingData,
            vfxConfig: await this.resolveGreetingVFX(),
            platform
        };

        const secondaryVfxConfig = await this.resolveSecondaryGreetingVFX(safeOptions.greetingProfile);
        if (secondaryVfxConfig) {
            queueItem.secondaryVfxConfig = secondaryVfxConfig;
        }

        if (typeof safeOptions.priority !== 'undefined') {
            queueItem.priority = safeOptions.priority;
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
                return this.shapeVfxConfig(vfxResult, 'Greeting VFX config');
            }
        } catch (error) {
            this._handleRouterError(`Error getting greeting VFX config: ${getErrorMessage(error)}`, error, 'greeting-vfx');
        }

        return null;
    }

    async resolveSecondaryGreetingVFX(greetingProfile) {
        if (!greetingProfile || typeof greetingProfile !== 'object') {
            return null;
        }
        if (typeof greetingProfile.command !== 'string' || greetingProfile.command.trim().length === 0) {
            return null;
        }
        if (!this.runtime.vfxCommandService?.selectVFXCommand) {
            return null;
        }

        const trigger = greetingProfile.command.trim();
        try {
            const vfxResult = await this.runtime.vfxCommandService.selectVFXCommand(trigger, trigger);
            if (!vfxResult) {
                return null;
            }
            return this.shapeVfxConfig(vfxResult, 'Greeting secondary VFX config');
        } catch (error) {
            this._handleRouterError(`Error getting greeting secondary VFX config: ${getErrorMessage(error)}`, error, 'greeting-secondary-vfx');
            return null;
        }
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

    _formatChatMessage(platform, logSafeData) {
        const message = this.getMessageText(logSafeData);
        const truncated = message.length > LOG_TRUNCATION_LENGTH ? message.substring(0, LOG_TRUNCATION_LENGTH - 3) + '...' : message;
        return `[${platform}] ${logSafeData.username}: ${truncated}`;
    }

    _logSkipped(platform, username, reason) {
        this.logger.debug(`[${platform}] Skipping ${username}: ${reason}`, 'chat-router');
    }

    _handleRouterError(message, error, eventType) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'chat-router', error);
        }
    }
}

export { ChatNotificationRouter };
