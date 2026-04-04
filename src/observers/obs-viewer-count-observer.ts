const { ViewerCountObserver } = require('./viewer-count-observer');
const { createTextProcessingManager } = require('../utils/text-processing');
const { VIEWER_COUNT_CONSTANTS } = require('../core/constants');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

class OBSViewerCountObserver extends ViewerCountObserver {
    constructor(obsManager, logger, deps = {}) {
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
            } catch (error) {
                this.logger.debug(`Could not initialize ${platformName} viewer count (source may not exist): ${error.message}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            }
        }
        
        this.logger.info('All platform viewer counts initialized to 0 in OBS', VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
    }

    async onViewerCountUpdate(update) {
        const { platform, count, isStreamLive } = update;
        
        // Only update OBS if stream is live
        if (!isStreamLive) {
            this.logger.debug(`Skipping OBS update for ${platform} (stream offline)`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            return;
        }

        try {
            await this.updateObsCount(platform, count);
        } catch (error) {
            this._handleObserverError(`Failed to update OBS for ${platform}: ${error.message}`, error, { platform, count });
        }
    }

    async onStreamStatusChange(statusUpdate) {
        const { platform, isLive, wasLive } = statusUpdate;
        
        // If stream went offline, reset viewer count to 0
        if (wasLive && !isLive) {
            this.logger.info(`Stream went offline for ${platform}, resetting viewer count to 0`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
            try {
                await this.updateObsCount(platform, VIEWER_COUNT_CONSTANTS.VIEWER_COUNT_ZERO);
            } catch (error) {
                this._handleObserverError(`Failed to reset OBS count for ${platform}: ${error.message}`, error, { platform });
            }
        }
        
        // Log status change
        this.logger.info(`OBS observer notified of ${platform} status change: ${isLive ? 'LIVE' : 'OFFLINE'}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
    }

    validateObsUpdateParameters(platformName, count) {
        if (typeof platformName !== 'string' || platformName.trim().length === 0) {
            return { valid: false, reason: 'Platform name must be a non-empty string' };
        }
        
        if (typeof count !== 'number' || count < 0 || isNaN(count)) {
            return { valid: false, reason: 'Count must be a non-negative number' };
        }
        
        return { valid: true };
    }

    isObsSourceMissingError(error) {
        if (!error || !error.message) {
            return false;
        }
        
        return error.message.toLowerCase().includes('not found');
    }

    handleObsUpdateError(error, sourceName, platformName) {
        if (this.isObsSourceMissingError(error)) {
            this.logger.debug(`OBS source '${sourceName}' not found for ${platformName}`, VIEWER_COUNT_CONSTANTS.LOG_CONTEXT.OBS_OBSERVER);
        } else {
            this._handleObserverError(`Failed to update OBS source '${sourceName}': ${error.message}`, error, { platformName, sourceName });
        }
    }

    async updateObsCount(platformName, count) {
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

    _handleObserverError(message, error, payload = null) {
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

module.exports = { OBSViewerCountObserver };
