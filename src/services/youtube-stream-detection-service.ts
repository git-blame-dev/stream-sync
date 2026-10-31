import { getSystemTimestampISO } from '../utils/timestamp';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { validateTimeout } from '../utils/timeout-validator';
import { isYouTubeVideoId, YouTubeLiveStreamService } from './youtube-live-stream-service';
import type { DiscoveryObservationKind, DiscoveryQualityReason } from './youtube-live-stream-service';
import type { InnertubeService } from './innertube-service';

type LoggerLike = {
    debug?: (message: string, scope?: string, payload?: unknown) => void;
    warn?: (message: string, scope?: string, payload?: unknown) => void;
    error: (message: string, scope?: string, payload?: unknown) => void;
};

type DetectionServiceOptions = {
    logger: LoggerLike;
    timeout?: number;
};

type DetectOptions = {
    debug?: boolean;
    signal?: AbortSignal;
    timeoutMs?: number;
};

type DetectionStream = {
    videoId?: unknown;
};

type DetectionResult = {
    streams: DetectionStream[];
    observationKind: DiscoveryObservationKind;
    qualityReason?: DiscoveryQualityReason;
    error?: string;
    malformed?: boolean;
    hasContent?: boolean;
    parserError?: boolean;
    detectionMethod?: string;
};

type LiveStreamServiceResult = Awaited<ReturnType<typeof YouTubeLiveStreamService.getLiveStreamsWithParserTolerance>>;
type DetectionClient = Parameters<typeof YouTubeLiveStreamService.getLiveStreamsWithParserTolerance>[0];
type MetadataOwner = Pick<InnertubeService, 'withMetadataOperation'>;

function hasDetectionCapability(client: object): client is DetectionClient {
    return 'getChannel' in client && typeof client.getChannel === 'function';
}

