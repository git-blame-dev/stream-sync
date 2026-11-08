import crypto from 'node:crypto';
import { logger } from '../core/logging';
import { createTikTokGiftAnimationResolver } from '../services/tiktok-gift-animation/resolver';
import MessageTTSHandler from '../utils/message-tts-handler';
import { normalizeTtsText } from '../utils/tts-text';
import { safeSetTimeout } from '../utils/timeout-validator';
import { triggerHandcamGlow } from './handcam-glow';
import type { DisplayQueueItem } from '../interfaces/DisplayQueue';
import { requestNeuralTts } from './neural-tts-diagnostics';
import { recoverNeuralTts } from './neural-tts-recovery';

const VFX_EVENTS = {
    EFFECT_COMPLETED: 'vfx:effect-completed',
    COMMAND_RECEIVED: 'vfx:command-received'
} as const;

const NEURAL_TTS_HEALTH_TIMEOUT_MS = 2_000;

type QueueItem = DisplayQueueItem;

type TtsStage = {
    text: string;
    delay: number;
    type?: string;
};

type VfxMatch = {
    commandKey: string;
    filename: string;
    mediaSource: string;
    command: string;
    correlationId?: string;
};

type VfxEmitOptions = {
    delayApplied?: number;
};

type VfxCompletionResult = {
    reason: 'cancelled' | 'completed' | 'no-eventbus' | 'timeout';
    payload?: Record<string, unknown>;
};

type VfxCompletionWaiter = {
    promise: Promise<VfxCompletionResult>;
    cancel: () => void;
};

type SpeechFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

type DisplayQueueEffectsDependencies = {
    obsManager: {
        ensureConnected?: () => Promise<void>;
        call: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
        addEventListener?: (eventName: string, handler: (payload?: Record<string, unknown>) => void) => void;
        removeEventListener?: (eventName: string, handler: (payload?: Record<string, unknown>) => void) => void;
    };
    sourcesManager: {
        clearTextSource: (sourceName: string, signal?: AbortSignal) => Promise<void>;
        updateTextSource: (sourceName: string, text: string, signal?: AbortSignal) => Promise<void>;
    };
    goalsManager: {
        processDonationGoal: (platform: string, amount: number, currency?: string) => Promise<unknown>;
        processPaypiggyGoal: (platform: string, count?: number) => Promise<unknown>;
    };
    eventBus?: {
        emit: (eventName: string, payload: Record<string, unknown>) => void;
        subscribe?: (eventName: string, handler: (payload: Record<string, unknown>) => void) => () => void;
        on?: (eventName: string, handler: (payload: Record<string, unknown>) => void) => void;
        off?: (eventName: string, handler: (payload: Record<string, unknown>) => void) => void;
    } | null;
    config: {
        ttsChatEnabled?: boolean;
        ttsNotificationsEnabled?: boolean;
        obs?: {
            ttsChatEnabled?: boolean;
            ttsNotificationsEnabled?: boolean;
            neuralTtsEndpoint?: string;
            neuralTtsVoice?: string;
            neuralTtsCommand?: string;
        };
        handcam?: {
            enabled?: boolean;
        } & Parameters<typeof triggerHandcamGlow>[1];
        gifts?: {
            giftVideoSource?: string;
            giftAudioSource?: string;
        };
        gui?: {
            enableDock?: boolean;
            enableOverlay?: boolean;
            showGifts?: boolean;
        };
    };
    delay: (ms: number, signal?: AbortSignal) => Promise<void>;
    handleDisplayQueueError: (message: string, error?: unknown, payload?: Record<string, unknown>) => void;
    triggerHandcamGlow?: typeof triggerHandcamGlow;
    extractUsername: (data: Record<string, unknown> | null | undefined) => string | null;
    giftAnimationResolver?: {
        resolveFromNotificationData: (data: unknown) => Promise<{
            durationMs: number;
            mediaFilePath: string;
            mediaContentType: string;
            animationConfig: Record<string, unknown>;
        } | null>;
        dispose?: () => Promise<void> | void;
    };
    createGiftAnimationResolver?: typeof createTikTokGiftAnimationResolver;
    fetch?: SpeechFetch;
};

