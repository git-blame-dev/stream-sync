import { logger } from '../core/logging';
import { PRIORITY_LEVELS, NOTIFICATION_CONFIGS } from '../core/constants';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import MessageTTSHandler from '../utils/message-tts-handler';
import { safeSetTimeout, safeDelay } from '../utils/timeout-validator';
import { validateDisplayConfig } from './display-config-validator';
import { DisplayQueueState } from './display-queue-state';
import { DisplayQueueEffects } from './display-queue-effects';
import { DisplayRenderer } from './display-renderer';
import { getDefaultGoalsManager } from './goals';
import { getDefaultSourcesManager } from './sources';

type QueueMessagePart = {
    text?: unknown;
};

type QueueMessage = {
    text?: unknown;
    parts?: QueueMessagePart[];
};

type QueueItemData = Record<string, unknown> & {
    username?: string;
    userId?: string;
    message?: unknown;
    timestamp?: unknown;
    displayMessage?: unknown;
    amount?: unknown;
    currency?: unknown;
    giftType?: unknown;
    giftCount?: unknown;
    repeatCount?: unknown;
    tier?: unknown;
    months?: unknown;
    isError?: boolean;
};

type QueueItem = {
    type: string;
    platform: string;
    data: QueueItemData;
    priority?: number;
    holdDurationMs?: number;
    [key: string]: unknown;
};

type DisplayQueueConfig = {
    autoProcess?: boolean;
    maxQueueSize?: number;
    ttsEnabled?: boolean;
    timing?: {
        transitionDelay?: number;
        notificationClearDelay?: number;
    };
    chat?: {
        sourceName?: string;
        sceneName?: string;
        groupName?: string;
        platformLogos?: Record<string, unknown>;
    };
    notification?: {
        sourceName?: string;
        sceneName?: string;
        groupName?: string;
        platformLogos?: Record<string, unknown>;
    };
    [platform: string]: unknown;
};

type DisplayQueueConstants = {
    PRIORITY_LEVELS?: Record<string, number>;
    [key: string]: unknown;
};

type DisplayQueueEventBus = {
    emit?: (eventName: string, payload: Record<string, unknown>) => void;
} | null;

type DisplayQueueDependencies = {
    sourcesManager?: ReturnType<typeof getDefaultSourcesManager>;
    goalsManager?: ReturnType<typeof getDefaultGoalsManager>;
    delay?: (ms: number) => Promise<void>;
    giftAnimationResolver?: {
        resolveFromNotificationData: (data: unknown) => Promise<{
            durationMs: number;
            mediaFilePath: string;
            mediaContentType: string;
            animationConfig: Record<string, unknown>;
        } | null>;
    };
};

type DisplayQueueObsManager = {
    isReady: () => Promise<boolean>;
    call: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
};

let notificationTypeSet: Set<string> | null = null;
const CHAT_TYPE = 'chat';

function isNotificationType(type: string) {
    if (typeof type !== 'string') {
        return false;
    }
    
    if (!notificationTypeSet) {
        notificationTypeSet = new Set(Object.keys(NOTIFICATION_CONFIGS));
    }
    
    return notificationTypeSet.has(type);
}

function isChatType(type: string) {
    return type === CHAT_TYPE;
}

function resolveChatMessageText(message: unknown) {
    if (typeof message === 'string') {
        return message;
    }

    if (message && typeof message === 'object') {
        const messageObject = message as QueueMessage;
        if (typeof messageObject.text === 'string') {
            return messageObject.text;
        }

        if (Array.isArray(messageObject.parts)) {
            return messageObject.parts
                .map((part) => (part && typeof part === 'object' && typeof part.text === 'string' ? part.text : ''))
                .join('');
        }
    }

    return '';
}

let displayQueueErrorHandler = logger ? createPlatformErrorHandler(logger, 'display-queue') : null;

function handleDisplayQueueError(message: string, error: unknown = null, payload: Record<string, unknown> | null = null) {
    if (!displayQueueErrorHandler && logger) {
        displayQueueErrorHandler = createPlatformErrorHandler(logger, 'display-queue');
    }

    if (displayQueueErrorHandler && error instanceof Error) {
        displayQueueErrorHandler.handleEventProcessingError(error, 'display-queue', payload, message, 'display-queue');
        return;
    }

    if (displayQueueErrorHandler) {
        displayQueueErrorHandler.logOperationalError(message, 'display-queue', payload);
    }
}

