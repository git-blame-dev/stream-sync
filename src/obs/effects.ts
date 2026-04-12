import { logger } from '../core/logging';
import { createRequire } from 'node:module';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { safeDelay } from '../utils/timeout-validator';

type EffectsLogger = {
    debug: (message: string, context?: string, payload?: unknown) => void;
    warn: (message: string, context?: string, payload?: unknown) => void;
};

type ObsManagerLike = {
    ensureConnected: () => Promise<void>;
    call: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
    addEventListener?: (eventName: string, handler: (event: { inputName?: string }) => void) => void;
    removeEventListener?: (eventName: string, handler: (event: { inputName?: string }) => void) => void;
};

type ObsManagerWithEvents = ObsManagerLike & {
    addEventListener: (eventName: string, handler: (event: { inputName?: string }) => void) => void;
    removeEventListener: (eventName: string, handler: (event: { inputName?: string }) => void) => void;
};

type SourcesManagerLike = {
    setSourceFilterEnabled?: (...args: unknown[]) => unknown;
    getSourceFilterSettings?: (...args: unknown[]) => unknown;
    setSourceFilterSettings?: (...args: unknown[]) => unknown;
};

type RetrySystemLike = {
    delay?: (ms: number, minMs: number, context: string) => Promise<void>;
};

type EffectsDependencies = {
    logger?: EffectsLogger;
    sourcesManager?: SourcesManagerLike;
    eventBus?: unknown;
    retrySystem?: RetrySystemLike;
    delay?: (ms: number, minMs: number, context: string) => Promise<void>;
};

const nodeRequire = createRequire(import.meta.url);
const { createRetrySystem } = nodeRequire('../utils/retry-system') as {
    createRetrySystem: (dependencies: { logger: EffectsLogger }) => RetrySystemLike;
};
const { getOBSConnectionManager } = nodeRequire('./connection') as {
    getOBSConnectionManager: () => ObsManagerLike;
};
const { getDefaultSourcesManager } = nodeRequire('./sources') as {
    getDefaultSourcesManager: () => SourcesManagerLike;
};

function hasObsEventListeners(obsManager: ObsManagerLike): obsManager is ObsManagerWithEvents {
    return typeof obsManager.addEventListener === 'function' && typeof obsManager.removeEventListener === 'function';
}

class OBSEffectsManager {
    obsManager: ObsManagerLike;
    logger: EffectsLogger;
    log: EffectsLogger;
    sourcesManager: SourcesManagerLike | undefined;
    eventBus: unknown;
    retrySystem: RetrySystemLike;
    ensureOBSConnected: () => Promise<void>;
    obsCall: (requestType: string, payload: Record<string, unknown>) => Promise<unknown>;
    setSourceFilterEnabled?: (...args: unknown[]) => unknown;
    getSourceFilterSettings?: (...args: unknown[]) => unknown;
    setSourceFilterSettings?: (...args: unknown[]) => unknown;
    delay: (ms: number, minMs: number, context: string) => Promise<void>;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;

    constructor(obsManager: ObsManagerLike, dependencies: EffectsDependencies = {}) {
        // Require OBS manager as first parameter
        if (!obsManager) {
            throw new Error('OBSEffectsManager requires OBSConnectionManager instance');
        }

        // Direct reference to OBS manager (no wrapper indirection)
        this.obsManager = obsManager;

        // Inject other dependencies with default implementations
        this.logger = dependencies.logger || logger;
        this.log = this.logger;
        this.sourcesManager = dependencies.sourcesManager;
        this.eventBus = dependencies.eventBus;
        this.retrySystem = (dependencies.retrySystem || createRetrySystem({ logger: this.logger })) as RetrySystemLike;

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


    async playMediaInOBS(commandConfig: { mediaSource?: string; filename?: string; vfxFilePath?: string }, waitForCompletion = true) {
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

    async waitForMediaCompletion(mediaSourceName: string) {
        if (!this.obsManager) {
            this.logger.warn('[VFX] No OBS manager available, skipping wait', 'effects');
            return;
        }

        if (!hasObsEventListeners(this.obsManager)) {
            throw new Error('OBS manager requires event listener support to wait for media completion');
        }

        const { addEventListener, removeEventListener } = this.obsManager;

        return new Promise<void>((resolve) => {
            const mediaEndHandler = (data: { inputName?: string }) => {
                if (data.inputName === mediaSourceName) {
                    removeEventListener.call(this.obsManager, 'MediaInputPlaybackEnded', mediaEndHandler);
                    this.logger.debug(`[VFX] Media playback ended: ${mediaSourceName}`, 'effects');
                    resolve();
                }
            };

            addEventListener.call(this.obsManager, 'MediaInputPlaybackEnded', mediaEndHandler);
            this.logger.debug(`[VFX] Waiting for media end event: ${mediaSourceName}`, 'effects');
        });
    }

    async triggerMediaAction(inputName: string, mediaAction: string) {
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

    _handleEffectsError(message: string, error: unknown, payload: Record<string, unknown> | null = null) {
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

function createOBSEffectsManager(obsManager: ObsManagerLike, dependencies: EffectsDependencies = {}) {
    return new OBSEffectsManager(obsManager, dependencies);
}

let defaultInstance: OBSEffectsManager | null = null;
function getDefaultEffectsManager() {
    if (!defaultInstance) {
        defaultInstance = createOBSEffectsManager(
            getOBSConnectionManager(),  // Get singleton directly
            {
                logger,
                sourcesManager: getDefaultSourcesManager()
            }
        );
    }
    return defaultInstance;
}

function resetDefaultEffectsManager() {
    defaultInstance = null;
}

// Export class and factory functions
export {
    OBSEffectsManager,
    getDefaultEffectsManager,
    resetDefaultEffectsManager
};
