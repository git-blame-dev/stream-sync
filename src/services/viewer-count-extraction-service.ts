import { YouTubeViewerExtractor, type ViewerExtractionResult } from '../extractors/youtube-viewer-extractor';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { validateTimeout } from '../utils/timeout-validator';
import type { InnertubeService } from './innertube-service';

type ServiceDependencies = {
    logger?: {
        debug?: (message: string, context?: string, payload?: unknown) => void;
    };
    timeout?: unknown;
};

type InnertubeServiceLike = Pick<InnertubeService, 'withMetadataOperation'>;

type ExtractionConfig = {
    timeout: number;
};

type ExtractionStats = {
    totalRequests: number;
    successfulExtractions: number;
    failedExtractions: number;
    averageResponseTime: number;
    errorsByType: Record<string, number>;
    startTime: number;
};

type ExtractViewerCountOptions = {
    signal?: AbortSignal;
    timeout?: unknown;
    maxConcurrency?: unknown;
};

type ExtractionResponse = {
    success: boolean;
    count: number;
    videoId: string;
    responseTime?: number;
    strategy?: ViewerExtractionResult['strategy'];
    metadata?: ViewerExtractionResult['metadata'];
    error?: string;
    errorType?: string;
};

const EXTRACTION_FAILURE = 'Viewer count extraction failed';

function getErrorType(error: unknown): string {
    if (error instanceof DOMException) return error.name === 'AbortError' ? 'AbortError' : error.name === 'TimeoutError' ? 'TimeoutError' : 'DOMException';
    return error instanceof TypeError ? 'TypeError' : error instanceof Error ? 'Error' : 'UnknownError';
}

function resolvePositiveNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2147483647
        ? validateTimeout(value, fallback) : fallback;
}