function defaultDelay(ms: number) {
    const numMs = Number(ms);
    return safeDelay(numMs, Number.isFinite(numMs) ? numMs : 5000, 'DisplayQueue delay');
}

class DisplayQueue {
    queue: QueueItem[];
    isProcessing: boolean;
    isRetryScheduled: boolean;
    currentDisplay: QueueItem | null;
    obsManager: DisplayQueueObsManager;
    constants: DisplayQueueConstants;
    sourcesManager: ReturnType<typeof getDefaultSourcesManager>;
    goalsManager: ReturnType<typeof getDefaultGoalsManager>;
    eventBus: DisplayQueueEventBus;
    delay: (ms: number) => Promise<void>;
    config: DisplayQueueConfig;
    state: DisplayQueueState;
    renderer: DisplayRenderer;
    effects: DisplayQueueEffects;

    constructor(
        obsManager: DisplayQueueObsManager,
        config: DisplayQueueConfig = {},
        constants: DisplayQueueConstants = {},
        eventBus: DisplayQueueEventBus = null,
        dependencies: DisplayQueueDependencies = {}
    ) {
        if (!obsManager) {
            throw new Error('DisplayQueue requires OBSConnectionManager instance');
        }
        try {
            this.queue = [];
            this.isProcessing = false;
            this.isRetryScheduled = false;
            this.currentDisplay = null;
            this.obsManager = obsManager;
            this.constants = constants;
            this.sourcesManager = dependencies.sourcesManager || getDefaultSourcesManager();
            this.goalsManager = dependencies.goalsManager || getDefaultGoalsManager();
            this.eventBus = eventBus;
            this.delay = dependencies.delay || defaultDelay;

            this.config = config;

            this.state = new DisplayQueueState({
                maxQueueSize: this.config.maxQueueSize,
                getPriority: (type) => this.getTypePriority(type)
            });
            this.queue = this.state.queue as QueueItem[];

            this.renderer = new DisplayRenderer({
                obsManager: this.obsManager,
                sourcesManager: this.sourcesManager as ConstructorParameters<typeof DisplayRenderer>[0]['sourcesManager'],
                config: this.config as ConstructorParameters<typeof DisplayRenderer>[0]['config'],
                delay: this.delay,
                handleDisplayQueueError,
                extractUsername: (data) => this.extractUsername(data) || '',
                validateDisplayConfig,
                isNotificationType,
                isChatType
            });

            this.effects = new DisplayQueueEffects({
                obsManager: this.obsManager,
                sourcesManager: this.sourcesManager as ConstructorParameters<typeof DisplayQueueEffects>[0]['sourcesManager'],
                goalsManager: this.goalsManager as ConstructorParameters<typeof DisplayQueueEffects>[0]['goalsManager'],
                eventBus: this.eventBus as ConstructorParameters<typeof DisplayQueueEffects>[0]['eventBus'],
                config: this.config as ConstructorParameters<typeof DisplayQueueEffects>[0]['config'],
                delay: this.delay,
                handleDisplayQueueError,
                extractUsername: (data) => this.extractUsername(data),
                giftAnimationResolver: dependencies.giftAnimationResolver
            });
        } catch (error) {
            handleDisplayQueueError('[DisplayQueue] Error during construction', error);
            throw error;
        }
    }

    get lastChatItem(): QueueItem | null {
        return this.state ? this.state.lastChatItem as QueueItem | null : null;
    }

    set lastChatItem(value: QueueItem | null) {
        if (this.state) {
            this.state.lastChatItem = value;
        }
    }
    
    isTTSEnabled() {
        return this.effects.isTTSEnabled();
    }

    async setTTSText(text: string) {
        await this.effects.setTTSText(text);
    }

