import type { AppLogger } from '../core/logger/types';
import { NotificationBuilder } from '../utils/notification-builder';
import { validateNormalizedMessage } from '../utils/message-normalization';
import { checkGlobalCommandCooldown, updateGlobalCommandCooldown } from '../utils/global-command-cooldown';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { sanitizeForDisplay } from '../utils/validation';
import { getValidMessageParts, normalizeBadgeImages } from '../utils/message-parts';
import { normalizeProfileIdentityKey } from '../utils/profile-identity-key-normalizer';
import type {
    DisplayQueueItem,
    DisplayQueueSequenceWriter,
    DisplayQueueVfxConfig
} from '../interfaces/DisplayQueue';
import type { MemberProfile } from '../core/types/config-types';

const LOG_TRUNCATION_LENGTH = 200;
type RouterRecord = Record<string, unknown>;

type LoggerLike = Pick<AppLogger, 'debug' | 'warn'> & Partial<Pick<AppLogger, 'error' | 'console'>>;

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
    greetings?: RouterRecord;
    profiles?: Record<string, ViewerProfile>;
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
    isStreamSupporter?: boolean;
    badgeImages?: unknown;
} & RouterRecord;

type CommandConfig = {
    command: string;
    filename?: unknown;
    mediaSource?: unknown;
    vfxFilePath?: unknown;
    commandKey?: unknown;
};

type ViewerProfile = MemberProfile & RouterRecord;

type FirstMessageState = {
    isFirstMessage: boolean;
    consume: () => void;
};

type ProcessCommandOptions = {
    firstMessageState?: FirstMessageState;
    greetingsEnabled?: boolean;
    greetingProfile?: ViewerProfile | null | undefined;
    sourceChatItem?: DisplayQueueItem | null;
};

type FarewellOutcome =
    | { status: 'not-handled' }
    | { status: 'handled-without-notification' }
    | { status: 'prepared'; item: DisplayQueueItem; cooldownKey: string };

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
    displayQueue?: DisplayQueueSequenceWriter;
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
    prepareFarewellNotification?: (platform: string, username: string | undefined, data: RouterRecord) => Promise<unknown> | unknown;
};

