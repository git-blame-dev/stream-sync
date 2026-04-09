import { ViewerCountObserver } from './viewer-count-observer';
import { VIEWER_COUNT_CONSTANTS } from '../core/constants';
import { createTextProcessingManager } from '../utils/text-processing';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';

type LoggerLike = {
    debug: (message: string, context?: string, payload?: unknown) => void;
    info: (message: string, context?: string, payload?: unknown) => void;
    warn: (message: string, context?: string, payload?: unknown) => void;
    error: (message: string, context?: string, payload?: unknown) => void;
};

type ObsManagerLike = {
    isConnected: () => boolean;
    call: (requestType: string, requestData: Record<string, unknown>) => Promise<unknown>;
};

type PlatformConfig = {
    viewerCountEnabled?: boolean;
    viewerCountSource?: string;
};

type ObserverDependencies = {
    config?: Record<string, PlatformConfig>;
};

function getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
        return error.message;
    }

    return String(error);
}

class OBSViewerCountObserver extends ViewerCountObserver {
    obsManager: ObsManagerLike;
    logger: LoggerLike;
    config: Record<string, PlatformConfig>;
    textProcessing: { formatViewerCount: (count: number) => string };
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;

    constructor(obsManager: ObsManagerLike, logger: LoggerLike, deps: ObserverDependencies = {}) {
        super();
        if (!logger || typeof logger.error !== 'function') {
            throw new Error('OBSViewerCountObserver requires a logger');
        }
        if (!deps.config) {
            throw new Error('OBSViewerCountObserver requires config');
        }
        this.obsManager = obsManager;
        this.logger = logger;
        this.config = deps.config;
        this.textProcessing = createTextProcessingManager({ logger: this.logger });
        this.errorHandler = createPlatformErrorHandler(logger, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
    }

    getObserverId() {
        return VIEWER_COUNT_CONSTANTS.OBSERVER.DEFAULT_OBS_OBSERVER_ID;
    }

    async initialize() {
        this.logger.info('Initializing OBS viewer count observer', VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
        
        // Initialize all platform viewer counts to 0 in OBS if connected
        if (this.obsManager && this.obsManager.isConnected()) {
            await this.initializeObsViewerCounts();
        } else {
            this.logger.debug('OBS not connected during observer initialization', VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
        }
    }

    async initializeObsViewerCounts() {
        const platformNames = VIEWER_COUNT_CONSTANTS.PLATFORM_NAMES;
        
        for (const platformName of platformNames) {
            try {
                await this.updateObsCount(platformName, VIEWER_COUNT_CONSTANTS.VIEWER_COUNT_ZERO);
                this.logger.debug(`Initialized ${platformName} viewer count to 0 in OBS`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            } catch (error: unknown) {
                this.logger.debug(`Could not initialize ${platformName} viewer count (source may not exist): ${getErrorMessage(error)}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            }
        }
        
        this.logger.info('All platform viewer counts initialized to 0 in OBS', VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
    }

    async onViewerCountUpdate(update: { platform: string; count: number; isStreamLive: boolean }) {
        const { platform, count, isStreamLive } = update;
        
        // Only update OBS if stream is live
        if (!isStreamLive) {
            this.logger.debug(`Skipping OBS update for ${platform} (stream offline)`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            return;
        }

        try {
            await this.updateObsCount(platform, count);
        } catch (error: unknown) {
            this._handleObserverError(`Failed to update OBS for ${platform}: ${getErrorMessage(error)}`, error, { platform, count });
        }
    }

    async onStreamStatusChange(statusUpdate: { platform: string; isLive: boolean; wasLive: boolean }) {
        const { platform, isLive, wasLive } = statusUpdate;
        
        // If stream went offline, reset viewer count to 0
        if (wasLive && !isLive) {
            this.logger.info(`Stream went offline for ${platform}, resetting viewer count to 0`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            try {
                await this.updateObsCount(platform, VIEWER_COUNT_CONSTANTS.VIEWER_COUNT_ZERO);
            } catch (error: unknown) {
                this._handleObserverError(`Failed to reset OBS count for ${platform}: ${getErrorMessage(error)}`, error, { platform });
            }
        }
        
        // Log status change
        this.logger.info(`OBS observer notified of ${platform} status change: ${isLive ? 'LIVE' : 'OFFLINE'}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
    }

    validateObsUpdateParameters(platformName: unknown, count: unknown) {
        if (typeof platformName !== 'string' || platformName.trim().length === 0) {
            return { valid: false, reason: 'Platform name must be a non-empty string' };
        }
        
        if (typeof count !== 'number' || count < 0 || isNaN(count)) {
            return { valid: false, reason: 'Count must be a non-negative number' };
        }
        
        return { valid: true };
    }

    isObsSourceMissingError(error: unknown) {
        if (!error || typeof error !== 'object' || typeof (error as { message?: unknown }).message !== 'string') {
            return false;
        }
        
        return (error as { message: string }).message.toLowerCase().includes('not found');
    }

    handleObsUpdateError(error: unknown, sourceName: string, platformName: string) {
        if (this.isObsSourceMissingError(error)) {
            this.logger.debug(`OBS source '${sourceName}' not found for ${platformName}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
        } else {
            this._handleObserverError(`Failed to update OBS source '${sourceName}': ${getErrorMessage(error)}`, error, { platformName, sourceName });
        }
    }

    async updateObsCount(platformName: string, count: number) {
        // Validate input parameters
        const validation = this.validateObsUpdateParameters(platformName, count);
        if (!validation.valid) {
            this.logger.warn(`Invalid parameters for OBS update: ${validation.reason}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            return;
        }

        if (!this.obsManager || !this.obsManager.isConnected()) {
            this.logger.debug(VIEWER_COUNT_CONSTANTS.ERROR_MESSAGES.MISSING_OBS_CONNECTION, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            return;
        }

        const platformConfig = this.config[platformName.toLowerCase()];
        if (!platformConfig || !platformConfig.viewerCountEnabled) {
            this.logger.debug(`Viewer count not enabled for ${platformName}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            return;
        }

        const sourceName = platformConfig.viewerCountSource;
        if (!sourceName) {
            this.logger.warn(`'viewerCountSource' not configured for ${platformName}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            return;
        }

        try {
            const newText = this.textProcessing.formatViewerCount(count);
            await this.obsManager.call('SetInputSettings', {
                inputName: sourceName,
                inputSettings: { text: newText },
                overlay: true
            });
            
            this.logger.debug(`Successfully updated OBS source '${sourceName}' with count: ${count}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
        } catch (error) {
            this.handleObsUpdateError(error, sourceName, platformName);
        }
    }

    _handleObserverError(message: string, error: unknown, payload: Record<string, unknown> | null = null) {
        if (!this.errorHandler && this.logger) {
            this.errorHandler = createPlatformErrorHandler(this.logger, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
        }

        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'viewer-count', payload, message, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            return;
        }

        if (this.errorHandler) {
            this.errorHandler.logOperationalError(message, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER, payload);
        }
    }

    async cleanup() {
        this.logger.info('Cleaning up OBS viewer count observer', VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
        // No specific cleanup needed for OBS observer
    }
}

export { OBSViewerCountObserver };