    getTypePriority(type: string) {
        if (!this.constants || !this.constants.PRIORITY_LEVELS) {
            logger.warn('[Display Queue] PRIORITY_LEVELS not available, using default priority');
            return PRIORITY_LEVELS.CHAT;
        }

        const priorityLevels = this.constants.PRIORITY_LEVELS;
        const typeToPriorityMap = {
            'platform:paypiggy': priorityLevels.PAYPIGGY,
            'platform:gift': priorityLevels.GIFT,
            'platform:follow': priorityLevels.FOLLOW,
            'greeting': priorityLevels.GREETING,
            'farewell': priorityLevels.FAREWELL,
            'platform:raid': priorityLevels.RAID,
            'platform:share': priorityLevels.SHARE,
            'platform:envelope': priorityLevels.ENVELOPE,
            'platform:giftpaypiggy': priorityLevels.GIFTPAYPIGGY,
            'chat': priorityLevels.CHAT,
            'command': priorityLevels.COMMAND
        };

        return typeToPriorityMap[type as keyof typeof typeToPriorityMap] || priorityLevels.CHAT;
    }
    
    addItem(item: QueueItem) {
        const { insertIndex, removedChatCount } = this.state.addItem(item);
        if (removedChatCount > 0) {
            logger.debug(`[Display Queue] Removing ${removedChatCount} stale chat messages to show latest`, 'display-queue');
        }
        logger.debug(`[Display Queue] Added ${item.type} (priority ${item.priority}) at position ${insertIndex}. Queue length: ${this.queue.length}`, 'display-queue');
        
        if (!this.isProcessing && !this.isRetryScheduled && this.config.autoProcess) {
            this.processQueue();
        }
    }

    emitDisplayRow(item: QueueItem) {
        if (!this.eventBus || typeof this.eventBus.emit !== 'function') {
            return;
        }

        this.eventBus.emit('display:row', {
            type: item?.type,
            platform: item?.platform,
            data: item?.data,
            timestamp: item?.data?.timestamp || null
        });
    }
    
    async processChatMessage(chatItem: QueueItem) {
        if (!chatItem || chatItem.type !== 'chat') {
            throw new Error('Invalid chat item: must be type "chat"');
        }

        this.addItem(chatItem);

        if (!this.isProcessing && !this.isRetryScheduled && this.config.autoProcess) {
            await this.processQueue();
        }
    }
    
    async processQueue() {
        if (this.isProcessing || this.isRetryScheduled || !this.obsManager) return;

        const transitionDelay = this.config.timing?.transitionDelay ?? 0;

        this.isRetryScheduled = true;

        try {
            if (!await this.obsManager.isReady()) {
                logger.debug('[DisplayQueue] OBS not ready, pausing queue processing', 'display-queue');

                if (this.queue.length > 0) {
                    safeSetTimeout(() => {
                        this.isRetryScheduled = false;
                        this.processQueue();
                    }, 1000);
                } else {
                    this.isRetryScheduled = false;
                }
                return;
            }
        } catch (error) {
            this.isRetryScheduled = false;
            handleDisplayQueueError('[Display Queue] Failed readiness check during processing', error);
            return;
        }
        
        this.isProcessing = true;
        this.isRetryScheduled = false;
        logger.debug('[Display Queue] Starting queue processing', 'display-queue');
        
        try {
            while (this.queue.length > 0) {
                const item = this.state.shift() as QueueItem | undefined;
                if (!item) {
                    continue;
                }
                this.currentDisplay = item;
                logger.debug(`[Display Queue] Processing ${item.type} item. Remaining: ${this.queue.length}`, 'display-queue');
                
                try {
                    const displayed = await this.displayItem(item);
                    const isNotification = isNotificationType(item.type);
                    const isDisplayedNotification = isNotification && displayed !== false;

                    if (isNotification) {
                        if (!isDisplayedNotification) {
                            logger.debug(`[Display Queue] Notification ${item.type} was not displayed; skipping wait/hide/transition`, 'display-queue');
                            this.currentDisplay = null;
                            continue;
                        }

                        await this.delay(this.getDuration(item));
                        await this.hideCurrentDisplay(item);
                        await this.delay(transitionDelay);
                        this.currentDisplay = null;
                        continue;
                    }

                    await this.delay(this.getDuration(item));

                    if (isChatType(item.type)) {
                        if (this.queue.length > 0 || !this.lastChatItem) {
                            await this.hideCurrentDisplay(item);
                        }
                    }

                    await this.delay(transitionDelay);
                    this.currentDisplay = null;

                } catch (err) {
                    handleDisplayQueueError(`[Display Queue] Error processing ${item.type}`, err, { itemType: item.type });
                    if (this.currentDisplay) {
                        await this.hideCurrentDisplay(this.currentDisplay);
                    }
                }
            }
            
            if (this.lastChatItem) {
                logger.debug('[Display Queue] Queue empty, showing lingering chat.', 'display-queue');
                await this.displayLingeringChat();
                this.currentDisplay = { type: 'chat', platform: this.lastChatItem.platform, data: this.lastChatItem.data };
            }
        } finally {
            this.isProcessing = false;
            logger.debug('[Display Queue] Queue processing complete', 'display-queue');

            if (this.config.autoProcess && !this.isRetryScheduled && this.queue.length > 0) {
                logger.debug('[Display Queue] New items queued during teardown, restarting processing', 'display-queue');
                void this.processQueue();
            }
        }
    }
    