type DetectionServiceResponse = {
    success: boolean;
    observationKind: DiscoveryObservationKind;
    qualityReason?: DiscoveryQualityReason;
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

function resolveTimeout(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2147483647
        ? validateTimeout(value, fallback) : fallback;
}

class YouTubeStreamDetectionService {
    client: MetadataOwner | null;
    private cancellation = new AbortController();
    logger: LoggerLike;
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    timeout: number;
    _isShuttingDown: boolean;
    _metrics: UsageMetrics;
    _circuitBreaker: CircuitBreakerState;
    username?: string;

    constructor(innertubeClient: MetadataOwner, options: DetectionServiceOptions) {
        this.client = innertubeClient;

        if (!options.logger || typeof options.logger.error !== 'function') {
            throw new Error('YouTubeStreamDetectionService requires a logger');
        }

        this.logger = options.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'youtube-stream-detection');
        this.timeout = resolveTimeout(options.timeout, 2000);
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
        const startTime = performance.now();
        if (this._isShuttingDown) {
            return this._formatErrorResponse(new Error('YouTube stream detection service stopped'), options.debug, startTime);
        }
        this._metrics.totalRequests += 1;

        try {
            if (this._isCircuitBreakerOpen()) {
                const error = new Error('Circuit breaker is open - service temporarily unavailable');
                this._metrics.failedRequests += 1;
                this._updateErrorMetrics(error);
                return this._formatErrorResponse(
                    error,
                    options.debug,
                    startTime,
                    true
                );
            }

            if (!channelHandle || typeof channelHandle !== 'string') {
                const error = new Error('Channel handle is required');
                this._metrics.failedRequests += 1;
                this._updateErrorMetrics(error);
                return this._formatErrorResponse(
                    error,
                    options.debug,
                    startTime,
                    false
                );
            }

            const cleanHandle = this._cleanChannelHandle(channelHandle);
            if (!cleanHandle) {
                const error = new Error('Channel handle is required');
                this._metrics.failedRequests += 1;
                this._updateErrorMetrics(error);
                return this._formatErrorResponse(error, options.debug, startTime, false);
            }

            this.logger.debug?.('Detecting live streams for channel', 'youtube-stream-detection');

            if (!this.client || this._isShuttingDown) {
                throw new Error('YouTube stream detection client is not configured');
            }
            const signal = AbortSignal.any([
                this.cancellation.signal,
                ...(options.signal ? [options.signal] : [])
            ]);
            const detectionResult = await this.client.withMetadataOperation({
                signal,
                timeoutMs: resolveTimeout(options.timeoutMs, this.timeout)
            }, async client => {
                if (!hasDetectionCapability(client)) {
                    throw new Error('Innertube client requires getChannel for stream detection');
                }
                const result = await this._performDetection(cleanHandle, client, resolveTimeout(options.timeoutMs, this.timeout));
                signal.throwIfAborted();
                return result;
            });
            signal.throwIfAborted();

            const validVideoIds = this._validateVideoIds(detectionResult.streams);
            if (validVideoIds.length !== detectionResult.streams.length) {
                detectionResult.observationKind = 'partial';
                detectionResult.qualityReason = 'invalid_video_ids';
            }

            if (detectionResult.observationKind !== 'complete' && validVideoIds.length === 0) {
                const error = new Error(detectionResult.error || 'Incomplete stream discovery');
                this._metrics.failedRequests += 1;
                this._updateErrorMetrics(error);
                this._recordCircuitBreakerFailure(error);
                return {
                    ...this._formatErrorResponse(error, options.debug, startTime),
                    observationKind: detectionResult.observationKind,
                    qualityReason: detectionResult.qualityReason ?? 'detection_unavailable',
                    hasContent: detectionResult.hasContent ?? false,
                    detectionMethod: detectionResult.detectionMethod ?? null
                };
            }

            // Complete negatives and partial positives remain usable successes.
            this._metrics.successfulRequests += 1;
            const responseTime = performance.now() - startTime;
            this._metrics.totalResponseTime += responseTime;
            this._resetCircuitBreaker();

            return this._formatSuccessResponse(validVideoIds, options.debug, responseTime, detectionResult);
        } catch (error) {
            const normalizedError = asError(error);

            if (!this._isShuttingDown) {
                this._metrics.failedRequests += 1;
                this._updateErrorMetrics(normalizedError);
                this._recordCircuitBreakerFailure(normalizedError);
            }

            if (!this._isChannelNotFoundError(normalizedError)) {
                this._handleDetectionError(
                    'Stream detection failed',
                    new Error('Stream detection failed'),
                    'stream-detection'
                );
            }

            return this._formatErrorResponse(normalizedError, options.debug, startTime, null,
                options.signal?.aborted || this.cancellation.signal.aborted ? 'AbortError' : undefined);
        }
    }

getUsageMetrics(): {
totalRequests: number;
successfulRequests: number;
failedRequests: number;
averageResponseTime: number;
errorRate: number;
errorsByType: Record<string, number>;
} {
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

updateConfiguration(newConfig: { timeout?: number; username?: string }): boolean {
        try {
            this.timeout = resolveTimeout(newConfig?.timeout, this.timeout);

            if (newConfig.username) {
                this.username = newConfig.username;
            }

            this.logger.debug?.('Configuration updated successfully', 'youtube-stream-detection');
            return true;
        } catch (_error) {
            this._handleDetectionError('Configuration update failed', new Error('Configuration update failed'), 'configuration-update');
            return false;
        }
    }

isConfigured(): boolean {
        return this.client !== null && typeof this.client !== 'undefined';
    }

isActive(): boolean {
        return this.isConfigured() && !this._isShuttingDown;
    }

async cleanup(): Promise<void> {
        try {
            this._isShuttingDown = true;
            this.cancellation.abort(new Error('YouTube stream detection service stopped'));
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
            this._handleDetectionError('Detection cleanup failed', new Error('Detection cleanup failed'), 'cleanup');
            throw error;
        }
    }

async _performDetection(channelHandle: string, detectionClient: DetectionClient, timeout = this.timeout): Promise<DetectionResult> {
const result: LiveStreamServiceResult = await YouTubeLiveStreamService.getLiveStreamsWithParserTolerance(
detectionClient,
channelHandle,
            {
                timeout,
                logger: {
                    debug: () => {},
                    warn: () => this.logger.warn?.('YouTube discovery warning', 'youtube-stream-detection'),
                    error: () => this._handleDetectionError('YouTube discovery failed', new Error('YouTube discovery failed'), 'stream-detection')
                }
            }
        );

        const parserError: boolean = result.parserError === true;
        const detectionMethod: string = typeof result.detectionMethod === 'string'
            ? result.detectionMethod
            : 'unknown';
        return {
            streams: result.streams,
            observationKind: result.observationKind,
            ...(result.qualityReason ? { qualityReason: result.qualityReason } : {}),
            ...(result.error ? { error: result.error } : {}),
            malformed: parserError,
            hasContent: result.hasContent ?? false,
            parserError,
            detectionMethod
        };
    }

_cleanChannelHandle(handle: unknown): string {
        if (!handle || typeof handle !== 'string') {
            return '';
        }

        let cleanHandle = handle.trim();
        if (cleanHandle.startsWith('@')) {
            cleanHandle = cleanHandle.substring(1);
        }

        return cleanHandle.trim();
    }

_validateVideoIds(streams: DetectionStream[]): string[] {
        return streams
            .map((stream) => stream.videoId)
            .filter((videoId): videoId is string => this._isValidVideoId(videoId));
    }

_isValidVideoId(videoId: unknown): videoId is string {
        return isYouTubeVideoId(videoId);
    }

    _formatSuccessResponse(
        videoIds: string[],
        includeDebug: boolean | undefined,
        responseTime: number,
        detectionResult: DetectionResult
    ): DetectionServiceResponse {

        let message: string;
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
            observationKind: detectionResult.observationKind,
            ...(detectionResult.qualityReason ? { qualityReason: detectionResult.qualityReason } : {}),
            videoIds,
            message,
            responseTime,
            detectionMethod: detectionResult.detectionMethod ?? null,
            hasContent: detectionResult.hasContent ?? false
        };

        if (includeDebug) {
            response.debug = {
                requestTime: getSystemTimestampISO(),
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
        retryable: boolean | null = null,
        cancellationType?: 'AbortError'
    ): DetectionServiceResponse {
        const responseTime = performance.now() - startTime;

        let message = 'Unable to detect streams';
        let isRetryable: boolean | null = retryable;
        let retryAfter: number | undefined;

        if (error.name === 'TimeoutError' || error.message.includes('timeout')) {
            message = 'Detection timeout - please try again';
            isRetryable = true;
        } else if (error.message.includes('Network') || error.message.includes('connection')) {
            message = 'connection issue';
            isRetryable = true;
        } else if (error.status === 429 || error.message.includes('rate limit') || error.message.includes('Quota exceeded')) {
            message = 'rate limit exceeded';
            isRetryable = true;
            retryAfter = 60000;
        } else if (this._isChannelNotFoundError(error)) {
            message = 'channel not found';
            isRetryable = false;
        } else if (isRetryable === null) {
            isRetryable = true;
        }

        const response: DetectionServiceResponse = {
            success: false,
            observationKind: 'unavailable',
            qualityReason: 'detection_unavailable',
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
                errorType: cancellationType ?? (error instanceof DOMException ? 'DOMException' : error instanceof TypeError ? 'TypeError' : 'Error'),
                errorMessage: message,
                responseTimeMs: responseTime
            };
            if (typeof error.status === 'number' && Number.isInteger(error.status) && error.status >= 100 && error.status <= 599) {
                response.debug.errorStatus = error.status;
            }
        }

        return response;
    }

_isChannelNotFoundError(error: ErrorWithStatus): boolean {
        if (!error) {
            return false;
        }

        if (error.status === 404) {
            return true;
        }

        return /channel[\s_-]+not[\s_-]+found/i.test(error.message);
    }

_updateErrorMetrics(error: Error): void {
        const errorType = error.name === 'TimeoutError' ? 'TimeoutError' : 'Error';
        this._metrics.errorsByType[errorType] = (this._metrics.errorsByType[errorType] || 0) + 1;
    }

_isCircuitBreakerOpen(): boolean {
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

_recordCircuitBreakerFailure(error: Error): void {
        if (this._isChannelNotFoundError(error)) return;
        if (error.message && (
            error.name === 'TimeoutError'
            || error.message.includes('timeout')
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

_resetCircuitBreaker(): void {
        this._circuitBreaker.consecutiveFailures = 0;
        this._circuitBreaker.lastFailureTime = null;
        this._circuitBreaker.isOpen = false;
    }

_handleDetectionError(message: string, error: unknown, eventType: string): void {
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
