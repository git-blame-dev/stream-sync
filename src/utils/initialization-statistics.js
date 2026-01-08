
const crypto = require('crypto');
const { createPlatformErrorHandler } = require('./platform-error-handler');

class InitializationStatistics {
    constructor(platformName, logger) {
        this.platformName = platformName;
        this.logger = logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, platformName || 'initialization');
        
        // Core statistics
        this.totalAttempts = 0;
        this.successfulAttempts = 0;
        this.failedAttempts = 0;
        this.preventedAttempts = 0;
        
        // Timing statistics
        this.timingHistory = []; // Array of timing data
        this.totalInitializationTime = 0;
        this.averageInitializationTime = 0;
        this.fastestInitialization = null;
        this.slowestInitialization = null;
        
        // Error tracking
        this.errorHistory = []; // Array of error data
        this.errorTypes = new Map(); // error type -> count
        this.consecutiveFailures = 0;
        this.lastSuccessTime = null;
        
        // Performance metrics
        this.performanceMetrics = {
            connectionEstablishmentTime: [],
            serviceInitializationTime: [],
            configurationValidationTime: [],
            dependencyResolutionTime: []
        };
        
        // State tracking
        this.firstInitializationTime = null;
        this.lastInitializationTime = null;
        this.isCurrentlyInitializing = false;
        this.currentAttemptStartTime = null;
        