    async displayItem(item: QueueItem) {
        switch (item.type) {
            case 'chat':
                return await this.displayChatItem(item);
            default:
                return await this.displayNotificationItem(item);
        }
    }
    
    async displayChatItem(item: QueueItem) {
        const displayed = await this.renderer.displayChatItem(item);
        if (displayed === false) {
            return false;
        }
        this.emitDisplayRow(item);
        return true;
    }

    async displayNotificationItem(item: QueueItem) {
        const displayed = await this.renderer.displayNotificationItem(item);
        if (displayed === false) {
            return false;
        }

        this.emitDisplayRow(item);
        await this.handleNotificationEffects(item);
        return true;
    }

    async handleNotificationEffects(item: QueueItem) {
        return this.effects.handleNotificationEffects(item);
    }

    buildVfxMatch(config: Record<string, unknown>) {
        return this.effects.buildVfxMatch(config);
    }

    async waitForVfxCompletion(match = {}, options = {}) {
        return this.effects.waitForVfxCompletion(match, options);
    }
    
    async emitVfxFromConfig(item: QueueItem, username: string | null) {
        return this.effects.emitVfxFromConfig(item, username);
    }

    async handleGiftEffects(item: QueueItem, ttsStages: Array<{ text: string; delay: number; type?: string }>) {
        return this.effects.handleGiftEffects(item, ttsStages);
    }
    
    async handleSequentialEffects(item: QueueItem, ttsStages: Array<{ text: string; delay: number; type?: string }>) {
        return this.effects.handleSequentialEffects(item, ttsStages);
    }

    async playGiftVideoAndAudio() {
        return this.effects.playGiftVideoAndAudio();
    }
    
    async displayLingeringChat() {
        return this.renderer.displayLingeringChat(this.lastChatItem);
    }
    
    async hideCurrentDisplay(item: QueueItem | null) {
        return this.renderer.hideCurrentDisplay(item);
    }
    
    getQueueLength() {
        return this.queue.length;
    }

    clearQueue() {
        if (this.state) {
            this.state.clear();
        } else {
            this.queue = [];
        }
        this.isRetryScheduled = false;
        this.isProcessing = false;
        this.currentDisplay = null;
        logger.debug('[Display Queue] Queue cleared', 'display-queue');
    }
    
    async stop() {
        this.isProcessing = false;
        this.isRetryScheduled = false;
        if (this.currentDisplay) {
            await this.hideCurrentDisplay(this.currentDisplay);
        }
        this.clearQueue();
        logger.info('[Display Queue] Processing stopped and queue cleared.');
    }

    getDuration(item: QueueItem) {
        const holdDurationMs = Number(item?.holdDurationMs);
        const normalizedHoldDurationMs = Number.isFinite(holdDurationMs) && holdDurationMs > 0
            ? holdDurationMs
            : 0;

        if (!this.config?.ttsEnabled) {
            return normalizedHoldDurationMs;
        }

        if (!item?.data) {
            return normalizedHoldDurationMs;
        }

        let ttsStages;
        try {
            ttsStages = MessageTTSHandler.createTTSStages(item.data) || [];
        } catch {
            return normalizedHoldDurationMs;
        }
        if (ttsStages.length === 0) {
            return normalizedHoldDurationMs;
        }

        const estimateSpeechMs = (text: unknown) => {
            if (!text || typeof text !== 'string') return 0;
            const words = text.trim().split(/\s+/).filter(Boolean).length;
            return 400 + (words * 170);
        };

        let maxStageMs = 0;
        for (const stage of ttsStages) {
            const stageDelay = Number(stage?.delay) || 0;
            const stageMs = stageDelay + estimateSpeechMs(stage?.text);
            if (stageMs > maxStageMs) {
                maxStageMs = stageMs;
            }
        }

        const tailBufferMs = 1000;
        const minWindow = 2000;
        const maxWindow = 20000;

        const ttsWindowMs = Math.min(maxWindow, Math.max(minWindow, maxStageMs + tailBufferMs));
        return Math.max(ttsWindowMs, normalizedHoldDurationMs);
    }

