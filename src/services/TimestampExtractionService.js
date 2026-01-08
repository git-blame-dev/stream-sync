
const ServiceInterface = require('../interfaces/ServiceInterface');
const { resolveTikTokTimestampMs } = require('../utils/tiktok-timestamp');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { validateLoggerInterface } = require('../utils/dependency-validator');

class TimestampExtractionService extends ServiceInterface {
    constructor(dependencies = {}) {
        super();
        
        // Validate configuration
        this.validateConfiguration(dependencies);
        
        // Core dependencies
        validateLoggerInterface(dependencies.logger);
        this.logger = dependencies.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'timestamp-service');
        this.performanceTracker = dependencies.performanceTracker || { recordExtraction: () => {} };
        this.cacheManager = dependencies.cacheManager || null;
        
        // Service configuration
        this._config = {
            enableCaching: dependencies.enableCaching !== false,
            cacheLimit: dependencies.cacheLimit || 1000,
            enableMetrics: dependencies.enableMetrics !== false,
            highPerformanceMode: dependencies.highPerformanceMode || false
        };
        
        // Service state management
        this._serviceState = {
            status: 'initializing',
            startTime: null,
            pausedAt: null,
            isInitialized: false,
            isPaused: false
        };
        
        // Performance optimization caches
        this._timestampValidationCache = new Map();
        this._platformStrategyCache = null; // Cached strategy map
        this._performanceMetrics = {
            totalExtractions: 0,
            totalProcessingTime: 0,
            avgProcessingTime: 0,
            slowExtractions: 0,
            extractionsByPlatform: {
                tiktok: 0,
                youtube: 0,
                twitch: 0
            },
            errors: {
                total: 0,
                byPlatform: {},
                byType: {}
            }
        };
        
        // Enterprise service metadata
        this._metadata = {
            version: '1.1.0',
            serviceType: 'TimestampExtractionService',
            capabilities: ['platform-extraction', 'caching', 'metrics', 'lifecycle-management'],
            supportedPlatforms: ['tiktok', 'youtube', 'twitch']
        };
        
        // Precompile platform strategies for performance
        this._initializeStrategies();
        