function resolveNonNegativeInteger(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function isValidViewerCount(count: number): boolean {
    return YouTubeViewerExtractor.isValidViewerCount(count);
}

class ViewerCountExtractionService {
    innertubeService: InnertubeServiceLike;
    logger?: ServiceDependencies['logger'];
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    config: ExtractionConfig;
    stats: ExtractionStats;
    private totalResponseTime = 0;
    private readonly startedAt = performance.now();

    constructor(innertubeService: InnertubeServiceLike, dependencies: ServiceDependencies = {}) {
        this.innertubeService = innertubeService;
        this.logger = dependencies.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'viewer-count-extraction');
        
        this.config = {
            timeout: resolvePositiveNumber(dependencies.timeout, 8000)
        };
        
        this.stats = {
            totalRequests: 0,
            successfulExtractions: 0,
            failedExtractions: 0,
            averageResponseTime: 0,
            errorsByType: {},
            startTime: Date.now()
        };
    }
    
    async extractViewerCount(videoId: string, options: ExtractViewerCountOptions = {}): Promise<ExtractionResponse> {
        const startTime = performance.now();
        this.stats.totalRequests++;
        let stage: 'request' | 'parse' = 'request';
        
        try {
            if (typeof videoId !== 'string' || videoId.length !== 11 || !/^[A-Za-z0-9_-]{11}$/.test(videoId)) throw new TypeError('Invalid video ID');
            options.signal?.throwIfAborted();
            const extractionResult = await this.innertubeService.withMetadataOperation({
                timeoutMs: resolvePositiveNumber(options.timeout, this.config.timeout),
                ...(options.signal ? { signal: options.signal } : {})
            }, async client => {
                const info = await client.getInfo(videoId, { client: 'WEB' });
                options.signal?.throwIfAborted();
                stage = 'parse';
                if (!info || typeof info !== 'object' || !('basic_info' in info) ||
                    !info.basic_info || typeof info.basic_info !== 'object' ||
                    !('id' in info.basic_info) || info.basic_info.id !== videoId) {
                    throw new TypeError('Video identity mismatch');
                }
                // The player supplies basic_info, but the count belongs to /next.
                // Both responses must identify the requested video independently.
                const page = 'page' in info ? info.page : undefined;
                const next = Array.isArray(page) ? page[1] : undefined;
                if (!next || typeof next !== 'object'
                    || next.current_video_endpoint?.payload?.videoId !== videoId) {
                    throw new TypeError('Viewer count source identity mismatch');
                }
                return YouTubeViewerExtractor.extractConcurrentViewers(info);
            });
            options.signal?.throwIfAborted();
            
            const responseTime = performance.now() - startTime;
            const success = extractionResult.success === true && isValidViewerCount(extractionResult.count);
            this._updateStats(success, responseTime);
            
            if (success) {
                return {
                    success: true,
                    count: extractionResult.count,
                    strategy: extractionResult.strategy,
                    videoId,
                    responseTime,
                    metadata: extractionResult.metadata
                };
            } else {
                this.logger?.debug?.(
                    '[ViewerCountExtraction] Viewer count unavailable',
                    'viewer-extraction'
                );
                
                return {
                    success: false,
                    count: 0,
                    videoId,
                    responseTime,
                    error: 'Extraction failed',
                    metadata: extractionResult.metadata
                };
            }
            
        } catch (error: unknown) {
            const responseTime = performance.now() - startTime;
            this._updateStats(false, responseTime, error);
            
            this._handleExtractionError(`${EXTRACTION_FAILURE} during ${stage} (${getErrorType(error)})`, new Error(EXTRACTION_FAILURE));
            
            return {
                success: false,
                count: 0,
                videoId,
                responseTime,
                error: EXTRACTION_FAILURE,
                errorType: options.signal?.aborted ? 'AbortError' : getErrorType(error)
            };
        }
    }
    
    async extractViewerCountsBatch(videoIds: string[], options: ExtractViewerCountOptions = {}): Promise<ExtractionResponse[]> {
        const requested = resolveNonNegativeInteger(options.maxConcurrency, 3);
        const maxConcurrency = requested === 0 ? 3 : Math.min(5, requested);
        const results = new Array<ExtractionResponse>(videoIds.length);
        let next = 0;
        // Refill each available slot without waiting for unrelated slower requests.
        await Promise.all(Array.from({ length: Math.min(maxConcurrency, videoIds.length) }, async () => {
            while (next < videoIds.length) {
                const index = next++;
                const videoId = videoIds[index]!;
                try {
                    results[index] = await this.extractViewerCount(videoId, options);
                } catch {
                    results[index] = { success: false, count: 0, videoId, error: EXTRACTION_FAILURE, errorType: 'Promise' };
                }
            }
        }));
        
        return results;
    }
    
    async getAggregatedViewerCount(videoIds: string[], options: ExtractViewerCountOptions = {}): Promise<{
        success: boolean;
        totalCount: number;
        successfulStreams: number;
        failedStreams: number;
        streams: Array<{ videoId: string; count: number; success: boolean; strategy?: string | null; error?: string }>;
        error?: string;
    }> {
        videoIds = [...new Set(videoIds)];
        if (videoIds.length === 0) {
            return {
                success: true,
                totalCount: 0,
                successfulStreams: 0,
                failedStreams: 0,
                streams: []
            };
        }

        const results = await this.extractViewerCountsBatch(videoIds, options);
        
        let totalCount = 0;
        let successfulStreams = 0;
        let failedStreams = 0;
        let safeTotal = true;
        
        const streamDetails = videoIds.map((videoId, index) => {
            const result = results[index];
            const success = !!result && result.videoId === videoId && result.success && isValidViewerCount(result.count);
            if (success) {
                const nextTotal = totalCount + result.count;
                if (isValidViewerCount(nextTotal)) {
                    totalCount = nextTotal;
                } else {
                    safeTotal = false;
                }
                successfulStreams++;
            } else {
                failedStreams++;
            }
            
            return {
                videoId,
                count: success ? result.count : 0,
                success,
                ...(result?.strategy === undefined ? {} : { strategy: result.strategy }),
                ...(!success ? { error: result?.error || 'Missing or invalid viewer count' } : {})
            };
        });

        if (failedStreams > 0 || !safeTotal || results.length !== videoIds.length) {

            return {
                success: false,
                totalCount: 0,
                successfulStreams,
                failedStreams,
                streams: streamDetails,
                error: !safeTotal ? 'Unsafe aggregate viewer count' : 'Incomplete viewer count aggregation'
            };
        }

        return {
            success: true,
            totalCount,
            successfulStreams,
            failedStreams,
            streams: streamDetails
        };
    }
    
    getStats(): ExtractionStats & { uptime: number; successRate: string } {
        return {
            ...this.stats,
            uptime: performance.now() - this.startedAt,
            successRate: this.stats.totalRequests > 0 ? 
                (this.stats.successfulExtractions / this.stats.totalRequests * 100).toFixed(2) + '%' : '0%'
        };
    }
    
    updateConfig(newConfig: Record<string, unknown> | null | undefined): void {
        if (!newConfig || typeof newConfig !== 'object' || Array.isArray(newConfig)) return;
        this.config = {
            timeout: resolvePositiveNumber(newConfig.timeout, this.config.timeout)
        };

    }
    
    _updateStats(success: boolean, responseTime: number, error: unknown = null): void {
        if (success) {
            this.stats.successfulExtractions++;
        } else {
            this.stats.failedExtractions++;
            
            if (error) {
                const errorType = getErrorType(error);
                this.stats.errorsByType[errorType] = (this.stats.errorsByType[errorType] || 0) + 1;
            }
        }
        
        this.totalResponseTime += responseTime;
        const completed = this.stats.successfulExtractions + this.stats.failedExtractions;
        this.stats.averageResponseTime = Math.round(this.totalResponseTime / completed);
    }

    _handleExtractionError(message: string, error: unknown): void {
        if (this.errorHandler && error instanceof Error) {
            this.errorHandler.handleEventProcessingError(error, 'viewer-extraction', null, message);
        } else {
            this.errorHandler?.logOperationalError(message, 'viewer-count-extraction');
        }
    }
}

export { ViewerCountExtractionService };
