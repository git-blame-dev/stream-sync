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
import { NotificationDisplayCoordinator } from './notification-display-coordinator';
import type { OperatorControlService } from '../services/operator/operator-control-service';

type QueueItem = DisplayQueueItem;
type QueueEntry = QueueItem | DisplayQueueSequence;
type QueueItemData = DisplayQueueItemData;
type OutstandingPresentation = {
    presented: boolean;
    active: boolean;
    rowDone: Promise<void>;
    finishRow: () => void;
};

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
    onPresentationStarted?: (item: DisplayQueueItem) => Promise<unknown> | unknown;
    fetch?: ConstructorParameters<typeof DisplayQueueEffects>[0]['fetch'];
    operatorControls?: Pick<OperatorControlService, 'isEnabled' | 'subscribe'>;
    sourcesManager?: DisplayQueueSourcesManager;
    goalsManager?: ReturnType<typeof getDefaultGoalsManager>;
    delay?: (ms: number, signal?: AbortSignal) => Promise<void>;
    notificationDelay?: (ms: number) => Promise<void>;
    giftAnimationResolver?: ConstructorParameters<typeof DisplayQueueEffects>[0]['giftAnimationResolver'];
    createGiftAnimationResolver?: ConstructorParameters<typeof DisplayQueueEffects>[0]['createGiftAnimationResolver'];
};

type DisplayQueueObsManager = {
    isReady?: () => Promise<boolean>;
    call: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
    [key: string]: unknown;
};

