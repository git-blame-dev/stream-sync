import { YouTubeViewerExtractor } from '../extractors/youtube-viewer-extractor';
import { createPlatformErrorHandler } from '../utils/platform-error-handler';
import { validateTimeout } from '../utils/timeout-validator';
import type { InnertubeService } from './innertube-service';

type ViewerExtractor = {
    extractConcurrentViewers: (
        videoInfo: Record<string, unknown>,
        options?: { debug?: boolean; strategies?: string[] }
    ) => {
        success: boolean;
        count: number;
        strategy?: string | null;
        metadata?: {
            strategiesAttempted?: string[];
            [key: string]: unknown;
        };
    };
};

type ServiceDependencies = {
    logger?: {
        debug?: (message: string, context?: string, payload?: unknown) => void;
    };
    timeout?: unknown;
    strategies?: unknown;
    debug?: unknown;
    retries?: unknown;
    YouTubeViewerExtractor?: ViewerExtractor;
};

type InnertubeServiceLike = Pick<InnertubeService, 'withMetadataOperation'>;

type ExtractionConfig = {
    timeout: number;
    strategies: string[];
    debug: boolean;
    retries: number;
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
    instanceKey?: unknown;
    debug?: unknown;
    strategies?: unknown;
    maxConcurrency?: unknown;
};

type ExtractionResponse = {
    success: boolean;
    count: number;
    videoId: string;
    responseTime?: number;
    strategy?: string | null;
    metadata?: Record<string, unknown>;
    error?: string;
    errorType?: string;
};

const STRATEGIES = ['view_text', 'video_details', 'basic_info'];
const EXTRACTION_FAILURE = 'Viewer count extraction failed';

function getErrorType(error: unknown): string {
    if (error instanceof DOMException) return error.name === 'AbortError' ? 'AbortError' : error.name === 'TimeoutError' ? 'TimeoutError' : 'DOMException';
    return error instanceof TypeError ? 'TypeError' : error instanceof Error ? 'Error' : 'UnknownError';
}

function resolvePositiveNumber(value: unknown, fallback: number): number {
    return typeof value === 'number' && Number.isInteger(value) && value >= 1 && value <= 2147483647
        ? validateTimeout(value, fallback) : fallback;
}

function resolveNonEmptyArray(value: unknown, fallback: string[]): string[] {
    if (!Array.isArray(value) || value.length === 0) {
        return fallback;
    }

    const strategies = [...new Set(value.filter((item): item is string => typeof item === 'string' && STRATEGIES.includes(item)))];
    return strategies.length > 0 ? strategies : [...fallback];
}

function resolveBoolean(value: unknown, fallback = false): boolean {
    return typeof value === 'boolean' ? value : fallback;
}

function resolveNonNegativeInteger(value: unknown, fallback = 0): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback;
}

function isValidViewerCount(count: number): boolean {
    return YouTubeViewerExtractor.isValidViewerCount(count);
}

function toMetadataRecord(metadata: unknown): Record<string, unknown> | undefined {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
        return undefined;
    }

    const source = metadata as Record<string, unknown>;
    const projected: Record<string, unknown> = {};
    if (Array.isArray(source.strategiesAttempted)) {
        projected.strategiesAttempted = [...new Set(source.strategiesAttempted.slice(0, 100).filter(
            (strategy): strategy is string => typeof strategy === 'string' && STRATEGIES.includes(strategy)
        ))];
    }
    if (source.error !== undefined) projected.error = 'Extraction unavailable';
    if (source.rawData === null) projected.rawData = null;
    if (source.rawData && typeof source.rawData === 'object' && !Array.isArray(source.rawData)) {
        const raw = source.rawData as Record<string, unknown>;
        const details: Record<string, unknown> = {};
        for (const strategy of STRATEGIES) {
            const entry = raw[strategy];
            if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
            const record = entry as Record<string, unknown>;
            const fields: Record<string, unknown> = {};
            if (typeof record.sourceField === 'string' && ['viewer_count', 'concurrent_viewers', 'view_count'].includes(record.sourceField)) fields.sourceField = record.sourceField;
            for (const flag of ['hasViewText', 'hasVideoDetails', 'hasBasicInfo', 'is_live']) {
                if (typeof record[flag] === 'boolean') fields[flag] = record[flag];
            }
            if (typeof record.patternMatched === 'string' && ['watching_now', 'watching', 'currently_watching', 'viewers_watching', 'people_watching'].includes(record.patternMatched)) fields.patternMatched = record.patternMatched;
            if (record.error !== undefined) fields.error = 'Extraction unavailable';
            details[strategy] = fields;
        }
        projected.rawData = details;
    }
    return Object.keys(projected).length ? projected : undefined;
}

