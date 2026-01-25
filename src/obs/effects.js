
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { safeDelay } = require('../utils/timeout-validator');
const { createRetrySystem } = require('../utils/retry-system');

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
