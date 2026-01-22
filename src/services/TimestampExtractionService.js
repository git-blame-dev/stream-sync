
const ServiceInterface = require('../interfaces/ServiceInterface');
const { resolveTikTokTimestampMs } = require('../utils/tiktok-timestamp');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');
const { validateLoggerInterface } = require('../utils/dependency-validator');
const { getSystemTimestampISO } = require('../utils/validation');

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
                this._recordPerformance(startTime, false, null, normalizedPlatform, error);
                return null;
            }

            const timestamp = strategy(rawData);
            const processingTimeNs = process.hrtime.bigint() - startTime;
            const processingTimeMs = Number(processingTimeNs) / 1000000;

            if (!timestamp || typeof timestamp !== 'string') {
                const error = new Error(`Missing ${normalizedPlatform} timestamp`);
                this._handleTimestampError(`Timestamp extraction failed for ${platform}`, error, 'missing-timestamp');
                this._recordPerformance(startTime, false, processingTimeMs, normalizedPlatform, error);
                return null;
            }

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
            return null;
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
            return null;
        }

        const resolvedTimestampMs = resolveTikTokTimestampMs(data);
        if (resolvedTimestampMs !== null) {
            const timestamp = new Date(resolvedTimestampMs).toISOString();
            this.logger.debug && this.logger.debug(`TikTok timestamp resolved: ${timestamp}`, 'timestamp-service');
            return timestamp;
        }

        return null;
    }
    
    extractYouTubeTimestamp(data) {
        // Fast null check with early return
        if (!data || typeof data !== 'object') {
            return null;
        }

        const source = data.item && typeof data.item === 'object' ? data.item : data;
        const rawUsec = source.timestamp_usec;
        if (rawUsec !== undefined && rawUsec !== null) {
            const usecValue = typeof rawUsec === 'number'
                ? rawUsec
                : this._fastParseInt(String(rawUsec));
            if (usecValue === null || usecValue <= 0) {
                return null;
            }
            const timestamp = new Date(Math.floor(usecValue / 1000)).toISOString();
            this.logger.debug && this.logger.debug(`YouTube timestamp from timestamp_usec: ${timestamp}`, 'timestamp-service');
            return timestamp;
        }

        const rawTimestamp = source.timestamp;
        if (rawTimestamp === undefined || rawTimestamp === null) {
            return null;
        }

        let timestampValue = this._parseTimestampInput(rawTimestamp);
        if (timestampValue === null) {
            return null;
        }

        const MICROSECOND_THRESHOLD = 10000000000000; // 10^13
        if (timestampValue > MICROSECOND_THRESHOLD) {
            timestampValue = Math.floor(timestampValue / 1000);
        }

        const timestamp = new Date(timestampValue).toISOString();
        this.logger.debug && this.logger.debug(`YouTube timestamp from timestamp field: ${timestamp}`, 'timestamp-service');
        return timestamp;
    }
    
    extractTwitchTimestamp(data) {
        return this._extractTwitchTimestampValue(data).timestamp;
    }

    _extractTwitchTimestampValue(data, options = {}) {
        const source = data && typeof data === 'object' ? data : null;
        if (!source) {
            return { timestamp: null, isFallback: true };
        }

        const rawTimestamp = source.followed_at ?? source.started_at ?? source.timestamp;
        if (rawTimestamp === undefined || rawTimestamp === null) {
            return { timestamp: null, isFallback: true };
        }

        const timeValue = typeof rawTimestamp === 'number'
            ? rawTimestamp
            : this._validateAndParseTimestamp(String(rawTimestamp));
        if (timeValue === null || timeValue <= 0) {
            return { timestamp: null, isFallback: true };
        }

        const timestamp = new Date(timeValue).toISOString();
        this.logger.debug && this.logger.debug(`Twitch timestamp resolved: ${timestamp}`, 'timestamp-service');
        return { timestamp, isFallback: false };
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
                if (numValue <= 0) {
                    if (this._config.enableCaching) {
                        this._addToCache(timestampStr, null);
                    }
                    return null;
                }
                // Cache valid results if caching enabled
                if (this._config.enableCaching) {
                    this._addToCache(timestampStr, numValue);
                }
                return numValue;
            }
            
            // Try Date parsing for ISO strings
            const dateValue = Date.parse(timestampStr);
            if (!isNaN(dateValue) && dateValue > 0) {
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
    
    _parseTimestampInput(value) {
        if (typeof value === 'number') {
            return Number.isFinite(value) ? value : null;
        }
        if (typeof value !== 'string') {
            return null;
        }
        const trimmed = value.trim();
        if (!trimmed) {
            return null;
        }
        const numericCandidate = Number(trimmed);
        if (!Number.isNaN(numericCandidate) && Number.isFinite(numericCandidate)) {
            if (numericCandidate <= 0) {
                return null;
            }
            return numericCandidate;
        }
        const parsedDate = Date.parse(trimmed);
        if (Number.isNaN(parsedDate) || parsedDate <= 0) {
            return null;
        }
        return parsedDate;
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
                lastActivity: getSystemTimestampISO(),
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
