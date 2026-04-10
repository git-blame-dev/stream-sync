import { getSystemTimestampISO } from '../utils/timestamp';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { withTimeout } from '../utils/timeout-wrapper';
import { YouTubeLiveStreamService } from './youtube-live-stream-service';

type LoggerLike = {
    debug?: (...args: unknown[]) => void;
    warn?: (...args: unknown[]) => void;
    error: (...args: unknown[]) => void;
};

type DetectionServiceOptions = {
    logger: LoggerLike;
    timeout?: number;
};

type DetectOptions = {
    debug?: boolean;
};

type DetectionStream = {
    videoId?: unknown;
};

type DetectionResult = {
    streams: DetectionStream[];
    malformed?: boolean;
    hasContent?: boolean;
    parserError?: boolean;
    detectionMethod?: string;
};

type LiveStreamServiceResult = Awaited<ReturnType<typeof YouTubeLiveStreamService.getLiveStreamsWithParserTolerance>>;

type DetectionServiceResponse = {
    success: boolean;
    videoIds: string[];
    message: string;
    responseTime: number;
    retryable?: boolean;
    retryAfter?: number;
    hasContent?: boolean;
    detectionMethod?: string | null;
    debug?: {
        requestTime: string;
        channelHandle?: string;
        totalVideosFound?: number;
        responseTimeMs: number;
        validVideoIds?: number;
        invalidVideoIds?: number;
        detectionMethod?: string | null;
        errorType?: string;
        errorMessage?: string;
        errorStatus?: number;
    };
};

type UsageMetrics = {
    totalRequests: number;
    successfulRequests: number;
    failedRequests: number;
    totalResponseTime: number;
    errorsByType: Record<string, number>;
};

type CircuitBreakerState = {
    consecutiveFailures: number;
    lastFailureTime: number | null;
    isOpen: boolean;
    cooldownPeriod: number;
    maxFailures: number;
};

type ErrorWithStatus = Error & { status?: number };

function asError(error: unknown): ErrorWithStatus {
    if (error instanceof Error) {
        return error;
    }

    return new Error(String(error));
}

class YouTubeStreamDetectionService {
    client: unknown;
    _innertubeClient: unknown;
    logger: LoggerLike;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    timeout: number;
    _isShuttingDown: boolean;
    _metrics: UsageMetrics;
    _circuitBreaker: CircuitBreakerState;
    username?: string;

    constructor(innertubeClient: unknown, options: DetectionServiceOptions) {
        this.client = innertubeClient;
        this._innertubeClient = innertubeClient;

        if (!options.logger || typeof options.logger.error !== 'function') {
            throw new Error('YouTubeStreamDetectionService requires a logger');
        }

        this.logger = options.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'youtube-stream-detection');
        this.timeout = options.timeout || 2000;
        this._isShuttingDown = false;

        this._metrics = {
            totalRequests: 0,
            successfulRequests: 0,
            failedRequests: 0,
            totalResponseTime: 0,
            errorsByType: {}
        };

        this._circuitBreaker = {
            consecutiveFailures: 0,
            lastFailureTime: null,
            isOpen: false,
            cooldownPeriod: 30000,
            maxFailures: 3
        };