class DisplayQueueEffects {
    private outputObsManager: DisplayQueueEffectsDependencies['obsManager'];
    private readonly guardedObsManager: DisplayQueueEffectsDependencies['obsManager'];
    private outputSourcesManager: DisplayQueueEffectsDependencies['sourcesManager'];
    private readonly guardedSourcesManager: DisplayQueueEffectsDependencies['sourcesManager'];
    get obsManager() { return this.guardedObsManager; }
    set obsManager(manager: DisplayQueueEffectsDependencies['obsManager']) { this.outputObsManager = manager; }
    get sourcesManager() { return this.guardedSourcesManager; }
    set sourcesManager(manager: DisplayQueueEffectsDependencies['sourcesManager']) { this.outputSourcesManager = manager; }
    goalsManager: DisplayQueueEffectsDependencies['goalsManager'];
    eventBus: DisplayQueueEffectsDependencies['eventBus'];
    config: DisplayQueueEffectsDependencies['config'];
    delay: DisplayQueueEffectsDependencies['delay'];
    handleDisplayQueueError: DisplayQueueEffectsDependencies['handleDisplayQueueError'];
    triggerHandcamGlow: typeof triggerHandcamGlow;
    extractUsername: DisplayQueueEffectsDependencies['extractUsername'];
    giftAnimationResolver: NonNullable<DisplayQueueEffectsDependencies['giftAnimationResolver']>;
    private readonly ownsGiftAnimationResolver: boolean;
    private disposalPromise: Promise<void> | null = null;
    private controller = new AbortController();
    private readonly cancellations = new Set<() => void>();
    private readonly goalAttempts = new WeakSet<QueueItem>();
    private healthVerified = false;
    private notificationPrepared = false;
    private notificationPrepareFailed = false;
    private preparedStageCounts = new Map<string, number>();
    private outputFetch: SpeechFetch;
    private readonly guardedFetch: SpeechFetch;
    get fetch() { return this.guardedFetch; }
    set fetch(fn: SpeechFetch) { this.outputFetch = fn; }

    beginPresentation() {
        if (this.disposalPromise) throw new Error('Display effects disposed');
        this.controller = new AbortController();
        this.healthVerified = false;
        this.notificationPrepared = false;
        this.notificationPrepareFailed = false;
        this.preparedStageCounts.clear();
    }

    cancelActive() {
        this.controller.abort();
        this.healthVerified = false;
        this.notificationPrepared = false;
        this.notificationPrepareFailed = false;
        this.preparedStageCounts.clear();
        for (const cancel of [...this.cancellations]) {
            try { cancel(); }
            catch (error) { this.handleDisplayQueueError('[Display Queue] Error cancelling an effect wait', error); }
        }
    }

    private assertActive() {
        this.controller.signal.throwIfAborted();
    }

    private trackWaiter<T>(waiter: { promise: Promise<T>; cancel: () => void }) {
        this.cancellations.add(waiter.cancel);
        void waiter.promise.then(() => this.cancellations.delete(waiter.cancel), () => this.cancellations.delete(waiter.cancel));
        return waiter;
    }