type RouterDependencies = {
    runtime: RuntimeLike;
    logger: LoggerLike;
    config: RouterConfig;
    publishChatMessage?: (platform: string, payload: Record<string, unknown>) => void;
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

function isDisplayQueueItem(value: unknown): value is DisplayQueueItem {
    return isRecord(value) &&
        typeof value.type === 'string' &&
        typeof value.platform === 'string' &&
        isRecord(value.data);
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
    publishChatMessage?: RouterDependencies['publishChatMessage'];

    constructor({ runtime, logger, config, publishChatMessage }: RouterDependencies) {
        this.runtime = runtime;
        this.logger = logger;
        if (!config) {
            throw new Error('ChatNotificationRouter requires config');
        }
        this.maxMessageLength = config.general.maxMessageLength;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'chat-router');
        this.publishChatMessage = publishChatMessage;
    }

    async handleChatMessage(platform: string, normalizedData: NormalizedChatData) {
        const safeNormalizedData: NormalizedChatData = normalizedData || {};
        let sourceChatItem: DisplayQueueItem | null = null;
        let displayCommitted = false;
        try {
            const messageText = this.getMessageText(safeNormalizedData);

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
                this._logSkipped(platform, safeNormalizedData.username, 'message sent before connection');
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
            this.publishChatMessage?.(platform, safeNormalizedData);

            if (this.runtime.config.general.logChatMessages && typeof this.logger.console === 'function') {
                const logSafeData = { ...safeNormalizedData, message: sanitizedMessage.message };
                this.logger.console(this._formatChatMessage(platform, logSafeData), 'chat-router');
            }

            const greetingIdentity = platform === 'tiktok'
                ? safeNormalizedData.userId
                : safeNormalizedData.username;
            const greetingProfile = this.resolveProfile(platform, greetingIdentity);
            const firstMessageTrackingId = greetingProfile
                ? `viewer-profile:${greetingProfile.id}`
                : safeNormalizedData.userId;
            const firstMessageState = this.getFirstMessageState(safeNormalizedData, platform, firstMessageTrackingId);
            const greetingsEnabled = this.isGreetingEnabled(platform);

            if (chatEnabled) {
                sourceChatItem = this.buildChatMessageItem(platform, safeNormalizedData, sanitizedMessage.message, messageParts, greetingProfile);
            }

            const farewellTrigger = this.detectFarewell(sanitizedMessage.message);
            if (farewellTrigger) {
                const farewellOutcome = await this.prepareFarewell(platform, safeNormalizedData, farewellTrigger);
                if (farewellOutcome.status === 'prepared') {
                    const farewellAllowed = this.checkGlobalCooldown(farewellOutcome.cooldownKey, this.getFarewellCooldownMs());
                    const admitted = this.enqueueDisplayItems([
                        ...(sourceChatItem ? [sourceChatItem] : []),
                        ...(farewellAllowed ? [farewellOutcome.item] : [])
                    ]);
                    displayCommitted = admitted.length > 0;
                    if (admitted.includes(farewellOutcome.item)) {
                        this.updateGlobalCooldown(farewellOutcome.cooldownKey);
                    }
                    return;
                }
                if (farewellOutcome.status === 'handled-without-notification') {
                    displayCommitted = this.enqueueDisplayItems(sourceChatItem ? [sourceChatItem] : []).length > 0;
                    return;
                }
            }

            const commandConfig = await this.detectCommand(sanitizedMessage.message);
            if (commandConfig) {
                const admitted = await this.processCommand(platform, safeNormalizedData, commandConfig, {
                    firstMessageState,
                    greetingsEnabled,
                    greetingProfile,
                    sourceChatItem
                });
                displayCommitted = admitted.length > 0;
                return;
            }

            if (firstMessageState.isFirstMessage && greetingsEnabled) {
                const greetingItem = await this.buildGreetingItem(platform, safeNormalizedData.username, {
                    userId,
                    avatarUrl: safeNormalizedData.avatarUrl,
                    greetingProfile
                });
                const admitted = this.enqueueDisplayItems([
                    ...(sourceChatItem ? [sourceChatItem] : []),
                    ...(firstMessageState.isFirstMessage ? [greetingItem] : [])
                ]);
                displayCommitted = admitted.length > 0;
                if (admitted.includes(greetingItem)) {
                    firstMessageState.consume();
                }
                return;
            }

            displayCommitted = this.enqueueDisplayItems(sourceChatItem ? [sourceChatItem] : []).length > 0;
        } catch (error) {
            const errorDetails = getErrorMessage(error);
            this._handleRouterError(`Error routing chat message: ${errorDetails}`, error, 'chat-routing');
            if (!displayCommitted && sourceChatItem) {
                try {
                    displayCommitted = this.enqueueDisplayItems([sourceChatItem]).length > 0;
                } catch (fallbackError) {
                    this._handleRouterError(
                        `Error queueing chat fallback: ${getErrorMessage(fallbackError)}`,
                        fallbackError,
                        'chat-fallback'
                    );
                }
            }
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

        this.runtime.displayQueue.addItem(
            this.buildChatMessageItem(platform, normalizedData, sanitizedMessage, messageParts)
        );
    }

    buildChatMessageItem(platform: string, normalizedData: NormalizedChatData, sanitizedMessage: string, messageParts: Array<Record<string, unknown>> = [], greetingProfile?: ViewerProfile | null): DisplayQueueItem {

        const baseChatData = {
            type: 'chat',
            platform,
            username: normalizedData.username,
            userId: normalizedData.userId,
            avatarUrl: normalizedData.avatarUrl,
            timestamp: normalizedData.timestamp,
            message: sanitizedMessage,
            isPaypiggy: normalizedData.isPaypiggy === true,
            isStreamSupporter: normalizedData.isStreamSupporter === true
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
        if (normalizedData.isPaypiggy === true && greetingProfile) {
            const presentationOverride: Record<string, unknown> = {};
            if (greetingProfile.rowTheme) presentationOverride.theme = greetingProfile.rowTheme;
            if (greetingProfile.rowEffects) presentationOverride.effects = greetingProfile.rowEffects;
            if (typeof greetingProfile.spriteUrl === 'string') presentationOverride.spriteUrl = greetingProfile.spriteUrl;
            if (Object.keys(presentationOverride).length > 0) chatData.presentationOverride = presentationOverride;
        }

        return {
            type: 'chat',
            data: chatData,
            platform
        };
    }

    async processCommand(platform: string, normalizedData: NormalizedChatData, commandConfig: CommandConfig, options: ProcessCommandOptions): Promise<readonly DisplayQueueItem[]> {
        const { firstMessageState, greetingsEnabled, greetingProfile, sourceChatItem } = options || {};
        const sourceItems = sourceChatItem ? [sourceChatItem] : [];
        const commandCooldownService = this.runtime.commandCooldownService;
        if (!commandCooldownService) {
            this.logger.warn('CommandCooldownService not available; cannot process command', 'chat-router');
            return this.enqueueDisplayItems(sourceItems);
        }
        const commandAllowed = () => {
            const { perUserCooldown, heavyCooldown, globalCooldown } = this.getCooldownSettings();
            if (!commandCooldownService.checkUserCooldown(normalizedData.userId, perUserCooldown, heavyCooldown)) {

                return false;
            }
            if (!this.checkGlobalCooldown(commandConfig.command, globalCooldown)) {

                return false;
            }
            return true;
        };
        if (!commandAllowed()) return this.enqueueDisplayItems(sourceItems);

        const greetingItem = firstMessageState?.isFirstMessage && greetingsEnabled
            ? await this.buildGreetingItem(platform, normalizedData.username, {
                userId: normalizedData.userId, avatarUrl: normalizedData.avatarUrl, greetingProfile
            }) : null;
        const commandItem = this.buildCommandItem(platform, normalizedData, commandConfig);

        // Preparation can yield; eligibility, admission and state commits must not.
        if (!commandAllowed()) return this.enqueueDisplayItems(sourceItems);
        const isFirstMessage = firstMessageState?.isFirstMessage === true;
        const eligibleGreeting = isFirstMessage ? greetingItem : null;
        const admitted = this.enqueueDisplayItems([
            ...sourceItems, ...(eligibleGreeting ? [eligibleGreeting] : []), commandItem
        ]);
        const commandAdmitted = admitted.includes(commandItem);
        if (isFirstMessage && (commandAdmitted || (eligibleGreeting && admitted.includes(eligibleGreeting)))) {
            this.runCommandStateUpdate(() => firstMessageState?.consume(), 'first-message state');
        }
        if (commandAdmitted) {
            this.runCommandStateUpdate(() => commandCooldownService.updateUserCooldown(normalizedData.userId), 'user cooldown');
            this.runCommandStateUpdate(() => this.updateGlobalCooldown(commandConfig.command), 'global cooldown');
        }
        return admitted;
    }

    runCommandStateUpdate(update: () => void, description: string) {
        try {
            update();
        } catch (error) {
            this._handleRouterError(
                `Command ${description} update failed after display admission: ${getErrorMessage(error)}`,
                error,
                'command-state-update'
            );
        }
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
            return {
                get isFirstMessage() { return !hasSeenUser(trackingUserId, context); },
                consume: () => markMessageSeen(trackingUserId, context)
            };
        }

        const isFirstMessage = this.isFirstMessage(normalizedData, platform, trackingUserId);
        return {
            isFirstMessage,
            consume: () => {}
        };
    }

    async prepareFarewell(platform: string, normalizedData: NormalizedChatData, farewellTrigger: string): Promise<FarewellOutcome> {
        if (!this.isFarewellEnabled(platform)) {
            this._logSkipped(platform, normalizedData.username, 'farewells disabled');
            return { status: 'not-handled' };
        }

        if (typeof this.runtime.prepareFarewellNotification !== 'function') {
            throw new Error('Runtime missing prepareFarewellNotification');
        }

        const farewellCooldownMs = this.getFarewellCooldownMs();
        const farewellCooldownKey = `farewell:${platform}`;
        const globalAllowed = this.checkGlobalCooldown(farewellCooldownKey, farewellCooldownMs);
        if (!globalAllowed) {
            this._logSkipped(platform, normalizedData.username, 'farewell timeout active');
            return { status: 'handled-without-notification' };
        }

        try {
            const result = await this.runtime.prepareFarewellNotification(platform, normalizedData.username, {
                command: farewellTrigger,
                trigger: farewellTrigger,
                userId: normalizedData.userId,
                avatarUrl: normalizedData.avatarUrl,
                timestamp: normalizedData.timestamp
            });

            if (isRecord(result) && result.success === true && isDisplayQueueItem(result.item)) {
                return {
                    status: 'prepared',
                    item: result.item,
                    cooldownKey: farewellCooldownKey
                };
            }

            this._logSkipped(platform, normalizedData.username, 'farewell notification not prepared');
            return { status: 'not-handled' };
        } catch (error) {
            this._handleRouterError(`Error preparing farewell notification: ${getErrorMessage(error)}`, error, 'farewell-routing');
            return { status: 'not-handled' };
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

        this.runtime.displayQueue.addItem(this.buildCommandItem(platform, normalizedData, commandConfig));
    }

    buildCommandItem(platform: string, normalizedData: NormalizedChatData, commandConfig: CommandConfig): DisplayQueueItem {

        const commandData = NotificationBuilder.build({
            type: 'command',
            platform,
            username: normalizedData.username,
            userId: normalizedData.userId,
            avatarUrl: normalizedData.avatarUrl,
            command: commandConfig.command.startsWith('!') ? commandConfig.command : `!${commandConfig.command}`,
            commandName: commandConfig.command.replace(/^!/, '')
        });
        if (!isRecord(commandData)) {
            throw new Error('Command notification build failed');
        }

        return {
            type: 'command',
            data: commandData,
            vfxConfig: this.buildVFXConfig(commandConfig),
            platform
        };
    }

    buildVFXConfig(commandConfig: CommandConfig): DisplayQueueVfxConfig {
        const safeCommandConfig = commandConfig || {};
        return {
            ...(typeof safeCommandConfig.filename === 'string' ? { filename: safeCommandConfig.filename } : {}),
            ...(typeof safeCommandConfig.mediaSource === 'string' ? { mediaSource: safeCommandConfig.mediaSource } : {}),
            ...(typeof safeCommandConfig.vfxFilePath === 'string' ? { vfxFilePath: safeCommandConfig.vfxFilePath } : {}),
            ...(typeof safeCommandConfig.commandKey === 'string' ? { commandKey: safeCommandConfig.commandKey } : {}),
            command: safeCommandConfig.command,
            triggerWord: safeCommandConfig.command
        };
    }

    shapeVfxConfig(vfxResult: unknown, errorPrefix: string) {
        if (!isRecord(vfxResult)) {
            return null;
        }

        if (typeof vfxResult.commandKey !== 'string' ||
            typeof vfxResult.filename !== 'string' ||
            typeof vfxResult.mediaSource !== 'string' ||
            typeof vfxResult.vfxFilePath !== 'string' ||
            typeof vfxResult.command !== 'string' ||
            typeof vfxResult.duration !== 'number' ||
            !Number.isFinite(vfxResult.duration)) {
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

    resolveProfile(platform: string, identityValue: unknown): ViewerProfile | null {
        const profiles = this.runtime?.config?.profiles;
        if (!profiles || typeof profiles !== 'object') {
            return null;
        }

        const identityKey = normalizeProfileIdentityKey(platform, identityValue);
        if (!identityKey) {
            return null;
        }

        return Object.values(profiles).find((profile) => profile.identities.includes(identityKey)) ?? null;
    }

    async queueGreeting(platform: string, username: string | undefined, options: { userId?: unknown; avatarUrl?: unknown; priority?: number; greetingProfile?: ViewerProfile | null | undefined }) {
        const safeOptions = options || {};
        if (!this.runtime.displayQueue) {
            return;
        }

        this.runtime.displayQueue.addItem(await this.buildGreetingItem(platform, username, safeOptions));
    }

    async buildGreetingItem(platform: string, username: string | undefined, options: { userId?: unknown; avatarUrl?: unknown; priority?: number; greetingProfile?: ViewerProfile | null | undefined }): Promise<DisplayQueueItem> {
        const safeOptions = options || {};

        const greetingData = NotificationBuilder.build({
            type: 'greeting',
            platform,
            username: username,
            userId: safeOptions.userId,
            avatarUrl: safeOptions.avatarUrl
        });
        if (!isRecord(greetingData)) {
            throw new Error('Greeting notification build failed');
        }

        const queueItem: DisplayQueueItem = {
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

        return queueItem;
    }

    enqueueDisplayItems(items: DisplayQueueItem[]): readonly DisplayQueueItem[] {
        if (!this.runtime.displayQueue || items.length === 0) return [];
        const item = items[0];
        if (items.length === 1 && item) return this.runtime.displayQueue.addItem(item);
        return this.runtime.displayQueue.addSequence(items);
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

    async resolveSecondaryGreetingVFX(greetingProfile: ViewerProfile | null | undefined) {
        if (!isRecord(greetingProfile)) {
            return null;
        }
        if (typeof greetingProfile.greetingCommand !== 'string' || greetingProfile.greetingCommand.trim().length === 0) {
            return null;
        }
        if (!this.runtime.vfxCommandService?.selectVFXCommand) {
            return null;
        }

        const trigger = greetingProfile.greetingCommand.trim();
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