        this.logger.debug?.('YouTube stream detection service initialized', 'youtube-stream-detection');
    }

    async detectLiveStreams(channelHandle: unknown, options: DetectOptions = {}): Promise<DetectionServiceResponse> {
        const startTime = Date.now();
        this._metrics.totalRequests += 1;

        try {
            if (this._isCircuitBreakerOpen()) {
                return this._formatErrorResponse(
                    new Error('Circuit breaker is open - service temporarily unavailable'),
                    options.debug,
                    startTime,
                    true
                );
            }

            if (!channelHandle || typeof channelHandle !== 'string') {
                return this._formatErrorResponse(
                    new Error('Channel handle is required'),
                    options.debug,
                    startTime,
                    false
                );
            }

            const originalHandle = channelHandle;
            const cleanHandle = this._cleanChannelHandle(channelHandle);

            this.logger.debug?.(`Detecting live streams for channel: ${cleanHandle}`, 'youtube-stream-detection');

            const detectionPromise = this._performDetection(cleanHandle);
            const detectionResult = await withTimeout(
                detectionPromise,
                this.timeout,
                {
                    operationName: `YouTube detection (${cleanHandle})`,
                    errorMessage: 'Detection timeout'
                }
            );

            const validVideoIds = this._validateVideoIds(detectionResult.streams);

            this._metrics.successfulRequests += 1;
            this._metrics.totalResponseTime += Date.now() - startTime;
            this._resetCircuitBreaker();

            return this._formatSuccessResponse(validVideoIds, options.debug, startTime, originalHandle, detectionResult);
        } catch (error) {
            const normalizedError = asError(error);

            this._metrics.failedRequests += 1;
            this._updateErrorMetrics(normalizedError);
            this._recordCircuitBreakerFailure(normalizedError);

            if (!this._isChannelNotFoundError(normalizedError)) {
                this._handleDetectionError(
                    `Stream detection failed for ${String(channelHandle)}: ${normalizedError.message}`,
                    normalizedError,
                    'stream-detection'
                );
            }

            return this._formatErrorResponse(normalizedError, options.debug, startTime);
        }
    }

    getUsageMetrics() {
        const avgResponseTime = this._metrics.successfulRequests > 0
            ? this._metrics.totalResponseTime / this._metrics.successfulRequests
            : 0;

        return {
            totalRequests: this._metrics.totalRequests,
            successfulRequests: this._metrics.successfulRequests,
            failedRequests: this._metrics.failedRequests,
            averageResponseTime: Math.round(avgResponseTime),
            errorRate: this._metrics.totalRequests > 0
                ? this._metrics.failedRequests / this._metrics.totalRequests
                : 0,
            errorsByType: { ...this._metrics.errorsByType }
        };
    }

    updateConfiguration(newConfig: { timeout?: number; username?: string }) {
        try {
            if (newConfig.timeout && typeof newConfig.timeout === 'number' && newConfig.timeout > 0) {
                this.timeout = newConfig.timeout;
            }

            if (newConfig.username) {
                this.username = newConfig.username;
            }

            this.logger.debug?.('Configuration updated successfully', 'youtube-stream-detection');
            return true;
        } catch (error) {
            const normalizedError = asError(error);
            this._handleDetectionError(`Configuration update failed: ${normalizedError.message}`, normalizedError, 'configuration-update');
            return false;
        }
    }

    isConfigured() {
        return this.client !== null && typeof this.client !== 'undefined';
    }

    isActive() {
        return this.isConfigured() && !this._isShuttingDown;
    }

    async cleanup() {
        try {
            this._isShuttingDown = true;
            this._metrics = {
                totalRequests: 0,
                successfulRequests: 0,
                failedRequests: 0,
                totalResponseTime: 0,
                errorsByType: {}
            };

            this.client = null;
            this.logger.debug?.('YouTube stream detection service cleanup complete', 'youtube-stream-detection');
        } catch (error) {
            const normalizedError = asError(error);
            this._handleDetectionError(`Cleanup error: ${normalizedError.message}`, normalizedError, 'cleanup');
            throw error;
        }
    }

    async _performDetection(channelHandle: string): Promise<DetectionResult> {
        const result: LiveStreamServiceResult = await YouTubeLiveStreamService.getLiveStreamsWithParserTolerance(
            this.client as Parameters<typeof YouTubeLiveStreamService.getLiveStreamsWithParserTolerance>[0],
            channelHandle,
            {
                timeout: this.timeout,
                logger: this.logger
            }
        );

        const parserError = 'parserError' in result && result.parserError === true;
        const detectionMethod = 'detectionMethod' in result && typeof result.detectionMethod === 'string'
            ? result.detectionMethod
            : 'unknown';
        const responseError = 'error' in result && typeof result.error === 'string'
            ? result.error
            : 'Stream detection failed';

        if (!result.success) {
            if (parserError) {
                return {
                    streams: [],
                    malformed: true,
                    hasContent: false,
                    parserError: true
                };
            }

            throw new Error(responseError);
        }

        return {
            streams: result.streams || [],
            malformed: parserError,
            hasContent: result.hasContent || false,
            parserError,
            detectionMethod
        };
    }

    _cleanChannelHandle(handle: unknown) {
        if (!handle || typeof handle !== 'string') {
            return '';
        }

        let cleanHandle = handle.trim();
        if (cleanHandle.startsWith('@')) {
            cleanHandle = cleanHandle.substring(1);
        }

        return cleanHandle;
    }

    _validateVideoIds(streams: unknown) {
        if (!Array.isArray(streams)) {
            return [];
        }

        return streams
            .map((stream) => (stream as DetectionStream).videoId)
            .filter((videoId): videoId is string => this._isValidVideoId(videoId));
    }

    _isValidVideoId(videoId: unknown) {
        if (!videoId || typeof videoId !== 'string') {
            return false;
        }

        return /^[a-zA-Z0-9_-]{11}$/.test(videoId) || /^[a-zA-Z0-9_-]+$/.test(videoId);
    }

    _formatSuccessResponse(
        videoIds: string[],
        includeDebug: boolean | undefined,
        startTime: number,
        channelHandle: string,
        detectionResult: DetectionResult
    ): DetectionServiceResponse {
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

        const response: DetectionServiceResponse = {
            success: true,
            videoIds,
            message,
            responseTime,
            detectionMethod: detectionResult.detectionMethod || null,
            hasContent: detectionResult.hasContent || false
        };

        if (includeDebug) {
            response.debug = {
                requestTime: getSystemTimestampISO(),
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

    _formatErrorResponse(
        error: ErrorWithStatus,
        includeDebug: boolean | undefined,
        startTime: number,
        retryable: boolean | null = null
    ): DetectionServiceResponse {
        const responseTime = Date.now() - startTime;

        let message = 'Unable to detect streams';
        let isRetryable = retryable;
        let retryAfter: number | undefined;

        if (error.message.includes('timeout')) {
            message = 'Detection timeout - please try again';
            isRetryable = true;
        } else if (error.message.includes('Network') || error.message.includes('connection')) {
            message = 'connection issue';
            isRetryable = true;
        } else if (error.status === 429 || error.message.includes('rate limit') || error.message.includes('Quota exceeded')) {
            message = 'rate limit exceeded';
            isRetryable = true;
            retryAfter = 60000;
        } else if (error.status === 404 || error.message.includes('not found')) {
            message = 'channel not found';
            isRetryable = false;
        } else if (isRetryable === null) {
            isRetryable = true;
        }

        const response: DetectionServiceResponse = {
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
                requestTime: getSystemTimestampISO(),
                errorType: error.constructor.name,
                errorMessage: error.message,
                errorStatus: error.status,
                responseTimeMs: responseTime
            };
        }

        return response;
    }

    _isChannelNotFoundError(error: ErrorWithStatus) {
        if (!error) {
            return false;
        }

        if (error.status === 404) {
            return true;
        }

        return error.message.toLowerCase().includes('channel not found');
    }

    _updateErrorMetrics(error: Error) {
        const errorType = error.constructor.name;
        this._metrics.errorsByType[errorType] = (this._metrics.errorsByType[errorType] || 0) + 1;
    }

    _isCircuitBreakerOpen() {
        if (!this._circuitBreaker.isOpen) {
            return false;
        }

        const now = Date.now();
        const lastFailureTime = this._circuitBreaker.lastFailureTime;
        if (lastFailureTime === null) {
            return true;
        }

        const timeSinceFailure = now - lastFailureTime;
        if (timeSinceFailure >= this._circuitBreaker.cooldownPeriod) {
            this._resetCircuitBreaker();
            return false;
        }

        return true;
    }

    _recordCircuitBreakerFailure(error: Error) {
        if (error.message && (
            error.message.includes('timeout')
            || error.message.includes('hanging')
            || error.message.includes('not found!')
            || error.message.includes('Type mismatch')
            || error.message.includes('Parser')
        )) {
            this._circuitBreaker.consecutiveFailures += 1;
            this._circuitBreaker.lastFailureTime = Date.now();

            if (this._circuitBreaker.consecutiveFailures >= this._circuitBreaker.maxFailures) {
                this._circuitBreaker.isOpen = true;
                this.logger.warn?.(`Circuit breaker opened after ${this._circuitBreaker.consecutiveFailures} consecutive failures`, 'youtube-stream-detection');
            }
        }
    }

    _resetCircuitBreaker() {
        this._circuitBreaker.consecutiveFailures = 0;
        this._circuitBreaker.lastFailureTime = null;
        this._circuitBreaker.isOpen = false;
    }

    _handleDetectionError(message: string, error: unknown, eventType: string) {
        if (error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, eventType, null, message);
            return;
        }

        this.errorHandler.logOperationalError(message, 'youtube-stream-detection', {
            eventType,
            error
        });
    }
}

export { YouTubeStreamDetectionService };
