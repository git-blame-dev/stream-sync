import { NotificationBuilder } from '../utils/notification-builder';
import { validateNormalizedMessage } from '../utils/message-normalization';
import { checkGlobalCommandCooldown, updateGlobalCommandCooldown } from '../utils/global-command-cooldown';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { sanitizeForDisplay } from '../utils/validation';
import { getValidMessageParts, normalizeBadgeImages } from '../utils/message-parts';
import { normalizeGreetingIdentityKey } from '../utils/greeting-identity-key-normalizer';

const LOG_TRUNCATION_LENGTH = 200;

type RouterRecord = Record<string, unknown>;

type LoggerLike = {
    debug: (message: unknown, source?: string, data?: unknown) => void;
    warn: (message: unknown, source?: string, data?: unknown) => void;
    error?: (message: unknown, source?: string, data?: unknown) => void;
    console?: (message: unknown, source?: string, data?: unknown) => void;
};

type RouterConfig = {
    general: {
        maxMessageLength: number;
        logChatMessages?: boolean;
        filterOldMessages?: boolean;
    };
    cooldowns: {
        cmdCooldownMs: number;
        heavyCommandCooldownMs: number;
        globalCmdCooldownMs: number;
    };
    farewell: {
        timeout: number;
    };
    greetings?: {
        customVfxProfiles?: Record<string, GreetingProfile>;
    };
} & Record<string, RouterRecord>;

type NormalizedChatData = {
    type?: unknown;
    platform?: string;
    username?: string;
    userId?: unknown;
    avatarUrl?: unknown;
    timestamp?: unknown;
    message?: unknown;
    isPaypiggy?: boolean;
    badgeImages?: unknown;
} & RouterRecord;

type CommandConfig = {
    command: string;
    filename?: unknown;
    mediaSource?: unknown;
    vfxFilePath?: unknown;
    commandKey?: unknown;
};

type GreetingProfile = {
    profileId?: string;
    command?: string;
} & RouterRecord;

type FirstMessageState = {
    isFirstMessage: boolean;
    consume: () => void;
};

type ProcessCommandOptions = {
    firstMessageState?: FirstMessageState;
    greetingsEnabled?: boolean;
    greetingProfile?: GreetingProfile | null | undefined;
};

type VfxResult = {
    commandKey?: unknown;
    filename?: unknown;
    mediaSource?: unknown;
    vfxFilePath?: unknown;
    duration?: unknown;
    command?: unknown;
};

type RuntimeLike = {
    config: RouterConfig;
    displayQueue?: { addItem: (item: RouterRecord) => void };
    platformLifecycleService?: { getPlatformConnectionTime: (platform: string) => number | undefined | null };
    gracefulExitService?: {
        isEnabled: () => boolean;
        incrementMessageCount: () => boolean;
        triggerExit: () => Promise<unknown> | unknown;
    };
    vfxCommandService?: {
        selectVFXCommand?: (trigger: string, message: string) => Promise<CommandConfig | VfxResult | null> | CommandConfig | VfxResult | null;
        matchFarewell?: (message: string, trigger: string) => unknown;
        getVFXConfig?: (commandKey: string, message: string | null) => Promise<VfxResult | null> | VfxResult | null;
    };
    commandCooldownService?: {
        checkUserCooldown: (userId: unknown, perUserCooldown: number, heavyCooldown: number) => boolean;
        updateUserCooldown: (userId: unknown) => void;
        checkGlobalCooldown?: (commandName: string, globalCooldownMs: number) => boolean;
        updateGlobalCooldown?: (commandName: string) => void;
    };
    userTrackingService?: {
        hasSeenUser?: (userId: unknown, context: RouterRecord) => boolean;
        markMessageSeen?: (userId: unknown, context: RouterRecord) => void;
        isFirstMessage?: (userId: unknown, context: RouterRecord) => boolean;
    };
    isFirstMessage?: (userId: unknown, context: RouterRecord) => boolean;
    handleFarewellNotification?: (platform: string, username: string | undefined, data: RouterRecord) => Promise<unknown> | unknown;
};

