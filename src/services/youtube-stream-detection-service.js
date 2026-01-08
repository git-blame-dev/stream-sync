
const { withTimeout } = require('../utils/timeout-wrapper');
const { createPlatformErrorHandler } = require('../utils/platform-error-handler');

class YouTubeStreamDetectionService {
    constructor(innertubeClient, options = {}) {
        this.client = innertubeClient;
        this._innertubeClient = innertubeClient; // Expose for testing
        if (!options.logger || typeof options.logger.error !== 'function') {
            throw new Error('YouTubeStreamDetectionService requires a logger');
        }
        this.logger = options.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'youtube-stream-detection');
        this.timeout = options.timeout || 2000; // 2 second timeout (reduced for faster failure)
        this._isShuttingDown = false;
        
        // Usage metrics for monitoring
        this._metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            totalResponseTime: 0,
            errorsByType: {}
        };
        
        // Circuit breaker pattern to prevent repeated hanging
        this._circuitBreaker = {
            consecutiveFailures: 0,
            lastFailureTime: null,
            isOpen: false,
            cooldownPeriod: 30000, // 30 seconds
            maxFailures: 3
        };
        
        this.logger.debug('YouTube stream detection service initialized', 'youtube-stream-detection');
    }
    
    async detectLiveStreams(channelHandle, options = {}) {
        const startTime = Date.now();
        this._metrics.totalRequests++;
        
        try {
            // Check circuit breaker before attempting operation
            if (this._isCircuitBreakerOpen()) {
                return this._formatErrorResponse(
                    new Error('Circuit breaker is open - service temporarily unavailable'),
                    options.debug,
                    startTime,
                    true // retryable after cooldown
                );
            }
            
            // Validate input
            if (!channelHandle || typeof channelHandle !== 'string') {
                return this._formatErrorResponse(
                    new Error('Channel handle is required'),
                    options.debug,
                    startTime,
                    false // not retryable
                );
            }
            
            // Store original handle for debug info
            const originalHandle = channelHandle;
            
            // Clean channel handle
            const cleanHandle = this._cleanChannelHandle(channelHandle);
            
            this.logger.debug(`Detecting live streams for channel: ${cleanHandle}`, 'youtube-stream-detection');
            
            // Create timeout wrapper for the detection
            const detectionPromise = this._performDetection(cleanHandle, options);
            const detectionResult = await withTimeout(
                detectionPromise,
                this.timeout,
                {
                    operationName: `YouTube detection (${cleanHandle})`,
                    errorMessage: 'Detection timeout'
                }
            );
            
            // Validate and filter video IDs
            const validVideoIds = this._validateVideoIds(detectionResult.streams);
            
            // Update metrics and reset circuit breaker on success
            this._metrics.successfulRequests++;
            this._metrics.totalResponseTime += (Date.now() - startTime);
            this._resetCircuitBreaker();
            
            return this._formatSuccessResponse(validVideoIds, options.debug, startTime, originalHandle, detectionResult);
            
        } catch (error) {
            this._metrics.failedRequests++;
            this._updateErrorMetrics(error);
            this._recordCircuitBreakerFailure(error);
            
            if (!this._isChannelNotFoundError(error)) {
                this._handleDetectionError(`Stream detection failed for ${channelHandle}: ${error.message}`, error, 'stream-detection');
            }
            
            return this._formatErrorResponse(error, options.debug, startTime);
        }
    }
    
    getUsageMetrics() {
        const avgResponseTime = this._metrics.totalRequests > 0 ? 
            this._metrics.totalResponseTime / this._metrics.successfulRequests : 0;
        
        return {
            totalRequests: this._metrics.totalRequests,
            successfulRequests: this._metrics.successfulRequests,
            failedRequests: this._metrics.failedRequests,
            averageResponseTime: Math.round(avgResponseTime),
            errorRate: this._metrics.totalRequests > 0 ? 
                this._metrics.failedRequests / this._metrics.totalRequests : 0,
            errorsByType: { ...this._metrics.errorsByType }
        };
    }
    
    updateConfiguration(newConfig) {
        try {
            if (newConfig.timeout && typeof newConfig.timeout === 'number' && newConfig.timeout > 0) {
                this.timeout = newConfig.timeout;
            }
            
            if (newConfig.username) {
                // Store username for future use if needed
                this.username = newConfig.username;
            }
            
            this.logger.debug('Configuration updated successfully', 'youtube-stream-detection');
            return true;
        } catch (error) {
            this._handleDetectionError(`Configuration update failed: ${error.message}`, error, 'configuration-update');
            return false;
        }
    }
    
    isConfigured() {
        return this.client !== null && this.client !== undefined;
    }
    
    isActive() {
        return this.isConfigured() && !this._isShuttingDown;
    }
    
    async cleanup() {
        try {
            this._isShuttingDown = true;
            
            // Reset metrics
            this._metrics = {
                totalRequests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                totalResponseTime: 0,
                errorsByType: {}
            };
            
            // Clear client reference
            this.client = null;
            
            this.logger.debug('YouTube stream detection service cleanup complete', 'youtube-stream-detection');
        } catch (error) {
            this._handleDetectionError(`Cleanup error: ${error.message}`, error, 'cleanup');
            throw error;
        }
    }
    
    async _performDetection(channelHandle, options) {
        // Use centralized YouTubeLiveStreamService - SINGLE SOURCE OF TRUTH
        const { YouTubeLiveStreamService } = require('./youtube-live-stream-service');
        
        const result = await YouTubeLiveStreamService.getLiveStreamsWithParserTolerance(
            this.client, 
            channelHandle, 
            { 
                timeout: this.timeout, 
                logger: this.logger 
            }
        );
        
        // Check if the operation was successful
        if (!result.success) {
            // Handle parser errors gracefully (don't throw - treat as successful with malformed flag)
            if (result.parserError) {
                // Return safe result for parser errors as successful operation
                return {
                    streams: [],
                    malformed: true,
                    hasContent: false,
                    parserError: true
                };
            }
            
            // For other failures, throw error to trigger error handling
            const error = new Error(result.error || 'Stream detection failed');
            throw error;
        }
        
        // Convert to expected format for backward compatibility
        return {
            streams: result.streams || [],
            malformed: result.parserError || false,
            hasContent: result.hasContent || false,
            parserError: result.parserError || false,
            detectionMethod: result.detectionMethod || 'unknown'
        };
    }
    
    _cleanChannelHandle(handle) {
        if (!handle) return '';
        
        // Remove @ prefix if present
        let cleanHandle = handle.trim();
        if (cleanHandle.startsWith('@')) {
            cleanHandle = cleanHandle.substring(1);
        }
        
        return cleanHandle;
    }
    
    _validateVideoIds(streams) {
        if (!Array.isArray(streams)) {
            return [];
        }
        
        return streams
            .map(stream => stream.videoId)
            .filter(videoId => this._isValidVideoId(videoId));
    }
    
    _isValidVideoId(videoId) {
        if (!videoId || typeof videoId !== 'string') {
            return false;
        }
        
        // Basic YouTube video ID validation (11 characters, alphanumeric + _ and -)
        return /^[a-zA-Z0-9_-]{11}$/.test(videoId) || /^[a-zA-Z0-9_-]+$/.test(videoId);
    }
    
    _formatSuccessResponse(videoIds, includeDebug, startTime, channelHandle, detectionResult) {
        const responseTime = Date.now() - startTime;
        
        let message;
        if (videoIds.length === 0) {
            if (detectionResult.malformed) {
                message = 'No streams found';
            } else if (detectionResult.hasContent) {
                message = 'No live streams found';
            } else {
                message = 'No content found';
            }
        } else {
            message = `Found ${videoIds.length} live stream${videoIds.length === 1 ? '' : 's'}`;
        }
        
        const response = {
            success: true,
            videoIds,
            message,
            responseTime,
            detectionMethod: detectionResult.detectionMethod || null,
            hasContent: detectionResult.hasContent || false
        };
        
        if (includeDebug) {
            response.debug = {
                requestTime: new Date().toISOString(),
                channelHandle,
                totalVideosFound: detectionResult.streams ? detectionResult.streams.length : 0,
                responseTimeMs: responseTime,
                validVideoIds: videoIds.length,
                invalidVideoIds: detectionResult.streams ? detectionResult.streams.length - videoIds.length : 0,
                detectionMethod: detectionResult.detectionMethod || null
            };
        }
        
        return response;
    }
    
    _formatErrorResponse(error, includeDebug, startTime, retryable = null) {
        const responseTime = Date.now() - startTime;
        
        let message = 'Unable to detect streams';
        let isRetryable = retryable;
        let retryAfter;
        
        if (error.message.includes('timeout')) {
            message = 'Detection timeout - please try again';
            isRetryable = true;
        } else if (error.message.includes('Network') || error.message.includes('connection')) {
            message = 'connection issue';
            isRetryable = true;
        } else if (error.status === 429 || error.message.includes('rate limit') || error.message.includes('Quota exceeded')) {
            message = 'rate limit exceeded';
            isRetryable = true;
            retryAfter = 60000; // 1 minute
        } else if (error.status === 404 || error.message.includes('not found')) {
            message = 'channel not found';
            isRetryable = false;
        } else if (isRetryable === null) {
            // Default retryable behavior for unknown errors
            isRetryable = true;
        }
        
        const response = {
            success: false,
            videoIds: [],
            message,
            responseTime,
            retryable: isRetryable
        };
        
        if (retryAfter) {
            response.retryAfter = retryAfter;
        }
        
        if (includeDebug) {
            response.debug = {
                requestTime: new Date().toISOString(),
                errorType: error.constructor.name,
                errorMessage: error.message,
                errorStatus: error.status,
                responseTimeMs: responseTime
            };
        }
        
        return response;
    }

    _isChannelNotFoundError(error) {
        if (!error) {
            return false;
        }
        if (error.status === 404) {
            return true;
        }
        const message = (error.message || '').toLowerCase();
        return message.includes('channel not found');
    }
    
    _updateErrorMetrics(error) {
        const errorType = error.constructor.name;
        this._metrics.errorsByType[errorType] = (this._metrics.errorsByType[errorType] || 0) + 1;
    }
    
    _isCircuitBreakerOpen() {
        if (!this._circuitBreaker.isOpen) {
            return false;
        }
        
        // Check if cooldown period has passed
        const now = Date.now();
        const timeSinceFailure = now - this._circuitBreaker.lastFailureTime;
        
        if (timeSinceFailure >= this._circuitBreaker.cooldownPeriod) {
            // Reset circuit breaker after cooldown
            this._resetCircuitBreaker();
            return false;
        }
        
        return true;
    }
    
    _recordCircuitBreakerFailure(error) {
        // Count timeout, hanging, and parser errors for circuit breaker
        if (error.message && (
            error.message.includes('timeout') || 
            error.message.includes('hanging') ||
            error.message.includes('not found!') ||
            error.message.includes('Type mismatch') ||
            error.message.includes('Parser')
        )) {
            this._circuitBreaker.consecutiveFailures++;
            this._circuitBreaker.lastFailureTime = Date.now();
            
            if (this._circuitBreaker.consecutiveFailures >= this._circuitBreaker.maxFailures) {
                this._circuitBreaker.isOpen = true;
                this.logger.warn(`Circuit breaker opened after ${this._circuitBreaker.consecutiveFailures} consecutive failures`, 'youtube-stream-detection');
            }
        }
    }
    
    _resetCircuitBreaker() {
        this._circuitBreaker.consecutiveFailures = 0;
        this._circuitBreaker.lastFailureTime = null;
        this._circuitBreaker.isOpen = false;
    }

    _handleDetectionError(message, error, eventType) {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'youtube-stream-detection', {
                eventType,
                error
            });
        }
    }
    
}

module.exports = { YouTubeStreamDetectionService };