    constructor({
        obsManager,
        sourcesManager,
        goalsManager,
        eventBus,
        config,
        delay,
        handleDisplayQueueError,
        triggerHandcamGlow: triggerHandcamGlowOverride,
        extractUsername,
        giftAnimationResolver,
        createGiftAnimationResolver = createTikTokGiftAnimationResolver,
        fetch: fetchOverride
    }: DisplayQueueEffectsDependencies) {
        this.outputObsManager = obsManager;
        this.guardedObsManager = {
            ensureConnected: async () => {
                this.assertActive();
                if (!this.outputObsManager.ensureConnected) throw new Error('Handcam glow requires OBS owner readiness');
                await this.outputObsManager.ensureConnected();
                this.assertActive();
            },
            ...(obsManager.addEventListener ? { addEventListener: (event: string, handler: (payload?: Record<string, unknown>) => void) => this.outputObsManager.addEventListener?.(event, handler) } : {}),
            ...(obsManager.removeEventListener ? { removeEventListener: (event: string, handler: (payload?: Record<string, unknown>) => void) => this.outputObsManager.removeEventListener?.(event, handler) } : {}),
            call: async (request, payload) => {
                this.assertActive();
                const result = await this.outputObsManager.call(request, payload);
                this.assertActive();
                return result;
            }
        };
        this.outputSourcesManager = sourcesManager;
        this.guardedSourcesManager = {
            clearTextSource: async (source) => { this.assertActive(); await this.outputSourcesManager.clearTextSource(source, this.controller.signal); this.assertActive(); },
            updateTextSource: async (source, text) => { this.assertActive(); await this.outputSourcesManager.updateTextSource(source, text, this.controller.signal); this.assertActive(); }
        };
        this.goalsManager = goalsManager;
        this.eventBus = eventBus ? {
            ...eventBus,
            ...(eventBus.subscribe ? { subscribe: eventBus.subscribe.bind(eventBus) } : {}),
            ...(eventBus.on ? { on: eventBus.on.bind(eventBus) } : {}),
            ...(eventBus.off ? { off: eventBus.off.bind(eventBus) } : {}),
            emit: (event, payload) => { this.assertActive(); eventBus.emit(event, payload); }
        } : null;
        this.config = config;
        this.delay = async (ms) => {
            this.assertActive();
            let cancel!: () => void;
            const cancelled = new Promise<void>((resolve) => { cancel = resolve; this.cancellations.add(cancel); });
            try { await Promise.race([delay(ms, this.controller.signal), cancelled]); this.assertActive(); }
            finally { this.cancellations.delete(cancel); }
        };
        this.handleDisplayQueueError = handleDisplayQueueError;
        this.triggerHandcamGlow = triggerHandcamGlowOverride || triggerHandcamGlow;
        this.extractUsername = extractUsername;
        this.ownsGiftAnimationResolver = !giftAnimationResolver;
        this.giftAnimationResolver = giftAnimationResolver || createGiftAnimationResolver({ logger });
        const defaultTestFetch: SpeechFetch = async () => new Response(JSON.stringify({ ready: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' }
        });
        this.outputFetch = fetchOverride
            || (process.env.NODE_ENV === 'test' ? defaultTestFetch : globalThis.fetch.bind(globalThis));
        this.guardedFetch = async (input, init) => {
            this.assertActive();
            const signal = init?.signal ? AbortSignal.any([init.signal, this.controller.signal]) : this.controller.signal;
            const result = await this.outputFetch(input, { ...init, signal });
            this.assertActive();
            return result;
        };
    }

    dispose(): Promise<void> {
        if (this.disposalPromise) return this.disposalPromise;
        let resolve!: () => void;
        let reject!: (reason: unknown) => void;
        this.disposalPromise = new Promise<void>((resolvePromise, rejectPromise) => {
            resolve = resolvePromise;
            reject = rejectPromise;
        });
        try {
            this.cancelActive();
            const disposal = this.ownsGiftAnimationResolver ? this.giftAnimationResolver.dispose?.() : undefined;
            Promise.resolve(disposal).then(resolve, reject);
        } catch (error) {
            reject(error);
        }
        return this.disposalPromise;
    }

    isGuiGiftAnimationEnabled() {
        const state = this.getGuiGiftAnimationState();
        return state.guiEnabled && state.giftsVisible;
    }

    getGuiGiftAnimationState() {
        const gui = this.config?.gui || {};
        const guiEnabled = gui.enableDock === true || gui.enableOverlay === true;
        const giftsVisible = gui.showGifts !== false;
        return {
            enableDock: gui.enableDock === true,
            enableOverlay: gui.enableOverlay === true,
            showGifts: gui.showGifts !== false,
            guiEnabled,
            giftsVisible
        };
    }

    logDebug(message: string, data: Record<string, unknown> | null = null) {
        if (!logger || typeof logger.debug !== 'function') {
            return;
        }
        logger.debug(message, 'display-queue', data);
    }

    async resolveAndEmitGiftAnimation(item: QueueItem) {
        if (!this.eventBus || item?.type !== 'platform:gift' || item?.platform !== 'tiktok') {
            return 0;
        }

        if (!this.isGuiGiftAnimationEnabled()) {
            this.logDebug('[Gift] Skipped gift animation resolution', {
                reason: 'gui-gift-animation-disabled',
                platform: item?.platform || null,
                type: item?.type || null,
                gui: this.getGuiGiftAnimationState()
            });
            return 0;
        }

        const resolved = await this.giftAnimationResolver.resolveFromNotificationData(item?.data);
        this.assertActive();
        if (!resolved) {
            this.logDebug('[Gift] No TikTok gift animation asset resolved', {
                platform: item?.platform || null,
                type: item?.type || null
            });
            return 0;
        }

        const durationMs = Number(resolved.durationMs);
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
            return 0;
        }

        const playbackId = crypto.randomUUID();
        const settledWaiter = this.createGiftAnimationCompletionWaiter(playbackId, durationMs);
        this.eventBus.emit('display:gift-animation', {
            playbackId,
            type: item.type,
            platform: item.platform,
            durationMs,
            mediaFilePath: resolved.mediaFilePath,
            mediaContentType: resolved.mediaContentType,
            animationConfig: resolved.animationConfig
        });

        this.logDebug('[Gift] Emitted TikTok gift animation effect', {
            playbackId,
            platform: item.platform,
            type: item.type,
            durationMs
        });

        await settledWaiter.promise;
        return durationMs;
    }