        this.logger.debug('InitializationStatistics tracker created', this.platformName);
    }
    
    startInitializationAttempt(metadata = {}) {
        const startTime = Date.now();
        const attemptId = `${this.platformName}-${startTime}-${crypto.randomUUID()}`;
        
        this.totalAttempts++;
        this.isCurrentlyInitializing = true;
        this.currentAttemptStartTime = startTime;
        
        if (!this.firstInitializationTime) {
            this.firstInitializationTime = this.currentAttemptStartTime;
        }
        
        this.logger.debug(
            `Starting initialization attempt ${this.totalAttempts} (ID: ${attemptId})`,
            this.platformName,
            metadata
        );
        
        return attemptId;
    }
    
    recordSuccess(attemptId, metrics = {}) {
        if (!this.isCurrentlyInitializing) {
            this.logger.warn('recordSuccess called but no active initialization attempt', this.platformName);
            return;
        }
        
        const endTime = Date.now();
        const duration = endTime - this.currentAttemptStartTime;
        
        this.successfulAttempts++;
        this.consecutiveFailures = 0;
        this.lastSuccessTime = endTime;
        this.lastInitializationTime = endTime;
        this.isCurrentlyInitializing = false;
        
        // Update timing statistics
        this.totalInitializationTime += duration;
        this.averageInitializationTime = this.totalInitializationTime / this.successfulAttempts;
        
        if (!this.fastestInitialization || duration < this.fastestInitialization.duration) {
            this.fastestInitialization = { duration, timestamp: endTime, attemptId };
        }
        
        if (!this.slowestInitialization || duration > this.slowestInitialization.duration) {
            this.slowestInitialization = { duration, timestamp: endTime, attemptId };
        }
        
        // Record timing data
        const timingData = {
            attemptId,
            duration,
            startTime: this.currentAttemptStartTime,
            endTime,
            success: true,
            metrics
        };
        
        this.timingHistory.push(timingData);
        
        // Update performance metrics
        if (metrics.connectionTime) {
            this.performanceMetrics.connectionEstablishmentTime.push(metrics.connectionTime);
        }
        if (metrics.serviceInitTime) {
            this.performanceMetrics.serviceInitializationTime.push(metrics.serviceInitTime);
        }
        if (metrics.configValidationTime) {
            this.performanceMetrics.configurationValidationTime.push(metrics.configValidationTime);
        }
        if (metrics.dependencyTime) {
            this.performanceMetrics.dependencyResolutionTime.push(metrics.dependencyTime);
        }
        
        this.logger.info(
            `Initialization successful in ${duration}ms (attempt ${this.totalAttempts})`,
            this.platformName
        );
        
        // Clean up old timing data (keep last 100 entries)
        if (this.timingHistory.length > 100) {
            this.timingHistory = this.timingHistory.slice(-100);
        }
    }
    
    recordFailure(attemptId, error, context = {}) {
        if (!this.isCurrentlyInitializing) {
            this.logger.warn('recordFailure called but no active initialization attempt', this.platformName);
            return;
        }
        
        const endTime = Date.now();
        const duration = endTime - this.currentAttemptStartTime;
        
        this.failedAttempts++;
        this.consecutiveFailures++;
        this.lastInitializationTime = endTime;
        this.isCurrentlyInitializing = false;
        
        // Track error types
        const errorType = error?.constructor?.name || 'UnknownError';
        this.errorTypes.set(errorType, (this.errorTypes.get(errorType) || 0) + 1);
        
        // Record error data
        const errorData = {
            attemptId,
            duration,
            timestamp: endTime,
            errorType,
            errorMessage: error?.message || 'Unknown error',
            context,
            consecutiveFailure: this.consecutiveFailures
        };
        
        this.errorHistory.push(errorData);
        
        // Record failed timing data
        this.timingHistory.push({
            attemptId,
            duration,
            startTime: this.currentAttemptStartTime,
            endTime,
            success: false,
            error: errorData
        });
        
        this._handleInitializationError(
            `Initialization failed after ${duration}ms (attempt ${this.totalAttempts}, consecutive failures: ${this.consecutiveFailures}): ${error?.message}`,
            error,
            { attemptId, errorType }
        );
        
        // Clean up old error data (keep last 50 entries)
        if (this.errorHistory.length > 50) {
            this.errorHistory = this.errorHistory.slice(-50);
        }
    }
    
    recordPreventedAttempt(reason) {
        this.preventedAttempts++;
        
        this.logger.debug(
            `Initialization attempt prevented: ${reason} (total prevented: ${this.preventedAttempts})`,
            this.platformName
        );
    }
    
    getStatistics() {
        const now = Date.now();
        const successRate = this.totalAttempts > 0 ? (this.successfulAttempts / this.totalAttempts) * 100 : 0;
        
        return {
            // Basic counts
            totalAttempts: this.totalAttempts,
            successfulAttempts: this.successfulAttempts,
            failedAttempts: this.failedAttempts,
            preventedAttempts: this.preventedAttempts,
            
            // Success metrics
            successRate,
            consecutiveFailures: this.consecutiveFailures,
            
            // Timing metrics
            averageInitializationTime: this.averageInitializationTime,
            totalInitializationTime: this.totalInitializationTime,
            fastestInitialization: this.fastestInitialization,
            slowestInitialization: this.slowestInitialization,
            
            // Time-based metrics
            firstInitializationTime: this.firstInitializationTime,
            lastInitializationTime: this.lastInitializationTime,
            lastSuccessTime: this.lastSuccessTime,
            timeSinceLastSuccess: this.lastSuccessTime ? now - this.lastSuccessTime : null,
            
            // Error analysis
            errorTypes: Object.fromEntries(this.errorTypes),
            recentErrors: this.errorHistory.slice(-10),
            
            // Performance metrics
            performanceMetrics: this._calculatePerformanceAverages(),
            
            // Health indicators
            isHealthy: successRate >= 80 && this.consecutiveFailures < 3,
            platform: this.platformName
        };
    }
    
    getTimingHistory(limit = 20) {
        return this.timingHistory.slice(-limit);
    }
    
    getErrorAnalysis() {
        const recentErrors = this.errorHistory.slice(-20);
        const errorFrequency = {};
        
        // Analyze error frequency
        for (const error of recentErrors) {
            if (!errorFrequency[error.errorType]) {
                errorFrequency[error.errorType] = 0;
            }
            errorFrequency[error.errorType]++;
        }
        
        // Find most common error
        let mostCommonError = null;
        let maxCount = 0;
        for (const [errorType, count] of Object.entries(errorFrequency)) {
            if (count > maxCount) {
                mostCommonError = errorType;
                maxCount = count;
            }
        }
        
        return {
            totalErrors: this.errorHistory.length,
            recentErrors: recentErrors.length,
            errorFrequency,
            mostCommonError,
            consecutiveFailures: this.consecutiveFailures,
            errorTypes: Array.from(this.errorTypes.keys()),
            recommendedAction: this._getRecommendedAction()
        };
    }
    
    reset() {
        this.totalAttempts = 0;
        this.successfulAttempts = 0;
        this.failedAttempts = 0;
        this.preventedAttempts = 0;
        
        this.timingHistory = [];
        this.totalInitializationTime = 0;
        this.averageInitializationTime = 0;
        this.fastestInitialization = null;
        this.slowestInitialization = null;
        
        this.errorHistory = [];
        this.errorTypes.clear();
        this.consecutiveFailures = 0;
        this.lastSuccessTime = null;
        
        this.performanceMetrics = {
            connectionEstablishmentTime: [],
            serviceInitializationTime: [],
            configurationValidationTime: [],
            dependencyResolutionTime: []
        };
        
        this.firstInitializationTime = null;
        this.lastInitializationTime = null;
        this.isCurrentlyInitializing = false;
        this.currentAttemptStartTime = null;
        
        this.logger.debug('Initialization statistics reset', this.platformName);
    }
    
    _calculatePerformanceAverages() {
        const averages = {};
        
        for (const [metric, values] of Object.entries(this.performanceMetrics)) {
            if (values.length > 0) {
                const sum = values.reduce((a, b) => a + b, 0);
                averages[metric] = {
                    average: sum / values.length,
                    count: values.length,
                    min: Math.min(...values),
                    max: Math.max(...values)
                };
            } else {
                averages[metric] = {
                    average: 0,
                    count: 0,
                    min: null,
                    max: null
                };
            }
        }
        
        return averages;
    }
    
    _getRecommendedAction() {
        if (this.consecutiveFailures >= 5) {
            return 'CRITICAL: Consider restarting platform or checking configuration';
        } else if (this.consecutiveFailures >= 3) {
            return 'WARNING: Investigate recurring initialization failures';
        } else if (this.averageInitializationTime > 30000) {
            return 'OPTIMIZATION: Initialization time is slow, consider performance improvements';
        } else if (this.successfulAttempts === 0 && this.totalAttempts > 0) {
            return 'ERROR: No successful initializations, check platform configuration';
        } else {
            return 'NORMAL: Platform initialization is functioning normally';
        }
    }
}

InitializationStatistics.prototype._handleInitializationError = function(message, error, eventData) {
    if (!this.errorHandler && this.logger) {
        this.errorHandler = createPlatformErrorHandler(this.logger, this.platformName);
    }

    if (this.errorHandler && error instanceof Error) {
        this.errorHandler.handleEventProcessingError(error, 'initialization', eventData, message);
        return;
    }

    if (this.errorHandler) {
        this.errorHandler.logOperationalError(message, this.platformName, eventData);
    }
};

module.exports = {
    InitializationStatistics
};