        // Mark as constructed
        this._serviceState.status = 'constructed';
    }
    
    _initializeStrategies() {
        this._platformStrategyCache = {
            tiktok: this.extractTikTokTimestamp.bind(this),
            youtube: this.extractYouTubeTimestamp.bind(this), 
            twitch: this.extractTwitchTimestamp.bind(this)
        };
    }
    
    extractTimestamp(platform, rawData) {
        const startTime = process.hrtime.bigint(); // Higher precision timing
        const normalizedPlatform = platform?.toLowerCase() || 'unknown';

        try {
            // Use cached platform strategy for performance
            const strategy = this._platformStrategyCache[normalizedPlatform];

            if (!strategy) {
                const error = new Error(`Unsupported platform: ${platform}`);
                this._handleTimestampError(`Timestamp extraction failed for ${platform}`, error, 'unsupported-platform');
                this._recordPerformance(startTime, false);
                return new Date().toISOString();
            }

            const timestamp = strategy(rawData);
            const processingTimeNs = process.hrtime.bigint() - startTime;
            const processingTimeMs = Number(processingTimeNs) / 1000000;

            // Record comprehensive performance metrics
            this._recordPerformance(startTime, true, processingTimeMs, normalizedPlatform);
            this.performanceTracker.recordExtraction(normalizedPlatform, processingTimeMs);

            // Enhanced performance monitoring
            if (processingTimeMs > 5) {
                this._performanceMetrics.slowExtractions++;
                this.logger.warn(`Slow timestamp extraction for ${platform}: ${processingTimeMs.toFixed(3)}ms`, 'timestamp-service');
            }

            // Only debug log in development or when explicitly enabled
            if (this.logger.isDebugEnabled?.() !== false) {
                this.logger.debug(`Extracted timestamp for ${platform}: ${timestamp} (${processingTimeMs.toFixed(3)}ms)`, 'timestamp-service');
            }

            return timestamp;

        } catch (error) {
            this._recordPerformance(startTime, false, null, normalizedPlatform, error);
            this._handleTimestampError(`Timestamp extraction failed for ${platform}`, error, 'extraction');
            return new Date().toISOString(); // Fallback to current time
        }
    }
    
    _recordPerformance(startTime, success, processingTimeMs = null, platform = null, error = null) {
        if (!this._config.enableMetrics) {
            return; // Skip metrics collection if disabled
        }
        
        if (processingTimeMs === null) {
            const processingTimeNs = process.hrtime.bigint() - startTime;
            processingTimeMs = Number(processingTimeNs) / 1000000;
        }
        
        // Update overall metrics
        this._performanceMetrics.totalExtractions++;
        this._performanceMetrics.totalProcessingTime += processingTimeMs;
        this._performanceMetrics.avgProcessingTime = 
            this._performanceMetrics.totalProcessingTime / this._performanceMetrics.totalExtractions;
        
        // Update platform-specific metrics
        if (platform && this._performanceMetrics.extractionsByPlatform[platform] !== undefined) {
            this._performanceMetrics.extractionsByPlatform[platform]++;
        }
        
        // Record errors with detailed tracking
        if (!success) {
            this._performanceMetrics.errors.total++;
            
            // Track errors by platform
            if (platform) {
                this._performanceMetrics.errors.byPlatform[platform] = 
                    (this._performanceMetrics.errors.byPlatform[platform] || 0) + 1;
            }
            
            // Track errors by type
            if (error) {
                const errorType = error.name || 'UnknownError';
                this._performanceMetrics.errors.byType[errorType] = 
                    (this._performanceMetrics.errors.byType[errorType] || 0) + 1;
            }
        }
            
        // Periodic performance reporting for monitoring
        if (this._performanceMetrics.totalExtractions % 1000 === 0) {
            const errorRate = (this._performanceMetrics.errors.total / this._performanceMetrics.totalExtractions * 100).toFixed(2);
            
            this.logger.info('Timestamp extraction performance report', 'timestamp-service', {
                totalExtractions: this._performanceMetrics.totalExtractions,
                avgProcessingTime: this._performanceMetrics.avgProcessingTime.toFixed(3) + 'ms',
                slowExtractions: this._performanceMetrics.slowExtractions,
                errorRate: errorRate + '%',
                platformDistribution: this._performanceMetrics.extractionsByPlatform,
                topErrors: Object.entries(this._performanceMetrics.errors.byType)
                    .sort(([,a], [,b]) => b - a)
                    .slice(0, 3)
            });
        }
    }
    
    extractTikTokTimestamp(data) {
        // Fast null check with early return
        if (!data || typeof data !== 'object') {
            return new Date().toISOString();
        }

        const resolvedTimestampMs = resolveTikTokTimestampMs(data);
        if (resolvedTimestampMs !== null) {
            const timestamp = new Date(resolvedTimestampMs).toISOString();
            this.logger.debug && this.logger.debug(`TikTok timestamp resolved: ${timestamp}`, 'timestamp-service');
            return timestamp;
        }
        
        // Fallback: current time
        const currentTime = new Date().toISOString();
        this.logger.debug && this.logger.debug(`TikTok timestamp fallback to current time: ${currentTime}`, 'timestamp-service');
        return currentTime;
    }
    
    extractYouTubeTimestamp(data) {
        // Fast null check with early return
        if (!data || typeof data !== 'object') {
            return new Date().toISOString();
        }
        
        // Priority 1: timestamp field (could be microseconds or milliseconds) - optimized parsing
        if (data.timestamp !== undefined && data.timestamp !== null) {
            try {
                // Fast integer parsing with validation
                const rawTimestamp = data.timestamp;
                let timestampValue;
                
                if (typeof rawTimestamp === 'number') {
                    timestampValue = rawTimestamp;
                } else if (typeof rawTimestamp === 'string') {
                    timestampValue = this._fastParseInt(rawTimestamp);
                    if (timestampValue === null) {
                        throw new Error(`Cannot parse timestamp: ${rawTimestamp}`);
                    }
                } else {
                    throw new Error(`Invalid timestamp type: ${typeof rawTimestamp}`);
                }
                
                // Optimized microsecond detection - use constant for performance
                const MICROSECOND_THRESHOLD = 10000000000000; // 10^13
                if (timestampValue > MICROSECOND_THRESHOLD) {
                    timestampValue = Math.floor(timestampValue / 1000); // Convert microseconds to milliseconds
                }
                
                const timestamp = new Date(timestampValue).toISOString();
                this.logger.debug && this.logger.debug(`YouTube timestamp from timestamp field: ${timestamp}`, 'timestamp-service');
                return timestamp;
            } catch (error) {
                this.logger.warn(`Invalid YouTube timestamp: ${data.timestamp}`, 'timestamp-service', error);
            }
        }
        
        // Priority 2: timestampUsec field (microsecond format) - optimized division
        if (data.timestampUsec !== undefined && data.timestampUsec !== null) {
            try {
                const rawUsec = data.timestampUsec;
                let usecValue;
                
                if (typeof rawUsec === 'number') {
                    usecValue = rawUsec;
                } else if (typeof rawUsec === 'string') {
                    usecValue = this._fastParseInt(rawUsec);
                    if (usecValue === null) {
                        throw new Error(`Cannot parse timestampUsec: ${rawUsec}`);
                    }
                } else {
                    throw new Error(`Invalid timestampUsec type: ${typeof rawUsec}`);
                }
                
                const timestamp = new Date(Math.floor(usecValue / 1000)).toISOString();
                this.logger.debug && this.logger.debug(`YouTube timestamp from timestampUsec: ${timestamp}`, 'timestamp-service');
                return timestamp;
            } catch (error) {
                this.logger.warn(`Invalid YouTube timestampUsec: ${data.timestampUsec}`, 'timestamp-service', error);
            }
        }
        
        // Fallback: current time
        const currentTime = new Date().toISOString();
        this.logger.debug && this.logger.debug(`YouTube timestamp fallback to current time: ${currentTime}`, 'timestamp-service');
        return currentTime;
    }
    
    extractTwitchTimestamp(data) {
        return this._extractTwitchTimestampValue(data).timestamp;
    }

    _extractTwitchTimestampValue(data, options = {}) {
        const { logFallback = true } = options;

        // Fast null check with early return
        if (!data || typeof data !== 'object') {
            const currentTime = new Date().toISOString();
            if (logFallback) {
                this.logger.debug && this.logger.debug(`Twitch timestamp fallback to current time: ${currentTime}`, 'timestamp-service');
            }
            return { timestamp: currentTime, isFallback: true };
        }
        
        // Priority 1: timestamp field (direct timestamp) - optimized validation
        if (data.timestamp !== undefined && data.timestamp !== null) {
            try {
                const timeValue = typeof data.timestamp === 'number' ? data.timestamp : 
                    this._validateAndParseTimestamp(data.timestamp);
                if (timeValue !== null) {
                    const timestamp = new Date(timeValue).toISOString();
                    this.logger.debug && this.logger.debug(`Twitch timestamp from timestamp field: ${timestamp}`, 'timestamp-service');
                    return { timestamp, isFallback: false };
                }
            } catch (error) {
                this.logger.warn(`Invalid Twitch timestamp: ${data.timestamp}`, 'timestamp-service', error);
            }
        }
        
        // Priority 2: tmi-sent-ts field (TMI.js format) - optimized parsing
        const tmiTimestamp = data['tmi-sent-ts'];
        if (tmiTimestamp !== undefined && tmiTimestamp !== null) {
            try {
                let tmiValue;
                if (typeof tmiTimestamp === 'number') {
                    tmiValue = tmiTimestamp;
                } else if (typeof tmiTimestamp === 'string') {
                    tmiValue = this._fastParseInt(tmiTimestamp);
                    if (tmiValue === null) {
                        throw new Error(`Cannot parse tmi-sent-ts: ${tmiTimestamp}`);
                    }
                } else {
                    throw new Error(`Invalid tmi-sent-ts type: ${typeof tmiTimestamp}`);
                }
                
                const timestamp = new Date(tmiValue).toISOString();
                this.logger.debug && this.logger.debug(`Twitch timestamp from tmi-sent-ts: ${timestamp}`, 'timestamp-service');
                return { timestamp, isFallback: false };
            } catch (error) {
                this.logger.warn(`Invalid Twitch tmi-sent-ts: ${tmiTimestamp}`, 'timestamp-service', error);
            }
        }
        
        // Priority 3: Check in nested context (if data is a wrapper object) - prevent infinite recursion
        if (data.context && typeof data.context === 'object' && data.context !== data) {
            const contextResult = this._extractTwitchTimestampValue(data.context, { logFallback: false });
            // Only return context result if it contains an actual timestamp
            if (!contextResult.isFallback) {
                return contextResult;
            }
        }
        
        // Fallback: current time
        const currentTime = new Date().toISOString();
        if (logFallback) {
            this.logger.debug && this.logger.debug(`Twitch timestamp fallback to current time: ${currentTime}`, 'timestamp-service');
        }
        return { timestamp: currentTime, isFallback: true };
    }
    
    _validateAndParseTimestamp(timestampStr) {
        if (typeof timestampStr !== 'string' || timestampStr.length === 0) {
            return null;
        }
        
        // Check cache first for repeated validations (if caching enabled)
        if (this._config.enableCaching && this._timestampValidationCache.has(timestampStr)) {
            return this._timestampValidationCache.get(timestampStr);
        }
        
        try {
            // Fast path for numeric strings
            const numValue = Number(timestampStr);
            if (!isNaN(numValue) && isFinite(numValue)) {
                // Cache valid results if caching enabled
                if (this._config.enableCaching) {
                    this._addToCache(timestampStr, numValue);
                }
                return numValue;
            }
            
            // Try Date parsing for ISO strings
            const dateValue = Date.parse(timestampStr);
            if (!isNaN(dateValue)) {
                if (this._config.enableCaching) {
                    this._addToCache(timestampStr, dateValue);
                }
                return dateValue;
            }
            
            // Cache invalid results as null
            if (this._config.enableCaching) {
                this._addToCache(timestampStr, null);
            }
            return null;
            
        } catch {
            // Cache failed validations
            if (this._config.enableCaching) {
                this._addToCache(timestampStr, null);
            }
            return null;
        }
    }
    
    _addToCache(key, value) {
        // Limit cache size to prevent memory leaks
        if (this._timestampValidationCache.size >= this._config.cacheLimit) {
            // Remove oldest entries using FIFO strategy
            const keysToRemove = Math.max(1, Math.floor(this._config.cacheLimit * 0.1)); // Remove 10% of cache
            let removedCount = 0;
            
            for (const oldKey of this._timestampValidationCache.keys()) {
                this._timestampValidationCache.delete(oldKey);
                removedCount++;
                if (removedCount >= keysToRemove) {
                    break;
                }
            }
        }
        
        this._timestampValidationCache.set(key, value);
    }
    
    _fastParseInt(str) {
        if (typeof str !== 'string' || str.length === 0) {
            return null;
        }
        
        // Fast path for pure numeric strings
        const num = Number(str);
        if (!isNaN(num) && isFinite(num) && Number.isInteger(num)) {
            return num;
        }
        
        return null;
    }
    
    getPerformanceMetrics() {
        return {
            ...this._performanceMetrics,
            cacheSize: this._timestampValidationCache.size,
            successRate: this._performanceMetrics.totalExtractions > 0 
                ? ((this._performanceMetrics.totalExtractions - this._performanceMetrics.slowExtractions) / this._performanceMetrics.totalExtractions * 100).toFixed(2) + '%'
                : '100%'
        };
    }
    
    resetMetrics() {
        this._performanceMetrics = {
            totalExtractions: 0,
            totalProcessingTime: 0,
            avgProcessingTime: 0,
            slowExtractions: 0
        };
        this._timestampValidationCache.clear();
    }
    
    async initialize(config = {}) {
        if (this._serviceState.isInitialized) {
            this.logger.debug('Service already initialized', 'timestamp-service');
            return;
        }
        
        try {
            // Apply any runtime configuration
            if (config.caching !== undefined) {
                this._config.enableCaching = config.caching;
            }
            if (config.metrics !== undefined) {
                this._config.enableMetrics = config.metrics;
            }
            
            // Initialize caches if enabled
            if (this._config.enableCaching) {
                this._timestampValidationCache.clear();
            }
            
            // Mark as initialized
            this._serviceState.isInitialized = true;
            this._serviceState.status = 'initialized';
            
            this.logger.info('TimestampExtractionService initialized successfully', 'timestamp-service', {
                config: this._config,
                metadata: this._metadata
            });

        } catch (error) {
            this._serviceState.status = 'initialization-failed';
            this._handleTimestampError('Failed to initialize TimestampExtractionService', error, 'initialize');
            throw error;
        }
    }
    
    async start() {
        if (!this._serviceState.isInitialized) {
            await this.initialize();
        }
        
        if (this._serviceState.status === 'running') {
            this.logger.debug('Service already running', 'timestamp-service');
            return;
        }
        
        try {
            this._serviceState.startTime = Date.now();
            this._serviceState.status = 'running';
            this._serviceState.isPaused = false;
            
            this.logger.info('TimestampExtractionService started', 'timestamp-service', {
                startTime: new Date(this._serviceState.startTime).toISOString(),
                config: this._config
            });

        } catch (error) {
            this._serviceState.status = 'start-failed';
            this._handleTimestampError('Failed to start TimestampExtractionService', error, 'start');
            throw error;
        }
    }
    
    async stop() {
        if (this._serviceState.status === 'stopped') {
            this.logger.debug('Service already stopped', 'timestamp-service');
            return;
        }
        
        try {
            // Capture final metrics
            const finalMetrics = this.getPerformanceMetrics();
            
            // Clean up resources
            this.resetMetrics();
            
            // Update state
            this._serviceState.status = 'stopped';
            this._serviceState.isPaused = false;
            
            this.logger.info('TimestampExtractionService stopped', 'timestamp-service', {
                finalMetrics,
                uptime: this._serviceState.startTime ? Date.now() - this._serviceState.startTime : 0
            });

        } catch (error) {
            this._serviceState.status = 'stop-failed';
            this._handleTimestampError('Failed to stop TimestampExtractionService', error, 'stop');
            throw error;
        }
    }
    
    async pause() {
        if (this._serviceState.isPaused) {
            this.logger.debug('Service already paused', 'timestamp-service');
            return;
        }
        
        this._serviceState.isPaused = true;
        this._serviceState.pausedAt = Date.now();
        
        this.logger.debug('TimestampExtractionService paused', 'timestamp-service', {
            pausedAt: new Date(this._serviceState.pausedAt).toISOString()
        });
    }
    
    async resume() {
        if (!this._serviceState.isPaused) {
            this.logger.debug('Service not paused, resume ignored', 'timestamp-service');
            return;
        }
        
        const pauseDuration = this._serviceState.pausedAt ? Date.now() - this._serviceState.pausedAt : 0;
        
        this._serviceState.isPaused = false;
        this._serviceState.pausedAt = null;
        
        this.logger.debug('TimestampExtractionService resumed', 'timestamp-service', {
            pauseDurationMs: pauseDuration
        });
    }
    
    validateConfiguration(config) {
        validateLoggerInterface(config?.logger);
        
        // Validate performance tracker if provided
        if (config.performanceTracker && typeof config.performanceTracker.recordExtraction !== 'function') {
            throw new Error('Invalid performanceTracker configuration: missing recordExtraction method');
        }
        
        // Validate cache configuration
        if (config.cacheLimit !== undefined && (!Number.isInteger(config.cacheLimit) || config.cacheLimit < 0)) {
            throw new Error('Invalid cacheLimit configuration: must be a non-negative integer');
        }
        
        return true;
    }
    
    getStatus() {
        const uptime = this._serviceState.startTime ? Date.now() - this._serviceState.startTime : 0;
        
        return {
            ...this._metadata,
            status: this._serviceState.status,
            state: {
                isInitialized: this._serviceState.isInitialized,
                isPaused: this._serviceState.isPaused,
                startTime: this._serviceState.startTime ? new Date(this._serviceState.startTime).toISOString() : null,
                uptime: uptime
            },
            config: this._config,
            performance: this.getPerformanceMetrics(),
            health: {
                status: this._serviceState.status === 'running' && !this._serviceState.isPaused ? 'healthy' : 'degraded',
                lastActivity: new Date().toISOString(),
                errorRate: this._performanceMetrics.totalExtractions > 0 
                    ? (this._performanceMetrics.errors.total / this._performanceMetrics.totalExtractions * 100).toFixed(2) + '%'
                    : '0%'
            }
        };
    }
    
    getMetrics() {
        return {
            ...super.getMetrics(),
            ...this.getPerformanceMetrics(),
            platformDistribution: this._performanceMetrics.extractionsByPlatform,
            errorBreakdown: this._performanceMetrics.errors,
            cacheUtilization: this._config.enableCaching ? {
                size: this._timestampValidationCache.size,
                limit: this._config.cacheLimit,
                utilization: ((this._timestampValidationCache.size / this._config.cacheLimit) * 100).toFixed(2) + '%'
            } : null
        };
    }

    _handleTimestampError(message, error, eventType = 'timestamp') {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'timestamp-service', {
                eventType,
                error
            });
        }
    }
}

module.exports = TimestampExtractionService;