    extractUsername(data: unknown): string | null {
        if (!data || typeof data !== 'object') {
            logger.warn('[DisplayQueue] extractUsername: Invalid data object; missing username field.', 'display-queue', {
                callerMethod: 'extractUsername',
                inputType: typeof data
            });
            return null;
        }

        const dataRecord = data as QueueItemData;
        const username = dataRecord.username;
        if (dataRecord.isError === true && (typeof username !== 'string' || !username.trim())) {
            return null;
        }
        if (typeof username !== 'string' || !username.trim()) {
            logger.warn('[DisplayQueue] extractUsername: Missing username field in notification data.', 'display-queue', {
                callerMethod: 'extractUsername',
                dataKeys: Object.keys(dataRecord)
            });
            return null;
        }

        return username.trim();
    }

    isItemDisplayedToUser(type: string) {
        try {
            if (isChatType(type)) {
                const isChatCurrentlyDisplayed = this.currentDisplay && isChatType(this.currentDisplay.type);
                const hasLingeringChat = !this.currentDisplay && this.queue.length === 0 && !!this.lastChatItem;
                const isChatDisplayed = isChatCurrentlyDisplayed || hasLingeringChat;
                
                logger.debug(`[DisplayQueue] Chat display check: ${isChatDisplayed} (current: ${this.currentDisplay?.type || 'none'}, hasLingering: ${hasLingeringChat})`, 'display-queue');
                return isChatDisplayed;
            }

            if (!this.currentDisplay) {
                logger.debug(`[DisplayQueue] No current display - ${type} not visible to user`, 'display-queue');
                return false;
            }

            if (isNotificationType(type)) {
                const isNotificationDisplayed = this.currentDisplay.type === type;
                logger.debug(`[DisplayQueue] Notification display check: ${isNotificationDisplayed} (current: ${this.currentDisplay.type})`, 'display-queue');
                return isNotificationDisplayed;
            }

            const isExactMatch = this.currentDisplay.type === type;
            logger.debug(`[DisplayQueue] Exact type display check: ${isExactMatch} (current: ${this.currentDisplay.type}, requested: ${type})`, 'display-queue');
            return isExactMatch;

        } catch (error) {
            handleDisplayQueueError(`[DisplayQueue] Error checking if ${type} is displayed to user`, error, { type });
            return false;
        }
    }

    getCurrentDisplayContent() {
        try {
            if (!this.currentDisplay) {
                if (this.queue.length === 0 && this.lastChatItem) {
                    return this._formatLingeringChatContent();
                }
                
                logger.debug('[DisplayQueue] No current display content - nothing visible to user', 'display-queue');
                return null;
            }

            if (isChatType(this.currentDisplay.type)) {
                return this._formatChatContent(this.currentDisplay);
            }

            if (isNotificationType(this.currentDisplay.type)) {
                return this._formatNotificationContent(this.currentDisplay);
            }

            return this._formatGenericContent(this.currentDisplay);

        } catch (error) {
            handleDisplayQueueError('[DisplayQueue] Error getting current display content', error);
            return null;
        }
    }

    _formatLingeringChatContent() {
        if (!this.lastChatItem) return null;

        const username = this.extractUsername(this.lastChatItem.data);
        const messageText = resolveChatMessageText(this.lastChatItem.data.message);
        const content = `${username}: ${messageText}`;

        return {
            type: 'chat',
            content: content,
            username: username,
            platform: this.lastChatItem.platform || 'unknown',
            timestamp: this.lastChatItem.data.timestamp || null,
            isTechnicalArtifactFree: this._isContentClean(content),
            isLingering: true
        };
    }

