
const { createPlatformErrorHandler } = require('./platform-error-handler');

class PlatformInitializationManager {
    constructor(platformName, logger) {
        this.platformName = platformName;
        if (!logger || typeof logger.error !== 'function') {
            throw new Error('PlatformInitializationManager requires a logger');
        }
        this.logger = logger;
        this.errorHandler = createPlatformErrorHandler(logger, platformName || 'platform-initialization');

        // Initialization tracking state
        this.initializationCount = 0;
        this.initializationAttempts = 0;
        this.preventedReinitializations = 0;
        this.initializationState = {};
        
        // Configuration
        this.allowReinitialization = false;
        this.maxAttempts = 5;
        
        this.logger.debug('PlatformInitializationManager created', this.platformName);
    }
    
    isInitialized() {
        return this.initializationCount > 0;
    }
    
    beginInitialization(forceReinitialize = false) {
        // Ensure state is properly initialized
        if (typeof this.initializationAttempts === 'undefined') this.initializationAttempts = 0;
        if (typeof this.preventedReinitializations === 'undefined') this.preventedReinitializations = 0;
        if (typeof this.initializationCount === 'undefined') this.initializationCount = 0;
        if (!this.initializationState) this.initializationState = {};
        
        this.initializationAttempts++;
        
        // Check if already initialized and reinitialization not allowed
        if (this.isInitialized() && !forceReinitialize && !this.allowReinitialization) {
            this.preventedReinitializations++;
            this.logger.warn(
                `Already initialized, skipping reinitialization attempt #${this.preventedReinitializations}`,
                this.platformName
            );
            this.logger.debug(
                `Prevented reinitialization attempt ${this.initializationAttempts}`,
                this.platformName
            );
            return false;
        }
        
        // Check max attempts
        if (this.initializationAttempts > this.maxAttempts) {
            this._handleInitializationError(
                `Maximum initialization attempts (${this.maxAttempts}) exceeded`,
                null,
                { attempt: this.initializationAttempts }
            );
            return false;
        }
        
        this.logger.info(
            `Beginning initialization attempt ${this.initializationAttempts}`,
            this.platformName
        );
        
        return true;
    }
    
    markInitializationSuccess(additionalState = {}) {
        this.initializationCount = Math.max(1, this.initializationCount + 1);
        
        this.initializationState = {
            timestamp: new Date().toISOString(),
            success: true,
            attempt: this.initializationAttempts,
            ...additionalState
        };
        
        this.logger.info(
            `Initialization successful (attempt ${this.initializationAttempts})`,
            this.platformName
        );
    }
    
    markInitializationFailure(error, additionalState = {}) {
        this.initializationState = {
            timestamp: new Date().toISOString(),
            success: false,
            attempt: this.initializationAttempts,
            error: error?.message || 'Unknown error',
            ...additionalState
        };
        
        this._handleInitializationError(
            `Initialization failed (attempt ${this.initializationAttempts}): ${error?.message}`,
            error,
            additionalState
        );
    }
    
    getStatistics() {
        return {
            initializationCount: this.initializationCount,
            initializationAttempts: this.initializationAttempts,
            preventedReinitializations: this.preventedReinitializations,
            isInitialized: this.isInitialized(),
            lastInitialization: this.initializationState,
            successRate: this.initializationAttempts > 0 
                ? (this.initializationCount / this.initializationAttempts) * 100 
                : 0
        };
    }
    
    getInitializationState() {
        return {
            ...this.initializationState,
            isInitialized: this.isInitialized(),
            totalAttempts: this.initializationAttempts,
            preventedAttempts: this.preventedReinitializations
        };
    }
    
    reset() {
        this.initializationCount = 0;
        this.initializationAttempts = 0;
        this.preventedReinitializations = 0;
        this.initializationState = {};
        
        this.logger.debug('Initialization state reset', this.platformName);
    }
    
    configure(options = {}) {
        if (typeof options.allowReinitialization === 'boolean') {
            this.allowReinitialization = options.allowReinitialization;
        }
        
        if (typeof options.maxAttempts === 'number' && options.maxAttempts > 0) {
            this.maxAttempts = options.maxAttempts;
        }
        
        this.logger.debug('Initialization manager configured', this.platformName, options);
    }
}

module.exports = {
    PlatformInitializationManager
};

PlatformInitializationManager.prototype._handleInitializationError = function(message, error = null, payload = null) {
    if (!this.errorHandler && this.logger) {
        this.errorHandler = createPlatformErrorHandler(this.logger, this.platformName || 'platform-initialization');
    }

    if (this.errorHandler && error instanceof Error) {
        this.errorHandler.handleEventProcessingError(error, 'initialization', payload, message, this.platformName);
        return;
    }

    if (this.errorHandler) {
        this.errorHandler.logOperationalError(message, this.platformName, payload);
    }
};
