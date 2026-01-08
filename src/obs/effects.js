
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { safeDelay } = require('../utils/timeout-validator');
const { createRetrySystem } = require('../utils/retry-system');

const DEFAULT_HANDCAM_ANIMATION_STEPS_DIVISOR = 10;

class OBSEffectsManager {
    constructor(obsManager, dependencies = {}) {
        // Require OBS manager as first parameter
        if (!obsManager) {
            throw new Error('OBSEffectsManager requires OBSConnectionManager instance');
        }

        // Direct reference to OBS manager (no wrapper indirection)
        this.obsManager = obsManager;

        // Inject other dependencies with default implementations
        const { logger } = require('../core/logging');
        this.logger = dependencies.logger || logger;
        this.log = this.logger;
        this.sourcesManager = dependencies.sourcesManager;
        this.eventBus = dependencies.eventBus;
        this.retrySystem = dependencies.retrySystem || createRetrySystem({ logger: this.logger });

        // Convenience bindings for OBS manager methods
        this.ensureOBSConnected = this.obsManager.ensureConnected.bind(this.obsManager);
        this.obsCall = this.obsManager.call.bind(this.obsManager);

        // Bind sources manager methods if available
        if (this.sourcesManager) {
            this.setSourceFilterEnabled = this.sourcesManager.setSourceFilterEnabled?.bind(this.sourcesManager);
            this.getSourceFilterSettings = this.sourcesManager.getSourceFilterSettings?.bind(this.sourcesManager);
            this.setSourceFilterSettings = this.sourcesManager.setSourceFilterSettings?.bind(this.sourcesManager);
        }

        this.delay = dependencies.delay || this.retrySystem.delay || safeDelay;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'obs-effects');
    }


    async playMediaInOBS(commandConfig, waitForCompletion = true) {
    if (!commandConfig || !commandConfig.mediaSource || !commandConfig.filename || !commandConfig.vfxFilePath) {
        throw new Error("No media config provided with source, filename, and vfxFilePath");
    }
    
        await this.ensureOBSConnected();

        // Construct VFX file path
        const filePath = `${commandConfig.vfxFilePath}/${commandConfig.filename}.mp4`;
    
    try {
            this.logger.debug(`[VFX] Playing media: ${commandConfig.filename} in source: ${commandConfig.mediaSource} from path: ${filePath}`, 'effects');
        
        // Set media file path and properties
            await this.obsCall("SetInputSettings", { 
            inputName: commandConfig.mediaSource, 
            inputSettings: { 
                local_file: filePath, 
                looping: false 
            }, 
            overlay: false 
        });

        // Start the media playback
            await this.obsCall("TriggerMediaInputAction", { 
            inputName: commandConfig.mediaSource, 
            mediaAction: "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART" 
        });

        // Handle completion waiting if requested
        if (waitForCompletion) {
                this.logger.debug(`[VFX] Waiting for media completion: ${commandConfig.filename}`, 'effects');
                await this.waitForMediaCompletion(commandConfig.mediaSource);
        } else {
                this.logger.debug(`[VFX] Fire-and-forget mode: ${commandConfig.filename} started, returning immediately`, 'effects');
        }
        
            this.logger.debug(`[VFX] Successfully played media: ${commandConfig.filename}`, 'effects');
    } catch (err) { 
            this._handleEffectsError(`[VFX] Failed to play media: ${commandConfig.filename}`, err, { command: commandConfig });
        throw err; 
    }
}

    async waitForMediaCompletion(mediaSourceName) {
        return new Promise((resolve) => {
            if (!this.obsManager) {
                this.logger.warn('[VFX] No OBS manager available, skipping wait', 'effects');
                resolve();
                return;
            }

            const mediaEndHandler = (data) => {
                if (data.inputName === mediaSourceName) {
                    this.obsManager.removeEventListener("MediaInputPlaybackEnded", mediaEndHandler);
                    this.logger.debug(`[VFX] Media playback ended: ${mediaSourceName}`, 'effects');
                    resolve();
                }
            };

            this.obsManager.addEventListener("MediaInputPlaybackEnded", mediaEndHandler);
            this.logger.debug(`[VFX] Waiting for media end event: ${mediaSourceName}`, 'effects');
        });
    }

    async triggerMediaAction(inputName, mediaAction) {
    try {
            await this.ensureOBSConnected();
        
            this.logger.debug(`[Media] Triggering action "${mediaAction}" on input: ${inputName}`, 'effects');
        
            await this.obsCall("TriggerMediaInputAction", { 
            inputName, 
            mediaAction 
        });
        
            this.logger.debug(`[Media] Successfully triggered action on: ${inputName}`, 'effects');
    } catch (err) {
            this._handleEffectsError(`[Media] Error triggering action on ${inputName}`, err, { inputName, mediaAction });
        throw err;
    }
}


    async playGiftVideoAndAudio(giftVideoSource, giftAudioSource, giftScene) {
    try {
            this.logger.debug(`[Gift] Playing initial gift video and audio from scene: ${giftScene}`, 'effects');
        
        // Start both video and audio sources simultaneously
        const promises = [
                this.triggerMediaAction(giftVideoSource, "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART"),
                this.triggerMediaAction(giftAudioSource, "OBS_WEBSOCKET_MEDIA_INPUT_ACTION_RESTART")
        ];
        
        // Execute both simultaneously
        await Promise.all(promises);
        
            this.logger.debug(`[Gift] Gift video (${giftVideoSource}) and audio (${giftAudioSource}) started successfully`, 'effects');
        
        // No delay - continue immediately with the rest of the gift notification sequence
    } catch (err) {
            this._handleEffectsError('[Gift] Failed to play gift video/audio', err, { giftVideoSource, giftAudioSource, giftScene });
        // Don't throw - continue with the rest of the gift notification
    }
}


    createHandcamGlowConfig(config = {}) {
        const stepsDivisor = DEFAULT_HANDCAM_ANIMATION_STEPS_DIVISOR;
        return {
            enabled: config.enabled || false,
            maxSize: config.maxSize || 100,
            sourceName: config.sourceName,
            filterName: config.filterName,
            sizeProperty: config.sizeProperty || 'size',
            animationSteps: config.animationSteps || 10,
            stepDuration: config.stepDuration || 100,
            rampUpDuration: config.rampUpDuration || 1000,
            rampDownDuration: config.rampDownDuration || 1000,
            holdDuration: config.holdDuration || 500,
            
            // Computed properties
    get totalSteps() {
                return Math.floor(this.animationSteps / stepsDivisor);
            },
    
    get totalDuration() {
        return this.rampUpDuration + this.holdDuration + this.rampDownDuration;
            },
    
    get rampUpStepDelay() {
                return this.rampUpDuration / this.totalSteps;
            },
    
    get rampDownStepDelay() {
                return this.rampDownDuration / this.totalSteps;
    }
        };
}

    async activateHandcamGlow(config) {
    if (!config.enabled) {
            this.logger.debug('[HandcamGlow] Handcam glow disabled, skipping animation', 'effects');
        return;
    }
    
    try {
            this.logger.debug(`[HandcamGlow] Starting handcam glow animation for source: ${config.sourceName}, filter: ${config.filterName}`, 'effects');
        
            // Get base filter settings first
            const baseSettings = await this.getSourceFilterSettings(config.sourceName, config.filterName);
        
            // Execute the animation sequence
            await this.animateGlowSize(baseSettings, config);
        
            this.logger.debug(`[HandcamGlow] Handcam glow animation completed successfully`, 'effects');
        } catch (err) {
            this._handleEffectsError('[HandcamGlow] Error in handcam glow animation', err, { handcamConfig: config });
            throw err;
        }
}

    async animateGlowSize(baseSettings, config) {
        const glowConfig = this.createHandcamGlowConfig(config);
    
        // Step 1: Ramp up to max size
        await this.executeAnimationPhase(
        baseSettings,
        'ramp-up',
        1,
            (step) => Math.round((step / glowConfig.totalSteps) * glowConfig.maxSize),
            glowConfig.rampUpStepDelay,
            glowConfig
    );
    
        // Step 2: Hold at max size
        this.logger.debug(`[HandcamGlow] Phase 2: Holding at max size (${glowConfig.maxSize}) for ${glowConfig.holdDuration}ms`, 'effects');
        await this.delay(glowConfig.holdDuration);
    
        // Step 3: Ramp down to original size
        await this.executeAnimationPhase(
        baseSettings,
        'ramp-down',
        3,
            (step) => Math.round(glowConfig.maxSize - ((step / glowConfig.totalSteps) * glowConfig.maxSize)),
            glowConfig.rampDownStepDelay,
            glowConfig
    );
}

    async executeAnimationPhase(baseSettings, phaseName, phaseNumber, calculateSize, stepDelay, config) {
        this.logger.debug(`[HandcamGlow] Phase ${phaseNumber}: Starting ${phaseName} (${config.totalSteps} steps, ${stepDelay}ms per step)`, 'effects');
    
    for (let step = 1; step <= config.totalSteps; step++) {
            const size = calculateSize(step);
            await this.setHandcamGlowSize(baseSettings, size, config);
            await this.delay(stepDelay);
    }
    }

    async setHandcamGlowSize(baseSettings, size, config) {
        const newSettings = {
            ...baseSettings,
            [config.sizeProperty]: size
        };
        
        await this.setSourceFilterSettings(config.sourceName, config.filterName, newSettings);
        this.logger.debug(`[HandcamGlow] Set ${config.sizeProperty} to ${size} for ${config.sourceName}:${config.filterName}`, 'effects');
}


    async executeEffectSequence(effects) {
        if (!effects || effects.length === 0) {
            this.logger.debug('[Effects] No effects to execute', 'effects');
            return;
        }

        this.logger.debug(`[Effects] Executing sequence of ${effects.length} effects`, 'effects');
    
        for (const effect of effects) {
            try {
                // Wait for any configured delay before executing this effect
                if (effect.delay && effect.delay > 0) {
                    this.logger.debug(`[Effects] Waiting ${effect.delay}ms before executing effect: ${effect.name}`, 'effects');
                    await this.delay(effect.delay);
                }
                
                this.logger.debug(`[Effects] Executing effect: ${effect.name} (type: ${effect.type})`, 'effects');
            
                // Execute the appropriate effect type
                switch (effect.type) {
                    case 'vfx':
                        await this.playMediaInOBS(effect.config, effect.waitForCompletion);
                        break;
                    case 'handcam_glow':
                        await this.activateHandcamGlow(effect.config);
                        break;
                    case 'gift':
                        await this.playGiftVideoAndAudio(effect.giftVideoSource, effect.giftAudioSource, effect.giftScene);
                        break;
                    default:
                        this.log.warn(`[Effects] Unknown effect type: ${effect.type} for effect: ${effect.name}`);
                }
                
                this.logger.debug(`[Effects] Completed effect: ${effect.name}`, 'effects');
        } catch (err) {
                this._handleEffectsError(`[Effects] Error executing effect: ${effect.name}`, err, { effectName: effect.name, effectType: effect.type });
                // Continue with remaining effects even if one fails
            }
        }
        
        this.logger.debug('[Effects] Effect sequence execution completed', 'effects');
}


    createVFXEffect(name, commandConfig, vfxFilePath, waitForCompletion = false, delay = 0) {
    return {
        name,
            type: 'vfx',
            config: {
                ...commandConfig,
                vfxFilePath
            },
            waitForCompletion,
            delay
    };
}

    createHandcamGlowEffect(name, config, delay = 0) {
    return {
        name,
            type: 'handcam_glow',
            config,
            delay
    };
}

    createGiftEffect(name, giftVideoSource, giftAudioSource, giftScene, delay = 0) {
    return {
        name,
        type: 'gift',
               giftVideoSource,
            giftAudioSource,
            giftScene,
            delay
        };
    }

    _handleEffectsError(message, error, payload = null) {
        if (!this.errorHandler && this.logger) {
            this.errorHandler = createPlatformErrorHandler(this.logger, 'obs-effects');
        }

        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'obs-effects', payload, message, 'obs-effects');
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, 'obs-effects', payload);
        }
    }
}

function createOBSEffectsManager(obsManager, dependencies = {}) {
    return new OBSEffectsManager(obsManager, dependencies);
}

let defaultInstance = null;
function getDefaultEffectsManager() {
    if (!defaultInstance) {
        const { getOBSConnectionManager } = require('./connection');
        const { logger } = require('../core/logging');
        const sources = require('./sources');

        defaultInstance = createOBSEffectsManager(
            getOBSConnectionManager(),  // Get singleton directly
            {
                logger,
                sourcesManager: sources
            }
        );
    }
    return defaultInstance;
}

// Export class and factory functions
module.exports = {
    OBSEffectsManager,
    getDefaultEffectsManager
};