    _formatChatContent(displayItem: QueueItem) {
        const username = this.extractUsername(displayItem.data);
        const messageText = resolveChatMessageText(displayItem.data.message);
        const content = `${username}: ${messageText}`;

        return {
            type: 'chat',
            content: content,
            username: username,
            platform: displayItem.platform || 'unknown',
            timestamp: displayItem.data.timestamp || null,
            isTechnicalArtifactFree: this._isContentClean(content),
            isLingering: false
        };
    }

    _formatNotificationContent(displayItem: QueueItem) {
        const username = this.extractUsername(displayItem.data);
        const content = displayItem.data.displayMessage || `${username} ${displayItem.type}`;

        return {
            type: displayItem.type,
            content: content,
            username: username,
            platform: displayItem.platform || 'unknown',
            isTechnicalArtifactFree: this._isContentClean(content),
            notificationDetails: this._extractNotificationDetails(displayItem.data)
        };
    }

    _formatGenericContent(displayItem: QueueItem) {
        const username = this.extractUsername(displayItem.data);
        const content = displayItem.data.displayMessage || 
                       displayItem.data.message || 
                       `${username} ${displayItem.type}`;

        return {
            type: displayItem.type,
            content: content,
            username: username,
            platform: displayItem.platform || 'unknown',
            isTechnicalArtifactFree: this._isContentClean(content)
        };
    }

    _isContentClean(content: unknown) {
        if (!content || typeof content !== 'string') return false;

        const technicalArtifacts = [
            'undefined',
            'null',
            '[object Object]',
            'NaN',
            'function',
            '{}',
            '[]',
            'Error:',
            'Exception:',
            'TypeError:',
            'ReferenceError:'
        ];

        const lowerContent = content.toLowerCase();
        return !technicalArtifacts.some(artifact => lowerContent.includes(artifact.toLowerCase()));
    }

    _extractNotificationDetails(data: QueueItemData) {
        const details: Record<string, unknown> = {};

        if (data.amount !== undefined) details.amount = data.amount;
        if (data.currency) details.currency = data.currency;
        if (data.giftType) details.giftType = data.giftType;
        if (data.giftCount) details.giftCount = data.giftCount;
        if (data.repeatCount) details.repeatCount = data.repeatCount;
        if (data.tier) details.tier = data.tier;
        if (data.months) details.months = data.months;

        return details;
    }

}

let displayQueueInstance: DisplayQueue | null = null;

function createDisplayQueue(
    obsManager: DisplayQueueObsManager,
    config: DisplayQueueConfig = {},
    constants: DisplayQueueConstants = {},
    eventBus: DisplayQueueEventBus = null,
    dependencies: DisplayQueueDependencies = {}
) {
    return new DisplayQueue(obsManager, config, constants, eventBus, dependencies);
}

function resetDisplayQueue() {
    displayQueueInstance = null;
}

function initializeDisplayQueue(
    obsManager: DisplayQueueObsManager,
    config: DisplayQueueConfig = {},
    constants: DisplayQueueConstants = {},
    eventBus: DisplayQueueEventBus = null,
    dependencies: DisplayQueueDependencies = {}
) {
    if (!obsManager) {
        throw new Error('DisplayQueue requires OBSConnectionManager instance');
    }

    if (!displayQueueInstance) {
        displayQueueInstance = createDisplayQueue(obsManager, config, constants, eventBus, dependencies);
        logger.debug('Display Queue system initialized.');
    } else if (dependencies && typeof dependencies === 'object' && displayQueueInstance) {
        displayQueueInstance.obsManager = obsManager;
        displayQueueInstance.renderer.obsManager = obsManager;
        displayQueueInstance.effects.obsManager = obsManager;
        if (dependencies.sourcesManager) {
            displayQueueInstance.sourcesManager = dependencies.sourcesManager;
            displayQueueInstance.renderer.sourcesManager = dependencies.sourcesManager;
            displayQueueInstance.effects.sourcesManager = dependencies.sourcesManager;
        }
        if (dependencies.goalsManager) {
            displayQueueInstance.goalsManager = dependencies.goalsManager;
            displayQueueInstance.effects.goalsManager = dependencies.goalsManager;
        }
    }
    return displayQueueInstance;
}

export {
    createDisplayQueue,
    initializeDisplayQueue,
    resetDisplayQueue,
    DisplayQueue,
    isNotificationType,
    isChatType
};