    createGiftAnimationCompletionWaiter(playbackId: string, durationMs: number) {
        const eventBus = this.eventBus;
        if (!eventBus || (!eventBus.subscribe && !eventBus.on)) {
            return { promise: Promise.resolve(), cancel: () => {} };
        }
        const timeoutMs = Math.min(Math.max(durationMs + 1000, 1000), 60000);
        let unsubscribe = () => {};
        let timeoutHandle: ReturnType<typeof safeSetTimeout> | undefined;
        let cancelWait = () => {};
        const promise = new Promise<void>((resolve) => {
            let settled = false;
            const cleanup = () => {
                if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
                try { unsubscribe(); }
                catch (error) { this.handleDisplayQueueError('[Gift] Error removing animation completion subscription', error); }
            };
            const settle = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve();
            };
            const handler = (payload?: Record<string, unknown>) => {
                if (payload?.playbackId === playbackId) settle();
            };
            if (typeof eventBus.subscribe === 'function') {
                unsubscribe = eventBus.subscribe('display:gift-animation-settled', handler);
            } else {
                eventBus.on?.('display:gift-animation-settled', handler);
                unsubscribe = () => eventBus.off?.('display:gift-animation-settled', handler);
            }
            timeoutHandle = safeSetTimeout(settle, timeoutMs);
            cancelWait = settle;
        });
        return this.trackWaiter({ promise, cancel: () => cancelWait() });
    }

    isChatTTSEnabled() {
        return this.config.ttsChatEnabled === true || this.config.obs?.ttsChatEnabled === true;
    }

    isNotificationTTSEnabled() {
        if (typeof this.config.ttsNotificationsEnabled === 'boolean') {
            return this.config.ttsNotificationsEnabled;
        }

        if (typeof this.config.obs?.ttsNotificationsEnabled === 'boolean') {
            return this.config.obs.ttsNotificationsEnabled;
        }

        return true;
    }

    private resolveNeuralTtsTarget(): { root: string; voice: string | undefined } {
        const endpoint = this.config.obs?.neuralTtsEndpoint || 'http://127.0.0.1:8765';
        let baseUrl: URL;
        try {
            baseUrl = new URL(endpoint);
        } catch {
            throw new Error(`Invalid neural TTS endpoint: ${endpoint}`);
        }

        const loopbackHosts = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);
        if (baseUrl.protocol !== 'http:' || !loopbackHosts.has(baseUrl.hostname)) {
            throw new Error('Neural TTS endpoint must use HTTP on loopback');
        }

        const root = baseUrl.toString().replace(/\/$/, '');
        const voice = this.config.obs?.neuralTtsVoice?.trim() || undefined;
        return { root, voice };
    }

    private getPreparedStageKey(voice: string | undefined, text: string) {
        return `${voice ?? ''}\u0000${text}`;
    }

    private async verifyNeuralTtsHealth(root: string) {
        const health = await this.fetch(`${root}/health`, {
            method: 'GET',
            redirect: 'error',
            signal: AbortSignal.timeout(NEURAL_TTS_HEALTH_TIMEOUT_MS)
        });
        if (health.status === 503) {
            await recoverNeuralTts(this.outputFetch, root, { signal: this.controller.signal });
        } else if (!health.ok) {
            throw new Error(`Neural TTS service is not ready (HTTP ${health.status})`);
        }
    }

    async prepareTTSText(text: string) {
        await this.prepareWithNeuralTts(text);
    }

    async prepareWithNeuralTts(text: string) {
        text = normalizeTtsText(text);
        const { root, voice } = this.resolveNeuralTtsTarget();
        if (!this.healthVerified) {
            await this.verifyNeuralTtsHealth(root);
            this.healthVerified = true;
        }

        const response = await requestNeuralTts(this.fetch, root, 'prepare', text, voice, logger);
        if (response.status === 404) {
            return;
        }
        if (!response.ok) {
            throw new Error(`Neural TTS request failed (HTTP ${response.status})`);
        }

        const stageKey = this.getPreparedStageKey(voice, text);
        this.preparedStageCounts.set(stageKey, (this.preparedStageCounts.get(stageKey) ?? 0) + 1);
    }

    async prepareNotificationTTS(ttsStages: TtsStage[]) {
        if (!this.isNotificationTTSEnabled() || ttsStages.length === 0 || this.notificationPrepared) {
            return;
        }
        this.notificationPrepared = true;
        for (const stage of ttsStages) {
            await this.prepareTTSText(stage.text);
        }
    }

    async prepareNotificationEffects(item: QueueItem) {
        if (!this.isNotificationTTSEnabled()) {
            return;
        }
        try {
            const ttsStages = MessageTTSHandler.createTTSStages(item.data);
            if (ttsStages.length === 0) {
                return;
            }
            await this.prepareNotificationTTS(ttsStages);
        } catch (error) {
            if (error === this.controller.signal.reason && this.controller.signal.aborted) return;
            this.notificationPrepareFailed = true;
            this.handleDisplayQueueError(`[Display Queue] Error handling notification effects for ${item?.type}`, error, { itemType: item?.type });
        }
    }

    async setTTSText(text: string) {
        await this.speakWithNeuralTts(text);
    }

    async speakWithNeuralTts(text: string) {
        text = normalizeTtsText(text);
        const { root, voice } = this.resolveNeuralTtsTarget();
        const stageKey = this.getPreparedStageKey(voice, text);
        const preparedCount = this.preparedStageCounts.get(stageKey) ?? 0;
        if (preparedCount > 0) {
            if (preparedCount === 1) {
                this.preparedStageCounts.delete(stageKey);
            } else {
                this.preparedStageCounts.set(stageKey, preparedCount - 1);
            }
        } else if (!this.healthVerified) {
            await this.verifyNeuralTtsHealth(root);
        }

        const response = await requestNeuralTts(this.fetch, root, 'speak', text, voice, logger);
        if (!response.ok) {
            throw new Error(`Neural TTS request failed (HTTP ${response.status})`);
        }
    }

    async handleNotificationEffects(item: QueueItem) {
        try {
            const username = this.extractUsername(item?.data);
            logger.debug(`Processing notification effects for ${item?.type} from ${username}`, 'display-queue');

            const ttsStages = MessageTTSHandler.createTTSStages(item.data);

            if (item.type === 'platform:gift') {
                await this.handleGiftEffects(item, ttsStages);
            } else {
                await this.handleSequentialEffects(item, ttsStages);
            }
        } catch (error) {
            if (error === this.controller.signal.reason && this.controller.signal.aborted) return;
            this.handleDisplayQueueError(`[Display Queue] Error handling notification effects for ${item?.type}`, error, { itemType: item?.type });
        }
    }

    async handleChatTTSEffects(item: QueueItem, message: string) {
        if (!this.isChatTTSEnabled()) {
            return;
        }

        try {
            const username = this.extractUsername(item?.data) || '';
            const ttsStages = MessageTTSHandler.createTTSStages({
                ...item.data,
                type: item.type,
                username,
                message,
                isComment: true
            });

            for (const stage of ttsStages) {
                if (stage.delay > 0) {
                    await this.delay(stage.delay);
                }

                await this.setTTSText(stage.text);
            }
        } catch (error) {
            if (error === this.controller.signal.reason && this.controller.signal.aborted) return;
            this.handleDisplayQueueError('[Display Queue] Error handling chat TTS effects', error, { itemType: item?.type });
        }
    }

    async processMonetizationGoal(item: QueueItem) {
        if (!item?.data || item.data.isError) {
            return;
        }

        if (item.data.goalProcessed || this.goalAttempts.has(item)) {
            logger.debug(`Goal already processed for ${item.data.username}, skipping`, 'display-queue');
            return;
        }

        this.goalAttempts.add(item);
        try {
            let result: unknown;
            if (item.type === 'platform:gift') {
                result = await this.processDonationGoal(item);
            } else if (item.type === 'platform:paypiggy') {
                result = await this.goalsManager.processPaypiggyGoal(item.platform || '', 1);
            } else if (item.type === 'platform:giftpaypiggy') {
                const giftCount = Number(item.data.giftCount);
                if (!Number.isFinite(giftCount) || !Number.isInteger(giftCount) || giftCount <= 0) {
                    throw new Error('Giftpaypiggy goal tracking requires giftCount');
                }
                result = await this.goalsManager.processPaypiggyGoal(item.platform || '', giftCount);
            } else {
                return;
            }
            const applied = !!result && typeof result === 'object' && 'success' in result && result.success === true;
            item.data.goalOutcome = applied ? 'applied' : 'not-applied';
            if (applied) item.data.goalProcessed = true;
            logger.debug(`Native goal outcome: ${item.data.goalOutcome}`, 'display-queue', { type: item.type, platform: item.platform });
        } catch (error) {
            item.data.goalOutcome = 'failed';
            this.handleDisplayQueueError(`[Display Queue] Goal tracking failed for ${item.platform}`, error, { platform: item.platform, type: item.type });
        }
    }

    async processDonationGoal(item: QueueItem) {
        const amountValue = Number(item.data?.amount);
        const currencyValue = typeof item.data?.currency === 'string' ? item.data.currency.trim().toLowerCase() : '';
        const totalGiftValue = Number.isFinite(amountValue) ? amountValue : 0;

        if (totalGiftValue <= 0) {
            return;
        }

        if (!currencyValue) {
            throw new Error('Gift goal tracking requires currency');
        }

        const giftCount = Number(item.data?.giftCount);
        if (currencyValue === 'coins' && (!Number.isFinite(giftCount) || giftCount <= 0)) {
            throw new Error('Gift goal tracking requires giftCount');
        }

        const result = await this.goalsManager.processDonationGoal(item.platform || '', totalGiftValue, currencyValue);
        if (!result || typeof result !== 'object' || !('success' in result) || result.success !== true) return result;
        if (currencyValue === 'bits') {
            logger.debug(`Goal tracking processed for ${item.platform}: ${totalGiftValue} bits`, 'display-queue');
        } else if (currencyValue === 'coins') {
            const perGift = giftCount > 0 ? (totalGiftValue / giftCount) : totalGiftValue;
            logger.debug(`Goal tracking processed for ${item.platform}: ${totalGiftValue} coins (${perGift} \u00d7 ${giftCount})`, 'display-queue');
        } else {
            logger.debug(`Goal tracking processed for ${item.platform}: ${totalGiftValue} ${currencyValue}`, 'display-queue');
        }
        return result;
    }

    async handleGiftEffects(item: QueueItem, ttsStages: TtsStage[]) {
        const username = this.extractUsername(item.data);
        logger.debug(`Gift notification - concurrent execution for ${username}`, 'display-queue');
        if (this.isNotificationTTSEnabled() && ttsStages.length > 0 && !this.notificationPrepared && !this.notificationPrepareFailed) {
            await this.prepareNotificationTTS(ttsStages);
        }
        const allPromises: Array<Promise<unknown>> = [];
        const animationPromise = this.resolveAndEmitGiftAnimation(item)
            .catch((error) => {
                this.handleDisplayQueueError('[Gift] Gift animation resolution failed', error, {
                    platform: item?.platform,
                    type: item?.type
                });
            });
        const vfxConfig = item.vfxConfig;
        const hasVfx = !!(this.eventBus && vfxConfig);
        allPromises.push(this.playGiftVideoAndAudio());

        const handcamConfig = this.config.handcam;
        if (handcamConfig?.enabled) {
            allPromises.push(Promise.resolve().then(() => {
                return this.triggerHandcamGlow(this.obsManager, handcamConfig, this.controller.signal);
            }).catch(err => {
                this.handleDisplayQueueError('[Gift] Error activating handcam glow', err);
            }));
        }

        if (this.isNotificationTTSEnabled() && ttsStages.length > 0 && !this.notificationPrepareFailed) {
            const ttsPromise = (async () => {
                for (const stage of ttsStages) {
                    if (stage.delay > 0) {
                        await this.delay(stage.delay);
                    }
                    await this.setTTSText(stage.text);
                }
            })();
            allPromises.push(ttsPromise);
        }

        if (hasVfx) {
            const vfxPromise = this.delay(2000).then(async () => {
                const result = await this.emitVfxFromConfig(item, username, { delayApplied: 2000 });
                if (result.completionPromise) {
                    await result.completionPromise;
                }
            });
            allPromises.push(vfxPromise);
        }

        const results = await Promise.allSettled([...allPromises, animationPromise]);
        for (const result of results) if (result.status === 'rejected') throw result.reason;
    }

    async handleSequentialEffects(item: QueueItem, ttsStages: TtsStage[]) {
        const username = this.extractUsername(item.data);
        logger.debug(`Sequential notification - VFX-first execution for ${username}`, 'display-queue');

        if (this.isNotificationTTSEnabled() && ttsStages.length > 0 && !this.notificationPrepared && !this.notificationPrepareFailed) {
            await this.prepareNotificationTTS(ttsStages);
        }

        let completionResult: { reason: string; payload?: Record<string, unknown> } | null = null;
        const vfxConfig = item.vfxConfig;
        const hasVfx = !!(this.eventBus && vfxConfig);

        let match: VfxMatch | null = null;
        if (hasVfx) {
            try {
                match = this.buildVfxMatch(vfxConfig);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn(`VFX match build failed: ${errorMessage}`, 'display-queue');
                match = null;
            }
            if (match) {
                const emitResult = await this.emitVfxFromConfig(item, username);
                if (emitResult.emitted && emitResult.match?.correlationId) {
                    match.correlationId = emitResult.match.correlationId;
                }
                completionResult = emitResult.error || !emitResult.emitted || !emitResult.completionPromise
                    ? null
                    : await emitResult.completionPromise;
            }
        }

        const secondaryVfxConfig = item.secondaryVfxConfig;
        if (item.type === 'greeting' && secondaryVfxConfig) {
            let secondaryMatch: VfxMatch | null = null;
            try {
                secondaryMatch = this.buildVfxMatch(secondaryVfxConfig);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn(`Secondary greeting VFX match build failed: ${errorMessage}`, 'display-queue');
                secondaryMatch = null;
            }

            if (secondaryMatch) {
                const emitResult = await this.emitVfxFromConfig({
                    ...item,
                    vfxConfig: secondaryVfxConfig
                }, username);
                if (emitResult.emitted && emitResult.match?.correlationId) {
                    secondaryMatch.correlationId = emitResult.match.correlationId;
                }
                if (!emitResult.error && emitResult.emitted && emitResult.completionPromise) {
                    completionResult = await emitResult.completionPromise;
                }
            }
        }

        if (this.isNotificationTTSEnabled() && ttsStages.length > 0 && !this.notificationPrepareFailed) {
            for (const stage of ttsStages) {
                if (stage.delay > 0) {
                    await this.delay(stage.delay);
                }

                await this.setTTSText(stage.text);
            }
        }

        return completionResult;
    }

    async playGiftVideoAndAudio() {
        try {
            const { giftVideoSource, giftAudioSource } = this.config.gifts || {};
            if (!giftVideoSource || !giftAudioSource) {
                this.handleDisplayQueueError('[Gift] Gift media sources not configured; skipping gift media');
                return false;
            }

            const sources = [...new Set([giftVideoSource, giftAudioSource])];
            const completionWaiters = sources.map((source) => this.waitForGiftMediaCompletion(source));
            const completionPromises = completionWaiters.map((waiter) => waiter.promise);
            const promises = sources.map((source) => this.obsManager.call('TriggerMediaInputAction', {
                inputName: source,
                mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
            }).catch(err => {
                this.handleDisplayQueueError(`[Gift] Error starting gift media source "${source}"`, err);
                throw err;
            }));

            try {
                const results = await Promise.allSettled(promises);
                for (const result of results) if (result.status === 'rejected') throw result.reason;
                await Promise.all(completionPromises);
            } catch (error) {
                completionWaiters.forEach((waiter) => waiter.cancel());
                throw error;
            }
            return true;
        } catch (error) {
            this.handleDisplayQueueError('[Display Queue] Error playing gift video/audio', error);
            return false;
        }
    }

    waitForGiftMediaCompletion(sourceName: string, timeoutMs = 10000) {
        const obs = this.obsManager;
        if (typeof obs.addEventListener !== 'function' || typeof obs.removeEventListener !== 'function') {
            return { promise: Promise.resolve(), cancel: () => {} };
        }
        const addEventListener = obs.addEventListener;
        const removeEventListener = obs.removeEventListener;
        let cancelWait = () => {};
        const promise = new Promise<void>((resolve) => {
            let settled = false;
            let timeoutHandle: ReturnType<typeof safeSetTimeout> | undefined;
            const handler = (payload?: Record<string, unknown>) => {
                if (payload?.inputName !== sourceName || settled) return;
                settled = true;
                cleanup();
                resolve();
            };
            const cleanup = () => {
                if (timeoutHandle !== undefined) clearTimeout(timeoutHandle);
                try { removeEventListener.call(obs, 'MediaInputPlaybackEnded', handler); }
                catch (error) { this.handleDisplayQueueError('[Gift] Error removing media completion subscription', error); }
            };
            cancelWait = () => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve();
            };
            addEventListener.call(obs, 'MediaInputPlaybackEnded', handler);
            timeoutHandle = safeSetTimeout(() => {
                if (settled) return;
                settled = true;
                cleanup();
                resolve();
            }, timeoutMs);
        });
        return this.trackWaiter({ promise, cancel: () => cancelWait() });
    }

    buildVfxMatch(config: Record<string, unknown>): VfxMatch {
        if (!config || typeof config !== 'object') {
            throw new Error('VFX match requires config object');
        }
        const commandKey = typeof config.commandKey === 'string' ? config.commandKey : '';
        const filename = typeof config.filename === 'string' ? config.filename : '';
        const mediaSource = typeof config.mediaSource === 'string' ? config.mediaSource : '';
        const command = typeof config.command === 'string' ? config.command : '';
        if (!commandKey || !filename || !mediaSource || !command) {
            throw new Error('VFX match requires commandKey, filename, mediaSource, and command');
        }
        return {
            commandKey,
            filename,
            mediaSource,
            command
        };
    }

    createVfxCompletionWaiter(
        match: Partial<VfxMatch> = {},
        options: { timeoutMs?: number } = {}
    ): VfxCompletionWaiter {
        const noEventBus = !this.eventBus || (!this.eventBus.subscribe && !this.eventBus.on);
        if (noEventBus) {
            logger.debug('EventBus not available for VFX completion wait', 'display-queue', { match });
            return {
                promise: Promise.resolve({ reason: 'no-eventbus' }),
                cancel: () => {}
            };
        }

        const requestedTimeoutMs = Number(options.timeoutMs);
        const timeoutMs = Number.isFinite(requestedTimeoutMs) && requestedTimeoutMs > 0
            ? requestedTimeoutMs
            : 10000;
        const eventNames = [VFX_EVENTS.EFFECT_COMPLETED];
        const eventBus = this.eventBus;
        const subscribe = (eventName: string, handler: (payload: Record<string, unknown>) => void) => {
            if (eventBus && typeof eventBus.subscribe === 'function') {
                return eventBus.subscribe(eventName, handler);
            }
            if (eventBus && typeof eventBus.on === 'function') {
                eventBus.on(eventName, handler);
                return () => {
                    if (typeof eventBus.off === 'function') {
                        eventBus.off(eventName, handler);
                    }
                };
            }
            return () => {};
        };

        let cancelWait = () => {};
        let timeoutHandle: ReturnType<typeof safeSetTimeout> | undefined;
        const promise = new Promise<VfxCompletionResult>((resolve) => {
            let resolved = false;
            const unsubscribeFns: Array<() => void> = [];

            const cleanup = () => {
                if (timeoutHandle !== undefined) {
                    clearTimeout(timeoutHandle);
                    timeoutHandle = undefined;
                }
                unsubscribeFns.forEach(unsub => {
                    try {
                        unsub();
                    } catch (err) {
                        logger.debug('Error cleaning up VFX completion subscription', 'display-queue', err);
                    }
                });
            };

            const settle = (result: VfxCompletionResult) => {
                if (resolved) {
                    return;
                }
                resolved = true;
                cleanup();
                resolve(result);
            };

            const matches = (payload: Record<string, unknown> = {}) => {
                const payloadCorrelationId = typeof payload.correlationId === 'string' ? payload.correlationId : null;
                if (typeof match.correlationId === 'string' && match.correlationId.trim().length > 0) {
                    if (!payloadCorrelationId) {
                        return false;
                    }
                    return match.correlationId === payloadCorrelationId;
                }

                const hasExactTuple = typeof match.commandKey === 'string'
                    && typeof match.command === 'string'
                    && typeof match.filename === 'string'
                    && typeof match.mediaSource === 'string'
                    && match.commandKey.trim().length > 0
                    && match.command.trim().length > 0
                    && match.filename.trim().length > 0
                    && match.mediaSource.trim().length > 0;

                if (!hasExactTuple) {
                    return false;
                }

                const payloadKey = typeof payload.commandKey === 'string' ? payload.commandKey : null;
                const payloadCommand = typeof payload.command === 'string' ? payload.command : null;
                const payloadFile = typeof payload.filename === 'string' ? payload.filename : null;
                const payloadSource = typeof payload.mediaSource === 'string' ? payload.mediaSource : null;

                return match.commandKey === payloadKey
                    && match.command === payloadCommand
                    && match.filename === payloadFile
                    && match.mediaSource === payloadSource;
            };

            const handler = (payload: Record<string, unknown>) => {
                if (resolved) {
                    return;
                }

                if (!matches(payload || {})) {
                    return;
                }

                settle({ reason: 'completed', payload });
            };

            eventNames.forEach(name => {
                const unsubscribe = subscribe(name, handler);
                if (typeof unsubscribe === 'function') {
                    unsubscribeFns.push(unsubscribe);
                }
            });

            cancelWait = () => settle({ reason: 'cancelled' });
            timeoutHandle = safeSetTimeout(() => {
                settle({ reason: 'timeout' });
            }, timeoutMs);
        });

        return this.trackWaiter({
            promise,
            cancel: () => cancelWait()
        });
    }

    async waitForVfxCompletion(match: Partial<VfxMatch> = {}, options: { timeoutMs?: number } = {}) {
        return this.createVfxCompletionWaiter(match, options).promise;
    }

    async emitVfxFromConfig(item: QueueItem, username: string | null, options: VfxEmitOptions = {}) {
        const vfxConfig = item && item.vfxConfig ? item.vfxConfig : null;
        if (!this.eventBus || !vfxConfig) {
            return { emitted: false, match: null, completionPromise: null };
        }

        let payload: Record<string, unknown> | undefined;
        try {
            const { command, commandKey, filename, mediaSource, vfxFilePath } = vfxConfig;
            if (!command || !commandKey || !filename || !mediaSource || !vfxFilePath) {
                throw new Error('VFX config requires command, commandKey, filename, mediaSource, and vfxFilePath');
            }
            if (!username || !item.platform) {
                throw new Error('VFX emit requires username and platform');
            }

            const correlationId = crypto.randomUUID();
            const match = this.buildVfxMatch(vfxConfig);
            match.correlationId = correlationId;
            const userId = typeof item.data?.userId === 'string' ? item.data.userId.trim() : '';
            const delayApplied = Number(options.delayApplied);
            const hasDelayApplied = Number.isFinite(delayApplied) && delayApplied >= 0;
            const context = {
                source: 'display-queue',
                notificationType: item.type || null,
                ...(hasDelayApplied ? { delayApplied } : {}),
                correlationId,
                skipCooldown: true
            };

            payload = {
                type: VFX_EVENTS.COMMAND_RECEIVED,
                command,
                commandKey,
                filename,
                mediaSource,
                username,
                platform: item.platform,
                ...(userId ? { userId } : {}),
                notificationType: item.type || null,
                ...(hasDelayApplied ? { delayApplied } : {}),
                correlationId,
                context,
                source: 'display-queue',
                vfxConfig
            };

            const completionWaiter = this.createVfxCompletionWaiter(match);
            try {
                this.eventBus.emit(VFX_EVENTS.COMMAND_RECEIVED, payload);
            } catch (error) {
                completionWaiter.cancel();
                throw error;
            }
            return { emitted: true, match, completionPromise: completionWaiter.promise };
        } catch (error) {
            this.handleDisplayQueueError('[DisplayQueue] Error emitting VFX command', error, payload);
            return { emitted: false, match: null, completionPromise: null, error };
        }
    }

}

export {
    DisplayQueueEffects
};
