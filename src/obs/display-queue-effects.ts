import crypto from 'node:crypto';
import { logger } from '../core/logging';
import { createTikTokGiftAnimationResolver } from '../services/tiktok-gift-animation/resolver';
import MessageTTSHandler from '../utils/message-tts-handler';
import { safeDelay } from '../utils/timeout-validator';
import { triggerHandcamGlow } from './handcam-glow';

const VFX_EVENTS = {
    EFFECT_COMPLETED: 'vfx:effect-completed',
    COMMAND_RECEIVED: 'vfx:command-received'
} as const;

type QueueItemData = Record<string, unknown> & {
    username?: string;
    userId?: string;
    amount?: unknown;
    currency?: unknown;
    giftCount?: unknown;
    isError?: boolean;
    goalProcessed?: boolean;
};

type QueueItem = {
    type: string;
    platform?: string;
    data: QueueItemData;
    vfxConfig?: Record<string, unknown>;
    secondaryVfxConfig?: Record<string, unknown>;
    holdDurationMs?: number;
};

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

type DisplayQueueEffectsDependencies = {
    obsManager: {
        call: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
    };
    sourcesManager: {
        clearTextSource: (sourceName: string) => Promise<void>;
        updateTextSource: (sourceName: string, text: string) => Promise<void>;
    };
    goalsManager: {
        processDonationGoal: (platform: string, amount: number) => Promise<unknown>;
    };
    eventBus?: {
        emit: (eventName: string, payload: Record<string, unknown>) => void;
        subscribe?: (eventName: string, handler: (payload: Record<string, unknown>) => void) => () => void;
        on?: (eventName: string, handler: (payload: Record<string, unknown>) => void) => void;
        off?: (eventName: string, handler: (payload: Record<string, unknown>) => void) => void;
    } | null;
    config: {
        ttsEnabled?: boolean;
        obs: {
            ttsTxt: string;
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
    delay: (ms: number) => Promise<void>;
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
    };
};

class DisplayQueueEffects {
    obsManager: DisplayQueueEffectsDependencies['obsManager'];
    sourcesManager: DisplayQueueEffectsDependencies['sourcesManager'];
    goalsManager: DisplayQueueEffectsDependencies['goalsManager'];
    eventBus: DisplayQueueEffectsDependencies['eventBus'];
    config: DisplayQueueEffectsDependencies['config'];
    delay: DisplayQueueEffectsDependencies['delay'];
    handleDisplayQueueError: DisplayQueueEffectsDependencies['handleDisplayQueueError'];
    triggerHandcamGlow: typeof triggerHandcamGlow;
    extractUsername: DisplayQueueEffectsDependencies['extractUsername'];
    giftAnimationResolver: NonNullable<DisplayQueueEffectsDependencies['giftAnimationResolver']>;

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
        giftAnimationResolver
    }: DisplayQueueEffectsDependencies) {
        this.obsManager = obsManager;
        this.sourcesManager = sourcesManager;
        this.goalsManager = goalsManager;
        this.eventBus = eventBus || null;
        this.config = config;
        this.delay = delay;
        this.handleDisplayQueueError = handleDisplayQueueError;
        this.triggerHandcamGlow = triggerHandcamGlowOverride || triggerHandcamGlow;
        this.extractUsername = extractUsername;
        this.giftAnimationResolver = giftAnimationResolver || createTikTokGiftAnimationResolver({ logger });
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

        return durationMs;
    }

    isTTSEnabled() {
        return this.config.ttsEnabled === true;
    }

    async setTTSText(text: string) {
        await this.sourcesManager.clearTextSource(this.config.obs.ttsTxt);
        await this.delay(50);
        await this.sourcesManager.updateTextSource(this.config.obs.ttsTxt, text);
    }

    async handleNotificationEffects(item: QueueItem) {
        try {
            const username = this.extractUsername(item?.data);
            logger.debug(`[Display Queue] Processing notification effects for ${item?.type} from ${username}`, 'display-queue');

            if (item?.type === 'platform:gift') {
                await this.processGiftGoal(item);
            }

            const ttsStages = MessageTTSHandler.createTTSStages(item.data);
            logger.debug(`[Display Queue] Generated ${ttsStages.length} TTS stages`, 'display-queue', { stages: ttsStages });

            if (item.type === 'platform:gift') {
                await this.handleGiftEffects(item, ttsStages);
            } else {
                await this.handleSequentialEffects(item, ttsStages);
            }
        } catch (error) {
            this.handleDisplayQueueError(`[Display Queue] Error handling notification effects for ${item?.type}`, error, { itemType: item?.type });
        }
    }

    async processGiftGoal(item: QueueItem) {
        if (!item?.data || item.data.isError) {
            return;
        }

        if (item.data.goalProcessed) {
            logger.debug(`[Display Queue] Goal already processed for ${item.data.username}, skipping`, 'display-queue');
            return;
        }

        const amountValue = Number(item.data.amount);
        const currencyValue = typeof item.data.currency === 'string' ? item.data.currency.trim().toLowerCase() : '';
        const totalGiftValue = Number.isFinite(amountValue) ? amountValue : 0;

        if (totalGiftValue <= 0) {
            return;
        }

        try {
            if (!currencyValue) {
                throw new Error('Gift goal tracking requires currency');
            }
            const giftCount = Number(item.data.giftCount);
            if (currencyValue === 'coins') {
                if (!Number.isFinite(giftCount) || giftCount <= 0) {
                    throw new Error('Gift goal tracking requires giftCount');
                }
            }
            await this.goalsManager.processDonationGoal(item.platform || '', totalGiftValue);
            if (currencyValue === 'bits') {
                logger.debug(`[Display Queue] Goal tracking processed for ${item.platform}: ${totalGiftValue} bits`, 'display-queue');
            } else if (currencyValue === 'coins') {
                const perGift = giftCount > 0 ? (totalGiftValue / giftCount) : totalGiftValue;
                logger.debug(`[Display Queue] Goal tracking processed for ${item.platform}: ${totalGiftValue} coins (${perGift} × ${giftCount})`, 'display-queue');
            } else {
                logger.debug(`[Display Queue] Goal tracking processed for ${item.platform}: ${totalGiftValue} ${currencyValue}`, 'display-queue');
            }
            item.data.goalProcessed = true;
        } catch (error) {
            this.handleDisplayQueueError(`[Display Queue] Goal tracking failed for ${item.platform}`, error, { platform: item.platform, totalGiftValue });
        }
    }

    async handleGiftEffects(item: QueueItem, ttsStages: TtsStage[]) {
        const username = this.extractUsername(item.data);
        logger.debug(`[Display Queue] Gift notification - concurrent execution for ${username}`, 'display-queue');
        const allPromises: Array<Promise<unknown>> = [];
        const animationPromise = this.resolveAndEmitGiftAnimation(item)
            .then((animationDurationMs) => {
                if (!(animationDurationMs > 0)) {
                    return;
                }

                const previousHold = Number(item?.holdDurationMs);
                const nextHold = Number.isFinite(previousHold) && previousHold > 0
                    ? Math.max(previousHold, animationDurationMs)
                    : animationDurationMs;
                item.holdDurationMs = nextHold;
            })
            .catch((error) => {
                this.handleDisplayQueueError('[Gift] Gift animation resolution failed', error, {
                    platform: item?.platform,
                    type: item?.type
                });
            });
        const vfxConfig = item.vfxConfig;
        const hasVfx = !!(this.eventBus && vfxConfig);
        let vfxMatch: VfxMatch | null = null;
        if (hasVfx) {
            try {
                vfxMatch = this.buildVfxMatch(vfxConfig);
            } catch (error) {
                this.handleDisplayQueueError('[Gift] Invalid VFX config for gift notification', error, {
                    notificationType: item?.type,
                    platform: item?.platform
                });
            }
        }
        allPromises.push(this.playGiftVideoAndAudio());

        const handcamConfig = this.config.handcam;
        if (handcamConfig?.enabled) {
            allPromises.push(Promise.resolve().then(() => {
                this.triggerHandcamGlow(this.obsManager, handcamConfig);
            }).catch(err => {
                this.handleDisplayQueueError('[Gift] Error activating handcam glow', err);
            }));
        }

        if (this.isTTSEnabled()) {
            for (const stage of ttsStages) {
                const ttsPromise = (async () => {
                    if (stage.delay > 0) {
                        await this.delay(stage.delay);
                    }
                    await this.setTTSText(stage.text);
                })();

                allPromises.push(ttsPromise);
            }
        }

        const eventBus = this.eventBus;
        if (vfxMatch && eventBus && vfxConfig) {
            const vfxPromise = this.delay(2000).then(async () => {
                let payload: Record<string, unknown> | undefined;
                try {
                    const { command, commandKey, filename, mediaSource, vfxFilePath } = vfxConfig;
                    if (!command || !commandKey || !filename || !mediaSource || !vfxFilePath) {
                        throw new Error('Gift VFX config requires command, commandKey, filename, mediaSource, and vfxFilePath');
                    }
                    if (!username || !item.platform || !item.data?.userId) {
                        throw new Error('Gift VFX emit requires username, platform, and userId');
                    }
                    const correlationId = crypto.randomUUID();
                    payload = {
                        command,
                        commandKey,
                        filename,
                        mediaSource,
                        username,
                        platform: item.platform,
                        userId: item.data.userId,
                        notificationType: item.type,
                        delayApplied: 2000,
                        correlationId,
                        source: 'display-queue',
                        context: { source: 'display-queue', notificationType: item.type, delayApplied: 2000, skipCooldown: true, correlationId },
                        vfxConfig
                    };

                    vfxMatch.correlationId = correlationId;
                    const completionPromise = this.waitForVfxCompletion(vfxMatch);
                    eventBus.emit(VFX_EVENTS.COMMAND_RECEIVED, payload);
                    await completionPromise;
                } catch (error) {
                    this.handleDisplayQueueError('[Gift] Error emitting VFX command', error, payload);
                }
            });
            allPromises.push(vfxPromise);
        }

        await Promise.all(allPromises);
        await animationPromise;
    }

    async handleSequentialEffects(item: QueueItem, ttsStages: TtsStage[]) {
        const username = this.extractUsername(item.data);
        logger.debug(`[Display Queue] Sequential notification - VFX-first execution for ${username}`, 'display-queue');

        let completionResult: { reason: string; payload?: Record<string, unknown> } | null = null;
        const vfxConfig = item.vfxConfig;
        const hasVfx = !!(this.eventBus && vfxConfig);

        let match: VfxMatch | null = null;
        if (hasVfx) {
            try {
                match = this.buildVfxMatch(vfxConfig);
            } catch (error) {
                const errorMessage = error instanceof Error ? error.message : String(error);
                logger.warn(`[Display Queue] VFX match build failed: ${errorMessage}`, 'display-queue');
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
                logger.warn(`[Display Queue] Secondary greeting VFX match build failed: ${errorMessage}`, 'display-queue');
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

        if (this.isTTSEnabled()) {
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

            const promises: Array<Promise<unknown>> = [];

            promises.push(this.obsManager.call('TriggerMediaInputAction', {
                inputName: giftVideoSource,
                mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
            }).catch(err => {
                this.handleDisplayQueueError(`[Gift] Error starting gift video source "${giftVideoSource}"`, err);
                throw err;
            }));

            promises.push(this.obsManager.call('TriggerMediaInputAction', {
                inputName: giftAudioSource,
                mediaAction: 'OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART'
            }).catch(err => {
                this.handleDisplayQueueError(`[Gift] Error starting gift audio source "${giftAudioSource}"`, err);
                throw err;
            }));

            await Promise.all(promises);
            return true;
        } catch (error) {
            this.handleDisplayQueueError('[Display Queue] Error playing gift video/audio', error);
            return false;
        }
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

    async waitForVfxCompletion(match: Partial<VfxMatch> = {}, options: { timeoutMs?: number } = {}) {
        const noEventBus = !this.eventBus || (!this.eventBus.subscribe && !this.eventBus.on);
        if (noEventBus) {
            logger.debug('[DisplayQueue] EventBus not available for VFX completion wait', 'display-queue', { match });
            return { reason: 'no-eventbus' };
        }

        const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 10000;
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

        return new Promise<{ reason: string; payload?: Record<string, unknown> }>((resolve) => {
            let resolved = false;
            const unsubscribeFns: Array<() => void> = [];

            const cleanup = () => {
                unsubscribeFns.forEach(unsub => {
                    try {
                        unsub();
                    } catch (err) {
                        logger.debug('[DisplayQueue] Error cleaning up VFX completion subscription', 'display-queue', err);
                    }
                });
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

                resolved = true;
                cleanup();
                resolve({ reason: 'completed', payload });
            };

            eventNames.forEach(name => {
                unsubscribeFns.push(subscribe(name, handler));
            });

            safeDelay(timeoutMs, timeoutMs, 'vfx-completion-wait').then(() => {
                if (resolved) return;
                resolved = true;
                cleanup();
                resolve({ reason: 'timeout' });
            });
        });
    }

    async emitVfxFromConfig(item: QueueItem, username: string | null) {
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
            if (!username || !item.platform || !item.data?.userId) {
                throw new Error('VFX emit requires username, platform, and userId');
            }

            const correlationId = crypto.randomUUID();
            const match = this.buildVfxMatch(vfxConfig);
            match.correlationId = correlationId;

            payload = {
                command,
                commandKey,
                filename,
                mediaSource,
                username,
                platform: item.platform,
                userId: item.data.userId,
                correlationId,
                context: { source: 'display-queue', notificationType: item.type || null, correlationId, skipCooldown: true },
                source: 'display-queue',
                vfxConfig
            };

            const completionPromise = this.waitForVfxCompletion(match);
            this.eventBus.emit(VFX_EVENTS.COMMAND_RECEIVED, payload);
            return { emitted: true, match, completionPromise };
        } catch (error) {
            this.handleDisplayQueueError('[DisplayQueue] Error emitting VFX command', error, payload);
            return { emitted: false, match: null, completionPromise: null, error };
        }
    }

}

export {
    DisplayQueueEffects
};