class ViewerCountExtractionService {
    innertubeService: InnertubeServiceLike;
    logger?: ServiceDependencies['logger'];
    errorHandler: ReturnType<typeof createPlatformErrorHandler>;
    YouTubeViewerExtractor: ViewerExtractor;
    config: ExtractionConfig;
    stats: ExtractionStats;
    private totalResponseTime = 0;
    private readonly startedAt = performance.now();

    constructor(innertubeService: InnertubeServiceLike, dependencies: ServiceDependencies = {}) {
        this.innertubeService = innertubeService;
        this.logger = dependencies.logger;
        this.errorHandler = createPlatformErrorHandler(this.logger, 'viewer-count-extraction');
        
        this.YouTubeViewerExtractor = dependencies.YouTubeViewerExtractor || 
            YouTubeViewerExtractor;
        
        this.config = {
            timeout: resolvePositiveNumber(dependencies.timeout, 8000),
            strategies: resolveNonEmptyArray(dependencies.strategies, ['view_text', 'video_details', 'basic_info']),
            debug: resolveBoolean(dependencies.debug, false),
            retries: resolveNonNegativeInteger(dependencies.retries, 0)
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

            
            const extractionResult = await this.innertubeService.withMetadataOperation({
                timeoutMs: resolvePositiveNumber(options.timeout, this.config.timeout),
                ...(options.signal ? { signal: options.signal } : {})
            }, async client => {
                const info = await client.getInfo(videoId, { client: 'WEB' });
                options.signal?.throwIfAborted();
                stage = 'parse';
                const result = this.YouTubeViewerExtractor.extractConcurrentViewers(
                    info && typeof info === 'object' && !Array.isArray(info) ? info as Record<string, unknown> : {},
                    {
                        debug: resolveBoolean(options.debug, this.config.debug),
                        strategies: resolveNonEmptyArray(options.strategies, this.config.strategies)
                    }
                );
                return { ...result, metadata: toMetadataRecord(result.metadata) };
            });
            options.signal?.throwIfAborted();
            
            const responseTime = performance.now() - startTime;
            const success = extractionResult.success === true && isValidViewerCount(extractionResult.count);
            this._updateStats(success, responseTime);
            
            if (success) {

                
                const metadata = toMetadataRecord(extractionResult.metadata);
                return {
                    success: true,
                    count: extractionResult.count,
                    ...(extractionResult.strategy === null ? { strategy: null } : typeof extractionResult.strategy === 'string' && STRATEGIES.includes(extractionResult.strategy) ? { strategy: extractionResult.strategy } : {}),
                    videoId,
                    responseTime,
                    ...(metadata === undefined ? {} : { metadata })
                };
            } else {
                this.logger?.debug?.(
                    '[ViewerCountExtraction] Viewer count unavailable',
                    'viewer-extraction'
                );
                
                const metadata = toMetadataRecord(extractionResult.metadata);
                return {
                    success: false,
                    count: 0,
                    videoId,
                    responseTime,
                    error: 'Extraction failed',
                    ...(metadata === undefined ? {} : { metadata })
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
        const results: ExtractionResponse[] = [];
        

        
        // Process in batches to avoid overwhelming the service
        for (let i = 0; i < videoIds.length; i += maxConcurrency) {
            const batch = videoIds.slice(i, i + maxConcurrency);
            const batchPromises = batch.map(videoId => 
                this.extractViewerCount(videoId, options)
            );
            
            const batchResults = await Promise.allSettled(batchPromises);
            
            const processedResults: ExtractionResponse[] = batchResults.map((result, index) => {
                if (result.status === 'fulfilled') {
                    return result.value;
                } else {
                    return {
                        success: false,
                        count: 0,
                        videoId: batch[index] || '',
                        error: EXTRACTION_FAILURE,
                        errorType: 'Promise'
                    };
                }
            });
            
            results.push(...processedResults);
        }
        
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
        if (!videoIds || videoIds.length === 0) {
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
            timeout: resolvePositiveNumber(newConfig.timeout, this.config.timeout),
            strategies: resolveNonEmptyArray(newConfig.strategies, this.config.strategies),
            debug: resolveBoolean(newConfig.debug, this.config.debug),
            retries: resolveNonNegativeInteger(newConfig.retries, this.config.retries)
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