type RouterDependencies = {
    runtime: RuntimeLike;
    logger: LoggerLike;
    config: RouterConfig;
};

type PlatformErrorHandlerLike = {
    handleEventProcessingError: (error: Error, eventType: string, eventData: unknown, message: string) => void;
    logOperationalError: (message: string, context: string, payload: unknown) => void;
};

function isRecord(value: unknown): value is RouterRecord {
    return !!value && typeof value === 'object';
}

function isCommandConfig(value: unknown): value is CommandConfig {
    return isRecord(value) && typeof value.command === 'string';
}

function getErrorMessage(error: unknown) {
    if (error instanceof Error) {
        return error.message;
    }
    return String(error);
}

class ChatNotificationRouter {
    runtime: RuntimeLike;
    logger: LoggerLike;
    maxMessageLength: number;
    errorHandler: PlatformErrorHandlerLike;

    constructor({ runtime, logger, config }: RouterDependencies) {
        this.runtime = runtime;
        this.logger = logger;
        if (!config) {
            throw new Error('ChatNotificationRouter requires config');
        }
        this.maxMessageLength = config.general.maxMessageLength;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'chat-router');
    }

    async handleChatMessage(platform: string, normalizedData: NormalizedChatData) {
        const safeNormalizedData: NormalizedChatData = normalizedData || {};
        try {
            const messageText = this.getMessageText(safeNormalizedData);
            this.logger.debug('Chat message via router', 'chat-router', {
                platform,
                username: safeNormalizedData.username,
                messageLength: messageText.length,
                hasMessageText: messageText.length > 0
            });

            const validation = validateNormalizedMessage(safeNormalizedData) || { isValid: true };
            if (!validation.isValid) {
                this.logger.warn(`Invalid normalized message from ${platform}`, 'chat-router', {
                    issues: validation.errors,
                    username: safeNormalizedData.username,
                    hasMessage: this.hasMessageContent(safeNormalizedData)
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

            const level = this.runtime.config.general.logChatMessages ? 'console' : 'debug';
            if (level === 'console' && typeof this.logger.console === 'function') {
                const logSafeData = { ...safeNormalizedData, message: sanitizedMessage.message };
                this.logger.console(this._formatChatMessage(platform, logSafeData), 'chat-router');
            } else {
                this.logger.debug('Chat message accepted for routing', 'chat-router', {
                    platform,
                    username: safeNormalizedData.username,
                    messageLength: sanitizedMessage.message.length,
                    hasRenderableParts
                });
            }

            const greetingIdentity = platform === 'tiktok'
                ? safeNormalizedData.userId
                : safeNormalizedData.username;
            const greetingProfile = this.resolveGreetingProfile(platform, greetingIdentity);
            const firstMessageTrackingId = greetingProfile
                ? `greeting-profile:${greetingProfile.profileId}`
                : safeNormalizedData.userId;
            const firstMessageState = this.getFirstMessageState(safeNormalizedData, platform, firstMessageTrackingId);
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
                    firstMessageState,
                    greetingsEnabled,
                    greetingProfile
                });
                return;
            }

            if (firstMessageState.isFirstMessage && greetingsEnabled) {
                await this.queueGreeting(platform, safeNormalizedData.username, {
                    userId,
                    avatarUrl: safeNormalizedData.avatarUrl,
                    greetingProfile
                });
                firstMessageState.consume();
            }
        } catch (error) {
            const errorDetails = getErrorMessage(error);
            this._handleRouterError(`Error routing chat message: ${errorDetails}`, error, 'chat-routing');
        }
    }

    hasMessageContent(normalizedData: NormalizedChatData) {
        const messageText = this.getMessageText(normalizedData);
        if (typeof messageText === 'string' && messageText.trim().length > 0) {
            return true;
        }
        return this.getCanonicalMessageParts(normalizedData).length > 0;
    }

    getMessageText(normalizedData: NormalizedChatData) {
        const safeNormalizedData = normalizedData || {};
        if (typeof safeNormalizedData?.message === 'string') {
            return safeNormalizedData.message;
        }

        if (isRecord(safeNormalizedData.message) && typeof safeNormalizedData.message.text === 'string') {
            return safeNormalizedData.message.text;
        }

        return '';
    }

    getCanonicalMessageParts(normalizedData: NormalizedChatData): Array<Record<string, unknown>> {
        const safeNormalizedData = normalizedData || {};
        const messagePayload = isRecord(safeNormalizedData.message)
            ? { message: safeNormalizedData.message }
            : {};
        return getValidMessageParts(messagePayload)
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

    shouldSkipForConnection(platform: string, timestamp: unknown) {
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
        if (typeof timestamp !== 'string' && typeof timestamp !== 'number' && !(timestamp instanceof Date)) {
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

    async detectCommand(messageText: unknown): Promise<CommandConfig | null> {
        const message = typeof messageText === 'string' ? messageText : '';
        const commandTrigger = this.extractCommandTrigger(message);
        if (!commandTrigger) {
            return null;
        }

        if (this.runtime.vfxCommandService?.selectVFXCommand) {
            const selected = await this.runtime.vfxCommandService.selectVFXCommand(commandTrigger, message);
            return isCommandConfig(selected) ? selected : null;
        }
        return null;
    }

    detectFarewell(messageText: unknown) {
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

    extractCommandTrigger(messageText: unknown) {
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

    normalizeTriggerToken(token: unknown) {
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

    isFirstMessage(normalizedData: NormalizedChatData, platform: string, trackingUserId: unknown = normalizedData.userId) {
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

    isGreetingEnabled(platform: string) {
        const value = this.getPlatformConfig(platform).greetingsEnabled;
        if (value === undefined) {
            throw new Error(`Config missing ${platform}.greetingsEnabled`);
        }
        return !!value;
    }

    isChatEnabled(platform: string) {
        const value = this.getPlatformConfig(platform).messagesEnabled;
        if (value === undefined) {
            throw new Error(`Config missing ${platform}.messagesEnabled`);
        }
        return !!value;
    }

    isFarewellEnabled(platform: string) {
        const value = this.getPlatformConfig(platform).farewellsEnabled;
        if (value === undefined) {
            throw new Error(`Config missing ${platform}.farewellsEnabled`);
        }
        return !!value;
    }

    getPlatformConfig(platform: string): RouterRecord {
        const platformConfig = this.runtime.config[platform];
        if (!platformConfig) {
            throw new Error(`Config missing ${platform}`);
        }
        return platformConfig;
    }

    enqueueChatMessage(platform: string, normalizedData: NormalizedChatData, sanitizedMessage: string, messageParts: Array<Record<string, unknown>> = []) {
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

    async processCommand(platform: string, normalizedData: NormalizedChatData, commandConfig: CommandConfig, options: ProcessCommandOptions) {
        const safeOptions = options || {};
        if (!this.runtime.commandCooldownService) {
            this.logger.warn('CommandCooldownService not available; cannot process command', 'chat-router');
            return;
        }

        const { firstMessageState, greetingsEnabled, greetingProfile } = safeOptions;
        const isFirstMessage = firstMessageState?.isFirstMessage === true;
        const consumeFirstMessage = typeof firstMessageState?.consume === 'function'
            ? firstMessageState.consume
            : () => {};
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
                avatarUrl: normalizedData.avatarUrl,
                greetingProfile
            });
            consumeFirstMessage();
        }

        await this.queueCommand(platform, normalizedData, commandConfig);
        if (isFirstMessage && !greetingsEnabled) {
            consumeFirstMessage();
        }
        this.runtime.commandCooldownService.updateUserCooldown(normalizedData.userId);
        this.updateGlobalCooldown(commandConfig.command);
    }

    getFirstMessageState(normalizedData: NormalizedChatData, platform: string, trackingUserId: unknown = normalizedData.userId): FirstMessageState {
        const context = {
            username: normalizedData.username,
            platform
        };

        const userTrackingService = this.runtime.userTrackingService;
        if (userTrackingService &&
            typeof userTrackingService.hasSeenUser === 'function' &&
            typeof userTrackingService.markMessageSeen === 'function') {
            const hasSeenUser = userTrackingService.hasSeenUser.bind(userTrackingService);
            const markMessageSeen = userTrackingService.markMessageSeen.bind(userTrackingService);
            const isFirstMessage = !hasSeenUser(trackingUserId, context);
            return {
                isFirstMessage,
                consume: () => {
                    if (isFirstMessage) {
                        markMessageSeen(trackingUserId, context);
                    }
                }
            };
        }

        const isFirstMessage = this.isFirstMessage(normalizedData, platform, trackingUserId);
        return {
            isFirstMessage,
            consume: () => {}
        };
    }

    async processFarewell(platform: string, normalizedData: NormalizedChatData, farewellTrigger: string) {
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
                avatarUrl: normalizedData.avatarUrl,
                timestamp: normalizedData.timestamp
            });

            if (isRecord(result) && result.success === true) {
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

    checkGlobalCooldown(commandName: string, globalCooldownMs: number) {
        if (typeof this.runtime.commandCooldownService?.checkGlobalCooldown === 'function') {
            return this.runtime.commandCooldownService.checkGlobalCooldown(commandName, globalCooldownMs);
        }

        return !checkGlobalCommandCooldown(commandName, globalCooldownMs);
    }

    updateGlobalCooldown(commandName: string) {
        if (typeof this.runtime.commandCooldownService?.updateGlobalCooldown === 'function') {
            this.runtime.commandCooldownService.updateGlobalCooldown(commandName);
            return;
        }

        updateGlobalCommandCooldown(commandName);
    }

    async queueCommand(platform: string, normalizedData: NormalizedChatData, commandConfig: CommandConfig) {
        if (!this.runtime.displayQueue) {
            return;
        }

        const commandData = NotificationBuilder.build({
            type: 'command',
            platform,
            username: normalizedData.username,
            userId: normalizedData.userId,
            avatarUrl: normalizedData.avatarUrl,
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

    buildVFXConfig(commandConfig: CommandConfig) {
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

    shapeVfxConfig(vfxResult: unknown, errorPrefix: string) {
        if (!isRecord(vfxResult)) {
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

    resolveGreetingProfile(platform: string, identityValue: unknown) {
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

    async queueGreeting(platform: string, username: string | undefined, options: { userId?: unknown; avatarUrl?: unknown; priority?: number; greetingProfile?: GreetingProfile | null | undefined }) {
        const safeOptions = options || {};
        if (!this.runtime.displayQueue) {
            return;
        }

        const greetingData = NotificationBuilder.build({
            type: 'greeting',
            platform,
            username: username,
            userId: safeOptions.userId,
            avatarUrl: safeOptions.avatarUrl
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

    async resolveSecondaryGreetingVFX(greetingProfile: GreetingProfile | null | undefined) {
        if (!isRecord(greetingProfile)) {
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

    sanitizeChatContent(rawMessage: unknown) {
        const safeMessage = typeof rawMessage === 'string' ? rawMessage : '';
        const withoutZeroWidth = safeMessage.replace(/[\u200B-\u200D\uFEFF]/g, ' ');
        const messageWithSpacing = withoutZeroWidth.replace(/<[^>]+>/g, ' ');
        const sanitized = sanitizeForDisplay(messageWithSpacing, this.maxMessageLength);

        return {
            hasContent: sanitized.trim().length > 0,
            message: sanitized
        };
    }

    _formatChatMessage(platform: string, logSafeData: NormalizedChatData) {
        const message = this.getMessageText(logSafeData);
        const truncated = message.length > LOG_TRUNCATION_LENGTH ? message.substring(0, LOG_TRUNCATION_LENGTH - 3) + '...' : message;
        return `[${platform}] ${logSafeData.username}: ${truncated}`;
    }

    _logSkipped(platform: string, username: unknown, reason: string) {
        this.logger.debug(`[${platform}] Skipping ${username}: ${reason}`, 'chat-router');
    }

    _handleRouterError(message: string, error: unknown, eventType: string) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'chat-router', error);
        }
    }
}

export { ChatNotificationRouter };
