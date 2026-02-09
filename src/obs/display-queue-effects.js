const crypto = require('crypto');
const { logger } = require('../core/logging');
const MessageTTSHandler = require('../utils/message-tts-handler');
const { safeDelay } = require('../utils/timeout-validator');
const { PlatformEvents } = require('../interfaces/PlatformEvents');
const { triggerHandcamGlow } = require('./handcam-glow');

class DisplayQueueEffects {
    constructor({
        obsManager,
        sourcesManager,
        goalsManager,
        eventBus,
        config,
        delay,
        handleDisplayQueueError,
        triggerHandcamGlow: triggerHandcamGlowOverride,
        extractUsername
    }) {
        this.obsManager = obsManager;
        this.sourcesManager = sourcesManager;
        this.goalsManager = goalsManager;
        this.eventBus = eventBus;
        this.config = config;
        this.delay = delay;
        this.handleDisplayQueueError = handleDisplayQueueError;
        this.triggerHandcamGlow = triggerHandcamGlowOverride || triggerHandcamGlow;
        this.extractUsername = extractUsername;
    }

    isTTSEnabled() {
        return this.config.ttsEnabled === true;
    }

    async setTTSText(text) {
        await this.sourcesManager.clearTextSource(this.config.obs.ttsTxt);
        await this.delay(50);
        await this.sourcesManager.updateTextSource(this.config.obs.ttsTxt, text);
    }

    async handleNotificationEffects(item) {
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

    async processGiftGoal(item) {
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
            await this.goalsManager.processDonationGoal(item.platform, totalGiftValue);
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

    async handleGiftEffects(item, ttsStages) {
        const username = this.extractUsername(item.data);
        logger.debug(`[Display Queue] Gift notification - concurrent execution for ${username}`, 'display-queue');
        const allPromises = [];
        const vfxConfig = item.vfxConfig;
        const hasVfx = !!(this.eventBus && vfxConfig);
        let vfxMatch = null;
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
        if (vfxMatch) {
            void this.waitForVfxCompletion(vfxMatch);
        }

        allPromises.push(this.playGiftVideoAndAudio());

        if (this.config.handcam?.enabled) {
            allPromises.push(Promise.resolve().then(() => {
                this.triggerHandcamGlow(this.obsManager, this.config.handcam);
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

        if (vfxMatch) {
            const vfxPromise = this.delay(2000).then(() => {
                let payload;
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

                    this.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, payload);
                } catch (error) {
                    this.handleDisplayQueueError('[Gift] Error emitting VFX command', error, payload);
                }
            });
            allPromises.push(vfxPromise);
        }

        await Promise.all(allPromises);
    }

    async handleSequentialEffects(item, ttsStages) {
        const username = this.extractUsername(item.data);
        logger.debug(`[Display Queue] Sequential notification - VFX-first execution for ${username}`, 'display-queue');

        let completionResult = null;
        const vfxConfig = item.vfxConfig;
        const hasVfx = !!(this.eventBus && vfxConfig);

        let match = null;
        if (hasVfx) {
            try {
                match = this.buildVfxMatch(vfxConfig);
            } catch {
                match = null;
            }
            if (match) {
                const emitResult = await this.emitVfxFromConfig(item, username);
                if (emitResult.emitted && emitResult.match?.correlationId) {
                    match.correlationId = emitResult.match.correlationId;
                }
                completionResult = emitResult.error
                    ? Promise.resolve(null)
                    : await this.waitForVfxCompletion(match);
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
            const { giftVideoSource, giftAudioSource } = this.config.gifts;
            if (!giftVideoSource || !giftAudioSource) {
                this.handleDisplayQueueError('[Gift] Gift media sources not configured; skipping gift media');
                return false;
            }

            const promises = [];

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

    buildVfxMatch(config) {
        if (!config || typeof config !== 'object') {
            throw new Error('VFX match requires config object');
        }
        const { commandKey, filename, mediaSource, command } = config;
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

    async waitForVfxCompletion(match = {}, options = {}) {
        const noEventBus = !this.eventBus || (!this.eventBus.subscribe && !this.eventBus.on);
        if (noEventBus) {
            logger.debug('[DisplayQueue] EventBus not available for VFX completion wait', 'display-queue', { match });
            return { reason: 'no-eventbus' };
        }

        const timeoutMs = typeof options.timeoutMs === 'number' ? options.timeoutMs : 10000;
        const eventNames = [PlatformEvents.VFX_EFFECT_COMPLETED, PlatformEvents.VFX_COMMAND_EXECUTED];
        const subscribe = (eventName, handler) => {
            if (typeof this.eventBus.subscribe === 'function') {
                return this.eventBus.subscribe(eventName, handler);
            }
            if (typeof this.eventBus.on === 'function') {
                this.eventBus.on(eventName, handler);
                return () => this.eventBus.off(eventName, handler);
            }
            return () => {};
        };

        return new Promise((resolve) => {
            let resolved = false;
            const unsubscribeFns = [];

            const cleanup = () => {
                unsubscribeFns.forEach(unsub => {
                    try {
                        unsub();
                    } catch (err) {
                        logger.debug('[DisplayQueue] Error cleaning up VFX completion subscription', 'display-queue', err);
                    }
                });
            };

            const matches = (payload = {}) => {
                if (match.correlationId && payload.correlationId && match.correlationId === payload.correlationId) {
                    return true;
                }

                const payloadKey = payload.commandKey;
                const payloadCommand = payload.command;
                const payloadFile = payload.filename;
                const payloadSource = payload.mediaSource;

                const byKey = match.commandKey && payloadKey && match.commandKey === payloadKey;
                const byCommand = match.command && payloadCommand && match.command === payloadCommand;
                const byFile = match.filename && payloadFile && match.filename === payloadFile;
                const bySource = match.mediaSource && payloadSource && match.mediaSource === payloadSource;

                return byKey || byCommand || byFile || bySource;
            };

            const handler = (payload) => {
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

    async emitVfxFromConfig(item, username) {
        const vfxConfig = item && item.vfxConfig ? item.vfxConfig : null;
        if (!this.eventBus || !vfxConfig) {
            return { emitted: false, match: null };
        }

        let payload;
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

            this.eventBus.emit(PlatformEvents.VFX_COMMAND_RECEIVED, payload);
            return { emitted: true, match };
        } catch (error) {
            this.handleDisplayQueueError('[DisplayQueue] Error emitting VFX command', error, payload);
            return { emitted: false, match: null, error };
        }
    }

}

module.exports = {
    DisplayQueueEffects
};