type DisplayQueueSourcesManager = {
    updateTextSource: (sourceName: string, text?: string, signal?: AbortSignal) => Promise<void>;
    clearTextSource: (sourceName: string, signal?: AbortSignal) => Promise<void>;
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

function defaultDelay(ms: number, signal?: AbortSignal) {
    const numMs = Number(ms);
    if (numMs === 0) return Promise.resolve();
    return safeDelay(numMs, Number.isFinite(numMs) ? numMs : 1000, 'DisplayQueue delay', signal);
}

class DisplayQueue {
    private stopped = false;
    private readonly stopController = new AbortController();
    private stopPromise: Promise<void> | null = null;
    private runner: Promise<void> | null = null;
    private rowRunner: Promise<void> | null = null;
    private workWaiter: (() => void) | undefined;
    private rowFailure: { error: unknown } | undefined;
    private readonly wakeWaiters = new Set<() => void>();
    // State orders pending entries; records retain their admission slots through final settlement.
    private readonly records = new Map<QueueItem, OutstandingPresentation>();
    private readonly onPresentationStarted: DisplayQueueDependencies['onPresentationStarted'];
    queue: QueueEntry[] = [];
    isProcessing = false;
    processingRunActive = false;
    activeSequenceRemaining: QueueItem[] = [];
    obsManager: DisplayQueueObsManager;
    constants: DisplayQueueConstants;
    sourcesManager: DisplayQueueSourcesManager;
    goalsManager: ReturnType<typeof getDefaultGoalsManager>;
    eventBus: DisplayQueueEventBus;
    delay: (ms: number, signal?: AbortSignal) => Promise<void>;
    config: DisplayQueueConfig;
    state: DisplayQueueState;
    effects: DisplayQueueEffects;
    notificationCoordinator: NotificationDisplayCoordinator;
    get effectChain(): Promise<void> { return this.runner ?? Promise.resolve(); }
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
        this.onPresentationStarted = dependencies.onPresentationStarted;
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
            ...(dependencies.fetch ? { fetch: dependencies.fetch } : {}),
            ...(dependencies.createGiftAnimationResolver === undefined
                ? {}
                : { createGiftAnimationResolver: dependencies.createGiftAnimationResolver }),
            ...(dependencies.giftAnimationResolver === undefined
                ? {}
                : { giftAnimationResolver: dependencies.giftAnimationResolver })
        });
        const timing = this.config as Record<string, unknown>;
        this.notificationCoordinator = new NotificationDisplayCoordinator({
            ...(Number.isFinite(Number(timing.notificationIdleHoldMs)) ? { notificationIdleHoldMs: Number(timing.notificationIdleHoldMs) } : {}),
            ...(Number.isFinite(Number(timing.monetizationIdleHoldMs)) ? { monetizationIdleHoldMs: Number(timing.monetizationIdleHoldMs) } : {}),
            ...(Number.isFinite(Number(timing.notificationTransitionMs)) ? { notificationTransitionMs: Number(timing.notificationTransitionMs) } : {}),
            ...(Number.isFinite(Number(timing.effectFallbackMs)) ? { effectFallbackMs: Number(timing.effectFallbackMs) } : {}),
            ...(dependencies.notificationDelay ? { delay: dependencies.notificationDelay } : {}),
            emit: (event, payload) => this.eventBus?.emit?.(event, payload as Record<string, unknown>)
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
            logger.warn('PRIORITY_LEVELS not available, using default priority', 'display-queue');
            return PRIORITY_LEVELS.CHAT;
        }
        return resolvePriorityForType(type, priorityLevels) ?? priorityLevels.CHAT;
    }

    addItem(item: QueueItem): readonly DisplayQueueItem[] {
        if (this.stopped) throw new Error('Display queue stopped');
        this.state.validate(item);
        if (this.records.has(item)) throw new Error('Display item already outstanding');
        if (!this.isViewerOutputEnabled(item)) {
            return [];
        }
        const { insertIndex } = this.state.addItem(item, this.records.size - this.state.getQueueLength());
        this.registerRecord(item);
        logger.debug(`Added ${item.type} at position ${insertIndex}. Queue length: ${this.getQueueLength()}`, 'display-queue');
        this.startProcessingIfNeeded();
        return [item];
    }

    addSequence(items: QueueItem[]): readonly DisplayQueueItem[] {
        if (this.stopped) throw new Error('Display queue stopped');
        if (!Array.isArray(items) || items.length === 0) {
            this.state.addSequence(items);
            return [];
        }
        items.forEach((item) => this.state.validate(item));
        if (new Set(items).size !== items.length || items.some((item) => this.records.has(item))) {
            throw new Error('Display item already outstanding');
        }
        const classified = items.map((item) => ({ item, enabled: this.isViewerOutputEnabled(item) }));
        const admitted = classified.filter(({ enabled }) => enabled).map(({ item }) => item);
        if (admitted.length === 0) return [];
        const { insertIndex } = this.state.addSequence(admitted, {
            reservedRows: this.records.size - this.state.getQueueLength()
        });
        admitted.forEach((item) => this.registerRecord(item));
        logger.debug(`Added sequence (${items.length} items) at position ${insertIndex}. Queue length: ${this.getQueueLength()}`, 'display-queue');
        this.startProcessingIfNeeded();
        return admitted;
    }

    startProcessingIfNeeded() {
        if (this.processingRunActive) this.startRowRunner();
        if (!this.processingRunActive && !this.isProcessing && this.config.autoProcess) {
            void this.processQueue();
        }
    }

    emitDisplayRow(item: QueueItem) {
        if (!this.eventBus || typeof this.eventBus.emit !== 'function') {
            return;
        }

        const eventId = this.ensureEventId(item);
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
        const admitted = this.addItem(chatItem);
        if (!this.isProcessing && this.config.autoProcess) {
            await this.processQueue();
        }
        return admitted;
    }

    processQueue(): Promise<void> {
        if (this.runner) return this.runner;
        if (this.stopped) return Promise.resolve();
        this.processingRunActive = true;
        this.isProcessing = true;
        this.startRowRunner();
        this.runner = Promise.resolve().then(() => this.runEffects()).finally(() => {
            this.runner = null;
            this.isProcessing = false;
            this.processingRunActive = false;
            if (!this.stopped && this.config.autoProcess && this.queue.length > 0) void this.processQueue();
        });
        return this.runner;
    }

    private async runEffects() {
        try {
            while (!this.stopped && (this.queue.length > 0 || this.rowRunner)) {
                if (this.rowFailure) throw this.rowFailure.error;
                if (this.queue.length === 0) {
                    await this.waitForWorkOrRowCompletion();
                    continue;
                }
                const entry = this.state.shift();
                if (!entry) {
                    continue;
                }

                const children = this.state.isSequence(entry) ? entry.children : [entry];
                this.activeSequenceRemaining = [...children];
                while (this.activeSequenceRemaining.length > 0) {
                    const item = this.activeSequenceRemaining.shift();
                    if (item) {
                        if (!this.isViewerOutputEnabled(item) || this.stopped) {
                            this.retire(item);
                            continue;
                        }
                        try {
                            const record = this.records.get(item);
                            if (record) record.active = true;
                            this.effects.beginPresentation();
                            if (isChatType(item.type)) {
                                await this.records.get(item)?.rowDone;
                                if (!this.stopped && this.isViewerOutputEnabled(item)) {
                                    await this.effects.handleChatTTSEffects(item, resolveChatMessageText(item.data.message));
                                }
                            } else {
                                const prepare = () => this.effects.prepareNotificationEffects(item);
                                const start = () => this.emitDisplayRow(item);
                                const effect = () => this.runPresentation(item);
                                if (this.isNotificationCoordinationEnabled()) {
                                    await this.notificationCoordinator.register(item).run(start, effect, () => this.effects.cancelActive(), prepare);
                                } else {
                                    await prepare();
                                    if (!this.stopped && this.isViewerOutputEnabled(item)) {
                                        start();
                                        await effect();
                                    }
                                }
                            }
                        } catch (error) {
                            handleDisplayQueueError(`[Display Queue] Error presenting ${item.type}`, error, { itemType: item.type });
                        } finally {
                            this.retire(item);
                        }
                    }
                }
            }
        } finally {
            this.activeSequenceRemaining = [];
            await this.rowRunner;
            const failure = this.rowFailure;
            this.rowFailure = undefined;
            if (failure) throw failure.error;
        }
    }

    private waitForWorkOrRowCompletion() {
        return new Promise<void>((resolve) => {
            const wake = () => {
                if (this.workWaiter === wake) this.workWaiter = undefined;
                resolve();
            };
            this.workWaiter = wake;
            if (this.stopped || this.queue.length > 0 || !this.rowRunner) wake();
        });
    }

    private registerRecord(item: QueueItem) {
        let finishRow!: () => void;
        const rowDone = new Promise<void>((resolve) => { finishRow = resolve; });
        this.records.set(item, { presented: false, active: false, rowDone, finishRow });
        this.ensureEventId(item);
        this.notificationCoordinator.setSuccessorAvailable(this.hasPendingNotification());
        this.workWaiter?.();
    }

    private retire(item: QueueItem) {
        this.records.get(item)?.finishRow();
        this.records.delete(item);
        this.notificationCoordinator.setSuccessorAvailable(this.hasPendingNotification());
    }

    private hasPendingNotification() {
        for (const [item, record] of this.records) {
            if (!isChatType(item.type) && !record.presented) return true;
        }
        return false;
    }

    private nextChatRecord() {
        let next: [QueueItem, OutstandingPresentation] | undefined;
        for (const entry of this.records) {
            const [item, record] = entry;
            if (!isChatType(item.type) || record.presented) continue;
            if (!next || (item.priority ?? 0) > (next[0].priority ?? 0)) next = entry;
        }
        return next;
    }

    private async runPresentation(item: QueueItem) {
        const record = this.records.get(item);
        if (record) record.presented = true;
        this.notificationCoordinator.setSuccessorAvailable(this.hasPendingNotification());
        const results = await Promise.allSettled([
            this.effects.processMonetizationGoal(item),
            Promise.resolve().then(() => this.onPresentationStarted?.(item)),
            this.effects.handleNotificationEffects(item)
        ]);
        for (const result of results) if (result.status === 'rejected') throw result.reason;
    }

    private startRowRunner() {
        if (this.rowRunner || this.stopped) return;
        this.rowRunner = Promise.resolve().then(() => this.runRows()).catch((error: unknown) => {
            this.rowFailure = { error };
        }).finally(() => {
            this.rowRunner = null;
            if (!this.rowFailure && this.nextChatRecord()) this.startRowRunner();
            this.workWaiter?.();
        });
    }

    private async runRows() {
        while (!this.stopped) {
            const next = this.nextChatRecord();
            if (!next) return;
            const [item, record] = next;
            record.presented = true;
            try { if (this.isViewerOutputEnabled(item)) this.emitDisplayRow(item); }
            catch (error) { handleDisplayQueueError('[Display Queue] Error emitting chat row', error); }
            finally { record.finishRow(); }
            const interval = Number(this.config.rowIntervalMs ?? 1000);
            await this.wakeableDelay(Number.isFinite(interval) && interval >= 0 ? interval : 1000);
        }
    }

    private async wakeableDelay(ms: number) {
        let wake!: () => void;
        const cancelled = new Promise<void>((resolve) => { wake = resolve; this.wakeWaiters.add(wake); });
        try { await Promise.race([this.delay(ms, this.stopController.signal), cancelled]); }
        catch (error) { if (!this.stopped) throw error; }
        finally { this.wakeWaiters.delete(wake); }
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
        const admitted = this.enqueueEffects(item);
        await this.processQueue();
        return admitted.includes(item);
    }

    async displayNotificationItem(item: QueueItem) {
        const admitted = this.enqueueEffects(item);
        await this.processQueue();
        return admitted.includes(item);
    }

    enqueueEffects(item: QueueItem) {
        return this.addItem(item);
    }

    handleNotificationEffects(item: QueueItem) {
        return this.effects.handleNotificationEffects(item);
    }

    private ensureEventId(item: QueueItem) {
        if (!item.eventId) item.eventId = crypto.randomUUID();
        return item.eventId;
    }

    private isNotificationCoordinationEnabled() {
        const gui = this.config.gui;
        return !!gui && typeof gui === 'object' && (gui as Record<string, unknown>).enableNotifications === true;
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
        return this.records.size;
    }

    clearQueue() {
        this.state.clear();
        for (const item of this.activeSequenceRemaining) this.retire(item);
        this.activeSequenceRemaining = [];
        for (const [item, record] of this.records) if (!record.active) this.retire(item);

    }

    stop(): Promise<void> {
        if (this.stopPromise) return this.stopPromise;
        let resolve!: () => void;
        let reject!: (reason: unknown) => void;
        this.stopPromise = new Promise<void>((done, fail) => { resolve = done; reject = fail; });
        this.stopped = true;
        this.workWaiter?.();
        this.stopController.abort();
        const cleanups: Array<Promise<unknown>> = [];
        const attempt = (operation: () => unknown) => {
            try { cleanups.push(Promise.resolve(operation())); }
            catch (error) { cleanups.push(Promise.reject(error)); }
        };
        attempt(() => this.unsubscribeOperatorControls?.());
        delete this.unsubscribeOperatorControls;
        this.clearQueue();
        this.notificationCoordinator.stop();
        for (const wake of this.wakeWaiters) wake();
        attempt(() => this.effects.dispose());
        void Promise.allSettled([...cleanups, this.runner, this.rowRunner]).then((results) => {
            for (const item of this.records.keys()) this.retire(item);
            for (const result of results) if (result.status === 'rejected') throw result.reason;
            logger.info('Processing stopped and queue cleared.', 'display-queue');
        }).then(resolve, reject);
        return this.stopPromise;
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

    private cancelDisabledItems(settingKey: string) {
        const removed = this.state.removeMatching((item) => {
            const itemKey = isChatType(item.type) ? 'messagesEnabled' : NOTIFICATION_CONFIGS[item.type as keyof typeof NOTIFICATION_CONFIGS]?.settingKey;
            return itemKey === settingKey;
        });
        removed.forEach((item) => this.retire(item));
        this.activeSequenceRemaining = this.activeSequenceRemaining.filter((item) => {
            if (this.isViewerOutputEnabled(item)) return true;
            this.retire(item);
            return false;
        });
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
