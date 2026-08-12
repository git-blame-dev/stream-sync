import crypto from 'node:crypto';

import { logger } from '../core/logging';
import { NOTIFICATION_CONFIGS, PRIORITY_LEVELS } from '../core/constants';
import { resolvePriorityForType } from '../core/notification-priority';
import type {
    DisplayQueueItem,
    DisplayQueueItemData,
    DisplayQueueMessage,
    DisplayQueueSequence
} from '../interfaces/DisplayQueue';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { safeDelay } from '../utils/timeout-validator';
import { DisplayQueueEffects } from './display-queue-effects';
import { DisplayQueueState } from './display-queue-state';
import { getDefaultGoalsManager } from './goals';
import { getDefaultSourcesManager } from './sources';
import type { OperatorControlService } from '../services/operator/operator-control-service';

type QueueItem = DisplayQueueItem;
type QueueEntry = QueueItem | DisplayQueueSequence;
type QueueItemData = DisplayQueueItemData;

type DisplayQueueConfig = {
    autoProcess?: boolean;
    maxQueueSize?: number;
    rowIntervalMs?: number;
    ttsChatEnabled?: boolean;
    ttsNotificationsEnabled?: boolean;
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
    operatorControls?: Pick<OperatorControlService, 'isEnabled' | 'subscribe'>;
    sourcesManager?: DisplayQueueSourcesManager;
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
    isReady?: () => Promise<boolean>;
    call: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
    [key: string]: unknown;
};

type DisplayQueueSourcesManager = {
    updateTextSource: (sourceName: string, text?: string) => Promise<void>;
    clearTextSource: (sourceName: string) => Promise<void>;
    [key: string]: unknown;
};

const CHAT_TYPE = 'chat';
let notificationTypeSet: Set<string> | null = null;

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
        const messageObject = message as Exclude<DisplayQueueMessage, string>;
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

    displayQueueErrorHandler?.logOperationalError(message, 'display-queue', payload);
}

function defaultDelay(ms: number) {
    const numMs = Number(ms);
    return safeDelay(numMs, Number.isFinite(numMs) ? numMs : 1000, 'DisplayQueue delay');
}

class DisplayQueue {
    queue: QueueEntry[] = [];
    isProcessing = false;
    processingRunActive = false;
    activeSequenceRemaining: QueueItem[] = [];
    obsManager: DisplayQueueObsManager;
    constants: DisplayQueueConstants;
    sourcesManager: DisplayQueueSourcesManager;
    goalsManager: ReturnType<typeof getDefaultGoalsManager>;
    eventBus: DisplayQueueEventBus;
    delay: (ms: number) => Promise<void>;
    config: DisplayQueueConfig;
    state: DisplayQueueState;
    effects: DisplayQueueEffects;
    effectChain: Promise<void> = Promise.resolve();
    operatorControls?: DisplayQueueDependencies['operatorControls'];
    unsubscribeOperatorControls?: () => void;

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

        this.obsManager = obsManager;
        this.constants = constants;
        this.sourcesManager = dependencies.sourcesManager || getDefaultSourcesManager();
        this.goalsManager = dependencies.goalsManager || getDefaultGoalsManager();
        this.eventBus = eventBus;
        this.delay = dependencies.delay || defaultDelay;
        this.config = config;
        this.operatorControls = dependencies.operatorControls;
        this.state = new DisplayQueueState({
            ...(this.config.maxQueueSize === undefined ? {} : { maxQueueSize: this.config.maxQueueSize }),
            getPriority: (type) => this.getTypePriority(type) ?? PRIORITY_LEVELS.CHAT
        });
        this.queue = this.state.queue;
        this.effects = new DisplayQueueEffects({
            obsManager: this.obsManager,
            sourcesManager: this.sourcesManager as ConstructorParameters<typeof DisplayQueueEffects>[0]['sourcesManager'],
            goalsManager: this.goalsManager as ConstructorParameters<typeof DisplayQueueEffects>[0]['goalsManager'],
            ...(this.eventBus && typeof this.eventBus.emit === 'function'
                ? { eventBus: this.eventBus as NonNullable<ConstructorParameters<typeof DisplayQueueEffects>[0]['eventBus']> }
                : {}),
            config: this.config as ConstructorParameters<typeof DisplayQueueEffects>[0]['config'],
            delay: this.delay,
            handleDisplayQueueError,
            extractUsername: (data) => this.extractUsername(data),
            ...(dependencies.giftAnimationResolver === undefined
                ? {}
                : { giftAnimationResolver: dependencies.giftAnimationResolver })
        });
        if (this.operatorControls) {
            this.unsubscribeOperatorControls = this.operatorControls.subscribe((snapshot) => {
                for (const [key, enabled] of Object.entries(snapshot.controls)) {
                    if (!enabled) this.cancelDisabledItems(key);
                }
            });
        }
    }

    isChatTTSEnabled() {
        return this.effects.isChatTTSEnabled();
    }

    setTTSText(text: string) {
        return this.effects.setTTSText(text);
    }

    getTypePriority(type: string) {
        const priorityLevels = this.constants.PRIORITY_LEVELS;
        if (!priorityLevels) {
            logger.warn('[Display Queue] PRIORITY_LEVELS not available, using default priority');
            return PRIORITY_LEVELS.CHAT;
        }
        return resolvePriorityForType(type, priorityLevels) ?? priorityLevels.CHAT;
    }

    addItem(item: QueueItem) {
        this.state.validate(item);
        if (!this.isViewerOutputEnabled(item)) {
            this.accountMonetization(item);
            return;
        }
        const { insertIndex } = this.state.addItem(item, this.activeSequenceRemaining.length);
        logger.debug(`[Display Queue] Added ${item.type} at position ${insertIndex}. Queue length: ${this.getQueueLength()}`, 'display-queue');
        this.startProcessingIfNeeded();
    }

    addSequence(items: QueueItem[]) {
        if (!Array.isArray(items) || items.length === 0) {
            this.state.addSequence(items);
            return;
        }
        items.forEach((item) => this.state.validate(item));
        const classified = items.map((item) => ({ item, enabled: this.isViewerOutputEnabled(item) }));
        const admitted = classified.filter(({ enabled }) => enabled).map(({ item }) => item);
        classified.filter(({ enabled }) => !enabled).forEach(({ item }) => this.accountMonetization(item));
        if (admitted.length === 0) return;
        const { insertIndex } = this.state.addSequence(admitted, {
            reservedRows: this.activeSequenceRemaining.length
        });
        logger.debug(`[Display Queue] Added sequence (${items.length} items) at position ${insertIndex}. Queue length: ${this.getQueueLength()}`, 'display-queue');
        this.startProcessingIfNeeded();
    }

    startProcessingIfNeeded() {
        if (!this.processingRunActive && !this.isProcessing && this.config.autoProcess) {
            void this.processQueue();
        }
    }

    emitDisplayRow(item: QueueItem) {
        if (!this.eventBus || typeof this.eventBus.emit !== 'function') {
            return;
        }

        const eventId = item.eventId || crypto.randomUUID();
        item.eventId = eventId;
        this.eventBus.emit('display:row', {
            eventId,
            type: item.type,
            platform: item.platform,
            data: item.data,
            timestamp: item.data.timestamp || null
        });
    }

    async processChatMessage(chatItem: QueueItem) {
        if (!chatItem || !isChatType(chatItem.type)) {
            throw new Error('Invalid chat item: must be type "chat"');
        }
        this.addItem(chatItem);
        if (!this.isProcessing && this.config.autoProcess) {
            await this.processQueue();
        }
    }

    async processQueue() {
        if (this.processingRunActive || this.isProcessing) {
            return;
        }

        const configuredInterval = Number(this.config.rowIntervalMs);
        const rowIntervalMs = Number.isFinite(configuredInterval) && configuredInterval >= 0
            ? configuredInterval
            : 1000;
        this.processingRunActive = true;
        this.isProcessing = true;

        try {
            while (this.queue.length > 0) {
                const entry = this.state.shift();
                if (!entry) {
                    continue;
                }

                const children = this.state.isSequence(entry) ? entry.children : [entry];
                this.activeSequenceRemaining = [...children];
                while (this.activeSequenceRemaining.length > 0) {
                    const item = this.activeSequenceRemaining.shift();
                    if (item) {
                        await this.processSingleItem(item, rowIntervalMs);
                    }
                }
            }
        } finally {
            this.activeSequenceRemaining = [];
            this.isProcessing = false;
            this.processingRunActive = false;
            if (this.config.autoProcess && this.queue.length > 0) {
                void this.processQueue();
            }
        }
    }

    async processSingleItem(item: QueueItem, rowIntervalMs: number) {
        try {
            await this.displayItem(item);
            await this.delay(rowIntervalMs);
        } catch (error) {
            handleDisplayQueueError(`[Display Queue] Error presenting ${item.type}`, error, { itemType: item.type });
        }
    }

    displayItem(item: QueueItem) {
        return isChatType(item.type)
            ? this.displayChatItem(item)
            : this.displayNotificationItem(item);
    }

    async displayChatItem(item: QueueItem) {
        this.emitDisplayRow(item);
        this.enqueueEffects(item);
        return true;
    }

    async displayNotificationItem(item: QueueItem) {
        this.emitDisplayRow(item);
        this.enqueueEffects(item);
        return true;
    }

    enqueueEffects(item: QueueItem) {
        this.effectChain = this.effectChain
            .then(async () => {
                if (isChatType(item.type)) {
                    await this.effects.handleChatTTSEffects(item, resolveChatMessageText(item.data.message));
                    return;
                }
                await this.effects.handleNotificationEffects(item);
            })
            .catch((error) => {
                handleDisplayQueueError(`[Display Queue] Error processing ${item.type} effects`, error, { itemType: item.type });
            });
    }

    handleNotificationEffects(item: QueueItem) {
        return this.effects.handleNotificationEffects(item);
    }

    buildVfxMatch(config: Record<string, unknown>) {
        return this.effects.buildVfxMatch(config);
    }

    waitForVfxCompletion(match = {}, options = {}) {
        return this.effects.waitForVfxCompletion(match, options);
    }

    emitVfxFromConfig(item: QueueItem, username: string | null) {
        return this.effects.emitVfxFromConfig(item, username);
    }

    handleGiftEffects(item: QueueItem, ttsStages: Array<{ text: string; delay: number; type?: string }>) {
        return this.effects.handleGiftEffects(item, ttsStages);
    }

    handleSequentialEffects(item: QueueItem, ttsStages: Array<{ text: string; delay: number; type?: string }>) {
        return this.effects.handleSequentialEffects(item, ttsStages);
    }

    playGiftVideoAndAudio() {
        return this.effects.playGiftVideoAndAudio();
    }

    getQueueLength() {
        return this.state.getQueueLength() + this.activeSequenceRemaining.length;
    }

    clearQueue() {
        this.state.clear();
        this.activeSequenceRemaining = [];
        logger.debug('[Display Queue] Queue cleared', 'display-queue');
    }

    async stop() {
        this.unsubscribeOperatorControls?.();
        delete this.unsubscribeOperatorControls;
        this.clearQueue();
        await this.effectChain;
        logger.info('[Display Queue] Processing stopped and queue cleared.');
    }

    extractUsername(data: unknown): string | null {
        if (!data || typeof data !== 'object') {
            return null;
        }

        const username = (data as QueueItemData).username;
        return typeof username === 'string' && username.trim() ? username.trim() : null;
    }

    private isViewerOutputEnabled(item: QueueItem) {
        if (!this.operatorControls) return true;
        const settingKey = isChatType(item.type) ? 'messagesEnabled' : NOTIFICATION_CONFIGS[item.type as keyof typeof NOTIFICATION_CONFIGS]?.settingKey;
        return !settingKey || this.operatorControls.isEnabled(settingKey);
    }

    private accountMonetization(item: QueueItem) {
        if (item.type === 'platform:gift' || item.type === 'platform:paypiggy' || item.type === 'platform:giftpaypiggy') {
            this.effectChain = this.effectChain.then(() => this.effects.processMonetizationGoal(item)).catch((error) => {
                handleDisplayQueueError(`[Display Queue] Error processing ${item.type} monetization`, error, { itemType: item.type });
            });
        }
    }

    private cancelDisabledItems(settingKey: string) {
        const removed = this.state.removeMatching((item) => {
            const itemKey = isChatType(item.type) ? 'messagesEnabled' : NOTIFICATION_CONFIGS[item.type as keyof typeof NOTIFICATION_CONFIGS]?.settingKey;
            return itemKey === settingKey;
        });
        removed.forEach((item) => this.accountMonetization(item));
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
    if (!displayQueueInstance) {
        displayQueueInstance = createDisplayQueue(obsManager, config, constants, eventBus, dependencies);
        logger.debug('Display Queue system initialized.');
    } else {
        displayQueueInstance.obsManager = obsManager;
        displayQueueInstance.effects.obsManager = obsManager;
        if (dependencies.sourcesManager) {
            displayQueueInstance.sourcesManager = dependencies.sourcesManager;
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
